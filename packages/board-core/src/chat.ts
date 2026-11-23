// @effect-diagnostics globalDate:off globalRandom:off
/* oxlint-disable t3code/no-em-dash-copy -- Board protocol and tool text shared verbatim with the Claude Code mod; "## Phase A — name" is the plan.md format. */
/**
 * One chat on the board (a Claude Code session or a T3 thread): its record, its context, its tools.
 * Rules and texts must match the Claude Code mod's `hooks/register.ts`, which shares the files.
 *
 * @module board-core/chat
 */
import {
  BoardEditError,
  type EditActor,
  addDecision,
  createTask,
  findDecision,
  moveTask,
  promoteTask,
  setSessionTask,
  setTaskLink,
  settleDecision,
  syncDelegatedSteps,
} from "./edit.ts";
import type { BoardGit } from "./io.ts";
import {
  type Goal,
  type GoalGroup,
  goalDrift,
  goalLedger,
  listGoals,
  loadGoal,
  nextGoalTask,
  nextGroupTask,
  planGroups,
  saveGoal,
  scopeTasks,
} from "./goal.ts";
import {
  nextStep,
  objectiveLine,
  planPhases,
  planProgress,
  setStepDone,
  tickStep,
} from "./plan.ts";
import {
  type BoardHost,
  boardModeProtocol,
  resumeHint,
  type T3OnDemandRule,
  t3GoalRules,
  t3GoalWorkerRules,
  t3OnDemandRule,
  t3Rules,
  toolRules,
} from "./protocol.ts";
import { BoardStore, LEVEL_NAME, findBoard, levelOf } from "./store.ts";
import { namedTask, queryWords, type SearchHit, searchTasks } from "./search.ts";
import { type DoneCheck, doneEvidence, evidenceLine, verifyDone } from "./verify.ts";
import { checksForTask } from "./view.ts";
import {
  base,
  clip,
  firstPara,
  isInside,
  norm,
  parent,
  safeFileName,
  sameRoot,
  slug,
  stamp,
} from "./text.ts";
import type {
  Board,
  CheckResult,
  Decision,
  ItemKind,
  Level,
  LinkType,
  RepoState,
  Service,
  Session,
  SessionSource,
  Task,
} from "./types.ts";

/** What a board tool or command returns: text for the agent, plus an optional toast for the UI. */
export interface BoardReply {
  readonly text: string;
  readonly toast?: string | undefined;
  /** Extra context for the agent alongside the reply (commands only). */
  readonly context?: ReadonlyArray<string> | undefined;
}

export interface OpenChatInput {
  readonly sessionId: string;
  readonly cwd: string;
  /**
   * The project folder `cwd` belongs to, when it can sit outside it (a T3 worktree): the chat
   * goes on that folder's board when `cwd` itself is on none.
   */
  readonly projectRoot?: string | undefined;
  /** The host app's own id for the chat, when it can give the same chat a new engine id. */
  readonly hostSessionId?: string | undefined;
  readonly surface?: string | undefined;
  readonly source?: SessionSource | undefined;
}

// VS Code's placeholder folder for untrusted workspaces, and similar: never reported.
const IGNORED = /\/globalStorage\/|\/untrusted-start(\/|$)/i;
/** How many recently active tasks an unlinked chat sees; the rest are a board_find away. */
const UNLINKED_TASKS = 8;
/** The living handoff's share of a T3 thread's resume summary. */
const RESUME_HANDOFF_CHARS = 3000;
/** How many matches a search shows; the rest are a narrower query away. */
const SEARCH_HITS = 5;
/** How many changed files a task keeps as done evidence. */
const TASK_FILES = 200;

const reply = (text: string, toast?: string): BoardReply => (toast ? { text, toast } : { text });
const str = (v: unknown, fallback = ""): string =>
  v === undefined || v === null ? fallback : String(v);

export const repoLine = (r: RepoState): string =>
  `${r.name} · ${r.branch} @ ${r.head} · ${!r.upstream ? "not pushed (no upstream)" : r.ahead ? `${r.ahead} commit(s) not pushed` : "pushed"}${r.behind ? `, ${r.behind} behind` : ""} · ${r.dirty ? `${r.dirty} uncommitted` : "clean"}`;

interface PendingCheckpoint {
  readonly boardId: string;
  readonly taskId: string;
  readonly step: string | null;
  readonly living: boolean;
}

const checkpointMarker = (ref: string | undefined, runId: string | undefined): string =>
  ref ? ` · checkpoint ${ref}` : runId ? ` · awaiting checkpoint ${encodeURIComponent(runId)}` : "";

export class BoardChat {
  readonly store: BoardStore;
  readonly git: BoardGit;
  readonly host: BoardHost;

  board: Board | null = null;
  sess: Session | null = null;
  ignored = false;
  /** The context section the agent gets; "" when there is nothing to say. */
  context = "";
  /** T3 threads: the rules that don't change with the task's state, sent apart from `context`. */
  rules = "";
  /** T3 threads: what the agent last got in a tool's reply, so it isn't sent again. */
  contextSeen = "";
  rulesSeen = "";
  /** One line naming the task an unlinked thread's first prompt plainly mentions. */
  private related = "";
  /** The way to save another name for an item is explained at a thread's first missed search. */
  private aliasTold = false;
  private readonly told = new Set<T3OnDemandRule>();
  private readonly doneChecks = new Map<
    string,
    { readonly at: number; readonly evidenceAt: number | undefined; readonly check: DoneCheck }
  >();
  /** A chat is written only once the person has spoken in it (or it was linked or set up). */
  reported = false;
  lastActionSetThisTurn = false;
  private readonly warnedServices = new Set<string>();
  private projectRoot: string | undefined;

  constructor(store: BoardStore, git: BoardGit, host: BoardHost) {
    this.store = store;
    this.git = git;
    this.host = host;
  }

  private now(): number {
    return this.store.clock.now();
  }
  private get boardId(): string {
    return this.board?.id ?? "";
  }
  private loadTask(id: string) {
    return this.board ? this.store.loadTask(this.board.id, id) : Promise.resolve(null);
  }

  private async lookupTask(id: string): Promise<Task | null> {
    const safeId = safeFileName(id);
    const exact =
      id === safeId && safeId && safeId !== "." && safeId !== ".." ? await this.loadTask(id) : null;
    return exact ?? this.loadTask(slug(id));
  }
  private saveTask(t: Task) {
    return this.store.saveTask(this.boardId, t);
  }
  private listTasks() {
    return this.board ? this.store.listTasks(this.board.id) : Promise.resolve([] as Task[]);
  }
  private readPlan(id: string) {
    return this.store.readText(this.store.planPath(this.boardId, id));
  }
  private livingPath(id: string) {
    return this.store.livingPath(this.boardId, id);
  }
  private masterPath(id: string) {
    return this.store.masterPath(this.boardId, id);
  }
  private svcName(id: string): string {
    return this.board?.services?.find((x) => x.id === id)?.name ?? id;
  }
  private currentBoard(): Board | null {
    return this.board;
  }
  get boardModeOn(): boolean {
    return !!this.board?.boardMode && !!this.sess?.taskId && !this.sess.boardModeOff;
  }
  async save(patch: Partial<Session>): Promise<void> {
    if (!this.sess || this.ignored) return;
    if (
      this.reported &&
      this.board &&
      patch.taskId === undefined &&
      patch.linkDeclined === undefined
    ) {
      const saved = await this.store.readSession(this.board.id, this.sess.sessionId);
      if (saved)
        this.sess = { ...this.sess, taskId: saved.taskId, linkDeclined: saved.linkDeclined };
    }
    this.sess = { ...this.sess, ...patch, updatedAt: this.now(), heartbeatAt: this.now() };
    if (this.reported) await this.store.writeSession(this.board?.id ?? null, this.sess);
  }

  /** Places the chat on its board (or leaves it unassigned). */
  async resolve(): Promise<void> {
    if (!this.sess) return;
    const reg = await this.store.loadRegistry();
    const hit =
      findBoard(reg, this.sess.cwd) ??
      (this.projectRoot === undefined ? null : findBoard(reg, this.projectRoot));
    const wasUnassigned = !this.board;
    const oldPath = this.store.sessionPath(this.board?.id ?? null, this.sess.sessionId);
    this.board = hit?.board ?? null;
    if (hit) {
      const rp = norm(hit.root.path);
      const sub = isInside(this.sess.cwd, rp)
        ? norm(this.sess.cwd).slice(rp.length).replace(/^\//, "")
        : "";
      this.sess = {
        ...this.sess,
        projectId: hit.board.id,
        workspace: rp,
        workspaceLabel: hit.root.label,
        subfolder: sub,
      };
      // Coming from unassigned: mark that record moved and carry its fields into the board.
      if (wasUnassigned) {
        const un = await this.store.readJson<Session | null>(oldPath, null);
        if (un && !un.movedTo) {
          await this.store.writeJson(oldPath, { ...un, movedTo: hit.board.id });
          this.sess = {
            ...this.sess,
            title: this.sess.title || un.title,
            lastPrompt: this.sess.lastPrompt || un.lastPrompt,
            lastAnswer: this.sess.lastAnswer || un.lastAnswer,
          };
          this.reported = true;
        }
      }
    } else {
      const sug = await this.suggestRoot(this.sess.cwd);
      this.sess = {
        ...this.sess,
        projectId: null,
        workspace: this.sess.cwd,
        workspaceLabel: base(this.sess.cwd),
        subfolder: "",
        suggestedRoot: sug.root,
        suggestedName: sug.name,
      };
    }
  }

  /** Nearest folder at or above the chat's folder holding a *.code-workspace file, else its repo. */
  private async suggestRoot(cwd: string): Promise<{ root: string; name: string }> {
    for (let d = cwd; d; d = parent(d)) {
      try {
        const ws = (await this.store.io.list(d)).find(
          (f) => f.kind === "file" && /\.code-workspace$/i.test(f.name),
        );
        if (ws) {
          const n = ws.name
            .replace(/\.code-workspace$/i, "")
            .replace(/[-_ .]*(copy|\d+)$/i, "")
            .trim();
          return { root: d, name: n.length <= 5 ? n.toUpperCase() : n };
        }
      } catch {}
    }
    const top = await this.git.root(cwd).catch(() => null);
    const r = top ? norm(top) : cwd;
    return { root: r, name: base(r).replace(/[-_ .]*(copy|\d+)$/i, "") || base(r) };
  }

  /** Session start: load or create the chat's record and build its context. */
  async open(input: OpenChatInput): Promise<void> {
    const where = norm(input.cwd);
    this.projectRoot = input.projectRoot;
    this.ignored = IGNORED.test(where + "/");
    if (this.ignored) return;
    const { sessionId, hostSessionId } = input;
    this.board = null;
    this.sess = {
      sessionId,
      projectId: null,
      taskId: null,
      linkDeclined: false,
      cwd: where,
      workspace: where,
      workspaceLabel: base(where),
      subfolder: "",
      branch: await this.git.branch(where).catch(() => ""),
      status: "idle",
      title: "",
      lastPrompt: "",
      lastAnswer: "",
      turnStartedAt: 0,
      updatedAt: this.now(),
      heartbeatAt: this.now(),
      hostSessionId,
      surface: input.surface,
      source: input.source,
    };
    await this.resolve();
    // resolve() sets the board; read it fresh, not through the `null` assigned above.
    const board = this.currentBoard();
    let prev = await this.store.readSession(board?.id ?? null, sessionId);
    this.reported = prev !== null && !prev.movedTo;
    // The host can give the same chat a new engine id (after /clear, a restart): carry the
    // earlier record's task link over and mark that record as replaced by this one.
    if (board && hostSessionId) {
      const boardId = board.id;
      const older = (await this.store.listSessions(boardId))
        .filter(
          (o) => o.sessionId !== sessionId && o.hostSessionId === hostSessionId && !o.supersededBy,
        )
        .toSorted((a, b) => b.updatedAt - a.updatedAt);
      for (const o of older) {
        prev = prev ?? o;
        await this.store.writeSession(boardId, { ...o, status: "ended", supersededBy: sessionId });
        if (!o.taskId) continue;
        const t = await this.store.loadTask(boardId, o.taskId);
        if (!t) continue;
        t.sessions = t.sessions.filter(
          (x) => x.sessionId !== o.sessionId && x.sessionId !== sessionId,
        );
        t.sessions.push({
          sessionId,
          linkedAt: this.now(),
          workspaceLabel: this.sess.workspaceLabel,
        });
        if (t.lastAction?.sessionId === o.sessionId) t.lastAction.sessionId = sessionId;
        await this.store.saveTask(boardId, t);
      }
      if (older.length) this.reported = true;
    }
    if (prev)
      this.sess = {
        ...this.sess,
        taskId: prev.taskId ?? null,
        linkDeclined: prev.linkDeclined ?? false,
        title: prev.title ?? "",
        lastPrompt: prev.lastPrompt ?? "",
        lastAnswer: prev.lastAnswer ?? "",
        boardModeOff: prev.boardModeOff,
        pickupNote: prev.pickupNote,
      };
    await this.save({});
    await this.rebuildContext();
  }

  /** A turn the person started. Host notices (`<task-notification>` …) aren't the person's words. */
  async turnStart(text: string): Promise<void> {
    if (!this.sess || this.ignored) return;
    this.lastActionSetThisTurn = false;
    const t = text.trim();
    this.sess.branch = await this.git.branch(this.sess.cwd).catch(() => this.sess?.branch ?? "");
    if (!this.board) await this.resolve().catch(() => {}); // a board may have been created meanwhile
    const isNotice = /^<[a-z][\w-]*[\s>]/i.test(t);
    if (!isNotice && t) this.reported = true;
    // Only the first prompt is matched, and only against whole titles and aliases.
    if (
      this.host === "t3" &&
      this.board &&
      !this.sess.taskId &&
      !isNotice &&
      t &&
      !this.sess.lastPrompt
    ) {
      const named = namedTask(await this.listTasks(), t);
      if (named) this.related = `Possibly related: ${named.id} "${named.title}".`;
    }
    const title = this.sess.title;
    await this.save(
      isNotice
        ? { status: "working", turnStartedAt: this.now(), title: /^</.test(title) ? "" : title }
        : {
            status: "working",
            turnStartedAt: this.now(),
            lastPrompt: clip(t, 500),
            title: (!/^</.test(title) && title) || clip(t.split("\n")[0] ?? "", 90),
          },
    ).catch(() => {});
    await this.rebuildContext().catch(() => {});
  }

  /** A turn finished: the answer's first paragraph is the last action unless a tool set one. */
  async turnComplete(answer: string): Promise<void> {
    if (!this.sess || this.ignored) return;
    const summary = clip(firstPara(answer), 300);
    await this.save({ status: "idle", lastAnswer: clip(answer, 800) }).catch(() => {});
    if (this.board && this.sess.taskId && !this.lastActionSetThisTurn && summary) {
      const t = await this.loadTask(this.sess.taskId);
      if (t) {
        t.lastAction = {
          text: summary,
          sessionId: this.sess.sessionId,
          workspaceLabel: this.sess.workspaceLabel,
          at: this.now(),
        };
        await this.saveTask(t).catch(() => {});
      }
    }
  }

  async end(resumeId?: string): Promise<void> {
    await this.save({ status: "ended", resumeId }).catch(() => {});
  }

  async recordCheck(check: CheckResult): Promise<void> {
    const taskId = this.sess?.taskId;
    if (!taskId || !this.board) return;
    const task = await this.loadTask(taskId);
    if (!task || task.checks?.some((previous) => previous.id === check.id)) return;
    task.checks = [check, ...(task.checks ?? [])].slice(0, 20);
    await this.saveTask(task);
  }

  /** Heartbeat: hosts that can't see a chat's liveness call this every ~30 seconds. */
  async heartbeat(): Promise<void> {
    if (this.sess && this.sess.status !== "ended") await this.save({});
  }
  /** The service whose folder pattern the path contains (the longest pattern wins). */
  serviceOfPath(file: string): Service | null {
    const f = "/" + norm(file).toLowerCase() + "/";
    let best: Service | null = null;
    let bestLen = 0;
    for (const svc of this.board?.services ?? [])
      for (const m of svc.match) {
        const pat = "/" + m.toLowerCase().replace(/^\/+|\/+$/g, "") + "/";
        if (f.includes(pat) && pat.length > bestLen) {
          best = svc;
          bestLen = pat.length;
        }
      }
    return best;
  }

  /**
   * A file the agent changed: tag the linked task with its service. Returns a note for the agent
   * the first time the work reaches a service outside the task's services so far.
   */
  /** Records the files a turn changed on the linked task: the evidence a later "done" rests on. */
  async filesChanged(files: ReadonlyArray<string>): Promise<void> {
    if (!this.board || !this.sess?.taskId || this.ignored || files.length === 0) return;
    const t = await this.loadTask(this.sess.taskId);
    // A turn's checkpoint lists its files after the task may be done; those are not its work.
    if (!t || t.status === "done") return;
    const s = this.sess;
    const copy = !isInside(s.cwd, s.workspace) ? s.cwd : s.workspace;
    const paths = files
      .map((file) => norm(/^([A-Za-z]:)?[/\\]/.test(file) ? file : `${copy}/${file}`))
      .filter((path) => !path.includes("/.local-run/"));
    if (paths.length === 0) return;
    const had = t.files ?? [];
    if (paths.every((path) => had.includes(path))) return;
    t.files = [...new Set([...paths, ...had])].slice(0, TASK_FILES);
    await this.saveTask(t);
  }

  /** Whether a finished task can be relied on from this workspace; cached briefly, as it runs git. */
  async doneCheck(t: Task): Promise<DoneCheck> {
    const cached = this.doneChecks.get(t.id);
    if (cached && cached.evidenceAt === t.doneEvidence?.at && this.now() - cached.at < 60_000)
      return cached.check;
    const repos = await this.reposFor(t);
    const check = await verifyDone(
      this.git,
      t,
      (name, recorded) => repos.find((r) => r.name === name)?.repo ?? recorded,
    );
    this.doneChecks.set(t.id, { at: this.now(), evidenceAt: t.doneEvidence?.at, check });
    return check;
  }

  async fileChanged(file: string): Promise<string | null> {
    if (!this.board || !this.sess?.taskId || this.ignored) return null;
    const svc = this.serviceOfPath(file);
    if (!svc) return null;
    const t = await this.loadTask(this.sess.taskId);
    if (!t) return null;
    const had = t.services ?? [];
    if (had.includes(svc.id)) return null;
    t.services = [...had, svc.id];
    await this.saveTask(t);
    await this.rebuildContext();
    if (!had.length || this.warnedServices.has(svc.id)) return null;
    this.warnedServices.add(svc.id);
    const thread = this.host === "t3" ? "thread" : "chat";
    return `Board: this edit is in ${svc.name}, outside this task's services so far (${had.map((x) => this.svcName(x)).join(", ")}). If it is a bug or extra work beyond this task's scope, stop and follow the out-of-scope protocol (ask: new task in another ${thread} / fix here with recorded scope / task for later). If it is genuinely part of this task, carry on; the task is now tagged ${svc.name}.`;
  }
  /** Ownership lives on modules and master tasks; a task belongs to its module's owner. */
  private async ownerNodeOf(t: Task): Promise<Task> {
    if (levelOf(t) === 3 && t.parentId) return (await this.loadTask(t.parentId)) ?? t;
    return t;
  }
  async ownerHolder(t: Task): Promise<Task | null> {
    let cur: Task | null = await this.ownerNodeOf(t);
    for (let i = 0; i < 3 && cur; i++) {
      if (cur.owner) return cur;
      cur = cur.parentId ? await this.loadTask(cur.parentId) : null;
    }
    return null;
  }
  private ownerHistory(
    t: Task,
    type: string,
    extra: { from?: string | undefined; to?: string | undefined },
  ) {
    t.ownerHistory = [
      ...(t.ownerHistory ?? []),
      { type, at: this.now(), by: this.sess?.sessionId, ...extra },
    ].slice(-30);
  }
  /** A one-time override counts for the chat that received it (and the task it was given on). */
  private hasOverride(t: Task): boolean {
    return (t.overrides ?? []).some((o) => o.session === this.sess?.sessionId);
  }

  /** The repos a task's module works in: its tree's service folders, else the chat's own repo. */
  async reposFor(t: Task): Promise<RepoState[]> {
    const node = await this.ownerNodeOf(t);
    const all = await this.listTasks();
    const desc = (id: string): Task[] =>
      all.filter((x) => x.parentId === id).flatMap((k) => [k, ...desc(k.id)]);
    const tree = [node, ...desc(node.id)];
    const ids = new Set(
      tree.flatMap((x) => [...(x.services ?? []), ...(x.mainService ? [x.mainService] : [])]),
    );
    const seen = new Map<string, RepoState>();
    for (const svc of this.board?.services ?? [])
      if (ids.has(svc.id))
        for (const m of svc.match) {
          // A worktree outside the board's root holds its own copy of each service folder.
          const s = this.sess;
          const copy = s && !isInside(s.cwd, s.workspace) ? s.cwd : s?.workspace;
          const dir = `${copy}/${m}`;
          if (!(await this.store.io.exists(dir).catch(() => false))) continue;
          const st = await this.git.state(dir);
          if (st && !seen.has(st.repo)) seen.set(st.repo, { ...st, service: svc.id });
        }
    if (!seen.size && this.sess) {
      const st = await this.git.state(this.sess.cwd);
      if (st) seen.set(st.repo, st);
    }
    return [...seen.values()];
  }
  async describeTask(t: Task, full: boolean): Promise<string> {
    const plan = await this.readPlan(t.id);
    const next = nextStep(plan);
    const living = await this.store.readText(this.livingPath(t.id));
    const ho = living ? null : await this.store.latestHandoff(this.boardId, t.id);
    const open = t.items.filter((i) => !i.done);
    const anc = await this.store.ancestorsOf(this.boardId, t);
    const kids = await this.store.childrenOf(this.boardId, t.id);
    const lv = levelOf(t);
    const crumb = [...anc]
      .reverse()
      .map((a) => a.title)
      .concat(t.title)
      .join(" › ");
    const lines = [
      `Task "${t.title}" (Level ${lv} ${LEVEL_NAME[lv]}, id: ${t.id}, status: ${t.status}) on the ${this.board?.name ?? "?"} board.`,
      anc.length ? `Path: ${crumb}` : "",
      t.description
        ? `Purpose: ${t.description}`
        : "Purpose: (not written yet — ask or infer, then save it with board_update.description)",
      next
        ? `Next step: ${next.id} – ${next.text}`
        : plan
          ? "Every plan step is ticked."
          : "No plan saved yet.",
      t.lastAction ? `Last action (${t.lastAction.workspaceLabel}): ${t.lastAction.text}` : "",
      `Living handoff: ${this.livingPath(t.id)}${living ? "" : " (not written yet)"}`,
    ];
    if (open.length)
      lines.push("Open items:", ...open.map((i) => `- [${i.kind}] ${i.text} (id ${i.id})`));
    // Binding decisions first: a long list of open questions must never push a verdict out.
    const decs: string[] = [];
    for (const d of t.decisions ?? [])
      if (d.status === "decided")
        decs.push(`- ${d.id} [L${d.level}, decided] ${d.title} → ${clip(d.verdict, 140)}`);
    for (const a of anc)
      for (const d of a.decisions ?? [])
        if (d.status === "decided")
          decs.push(
            `- ${d.id} [L${d.level} on "${a.title}", decided] ${d.title} → ${clip(d.verdict, 140)}`,
          );
    for (const d of t.decisions ?? [])
      if (d.status === "open")
        decs.push(
          `- ${d.id} [L${d.level}, open] ${d.title}${d.raisedFrom ? ` (raised in ${d.raisedFrom.title})` : ""}`,
        );
    for (const a of anc)
      for (const d of a.decisions ?? [])
        if (d.status === "open")
          decs.push(
            `- ${d.id} [L${d.level} on "${a.title}", open] ${d.title}${d.raisedFrom?.id === t.id ? " (raised here)" : ""}`,
          );
    if (decs.length)
      lines.push(
        "Decisions bearing on this task (decided ones are binding; open ones are not settled):",
        ...decs.slice(0, 20),
      );
    if (lv === 1)
      lines.push(
        `Kind: ${t.kind === "backlog" ? "service backlog (a service's own bugs and gaps)" : "feature"}${t.mainService ? ` · main service: ${this.svcName(t.mainService)}` : ""}`,
      );
    if (t.services?.length)
      lines.push(`Services touched: ${t.services.map((x) => this.svcName(x)).join(", ")}`);
    const holder = await this.ownerHolder(t);
    if (holder?.owner) {
      const o = holder.owner;
      const here = sameRoot(o.root, this.sess?.workspace);
      const who = this.host === "t3" ? "thread" : "chat";
      lines.push(
        `Ownership: "${holder.title}" is ${o.state === "soft" ? "soft-released by" : "owned by"} workspace ${o.label}${here ? " (this one)" : ""}.${!here && o.state === "owned" ? (this.hasOverride(t) ? ` This ${who} works here by a one-time override the person gave — coordinate branches with that copy.` : ` This ${who} must not change it unless the person agrees to an override.`) : ""}${here && o.state === "soft" ? " Reclaim it (board_release reclaim) before continuing here, or let another workspace take over." : ""}`,
      );
    }
    if (t.repoState?.length)
      lines.push(
        "Repo state at the last checkpoint:",
        ...t.repoState.map((r) => `- ${repoLine(r)}`),
      );
    if (t.bug) lines.push("This task fixes a bug found after the original work was done.");
    const linkLines: string[] = [];
    for (const l of t.links ?? []) {
      const o = await this.loadTask(l.to);
      if (!o) {
        linkLines.push(`- ${l.type} ${l.to} (missing/archived)`);
        continue;
      }
      const nx = nextStep(await this.readPlan(o.id));
      if (l.type === "blocked_by")
        linkLines.push(
          o.status === "done"
            ? `- Blocker resolved: "${o.title}" (${o.id}) is done.`
            : `- BLOCKED BY "${o.title}" (${o.id}, ${o.status}${nx ? `, next: ${nx.id} – ${nx.text}` : ""}). Don't start work that depends on it.`,
        );
      else if (l.type === "fixes")
        linkLines.push(
          `- Fixes "${o.title}" (${o.id}, ${o.status}) — its living handoff: ${this.livingPath(o.id)}`,
        );
      else
        linkLines.push(
          `- ${l.type === "found_during" ? "Found during" : "Related to"} "${o.title}" (${o.id}, ${o.status})${l.note ? ` — ${clip(l.note, 80)}` : ""}`,
        );
    }
    for (const o of await this.listTasks())
      for (const l of o.links ?? [])
        if (l.to === t.id) {
          if (l.type === "fixes") {
            if (o.status !== "done")
              linkLines.push(`- Open fix: "${o.title}" (${o.id}) fixes a bug in this work.`);
            continue;
          }
          linkLines.push(
            l.type === "blocked_by"
              ? `- Blocks "${o.title}" (${o.id}, ${o.status}) — finishing this unblocks it.`
              : l.type === "found_during"
                ? `- Led to "${o.title}" (${o.id}, ${o.status}), found during this work.`
                : `- Related to "${o.title}" (${o.id}, ${o.status})`,
          );
        }
    if (linkLines.length) lines.push("Linked tasks:", ...linkLines.slice(0, 15));
    if (kids.length) {
      lines.push(`Subtasks (Level ${lv + 1}):`);
      for (const k of kids) {
        const nx = nextStep(await this.readPlan(k.id));
        lines.push(
          `- ${k.id}: ${k.title} [${k.status}]${nx ? ` next: ${nx.id} – ${nx.text}` : ""}`,
        );
      }
    }
    const master = lv === 1 ? t : anc[anc.length - 1];
    if (master) {
      const mp = await this.store.readText(this.masterPath(master.id));
      if (mp && master.id !== t.id)
        lines.push(
          `Master plan of "${master.title}": ${this.masterPath(master.id)} — ${clip(objectiveLine(mp), 160)} (read it when this task's scope is unclear)`,
        );
      else if (!mp && master.id === t.id)
        lines.push(
          `Master plan: not written yet (${this.masterPath(t.id)}). Planning ${this.host === "t3" ? "threads" : "chats"} write it first with board_master_plan, unless the person brings their own.`,
        );
    }
    const docLines: string[] = [];
    for (const d of t.docs ?? [])
      docLines.push(`- [${d.kind}] ${d.title}: ${d.ref}${d.note ? ` — ${clip(d.note, 100)}` : ""}`);
    for (const a of anc)
      for (const d of a.docs ?? [])
        docLines.push(
          `- [${d.kind}, from ${LEVEL_NAME[levelOf(a)]} "${a.title}"] ${d.title}: ${d.ref}`,
        );
    if (docLines.length)
      lines.push(
        "Docs and references (read one only when the current step needs it):",
        ...docLines.slice(0, 25),
      );
    if (anc.length || t.origin?.length) {
      lines.push("Parent context (read a parent's handoff file only when the next step needs it):");
      for (const a of anc) {
        const aplan = nextStep(await this.readPlan(a.id));
        const ah = await this.store.readText(this.livingPath(a.id));
        lines.push(
          `- Level ${levelOf(a)} "${a.title}" (id ${a.id}): ${a.description || "no purpose written"}${aplan ? ` · next: ${aplan.id} – ${aplan.text}` : ""}${ah ? ` · handoff ${this.livingPath(a.id)} — ${clip(objectiveLine(ah), 160)}` : ""}`,
        );
      }
      for (const o of t.origin ?? [])
        lines.push(`- Former parent "${o.title}" (id ${o.id}) · handoff ${this.livingPath(o.id)}`);
    }
    if (full) {
      if (lv === 1) {
        const mp = await this.store.readText(this.masterPath(t.id));
        if (mp) lines.push("", "### Master plan (masterplan.md)", clip(mp, 6000));
      }
      if (plan) lines.push("", "### Plan (plan.md)", clip(plan, 7000));
      if (living) lines.push("", "### Living handoff (handoff.md)", clip(living, 4000));
      else if (ho) lines.push("", `### Latest step note (${ho.step})`, clip(ho.text, 3500));
    }
    return lines.filter(Boolean).join("\n");
  }

  async unassignedHelp(): Promise<string> {
    const reg = await this.store.loadRegistry();
    const s = this.sess;
    const list = reg.boards.map(
      (b) =>
        `- ${b.name} (id ${b.id}; workspaces: ${b.roots.map((r) => `${r.label} = ${r.path}`).join(", ")})`,
    );
    const where = this.host === "t3" ? "thread's" : "chat's";
    return `This ${where} folder (${s?.cwd}) is not on any board yet.
Suggested root for it: ${s?.suggestedRoot} — suggested board name: ${s?.suggestedName}.
${list.length ? `Existing boards:\n${list.join("\n")}` : "There are no boards yet."}
Before creating any task, ask the person ONE question: create a new board (ask for its name, offering "${s?.suggestedName}" and root ${s?.suggestedRoot}), or add this workspace to one of the existing boards (if one looks like the same project, say so). Then call board_setup with their answer. Never create a board without asking.`;
  }

  private async buildContext(): Promise<void> {
    const s = this.sess;
    const b = this.board;
    if (!s || this.ignored) {
      this.context = "";
      return;
    }
    const chat = this.host === "t3" ? "thread" : "chat";
    const chats = this.host === "t3" ? "threads" : "chats";
    if (!b) {
      this.context =
        this.host === "t3"
          ? `## Claude Project Board\nThis thread's folder (${s.cwd}) is not on a board. Only if the person asks to track work: call board_find for the setup steps, and never create a board without asking.`
          : `## Claude Project Board\n${await this.unassignedHelp()}\nOnly raise this when the person wants a task tracked (or runs /task); don't interrupt one-off questions.`;
      return;
    }
    const where = `workspace "${s.workspaceLabel}" (${s.workspace})${s.subfolder ? `, folder ${s.subfolder}` : ""}${s.branch ? `, branch ${s.branch}` : ""}`;
    const others = b.roots.filter((r) => r.label !== s.workspaceLabel).map((r) => r.label);
    const head = `## Claude Project Board\nThis ${chat} runs in ${where} of the ${b.name} board.${others.length > 0 ? ` Other ${chats} may work on the same board in its other workspace copies: ${others.join(", ")}.` : ""}`;
    const goal = await this.myGoal();
    if (goal) {
      const t = s.taskId ? await this.loadTask(s.taskId) : null;
      this.context = `${head}\nThis ${chat} is the executor of a Goal.\n\n${goalLedger(goal, await this.listTasks())}${t && t.status !== "done" ? `\n\nTask in hand:\n${await this.resumeSummary(t)}` : ""}`;
      return;
    }
    const work = await this.myWork();
    if (work) {
      const tasks = await this.listTasks();
      const byId = new Map(tasks.map((task) => [task.id, task]));
      const t = s.taskId ? byId.get(s.taskId) : undefined;
      const next = nextGroupTask(work.group, tasks);
      const settled = work.goal.decisions.filter((decision) => decision.settled);
      this.context = [
        `${head}\nThis ${chat} works group ${work.group.id} of Goal ${work.goal.id} ("${work.goal.title}") for its executor.`,
        `Group ${work.group.id}. ${work.group.title}:\n${work.group.taskIds.map((id) => `- [${byId.get(id)?.status === "done" ? "x" : " "}] ${id} "${byId.get(id)?.title ?? id}"`).join("\n")}`,
        settled.length > 0 &&
          `Decisions of the Goal to respect:\n${settled.map((d) => `- ${d.id} ${d.title} → ${d.settled}`).join("\n")}`,
        next
          ? `Next task: ${next.id} "${next.title}". Take it with board_goal {action: "task", taskId: "${next.id}"}.`
          : 'The group is finished: call board_goal {action: "report", note}.',
        t && t.status !== "done" && `Task in hand:\n${await this.resumeSummary(t)}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      return;
    }
    if (s.taskId) {
      const t = await this.loadTask(s.taskId);
      if (t) {
        const linked = `${head}\nThis ${chat} is linked to a task. Continue from the plan and the latest handoff below without asking the person to re-explain them.`;
        this.context =
          this.host === "t3"
            ? `${linked}\n\n${await this.resumeSummary(t)}`
            : `${linked}\n\n${await this.describeTask(t, true)}\n\n${toolRules(this.host)}`;
        return;
      }
    }
    if (s.linkDeclined) {
      this.context = `${head}\nThis ${chat} is not linked to a board task (the person chose not to). Don't ask about linking again; board_link is there if they ask.`;
      return;
    }
    // Finding a task shouldn't cost what working on one does: the most recent few, and search.
    const tasks = (await this.listTasks())
      .filter((t) => t.status !== "done")
      .toSorted((a, b) => b.updatedAt - a.updatedAt);
    const recent = await Promise.all(
      tasks.slice(0, UNLINKED_TASKS).map(async (t) => {
        const nx = nextStep(await this.readPlan(t.id));
        return `- ${t.id}: ${t.title}${nx ? ` (next: ${nx.id} – ${nx.text})` : ""}`;
      }),
    );
    const more =
      tasks.length > recent.length
        ? `\n…and ${tasks.length - recent.length} more: search them with board_find before creating one.`
        : "";
    this.context = `${head}
This ${chat} is not linked to a board task yet.${recent.length ? `\nRecently active tasks on the board:\n${recent.join("\n")}${more}` : " The board has no active tasks."}
Use the standard conversation workflow for questions, debugging and planning. Keep this ${chat} unlinked until the person asks you to take or work on a board task. Do not prompt them to link just because the discussion involves multi-step work.
When the person asks to create board items, use board_create_task to create features, modules, tasks or bugs with the requested parent hierarchy. Creating items keeps this conversation unlinked. When they ask you to take a task, call board_link with its taskId and continue from its plan and handoff.
When linked, the tool returns the task's plan and handoff: continue from them.${
      this.related
        ? `
${this.related}`
        : ""
    }`;
  }

  /**
   * A linked T3 thread's resume summary: what the next turn needs to act, with the rest a
   * board_read away. Blockers, binding decisions and the next action lead; the living handoff
   * follows within a fixed budget.
   */
  private async resumeSummary(t: Task): Promise<string> {
    const plan = await this.readPlan(t.id);
    const next = nextStep(plan);
    const anc = await this.store.ancestorsOf(this.boardId, t);
    const owner = (await this.ownerHolder(t))?.owner;
    const blockers = (
      await Promise.all(
        (t.links ?? [])
          .filter((l) => l.type === "blocked_by")
          .map(async (l) => {
            const o = await this.loadTask(l.to);
            if (o?.status === "done") {
              // A finished dependency still blocks when its work isn't here, or changed since.
              const check = await this.doneCheck(o);
              return check.state === "verified"
                ? null
                : `- Depends on "${o.title}" (${l.to}): ${check.text}`;
            }
            const ws = o ? (await this.ownerHolder(o))?.owner?.label : undefined;
            return `- Blocked by "${o?.title ?? l.to}" (${l.to}${ws ? `, workspace ${ws}` : ""})${l.note ? ` — ${clip(l.note, 120)}` : ""}`;
          }),
      )
    ).filter((x) => x !== null);
    const decided = [t, ...anc]
      .flatMap((x) => (x.decisions ?? []).filter((d) => d.status === "decided"))
      .slice(0, 10)
      .map((d) => `- ${d.title} → ${clip(d.verdict || "decided", 200)}`);
    const required = t.items
      .filter((i) => !i.done && i.kind === "mandatory")
      .slice(0, 5)
      .map((i) => `- ${clip(i.text, 180)}`);
    const living = (await this.store.readText(this.livingPath(t.id)))
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    const ho = living ? null : await this.store.latestHandoff(this.boardId, t.id);
    const progress = planProgress(plan);
    const phases = planPhases(plan);
    const delegated = phases
      .flatMap((phase) => phase.steps)
      .filter((step) => step.done && step.childId !== null)
      .slice(-5);
    const checks = (await checksForTask(this.store, this.boardId, t, phases)).slice(0, 5);
    const lines = [
      `### Task: ${t.title} (id ${t.id}, Level ${levelOf(t)}, ${t.status})`,
      t.description && `Purpose: ${clip(t.description, 350)}`,
      anc.length > 0 && `Under: ${anc.map((a) => a.title).join(" › ")}`,
      owner && `Owner: workspace ${owner.label}${owner.state === "soft" ? " (soft-released)" : ""}`,
      next
        ? `Next action: ${next.id} – ${next.text} (step ${progress.done + 1} of ${progress.total}). The plan's checklist is authoritative if the handoff below disagrees.`
        : plan
          ? "Next action: every plan step is done; confirm with the person what's left."
          : !(await this.myGoal()) &&
            !(await this.myWork()) &&
            "No plan yet: write one with board_plan before starting multi-step work.",
      delegated.length > 0 &&
        `Completed delegated steps:\n${delegated.map((step) => `- ${step.id} – ${step.text} (task ${step.childId})`).join("\n")}`,
      blockers.length > 0 && `Open blockers:\n${blockers.slice(0, 5).join("\n")}`,
      decided.length > 0 && `Binding decisions:\n${decided.join("\n")}`,
      required.length > 0 && `Must-dos:\n${required.join("\n")}`,
      checks.length > 0 &&
        `Recorded check results:\n${checks
          .map((check) => `- ${check.taskTitle}: ${check.command} exited ${check.exitCode}`)
          .join("\n")}`,
      // The thread's own answers are in its history already, and would change this every turn.
      t.lastAction &&
        t.lastAction.sessionId !== this.sess?.sessionId &&
        `Last action (${t.lastAction.workspaceLabel}): ${clip(t.lastAction.text, 260)}`,
      living
        ? `### Living handoff\n${clip(living, RESUME_HANDOFF_CHARS)}`
        : ho && `### Latest step note (${ho.step})\n${clip(ho.text, RESUME_HANDOFF_CHARS)}`,
      `More with board_read: the full plan, open decisions, step notes, parents. Living handoff: ${this.livingPath(t.id)}`,
    ];
    return lines.filter(Boolean).join("\n");
  }

  async rebuildContext(): Promise<void> {
    await this.buildContext();
    const b = this.board;
    if (this.context && this.sess?.pickupNote)
      this.context += `\n\n### Pickup point\n${this.sess.pickupNote}`;
    const extras = () => {
      if (!b) return "";
      const services = b.services?.length
        ? `\nServices on this board (folder patterns): ${b.services.map((x) => `${x.id}=${x.match.join("|")}`).join(", ")}`
        : "";
      const rules = b.rules?.trim()
        ? `\n\n## Project rules for the ${b.name} board\n${b.rules.trim()}`
        : "";
      const registers = b.registers?.length
        ? `\nExisting registers: ${b.registers.map((r) => `${r.topic} → ${r.url}`).join("; ")}`
        : "";
      return `${services}${rules}${registers}`;
    };
    if (this.host === "t3") {
      const t = this.sess?.taskId && b ? await this.loadTask(this.sess.taskId) : null;
      const goal = await this.myGoal();
      if (goal && this.context) {
        this.rules = `${t3GoalRules(goal.mode)}${extras()}`;
        return;
      }
      if ((await this.myWork()) && this.context) {
        this.rules = `${t3GoalWorkerRules()}${extras()}`;
        return;
      }
      this.rules = this.context
        ? `${t3Rules({ linked: !!t, boardMode: this.boardModeOn, planning: !!t && levelOf(t) <= 2 })}${this.boardModeOn ? extras() : ""}`
        : "";
      return;
    }
    if (this.context && b && this.boardModeOn)
      this.context += `\n\n${boardModeProtocol(this.host)}${extras()}`;
  }

  /** The Goal this thread is running, if it is still its executor. */
  private async myGoal(): Promise<Goal | null> {
    const id = this.sess?.goalId;
    if (!id || !this.board || this.host !== "t3") return null;
    const goal = await loadGoal(this.store, this.boardId, id);
    return goal?.executor === this.sess?.sessionId ? goal : null;
  }

  /** The group this thread works for a Goal's executor, while it is still the group's worker. */
  private async myWork(): Promise<{ goal: Goal; group: GoalGroup } | null> {
    const s = this.sess;
    if (!s?.goalId || !s.goalGroup || !this.board || this.host !== "t3") return null;
    const goal = await loadGoal(this.store, this.boardId, s.goalId);
    const group = goal?.groups.find((g) => g.id === s.goalGroup);
    return goal && group?.delegated && group.worker === s.sessionId ? { goal, group } : null;
  }

  async goalTool(a: Record<string, unknown>): Promise<BoardReply> {
    const s = this.sess;
    if (!s || this.ignored) return reply("The board is not available in this folder.");
    if (!this.board) return reply(await this.unassignedHelp());
    if (this.host !== "t3") return reply("Goals run in T3 threads.");
    const all = await this.listTasks();
    const byId = new Map(all.map((task) => [task.id, task]));
    const action = str(a.action);
    const withRules = () => `${this.context}\n\n${this.rules}`;

    if (action === "start") {
      const scope = Array.isArray(a.scope) ? a.scope.map(String) : [];
      const tasks = scopeTasks(all, scope);
      if (tasks.length === 0)
        return reply(
          "Not started: the scope has no open tasks. Pass scope as task, module or feature ids (board_find lists them).",
        );
      const taken = (await listGoals(this.store, this.boardId))
        .filter((other) => other.status !== "done")
        .flatMap((other) =>
          other.groups
            .flatMap((group) => group.taskIds)
            .filter((id) => tasks.some((task) => task.id === id))
            .map((id) => `${id} (Goal ${other.id})`),
        );
      if (taken.length > 0)
        return reply(
          `Not started: a task belongs to one active Goal at a time. Already in a Goal: ${taken.join(", ")}. Resume that Goal, or leave those tasks out.`,
        );
      const title = str(a.title, tasks[0]?.title ?? "Goal");
      let id = `g-${slug(title)}`;
      for (let n = 2; await loadGoal(this.store, this.boardId, id); n++)
        id = `g-${slug(title)}-${n}`;
      const at = this.now();
      const goal: Goal = {
        id,
        title,
        scope,
        groups: planGroups(all, tasks),
        decisions: [],
        mode: a.mode === "auto" ? "auto" : "ask",
        status: "running",
        executor: s.sessionId,
        executors: [s.sessionId],
        baseline: Object.fromEntries(tasks.map((task) => [task.id, { status: task.status, at }])),
        createdAt: at,
        updatedAt: at,
      };
      await saveGoal(this.store, this.boardId, goal);
      this.reported = true;
      await this.save({ goalId: id });
      await this.rebuildContext();
      return reply(
        `Started Goal ${id} with this thread as its executor.\n\n${withRules()}`,
        `Board: Goal ${title}`,
      );
    }

    if (action === "resume" || action === "status") {
      const id = str(a.goalId || s.goalId);
      const goal = id ? await loadGoal(this.store, this.boardId, id) : null;
      if (!goal) {
        const open = (await listGoals(this.store, this.boardId)).filter((g) => g.status !== "done");
        return reply(
          `No Goal "${id}". ${open.length ? `Goals on this board: ${open.map((g) => `${g.id} (${g.title}, ${g.status})`).join(", ")}.` : "This board has no open Goals."}`,
        );
      }
      const drift = goalDrift(goal, all);
      const changes = [...drift.notes];
      for (const taskId of drift.doneElsewhere) {
        const task = byId.get(taskId);
        if (task)
          changes.push(
            `- ${taskId} "${task.title}": finished in another thread. ${(await this.doneCheck(task)).text}`,
          );
      }
      if (action === "status")
        return reply(
          `${goalLedger(goal, all)}${changes.length ? `\n\nChanged outside the Goal:\n${changes.join("\n")}` : ""}`,
        );
      if (goal.status === "done") return reply(`Goal ${goal.id} is finished.`);
      if (goal.executor && goal.executor !== s.sessionId) {
        const other = await this.store.readSession(this.boardId, goal.executor);
        if (other?.status === "working")
          return reply(
            `Goal ${goal.id} is running in another thread ("${other.title}") right now. A Goal has one executor: open that thread, or pause it there first.`,
          );
      }
      const at = this.now();
      for (const group of goal.groups)
        group.taskIds = group.taskIds.filter((taskId) => !drift.removed.includes(taskId));
      goal.executor = s.sessionId;
      goal.executors = [...new Set([...goal.executors, s.sessionId])];
      goal.status = "running";
      delete goal.pausedReason;
      goal.baseline = Object.fromEntries(
        goal.groups
          .flatMap((group) => group.taskIds)
          .map((taskId) => [taskId, { status: byId.get(taskId)?.status ?? "active", at }]),
      );
      await saveGoal(this.store, this.boardId, goal);
      this.reported = true;
      await this.save({ goalId: goal.id });
      await this.rebuildContext();
      const summary = changes.length
        ? `Changed while it was paused:\n${changes.join("\n")}${goal.mode === "auto" ? '\nAuto mode: carry on, and record how you handled these with board_goal {action: "decide"}.' : "\nTell the person about these before you continue."}`
        : "Nothing changed while it was paused.";
      return reply(`Resumed Goal ${goal.id}. ${summary}\n\n${withRules()}`);
    }

    if (action === "work") {
      const found = await loadGoal(this.store, this.boardId, str(a.goalId));
      const group = found?.groups.find((g) => g.id === str(a.group));
      if (!found || !group || !group.delegated || found.status !== "running")
        return reply("That group is not waiting for a child thread.");
      if (found.executor === s.sessionId)
        return reply("The executor hands a group to a child thread; it doesn't work it as one.");
      const holder =
        group.worker && group.worker !== s.sessionId
          ? await this.store.readSession(this.boardId, group.worker)
          : null;
      if (holder?.status === "working")
        return reply(`Group ${group.id} is already being worked in "${holder.title}".`);
      group.worker = s.sessionId;
      found.executors = [...new Set([...found.executors, s.sessionId])];
      await saveGoal(this.store, this.boardId, found);
      this.reported = true;
      await this.save({ goalId: found.id, goalGroup: group.id });
      await this.rebuildContext();
      return reply(`Working group ${group.id} of Goal ${found.id}.\n\n${withRules()}`);
    }

    const work = await this.myWork();
    const goal = (await this.myGoal()) ?? work?.goal;
    if (!goal && action === "finish") {
      const closed = a.goalId ? await loadGoal(this.store, this.boardId, str(a.goalId)) : null;
      if (closed?.status === "done") return reply(`Goal ${closed.id} is already finished.`);
    }
    if (!goal)
      return reply(
        'This thread is not running a Goal. Start one with board_goal {action: "start", scope: [...]}, or take one over with {action: "resume", goalId}.',
      );
    if (work && action !== "task" && action !== "done" && action !== "report")
      return reply(
        'A worker takes its group\'s tasks, finishes them and reports once: board_goal {action: "task" | "done" | "report"}. Questions and anything outside the group go in the report.',
      );
    const inGoal = (id: string) =>
      (work ? [work.group] : goal.groups).some((group) => group.taskIds.includes(id));
    const nextLine = (tasks: ReadonlyArray<Task>) => {
      const next = work ? nextGroupTask(work.group, tasks) : nextGoalTask(goal, tasks);
      return next
        ? `Next task: ${next.id} "${next.title}". Take it with board_goal {action: "task", taskId: "${next.id}"}.`
        : work
          ? 'The group is finished: call board_goal {action: "report", note}.'
          : "No task is ready.";
    };

    if (action === "report") {
      if (!work)
        return reply("Only a Goal's child thread reports; the executor pauses or finishes.");
      const note = str(a.note).trim();
      if (!note) return reply("Say in `note` what was done, what is left and why.");
      // The executor may have written the Goal meanwhile: change only this group, on a fresh copy.
      const fresh = (await loadGoal(this.store, this.boardId, goal.id)) ?? goal;
      const group = fresh.groups.find((g) => g.id === work.group.id);
      if (group) {
        group.report = clip(note, 600);
        group.delegated = false;
        delete group.worker;
        await saveGoal(this.store, this.boardId, fresh);
      }
      const inHand = s.taskId ? byId.get(s.taskId) : undefined;
      await this.save({ goalId: undefined, goalGroup: undefined });
      await this.rebuildContext();
      return reply(
        `Reported to Goal ${goal.id}. End your turn now with one line; the executor reads the board.${inHand && inHand.status !== "done" ? ` ${inHand.id} is unfinished: write its living handoff with board_checkpoint first.` : ""}`,
      );
    }

    if (action === "delegate") {
      const wanted = str(a.group).trim().toLowerCase();
      const group = goal.groups.find(
        (g) => g.id.toLowerCase() === wanted || g.title.toLowerCase() === wanted,
      );
      const open = group?.taskIds.filter((id) => byId.get(id)?.status !== "done") ?? [];
      if (!group || open.length === 0)
        return reply(
          `No open group "${str(a.group)}". Groups: ${goal.groups.map((g) => `${g.id} (${g.title})`).join(", ")}.`,
        );
      const waits = group.dependsOn.filter((id) =>
        goal.groups
          .find((g) => g.id === id)
          ?.taskIds.some((taskId) => byId.get(taskId)?.status !== "done"),
      );
      if (waits.length > 0)
        return reply(`Group ${group.id} waits on ${waits.join(", ")}: finish those first.`);
      if (s.taskId && open.includes(s.taskId))
        return reply(
          `${s.taskId} is in your hands: finish it, or checkpoint it, before handing the group over.`,
        );
      group.delegated = true;
      delete group.report;
      delete group.worker;
      await saveGoal(this.store, this.boardId, goal);
      await this.rebuildContext();
      const others = goal.groups.filter((g) => g.delegated && g.id !== group.id).length;
      return reply(
        `Group ${group.id} waits for a child thread. Start it with delegate_task${others > 0 ? ', isolation "worktree" since another group is out too' : ""}, and this as its task:\n\nYou work one group of a Goal on the ${this.board.name} board. First call board_goal {action: "work", goalId: "${goal.id}", group: "${group.id}"}: it gives you the tasks and the rules. Tasks: ${open.join(", ")}.\n\nCarry on with groups that don't rest on it, or end your turn: you are woken when the child finishes.`,
      );
    }

    if (action === "finish") {
      const left = goal.groups
        .flatMap((group) => group.taskIds)
        .filter((id) => byId.get(id)?.status !== "done");
      if (left.length > 0) return reply(`Not finished: ${left.join(", ")} still open.`);
      goal.status = "done";
      goal.executor = null;
      await this.releaseGoalHolds(goal);
      await saveGoal(this.store, this.boardId, goal);
      await this.save({ goalId: undefined });
      await this.rebuildContext();
      return reply(
        `Goal ${goal.id} is finished. Report to the person with the decisions you settled.`,
      );
    }

    if (action === "task") {
      const id = str(a.taskId);
      const task = byId.get(id);
      if (!task || !inGoal(id))
        return reply(`${id || "That task"} is not in this Goal. ${nextLine(all)}`);
      // One runner per task: work started on it directly outranks the Goal.
      const busy = (await this.store.listSessions(this.boardId)).find(
        (other) =>
          other.taskId === id && other.sessionId !== s.sessionId && other.status === "working",
      );
      if (busy)
        return reply(
          `${id} is being worked on in another thread ("${busy.title}"). Leave it to that thread and take another task; check it again with board_goal {action: "status"}.`,
        );
      const heldBefore = (await this.ownerHolder(task))?.owner;
      const linked = await this.linkTask({ taskId: id });
      if (!linked.text.startsWith("Linked")) return linked;
      // The Goal holds a module it claimed, or took back after its own pause released it.
      const holder = await this.ownerHolder(task);
      if (holder?.owner && sameRoot(holder.owner.root, s.workspace)) {
        if (holder.owner.state === "soft") {
          const { softAt: _softAt, pickup: _pickup, ...owned } = holder.owner;
          holder.owner = { ...owned, state: "owned" };
          this.ownerHistory(holder, "reclaim", { to: holder.owner.label });
          await this.saveTask(holder);
        }
        if (!heldBefore || heldBefore.state === "soft")
          goal.claimed = [...new Set([...(goal.claimed ?? []), holder.id])];
      }
      // A worker leaves the Goal record to its executor, which may be writing it now.
      if (!work) {
        goal.baseline[id] = { status: task.status, at: this.now() };
        await saveGoal(this.store, this.boardId, goal);
      }
      await this.rebuildContext();
      return reply(`Working on ${id} for Goal ${goal.id}.\n\n${await this.resumeSummary(task)}`);
    }

    if (action === "done") {
      const id = str(a.taskId || s.taskId);
      if (!id || !inGoal(id)) return reply(`${id || "That task"} is not in this Goal.`);
      if (s.taskId !== id)
        return reply(`Take ${id} first with board_goal {action: "task", taskId: "${id}"}.`);
      const plan = await this.readPlan(id);
      const ticked = planPhases(plan)
        .flatMap((phase) => phase.steps)
        .filter((step) => !step.done)
        .reduce((text, step) => setStepDone(text, step.id, true), plan);
      if (ticked !== plan) await this.store.io.write(this.store.planPath(this.boardId, id), ticked);
      const updated = await this.updateTask({
        taskId: id,
        status: "done",
        lastAction: str(a.note, "Finished in the Goal."),
      });
      const tasks = await this.listTasks();
      if (work) {
        await this.rebuildContext();
        return reply(`${updated.text}\n${nextLine(tasks)}`);
      }
      goal.baseline[id] = { status: "done", at: this.now() };
      const left = goal.groups
        .flatMap((group) => group.taskIds)
        .filter((taskId) => tasks.find((task) => task.id === taskId)?.status !== "done");
      if (left.length === 0) {
        goal.status = "done";
        goal.executor = null;
        await saveGoal(this.store, this.boardId, goal);
        await this.save({ goalId: undefined });
        await this.rebuildContext();
        return reply(
          `${updated.text}\nGoal ${goal.id} is finished: every task is done. Run the full checks once more, then report to the person with the decisions you settled.`,
        );
      }
      await saveGoal(this.store, this.boardId, goal);
      await this.rebuildContext();
      return reply(`${updated.text}\n${left.length} task(s) left. ${nextLine(tasks)}`);
    }

    if (action === "decide") {
      const settled = str(a.settled).trim();
      if (!str(a.title).trim()) return reply("Give the decision a title.");
      if (settled && goal.mode !== "auto")
        return reply(
          "This Goal asks before deciding: record the question without `settled` and carry on with the tasks it doesn't block.",
        );
      const decision = {
        id: `G${goal.decisions.length + 1}`,
        title: str(a.title),
        settled,
        by: "model" as const,
        taskIds: Array.isArray(a.taskIds) ? a.taskIds.map(String) : [],
        at: this.now(),
      };
      goal.decisions.push(decision);
      await saveGoal(this.store, this.boardId, goal);
      await this.rebuildContext();
      return reply(
        settled
          ? `Recorded ${decision.id} as settled by the model. The person reviews it later; carry on.`
          : `Recorded ${decision.id} as an open question for the person. Carry on with the tasks it doesn't block.`,
      );
    }

    if (action === "include") {
      const ids = (Array.isArray(a.taskIds) ? a.taskIds.map(String) : []).filter(
        (id) => byId.has(id) && !inGoal(id),
      );
      if (ids.length === 0) return reply("No new tasks to include.");
      const at = this.now();
      for (const id of ids) {
        const task = byId.get(id);
        if (!task) continue;
        const home = goal.groups.find((group) =>
          group.taskIds.some((other) => byId.get(other)?.parentId === task.parentId),
        );
        if (home) home.taskIds.push(id);
        else
          goal.groups.push({
            id: String.fromCharCode(65 + (goal.groups.length % 26)),
            title: (task.parentId ? byId.get(task.parentId)?.title : undefined) ?? task.title,
            taskIds: [id],
            dependsOn: [],
          });
        goal.baseline[id] = { status: task.status, at };
      }
      await saveGoal(this.store, this.boardId, goal);
      await this.rebuildContext();
      return reply(`Included ${ids.join(", ")}. ${nextLine(all)}`);
    }

    if (action === "pause") {
      const reason = str(a.reason, "paused").trim() || "paused";
      goal.status = "paused";
      goal.pausedReason = reason;
      goal.executor = null;
      const kept = await this.releaseGoalHolds(goal);
      await saveGoal(this.store, this.boardId, goal);
      const inHand = s.taskId ? byId.get(s.taskId) : undefined;
      await this.save({ goalId: undefined });
      await this.rebuildContext();
      return reply(
        `Paused Goal ${goal.id}: ${reason}. It resumes in any thread with board_goal {action: "resume", goalId: "${goal.id}"}.${inHand && inHand.status !== "done" ? ` ${inHand.id} is unfinished: write its living handoff now with board_checkpoint.` : ""}${kept.length > 0 ? `\n${kept.join("\n")}` : ""}`,
      );
    }
    return reply(`Unknown action "${action}".`);
  }

  /** The thread lost its history (compaction): nothing it was told can be assumed any more. */
  forgetSeen(): void {
    this.contextSeen = "";
    this.rulesSeen = "";
    this.told.clear();
  }

  /** Adds a situational rule to a tool's reply, the first time a T3 thread meets the situation. */
  private once(rule: T3OnDemandRule, text: string): string {
    // A Goal's executor works to the Goal's rules, not the per-task ones.
    if (this.host !== "t3" || this.sess?.goalId || this.told.has(rule)) return text;
    this.told.add(rule);
    return `${text}\n\n${t3OnDemandRule(rule)}`;
  }
  async setupBoard(a: Record<string, unknown>): Promise<BoardReply> {
    const s = this.sess;
    if (!s || this.ignored) return reply("The board is not available in this folder.");
    const reg = await this.store.loadRegistry();
    const rootPath = norm(str(a.root || s.suggestedRoot || s.cwd));
    const label = str(a.label || base(rootPath));
    if (!isInside(s.cwd, rootPath))
      return reply(`The root ${rootPath} must contain this chat's folder (${s.cwd}).`);
    let b: Board | undefined;
    if (a.action === "attach") {
      const key = str(a.boardId || a.name).toLowerCase();
      b = reg.boards.find((x) => x.id === key || x.name.toLowerCase() === key);
      if (!b)
        return reply(
          `No board "${str(a.boardId || a.name)}". Boards: ${reg.boards.map((x) => x.name).join(", ") || "none"}.`,
        );
      if (!b.roots.some((r) => sameRoot(r.path, rootPath))) b.roots.push({ path: rootPath, label });
    } else {
      const name = str(a.name).trim();
      if (!name)
        return reply(
          "Ask the person for the board name first, then call board_setup again with name.",
        );
      const dup = reg.boards.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (dup)
        return reply(
          `A board named "${dup.name}" already exists. To add this workspace to it, call board_setup with action "attach".`,
        );
      let id = slug(name);
      for (let n = 2; reg.boards.some((x) => x.id === id); n++) id = `${slug(name)}-${n}`;
      b = { id, name, roots: [{ path: rootPath, label }], createdAt: this.now() };
      reg.boards.push(b);
    }
    await this.store.saveRegistry(reg);
    this.reported = true;
    await this.resolve();
    await this.save({});
    await this.rebuildContext();
    const attach = a.action === "attach";
    return reply(
      `${attach ? `Added workspace "${label}" (${rootPath}) to` : "Created"} the ${b.name} board. Workspaces: ${b.roots.map((r) => `${r.label} = ${r.path}`).join(", ")}. You can now create or link tasks with board_link.`,
      `Board: ${attach ? "added this workspace to" : "created"} ${b.name}`,
    );
  }

  async linkTask(a: Record<string, unknown>): Promise<BoardReply> {
    const s = this.sess;
    if (!s || this.ignored) return reply("The board is not available in this folder.");
    if (!this.board) return reply(await this.unassignedHelp());
    const chat = this.host === "t3" ? "thread" : "chat";
    if (a.decline) {
      this.reported = true;
      await this.unlink();
      return reply(`Noted: this ${chat} stays unlinked.`);
    }
    let t: Task | null = null;
    if (a.taskId) t = await this.lookupTask(str(a.taskId));
    if (!t && a.taskId && !a.newTaskTitle) {
      const all = await this.listTasks();
      t = all.find((x) => x.title.toLowerCase() === str(a.taskId).toLowerCase()) ?? null;
      if (!t)
        return reply(
          `No task "${str(a.taskId)}". Active tasks: ${all.map((x) => `${x.id} (${x.title})`).join(", ") || "none"}. Pass newTaskTitle to create one.`,
        );
    }
    if (!t) {
      const title = str(a.newTaskTitle ?? a.taskId, "Untitled task");
      const id = await this.store.freeTaskId(this.boardId, slug(title));
      t = {
        id,
        title,
        description: str(a.description),
        status: "active",
        createdAt: this.now(),
        updatedAt: this.now(),
        lastAction: null,
        items: [],
        sessions: [],
        level: 1,
        parentId: null,
      };
    }
    // Ownership: a module/feature worked on by another workspace copy is blocked unless the
    // person overrides once or takes over; a soft-released one is taken over freely.
    let ownerNote = "";
    let pickupNote = s.taskId === t.id ? s.pickupNote : undefined;
    const holder = await this.ownerHolder(t);
    if (holder?.owner && !sameRoot(holder.owner.root, s.workspace)) {
      const o = holder.owner;
      const said = str(a.personSaid).trim();
      if (a.override && o.state !== "soft" && said.length < 2)
        return reply(
          `BLOCKED: overriding "${holder.title}" (owned by workspace ${o.label}) needs the person's approval. Ask them, then call board_link again with override and personSaid set to their words.`,
        );
      if (o.state === "soft" || a.override === "takeover") {
        const from = o.label;
        if (o.state === "soft" && o.pickup?.length)
          pickupNote = `Picked up "${holder.title}" from workspace ${from}, soft-released at:\n${o.pickup.map((r) => `- ${repoLine(r)}`).join("\n")}\nBefore continuing: in this workspace, for each repo fetch and check out that branch, confirm HEAD matches (or is a fast-forward of) that commit, and stop if there are uncommitted changes or the branch has diverged. Then continue with the next step.`;
        this.ownerHistory(holder, o.state === "soft" ? "takeover-after-soft-release" : "takeover", {
          from,
          to: s.workspaceLabel,
        });
        holder.owner = {
          root: s.workspace,
          label: s.workspaceLabel,
          state: "owned",
          since: this.now(),
        };
        if (holder !== t) await this.saveTask(holder);
        ownerNote = `Ownership of "${holder.title}" moved from ${from} to ${s.workspaceLabel}.`;
      } else if (a.override === "once") {
        t.overrides = [
          ...(t.overrides ?? []),
          {
            workspace: s.workspaceLabel,
            at: this.now(),
            session: s.sessionId,
            said: said || "via /task --override",
          },
        ];
        ownerNote = `Working here by a one-time override: "${holder.title}" stays owned by workspace ${o.label}. Coordinate branches with that copy.`;
      } else {
        const blocked = `BLOCKED: "${holder.title}" is owned by workspace ${o.label} (since ${new Date(o.since).toISOString().slice(0, 10)}). ${chat === "thread" ? "Threads" : "Chats"} in ${s.workspaceLabel} can't pick it up without the person's say-so. Ask them: (1) override once — call board_link again with override "once"; (2) take over — override "takeover" (ownership moves here); (3) leave it.`;
        return reply(this.board.boardMode ? this.once("ownership", blocked) : blocked);
      }
    } else if (!holder) {
      const node = await this.ownerNodeOf(t);
      // Only modules are claimed automatically; a master task is owned only when set on purpose.
      if (levelOf(node) === 2) {
        const target = node.id === t.id ? t : node;
        target.owner = {
          root: s.workspace,
          label: s.workspaceLabel,
          state: "owned",
          since: this.now(),
        };
        this.ownerHistory(target, "claimed", { to: s.workspaceLabel });
        if (target !== t) await this.saveTask(target);
      }
    }
    this.reported = true;
    if (a.description && !t.description) t.description = str(a.description);
    this.sess = await setSessionTask(
      this.store,
      this.boardId,
      { ...s, pickupNote, heartbeatAt: this.now() },
      t,
    );
    await this.rebuildContext();
    const linkedLine = `Linked this ${chat} to the task.${ownerNote ? ` ${ownerNote}` : ""}`;
    if (this.host === "t3") {
      // The rest of this turn needs the rules now, not at the next turn.
      const text = `${linkedLine}\n\n${this.context}\n\n${this.rules}`;
      return reply(
        ownerNote && this.boardModeOn ? this.once("ownership", text) : text,
        `Board: linked to ${t.title}`,
      );
    }
    return reply(
      `${linkedLine}\n\n${await this.describeTask(t, true)}\n\n${toolRules(this.host)}`,
      `Board: linked to ${t.title}`,
    );
  }

  /** Unlinks the chat from its task (the person's `/task off`, or the UI's unlink). */
  async unlink(): Promise<BoardReply> {
    if (this.sess && this.board && !this.ignored) {
      this.sess = await setSessionTask(
        this.store,
        this.board.id,
        { ...this.sess, heartbeatAt: this.now() },
        null,
      );
    } else {
      await this.save({ taskId: null, linkDeclined: true });
    }
    await this.rebuildContext();
    return reply(`This ${this.host === "t3" ? "thread" : "chat"} is no longer linked to a task.`);
  }

  private async requireTask(a: Record<string, unknown>): Promise<Task | string> {
    if (!this.board)
      return "This chat is not on a board yet: ask the person, then call board_setup.";
    const id = a.taskId ? str(a.taskId) : this.sess?.taskId;
    if (!id) return "This chat is not linked to a task: call board_link first.";
    const t = await this.lookupTask(id);
    if (!t) return `No task "${id}".`;
    // Writes respect ownership too: another workspace's module needs an override for this chat.
    const holder = await this.ownerHolder(t);
    if (
      holder?.owner &&
      holder.owner.state === "owned" &&
      !sameRoot(holder.owner.root, this.sess?.workspace) &&
      !this.hasOverride(t)
    )
      return `BLOCKED: "${holder.title}" is owned by workspace ${holder.owner.label}. This chat (workspace ${this.sess?.workspaceLabel}) may not change it unless the person agrees to an override — ask them, then call board_link with override and personSaid.`;
    return t;
  }

  private lastAction(text: string) {
    return {
      text: clip(text, 300),
      sessionId: this.sess?.sessionId ?? "",
      workspaceLabel: this.sess?.workspaceLabel ?? "",
      at: this.now(),
    };
  }

  private actor(): EditActor {
    return { by: this.sess?.sessionId ?? this.host };
  }

  private newId(prefix: string, upper = false, suffixMax = 0): string {
    const t = this.now().toString(36);
    return `${prefix}${upper ? t.toUpperCase() : t}${suffixMax ? this.store.clock.random(suffixMax) : ""}`;
  }

  async updateTask(a: Record<string, unknown>): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    const by = this.sess?.sessionId;
    if (a.lastAction) {
      t.lastAction = this.lastAction(str(a.lastAction));
      this.lastActionSetThisTurn = true;
    }
    if (a.description) t.description = str(a.description);
    if (a.title) t.title = str(a.title);
    const wasDone = t.status === "done";
    if (a.status === "active" || a.status === "paused" || a.status === "done") t.status = a.status;
    let evidence = "";
    if (!wasDone && t.status === "done") {
      t.doneEvidence = doneEvidence(t, await this.reposFor(t), this.now());
      evidence = evidenceLine(t.doneEvidence);
    } else if (wasDone && t.status !== "done") delete t.doneEvidence;
    const delegated =
      wasDone !== (t.status === "done")
        ? await syncDelegatedSteps(this.store, this.boardId, t)
        : [];
    if (Array.isArray(a.services)) t.services = [...new Set(a.services.map(String))];
    if (a.mainService !== undefined) t.mainService = a.mainService ? str(a.mainService) : null;
    if (a.kind === "feature" || a.kind === "backlog") t.kind = a.kind;
    for (const it of (Array.isArray(a.add) ? a.add : []) as Array<{
      kind?: unknown;
      text?: unknown;
    }>) {
      if (it.kind === "decision") {
        t.decisions = [
          ...(t.decisions ?? []),
          {
            id: this.newId("D-", true, 9),
            title: str(it.text),
            description: "",
            level: levelOf(t),
            raisedFrom: null,
            refs: [],
            options: "",
            verdict: "",
            status: "open",
            at: this.now(),
            by,
          },
        ];
        continue;
      }
      const kind: ItemKind = it.kind === "mandatory" ? "mandatory" : "todo";
      t.items.push({
        id: this.newId(kind[0] ?? "t", false, 99),
        kind,
        text: str(it.text),
        done: false,
        at: this.now(),
        by,
      });
    }
    for (const id of (Array.isArray(a.resolve) ? a.resolve : []) as unknown[]) {
      const it = t.items.find((i) => i.id === id);
      if (it) it.done = true;
    }
    await this.saveTask(t);
    await this.rebuildContext();
    return reply(
      `Board updated for "${t.title}". Open items: ${t.items.filter((i) => !i.done).length}.${delegated.length ? ` ${t.status === "done" ? "Ticked" : "Reopened"} the parent step it took over (${delegated.join(", ")}).` : ""}${evidence ? ` ${evidence}` : ""}`,
    );
  }

  async savePlan(a: Record<string, unknown>): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    const md = str(a.markdown);
    if (!md.trim()) return reply("markdown is empty: nothing saved.");
    await this.store.io.write(this.store.planPath(this.boardId, t.id), md);
    await this.saveTask(t);
    await this.rebuildContext();
    const nx = nextStep(md);
    return reply(`Plan saved for "${t.title}".${nx ? ` Next step: ${nx.id} – ${nx.text}.` : ""}`);
  }

  private byLine(): string {
    const s = this.sess;
    return `${this.host === "t3" ? "thread" : "chat"} ${s?.sessionId ?? "?"} in ${s?.workspaceLabel ?? "?"}${s?.subfolder ? `/${s.subfolder}` : ""}`;
  }

  /**
   * Finishes a plan step in one call: the step note, the rewritten living handoff (when given)
   * and the tick, so an interrupted chat never leaves the checklist and the handoff pointing at
   * different next actions. Safe to retry: every write replaces, and ticking is idempotent.
   */
  async writeHandoff(
    a: Record<string, unknown>,
    t3Checkpoint?: string,
    t3RunId?: string,
  ): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    const step = safeFileName(str(a.step)) || `note-${this.now()}`;
    const s = this.sess;
    const living = str(a.handoff).trim();
    if (t3RunId) await this.notePendingCheckpoint(t3RunId, t.id, step, !!living);
    const header = `<!-- by ${this.byLine()}${s?.branch ? ` (${s.branch})` : ""}, ${stamp(this.now())}${checkpointMarker(t3Checkpoint, t3RunId)} -->\n`;
    await this.store.io.write(
      this.store.stepHandoffPath(this.boardId, t.id, step),
      header + str(a.markdown),
    );
    const repos = living ? await this.writeLiving(t, living, t3Checkpoint, t3RunId) : [];
    let plan = await this.readPlan(t.id);
    if (plan && a.markStepDone !== false) {
      plan = tickStep(plan, step);
      await this.store.io.write(this.store.planPath(this.boardId, t.id), plan);
    }
    t.lastAction = this.lastAction(
      str(a.lastAction ?? `Finished ${step}: ${firstPara(str(a.markdown))}`),
    );
    this.lastActionSetThisTurn = true;
    await this.saveTask(t);
    await this.rebuildContext();
    const nx = nextStep(plan);
    return reply(
      `Handoff ${step} saved.${nx ? ` Next step: ${nx.id} – ${nx.text}.` : " No unticked steps left."}${
        living
          ? ` Living handoff rewritten: ${this.livingPath(t.id)}.${repos.length ? `\nRepo state recorded:\n${repos.map((r) => `- ${repoLine(r)}`).join("\n")}` : ""}`
          : " The living handoff was not rewritten and still describes the state before this step: pass handoff next time, or rewrite it now with board_checkpoint."
      }`,
    );
  }

  async createTask(a: Record<string, unknown>): Promise<BoardReply> {
    if (!this.board) return reply(await this.unassignedHelp());
    // Work with no place in the tree is how boards fill with unmapped tasks.
    if (this.host === "t3" && !a.parentId && !a.topLevel)
      return reply(
        "Not created: a new item needs a parent. Pass parentId (board_find lists the features and modules), or topLevel: true when the person wants a new feature or master task.",
      );
    // A step handed to a subtask matches its own step; anything else is checked for a duplicate.
    if (!a.createAnyway && !a.fromStep) {
      const { lines } = await this.searchBoard(str(a.title));
      const similar = lines.slice(0, 3);
      if (similar.length > 0)
        return reply(
          `Not created: the board may already have this.\n${similar.join("\n")}\nIf one of these is it, link or extend it (a planned step becomes a task with fromStep). If none is, call board_create_task again with createAnyway: true.`,
        );
    }
    let t: Task;
    try {
      t = await createTask(
        this.store,
        this.boardId,
        {
          title: str(a.title),
          parentId: a.parentId ? str(a.parentId) : null,
          description: str(a.description),
          kind: a.kind === "backlog" ? "backlog" : undefined,
          services: Array.isArray(a.services) ? a.services.map(String) : undefined,
          mainService: a.mainService ? str(a.mainService) : undefined,
          bug: !!a.bug,
          fixes: a.fixes ? str(a.fixes) : undefined,
          plan: a.plan ? str(a.plan) : undefined,
          fromStep: a.fromStep ? str(a.fromStep) : undefined,
        },
        this.actor(),
      );
    } catch (error) {
      if (error instanceof BoardEditError) return reply(error.message);
      throw error;
    }
    const level = levelOf(t);
    const par = t.parentId ? await this.loadTask(t.parentId) : null;
    this.reported = true;
    await this.rebuildContext();
    const pickUp =
      this.host === "t3"
        ? `Start it with Continue in new thread on task ${t.id}.`
        : `A chat picks it up with /task ${t.id}.`;
    const created = `Created Level ${level} ${LEVEL_NAME[level]} "${t.title}" (id ${t.id})${par ? ` under "${par.title}"` : ""}. ${pickUp}`;
    return reply(this.boardModeOn ? this.once("outOfScope", created) : created);
  }

  async promoteTask(a: Record<string, unknown>): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    let par: Task | null;
    try {
      par = await promoteTask(this.store, this.boardId, t);
    } catch (error) {
      if (error instanceof BoardEditError) return reply(error.message);
      throw error;
    }
    await this.rebuildContext();
    return reply(
      `Promoted "${t.title}" to Level ${levelOf(t)} (${LEVEL_NAME[levelOf(t)]})${t.parentId ? ` under ${t.parentId}` : ""}. It keeps its plan, handoffs and chats; ${par ? `"${par.title}" stays reachable as a former parent. ` : ""}You can now create subtasks under it with board_create_task (fromStep turns a plan step into one).`,
    );
  }

  /**
   * Rewrites the living handoff. `t3Checkpoint` is the T3 checkpoint ref of the turn it was
   * written in, when the host has one; it goes in the header so the handoff points at exact code.
   */
  async checkpoint(
    a: Record<string, unknown>,
    t3Checkpoint?: string,
    t3RunId?: string,
  ): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    const md = str(a.markdown).trim();
    if (!md) return reply("markdown is empty: nothing saved.");
    if (t3RunId) await this.notePendingCheckpoint(t3RunId, t.id, null, true);
    const repos = await this.writeLiving(t, md, t3Checkpoint, t3RunId);
    if (a.lastAction) {
      t.lastAction = this.lastAction(str(a.lastAction));
      this.lastActionSetThisTurn = true;
    }
    await this.saveTask(t);
    await this.rebuildContext();
    return reply(
      `Living handoff saved: ${this.livingPath(t.id)}${repos.length ? `\nRepo state recorded:\n${repos.map((r) => `- ${repoLine(r)}`).join("\n")}` : ""}\n${resumeHint(this.host, t.id)}`,
    );
  }

  /** Rewrites the living handoff and records repo state on `t` (the caller saves the task). */
  private async writeLiving(
    t: Task,
    md: string,
    t3Checkpoint?: string,
    t3RunId?: string,
  ): Promise<RepoState[]> {
    const header = `<!-- living handoff, rewritten in place · last by ${this.byLine()}, ${stamp(this.now())}${checkpointMarker(t3Checkpoint, t3RunId)} -->\n`;
    await this.store.io.write(this.livingPath(t.id), header + md + "\n");
    const repos = await this.reposFor(t).catch(() => [] as RepoState[]);
    if (repos.length) t.repoState = repos;
    if (this.sess?.pickupNote) await this.save({ pickupNote: undefined });
    return repos;
  }

  private async notePendingCheckpoint(
    runId: string,
    taskId: string,
    step: string | null,
    living: boolean,
  ) {
    const path = this.pendingCheckpointPath(runId);
    const notes = await this.store.readJson<PendingCheckpoint[]>(path, []);
    notes.push({ boardId: this.boardId, taskId, step, living });
    await this.store.writeJson(path, notes);
  }

  private pendingCheckpointPath(runId: string): string {
    return `${this.store.home}/pending-handoff-checkpoints/${encodeURIComponent(runId)}.json`;
  }

  async attachCheckpoint(runId: string, checkpoint: string | null): Promise<void> {
    const path = this.pendingCheckpointPath(runId);
    const notes = await this.store.readJson<PendingCheckpoint[] | null>(path, null);
    if (notes === null) return;
    const files = new Set(
      notes.flatMap(({ boardId, taskId, step, living }) => [
        ...(step ? [this.store.stepHandoffPath(boardId, taskId, safeFileName(step))] : []),
        ...(living ? [this.store.livingPath(boardId, taskId)] : []),
      ]),
    );
    const marker = checkpointMarker(undefined, runId);
    for (const file of files) {
      const text = await this.store.readText(file);
      const end = text.indexOf(" -->\n");
      if (text.startsWith("<!-- ") && end >= 0 && text.slice(0, end).endsWith(marker))
        await this.store.io.write(
          file,
          text.slice(0, end - marker.length) +
            checkpointMarker(checkpoint ?? undefined, undefined) +
            text.slice(end),
        );
    }
    await this.store.io.remove?.(path);
  }

  async fileDecision(a: Record<string, unknown>): Promise<BoardReply> {
    const cur = await this.requireTask(a);
    if (typeof cur === "string") return reply(cur);
    if (a.action === "add" || !a.action) {
      let filed: { readonly decision: Decision; readonly owner: Task };
      try {
        filed = await addDecision(
          this.store,
          this.boardId,
          cur,
          {
            title: str(a.title),
            description: str(a.description),
            options: str(a.options),
            refs: Array.isArray(a.refs) ? a.refs.map(String) : [],
            level: Number(a.level ?? levelOf(cur)),
            recommendation: a.recommendation
              ? {
                  r: a.r ? str(a.r) : undefined,
                  area: str(a.area),
                  lldCheck: str(a.lldCheck),
                  register: a.register ? str(a.register) : null,
                }
              : undefined,
          },
          this.actor(),
        );
      } catch (error) {
        if (error instanceof BoardEditError) return reply(error.message);
        throw error;
      }
      const { decision: d, owner } = filed;
      await this.rebuildContext();
      return reply(
        this.once(
          "decisions",
          d.rec
            ? `Recommendation ${d.rec.r} (${d.id}) recorded at Level ${d.level} on "${owner.title}"${d.rec.register ? ` — also add it to the ${d.rec.register} register as ${d.rec.r}` : ""}. Name ${d.rec.r} in your reply. It stays open until the person records the team's decision.`
            : `Decision ${d.id} filed at Level ${d.level} on "${owner.title}"${d.raisedFrom ? `, mapped to "${cur.title}" where it was raised` : ""}. It is open until the person records a verdict.`,
        ),
      );
    }
    // decide / update / drop: find it on this task, its parents, or (by id) anywhere on the board
    const id = str(a.id);
    const found = await findDecision(this.store, this.boardId, cur, id);
    if (!found) return reply(`No decision "${id}".`);
    const { decision: d, owner } = found;
    if (a.title) d.title = str(a.title);
    if (a.description) d.description = str(a.description);
    if (a.options) d.options = str(a.options);
    if (Array.isArray(a.refs)) d.refs = a.refs.map(String);
    if (a.action === "implemented") {
      if (!d.rec) return reply("Only recommendations have a How implemented record.");
      const opt = (k: string) => (a[k] === undefined ? undefined : str(a[k]));
      d.rec.implemented = {
        problem: opt("problem"),
        approach: opt("approach"),
        api: opt("api"),
        code: opt("code"),
        tests: opt("tests"),
        at: this.now(),
      };
    }
    if (a.action === "decide" || a.action === "drop" || a.action === "reopen")
      settleDecision(this.store, d, a.action, str(a.verdict));
    await this.saveTask(owner);
    await this.rebuildContext();
    return reply(`Decision ${d.id} on "${owner.title}" is now ${d.status}.`);
  }

  async saveMasterPlan(a: Record<string, unknown>): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    const anc = await this.store.ancestorsOf(this.boardId, t);
    const master = levelOf(t) === 1 ? t : (anc[anc.length - 1] ?? t);
    const md = str(a.markdown).trim();
    if (!md) return reply("markdown is empty: nothing saved.");
    await this.store.io.write(this.masterPath(master.id), md + "\n");
    await this.saveTask(master);
    await this.rebuildContext();
    return reply(
      `Master plan saved for "${master.title}": ${this.masterPath(master.id)}. Break it down with board_create_task (modules, then tasks), each tied to a part of this plan.`,
    );
  }

  async mapDoc(a: Record<string, unknown>): Promise<BoardReply> {
    const cur = await this.requireTask(a);
    if (typeof cur === "string") return reply(cur);
    const chain = [cur, ...(await this.store.ancestorsOf(this.boardId, cur))];
    if (a.action === "remove") {
      for (const t of chain)
        if ((t.docs ?? []).some((d) => d.id === a.id)) {
          t.docs = (t.docs ?? []).filter((d) => d.id !== a.id);
          await this.saveTask(t);
          await this.rebuildContext();
          return reply(`Removed ${str(a.id)} from "${t.title}".`);
        }
      return reply(`No doc "${str(a.id)}".`);
    }
    const ref = str(a.ref).trim();
    if (!ref) return reply("ref (a path or URL) is required.");
    const want = Number(a.level ?? levelOf(cur));
    const owner = chain.find((x) => levelOf(x) <= want) ?? chain[chain.length - 1] ?? cur;
    const title = str(a.title).trim() || ref.split(/[\\/]/).pop() || ref;
    const d = {
      id: this.newId("doc-"),
      kind: str(a.kind, "Reference"),
      title,
      ref,
      note: str(a.note),
      at: this.now(),
      by: this.sess?.sessionId,
    };
    owner.docs = [...(owner.docs ?? []), d];
    await this.saveTask(owner);
    await this.rebuildContext();
    return reply(
      `Mapped [${d.kind}] ${title} to ${LEVEL_NAME[levelOf(owner)]} "${owner.title}" (${d.id}).`,
    );
  }

  async linkTasks(a: Record<string, unknown>): Promise<BoardReply> {
    const cur = await this.requireTask(a);
    if (typeof cur === "string") return reply(cur);
    let linked: { readonly from: Task; readonly to: Task; readonly type: LinkType };
    try {
      linked = await setTaskLink(
        this.store,
        this.boardId,
        cur,
        {
          to: str(a.to),
          type: str(a.type, "related"),
          note: str(a.note),
          remove: a.action === "remove",
        },
        this.actor(),
      );
    } catch (error) {
      if (error instanceof BoardEditError)
        return reply(
          error.message.startsWith("No task")
            ? `${error.message} Use board_find to look it up.`
            : error.message,
        );
      throw error;
    }
    await this.rebuildContext();
    return reply(
      a.action === "remove"
        ? "Removed the link."
        : `Linked: "${linked.from.title}" ${linked.type.replace("_", " ")} "${linked.to.title}".`,
    );
  }

  async moveTask(a: Record<string, unknown>): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    let par: Task | null;
    try {
      par = await moveTask(this.store, this.boardId, t, a.parentId ? str(a.parentId) : null);
    } catch (error) {
      if (error instanceof BoardEditError) return reply(error.message);
      throw error;
    }
    await this.rebuildContext();
    return reply(
      `Moved "${t.title}" to ${par ? `"${par.title}" (now Level ${t.level})` : "the top level (master task)"}.`,
    );
  }

  /** One line per search hit: where it sits, its state, and any plan steps that matched. */
  private async searchBoard(
    query: string,
    service = "",
    level?: Level,
  ): Promise<{ lines: string[]; all: Task[] }> {
    const all = await this.listTasks();
    const byId = new Map(all.map((x) => [x.id, x]));
    const pathOf = (x: Task) => {
      const p: string[] = [];
      let c: Task | undefined = x;
      for (let i = 0; i < 3 && c; i++) {
        p.unshift(c.title);
        c = c.parentId ? byId.get(c.parentId) : undefined;
      }
      return p.join(" › ");
    };
    const line = (
      x: Task,
      steps: ReadonlyArray<{ id: string; text: string }> = [],
      more: Partial<Pick<SearchHit, "files" | "replaces" | "below">> = {},
    ) =>
      `- ${x.id} [L${levelOf(x)}${levelOf(x) === 1 ? ` ${x.kind ?? "feature"}` : ""}, ${x.status === "done" ? "done: reference only" : x.status}] ${pathOf(x)}${x.services?.length ? ` · services: ${x.services.join(", ")}` : ""}${steps.length ? ` · planned as ${steps.map((step) => `${step.id} – ${clip(step.text, 60)}`).join("; ")}` : ""}${more.files?.length ? ` · touched ${more.files.slice(0, 3).map(base).join(", ")}` : ""}${more.replaces?.length ? ` · replaces ${more.replaces.join(", ")} (superseded)` : ""}${more.below?.length ? ` · ${more.below.length} matching tasks below: ${more.below.slice(0, 5).join(", ")}` : ""}`;
    const inService = all.filter(
      (x) => !service || (x.services ?? []).includes(service) || x.mainService === service,
    );
    if (queryWords(query).length === 0) return { lines: inService.map((x) => line(x)), all };
    const docs = await Promise.all(
      inService.map(async (task) => ({ task, plan: await this.readPlan(task.id) })),
    );
    return {
      lines: searchTasks(docs, query, level).map((hit) => line(hit.task, hit.steps, hit)),
      all,
    };
  }

  async findTasks(a: Record<string, unknown>): Promise<BoardReply> {
    if (!this.board) return reply(await this.unassignedHelp());
    const alias = str(a.alias).trim().toLowerCase();
    if (alias) {
      const item = a.taskId ? await this.loadTask(slug(str(a.taskId))) : null;
      if (!item) return reply("An alias needs the taskId of the item it names.");
      item.aliases = [...new Set([...(item.aliases ?? []), alias])];
      await this.saveTask(item);
      return reply(`Saved "${alias}" as another name for "${item.title}" (${item.id}).`);
    }
    const query = str(a.query);
    const level = a.level === 1 || a.level === 2 || a.level === 3 ? a.level : undefined;
    const { lines } = await this.searchBoard(
      query,
      a.service ? str(a.service).toLowerCase() : "",
      level,
    );
    // A listing keeps to open work unless asked; a search shows finished work as reference.
    const listing = queryWords(query).length === 0;
    const shown = listing && !a.includeDone ? lines.filter((l) => !l.includes(", done: ")) : lines;
    const limit = listing ? 25 : SEARCH_HITS;
    const found = shown.length
      ? `${shown.slice(0, limit).join("\n")}${shown.length > limit ? `\n…and ${shown.length - limit} more: add a word to narrow it. board_read shows a task in full.` : ""}`
      : listing || this.host !== "t3" || this.aliasTold
        ? "No matching tasks."
        : "No matching tasks. If the person points at the item this should have found, offer to save their word as another name for it; once they agree, call board_find with alias and taskId.";
    if (shown.length === 0 && !listing) this.aliasTold = true;
    return reply(this.boardModeOn ? this.once("outOfScope", found) : found);
  }

  async releaseOwnership(a: Record<string, unknown>): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    const holder = await this.ownerHolder(t);
    if (!holder?.owner) return reply("Nobody owns this module or master task.");
    if (!sameRoot(holder.owner.root, this.sess?.workspace))
      return reply(
        `Only workspace ${holder.owner.label} (the owner) can release "${holder.title}".`,
      );
    if (a.action === "reclaim") {
      const { softAt: _softAt, ...owned } = holder.owner;
      holder.owner = { ...owned, state: "owned" };
      this.ownerHistory(holder, "reclaim", { to: holder.owner.label });
      await this.saveTask(holder);
      await this.rebuildContext();
      return reply(`"${holder.title}" is owned by ${holder.owner.label} again.`);
    }
    if (a.action === "free") {
      this.ownerHistory(holder, "release", { from: holder.owner.label });
      holder.owner = null;
      await this.saveTask(holder);
      await this.rebuildContext();
      return reply(`Released "${holder.title}": the next workspace to link claims it.`);
    }
    const { repos, problems } = await this.softReleaseState(holder);
    if (problems.length)
      return reply(`Not ready for a soft release:\n${problems.map((x) => `- ${x}`).join("\n")}`);
    holder.owner = { ...holder.owner, state: "soft", softAt: this.now(), pickup: repos };
    this.ownerHistory(holder, "soft-release", { from: holder.owner.label });
    await this.saveTask(holder);
    await this.rebuildContext();
    return reply(
      `Soft-released "${holder.title}". Another workspace can take over from:\n${repos.map((r) => `- ${repoLine(r)}`).join("\n")}\nThis ${this.host === "t3" ? "thread" : "chat"} should stop working on it unless it reclaims it (board_release reclaim).`,
    );
  }

  /** Soft release needs everything pushed, clean and checkpointed after the last commit. */
  private async softReleaseState(
    holder: Task,
  ): Promise<{ repos: RepoState[]; problems: string[] }> {
    const repos = await this.reposFor(holder);
    const problems: string[] = [];
    if (!repos.length) problems.push("no repos found — tag the services it touches first");
    for (const r of repos) {
      if (!r.upstream) problems.push(`${r.name}: branch ${r.branch} has no upstream — push it`);
      else if (r.ahead) problems.push(`${r.name}: ${r.ahead} commit(s) on ${r.branch} not pushed`);
      if (r.dirty) problems.push(`${r.name}: ${r.dirty} uncommitted change(s)`);
    }
    const all = await this.listTasks();
    const desc = (id: string): Task[] =>
      all.filter((x) => x.parentId === id).flatMap((k) => [k, ...desc(k.id)]);
    let handoffAt = 0;
    for (const x of [holder, ...desc(holder.id)]) {
      try {
        handoffAt = Math.max(handoffAt, (await this.store.io.stat(this.livingPath(x.id))).mtimeMs);
      } catch {}
    }
    const lastCommit = Math.max(0, ...repos.map((r) => r.lastCommitAt));
    if (repos.length && handoffAt < lastCommit)
      problems.push("the living handoff is older than the last commit — checkpoint first");
    return { repos, problems };
  }

  /**
   * A paused Goal holds nothing: the modules it claimed are soft-released where their work can be
   * picked up elsewhere. Returns what stays owned, and why.
   */
  private async releaseGoalHolds(goal: Goal): Promise<string[]> {
    const kept: string[] = [];
    for (const id of goal.claimed ?? []) {
      const holder = await this.loadTask(id);
      const owner = holder?.owner;
      if (!holder || owner?.state !== "owned" || !sameRoot(owner.root, this.sess?.workspace))
        continue;
      const { repos, problems } = await this.softReleaseState(holder);
      if (problems.length > 0) {
        kept.push(`"${holder.title}" stays owned by ${owner.label}: ${problems.join("; ")}.`);
        continue;
      }
      holder.owner = { ...owner, state: "soft", softAt: this.now(), pickup: repos };
      this.ownerHistory(holder, "soft-release", { from: owner.label });
      await this.saveTask(holder);
    }
    return kept;
  }

  async readTask(a: Record<string, unknown>): Promise<BoardReply> {
    const t = await this.requireTask(a);
    if (typeof t === "string") return reply(t);
    let text = await this.describeTask(t, true);
    if (t.status === "done") text += `\n\n### Done check\n${(await this.doneCheck(t)).text}`;
    if (a.step) {
      const h = await this.store.readText(
        this.store.stepHandoffPath(this.boardId, t.id, safeFileName(str(a.step))),
      );
      text += `\n\n### Handoff ${str(a.step)}\n${h || "(none)"}`;
    }
    return reply(text);
  }

  /** Runs a board tool by its name (`board_link`, …); null for a name that isn't a board tool. */
  runTool(
    name: string,
    args: Record<string, unknown>,
    extra?: { readonly t3Checkpoint?: string | undefined; readonly t3RunId?: string | undefined },
  ): Promise<BoardReply> | null {
    const run = this.dispatch(name, args, extra);
    if (run === null) return null;
    return run.then((result) => {
      // What a tool changed on the board, the agent that called it already knows.
      this.contextSeen = this.context;
      if (this.rules && result.text.includes(this.rules)) this.rulesSeen = this.rules;
      return result;
    });
  }

  private dispatch(
    name: string,
    args: Record<string, unknown>,
    extra?: { readonly t3Checkpoint?: string | undefined; readonly t3RunId?: string | undefined },
  ): Promise<BoardReply> | null {
    switch (name) {
      case "board_setup":
        return this.setupBoard(args);
      case "board_link":
        return this.linkTask(args);
      case "board_update":
        return this.updateTask(args);
      case "board_plan":
        return this.savePlan(args);
      case "board_handoff":
        return this.writeHandoff(args, extra?.t3Checkpoint, extra?.t3RunId);
      case "board_create_task":
        return this.createTask(args);
      case "board_decision":
        return this.fileDecision(args);
      case "board_master_plan":
        return this.saveMasterPlan(args);
      case "board_doc":
        return this.mapDoc(args);
      case "board_release":
        return this.releaseOwnership(args);
      case "board_link_task":
        return this.linkTasks(args);
      case "board_move":
        return this.moveTask(args);
      case "board_find":
        return this.findTasks(args);
      case "board_goal":
        return this.goalTool(args);
      case "board_promote":
        return this.promoteTask(args);
      case "board_checkpoint":
        return this.checkpoint(args, extra?.t3Checkpoint, extra?.t3RunId);
      case "board_read":
        return this.readTask(args);
      default:
        return null;
    }
  }
}
