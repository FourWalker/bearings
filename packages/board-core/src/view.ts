/**
 * What a board shows: its tasks with plan progress, last action and linked chats, and the chats
 * not on a task. Same rules as the board app (app/server.js), so both show a board alike.
 *
 * @module board-core/view
 */
import {
  nextStep,
  objectiveLine,
  type PlanPhase,
  planPhases,
  planProgress,
  type PlanStep,
} from "./plan.ts";
import { goalOpen, listGoals } from "./goal.ts";
import { evidenceLine } from "./verify.ts";
import { type BoardStore, decisionType, mergeOf } from "./store.ts";
import { norm } from "./text.ts";
import type {
  Decision,
  DecisionType,
  CheckResult,
  Item,
  Level,
  MergeMode,
  Slot,
  Owner,
  RepoState,
  Session,
  Task,
  TaskDoc,
  TaskLink,
  TaskStatus,
} from "./types.ts";

/** The board app marks a chat offline after this long without a heartbeat. */
export const OFFLINE_MS = 2.5 * 60 * 1000;

export type BoardChatLive = "working" | "idle" | "ended" | "offline";

export interface BoardSummary {
  readonly id: string;
  readonly name: string;
  readonly taskCount: number;
}

export interface BoardViewChat {
  readonly sessionId: string;
  readonly title: string;
  readonly live: BoardChatLive;
  readonly workspaceLabel: string;
  readonly taskId: string | null;
  readonly updatedAt: number;
  /** Set for T3 threads: the thread to open. */
  readonly threadId: string | null;
  readonly provider: string | null;
  /** When the chat's current (or last) turn started; 0 before its first. */
  readonly turnStartedAt: number;
}

/** A decision as the board screen lists it; its full text is read with the task. */
export interface BoardViewDecision {
  readonly id: string;
  readonly title: string;
  readonly status: Decision["status"];
  readonly type: DecisionType;
  readonly level: Level;
  readonly raisedFrom: { readonly id: string; readonly title: string } | null;
  /** The recommendation's R#, when the decision is one. */
  readonly r: string | null;
  readonly recommendation?:
    | {
        readonly description: string;
        readonly area: string;
        readonly verdict: string;
        readonly register: string | null;
        readonly implemented: boolean;
      }
    | undefined;
}

export interface BoardViewTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly level: Level;
  readonly parentId: string | null;
  /** Level 1 only: a feature or a service backlog. */
  readonly kind: "feature" | "backlog" | null;
  readonly bug: boolean;
  readonly mainService: string | null;
  readonly services: ReadonlyArray<string>;
  readonly lastAction: {
    readonly text: string;
    readonly at: number;
    readonly workspaceLabel: string;
    readonly sessionId: string;
  } | null;
  /** The last tick, status change or last-action line; tasks from before it was kept use `updatedAt`. */
  readonly lastActionAt: number;
  /** When the last plan step was ticked or the task was set done; null while neither holds. */
  readonly doneAt: number | null;
  readonly starredAt: number | null;
  readonly next: PlanStep | null;
  readonly steps: { readonly done: number; readonly total: number };
  readonly chats: ReadonlyArray<BoardViewChat>;
  /** Chats linked elsewhere that ticked a step of this task's plan, the latest tick first. */
  readonly worked: ReadonlyArray<{
    readonly chat: BoardViewChat;
    readonly step: string;
    readonly at: number;
  }>;
  readonly items: ReadonlyArray<Pick<Item, "id" | "kind" | "text" | "done">>;
  readonly decisions: ReadonlyArray<BoardViewDecision>;
  readonly links: ReadonlyArray<Pick<TaskLink, "to" | "type" | "note">>;
  /** Set on the module or master task itself; tasks inherit it (see `ownerRoot`). */
  readonly owner: Pick<Owner, "root" | "label" | "state"> | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** The root of the workspace copy that owns the task's module or master task, if one does. */
  readonly ownerRoot: string | null;
  /** The open Goal that holds the task: one thread is finishing it with the Goal's other tasks. */
  readonly goal: {
    readonly id: string;
    readonly title: string;
    readonly status: "running" | "paused";
  } | null;
  /** What a finished task left behind (commit, files, check), in one line; null when not recorded. */
  readonly evidence: string | null;
  /** What the Goal's thread reported when it finished the task, in full. */
  readonly doneNote: string | null;
  /** The merge mode the task works under; `from` names the feature or module that set it. */
  readonly merge:
    | (MergeMode & { readonly from: { readonly id: string; readonly title: string } | null })
    | null;
  /** A feature's or module's own open merge request. */
  readonly mergeRequest: string | null;
  /** The first build that held its finished work, and for a bug the build it was found in. */
  readonly landedIn: string | null;
  readonly foundIn: string | null;
  /** Ids of the slots whose build holds its finished work. */
  readonly inSlots: ReadonlyArray<string>;
}

export interface BoardViewGoal {
  readonly id: string;
  readonly title: string;
  readonly status: "running" | "paused" | "done" | "ended";
  readonly mode: "auto" | "ask";
  readonly pausedReason: string | null;
  /** The session running it now. */
  readonly executor: string | null;
  readonly taskIds: ReadonlyArray<string>;
  readonly decisions: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    /** "" while it waits for the person. */
    readonly settled: string;
    readonly by: "model" | "person";
    /** The same decision in the board's register, where a verdict is recorded. */
    readonly decisionId: string | null;
    readonly blocker: boolean;
  }>;
  /** The Goal's order of work: a group starts once the groups it depends on are finished. */
  readonly groups: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly taskIds: ReadonlyArray<string>;
    readonly dependsOn: ReadonlyArray<string>;
    readonly delegated: boolean;
    /** The session of the child thread working the group. */
    readonly worker: string | null;
    readonly report: string | null;
  }>;
  /** Every chat that has run the Goal or one of its groups, the current executor included. */
  readonly chats: ReadonlyArray<BoardViewChat>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Marks a register verdict a Goal's model wrote; a verdict without it is a person's. */
export const MODEL_SETTLED = "(settled by the model in Goal ";

/** How many finished Goals the board keeps in view. */
const FINISHED_GOALS_SHOWN = 20;

export interface BoardView {
  readonly id: string;
  readonly name: string;
  readonly boardMode: boolean;
  /** The board's own merge mode. */
  readonly merge: MergeMode | null;
  /** Where builds live, and the build in each. */
  readonly slots: ReadonlyArray<Slot>;
  readonly registers: ReadonlyArray<{
    readonly id: string;
    readonly topic: string;
    readonly url: string;
  }>;
  readonly services: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly match: ReadonlyArray<string>;
  }>;
  /** Each copy of the project the board spans: the folders a thread can work on its tasks in. */
  readonly workspaces: ReadonlyArray<{ readonly label: string; readonly root: string }>;
  readonly tasks: ReadonlyArray<BoardViewTask>;
  /** Chats on the board that aren't linked to a task and haven't ended (offline ones too). */
  readonly unlinked: ReadonlyArray<BoardViewChat>;
  /** Goals not finished yet, newest first. Progress is read from their tasks. */
  readonly goals: ReadonlyArray<BoardViewGoal>;
  /** The latest finished Goals, newest first. */
  readonly finishedGoals: ReadonlyArray<BoardViewGoal>;
}

export const liveOf = (s: Pick<Session, "status" | "heartbeatAt">, now: number): BoardChatLive =>
  s.status === "ended" ? "ended" : now - (s.heartbeatAt || 0) > OFFLINE_MS ? "offline" : s.status;

const chatOf = (s: Session, now: number): BoardViewChat => ({
  sessionId: s.sessionId,
  title: s.title || s.lastPrompt?.split("\n")[0] || "",
  live: liveOf(s, now),
  workspaceLabel: s.workspaceLabel,
  taskId: s.taskId,
  updatedAt: s.updatedAt,
  threadId: s.source?.kind === "t3-thread" ? s.source.threadId : null,
  provider: s.source?.kind === "t3-thread" ? (s.source.provider ?? null) : null,
  turnStartedAt: s.turnStartedAt || 0,
});

export async function readBoardSummaries(store: BoardStore): Promise<BoardSummary[]> {
  const reg = await store.loadRegistry();
  return Promise.all(
    reg.boards.map(async (b) => ({
      id: b.id,
      name: b.name,
      taskCount: (await store.listTasks(b.id)).length,
    })),
  );
}

export async function readUnassignedChats(
  store: BoardStore,
  now: number,
): Promise<BoardViewChat[]> {
  const cutoff = now - 14 * 86_400_000;
  return (await store.listSessions(null))
    .filter(
      (session) =>
        !session.movedTo &&
        !session.supersededBy &&
        (session.lastPrompt || session.title) &&
        session.updatedAt >= cutoff,
    )
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .map((session) => chatOf(session, now));
}

export async function readBoardView(
  store: BoardStore,
  boardId: string,
  now: number,
): Promise<BoardView | null> {
  const board = (await store.loadRegistry()).boards.find((b) => b.id === boardId);
  if (!board) return null;
  // Helper runs that never took a prompt, and records replaced by a newer one, aren't chats.
  const sessions = (await store.listSessions(boardId))
    .filter((s) => !s.supersededBy && (s.taskId || s.lastPrompt || s.title))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const chats = sessions.map((s) => chatOf(s, now));
  const chatBySession = new Map(chats.map((chat) => [chat.sessionId, chat]));
  const all = await store.listTasks(boardId);
  const byId = new Map(all.map((t) => [t.id, t]));
  // As BoardChat.ownerHolder: a task belongs to its module's owner, else the nearest owned parent.
  const mergeFor = (t: Task): BoardViewTask["merge"] => {
    const chain: Task[] = [];
    for (let cur: Task | undefined = t; cur && !chain.includes(cur);) {
      chain.push(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    const merge = mergeOf(board, chain);
    return merge
      ? {
          mode: merge.mode,
          target: merge.target,
          from: merge.from ? { id: merge.from.id, title: merge.from.title } : null,
        }
      : null;
  };
  const ownerRoot = (t: Task): string | null => {
    let cur = t.level === 3 && t.parentId ? (byId.get(t.parentId) ?? t) : t;
    for (let i = 0; i < 3; i++) {
      if (cur.owner) return norm(cur.owner.root);
      const up = cur.parentId ? byId.get(cur.parentId) : undefined;
      if (!up) return null;
      cur = up;
    }
    return null;
  };
  const goals = new Map<string, BoardViewTask["goal"]>();
  const openGoals: BoardViewGoal[] = [];
  const finishedGoals: BoardViewGoal[] = [];
  const registered = new Map(
    all.flatMap((t) => (t.decisions ?? []).map((d) => [d.id, d] as const)),
  );
  for (const goal of await listGoals(store, boardId)) {
    const taskIds = goal.groups.flatMap((group) => group.taskIds);
    if (goal.status === "running" || goal.status === "paused")
      for (const taskId of taskIds)
        goals.set(taskId, { id: goal.id, title: goal.title, status: goal.status });
    const ran = new Set([...goal.executors, ...goal.groups.flatMap((group) => group.worker ?? [])]);
    (goalOpen(goal) ? openGoals : finishedGoals).push({
      id: goal.id,
      title: goal.title,
      status: goal.status,
      mode: goal.mode,
      pausedReason: goal.pausedReason ?? null,
      executor: goal.executor,
      taskIds,
      decisions: goal.decisions.map((decision) => {
        // The register wins: a person who decided or overruled it there has answered the Goal.
        const filed = decision.decisionId ? registered.get(decision.decisionId) : undefined;
        const answered = filed?.status === "decided" && !filed.verdict.includes(MODEL_SETTLED);
        return {
          id: decision.id,
          title: decision.title,
          settled: answered ? filed.verdict : decision.settled,
          by: answered ? ("person" as const) : decision.by,
          decisionId: filed ? filed.id : null,
          blocker: filed !== undefined && decisionType(filed) === "blocker",
        };
      }),
      groups: goal.groups.map((group) => ({
        id: group.id,
        title: group.title,
        taskIds: group.taskIds,
        dependsOn: group.dependsOn,
        delegated: !!group.delegated,
        worker: group.worker ?? null,
        report: group.report ?? null,
      })),
      chats: chats.filter((chat) => ran.has(chat.sessionId)),
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    });
  }
  const tasks = await Promise.all(
    all.map(async (t: Task): Promise<BoardViewTask> => {
      const plan = await store.readText(store.planPath(boardId, t.id));
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        level: t.level === 2 || t.level === 3 ? t.level : 1,
        parentId: t.parentId ?? null,
        kind: t.level === 2 || t.level === 3 ? null : t.kind === "backlog" ? "backlog" : "feature",
        bug: !!t.bug,
        mainService: t.mainService ?? null,
        services: t.services ?? [],
        lastAction: t.lastAction
          ? {
              text: t.lastAction.text,
              at: t.lastAction.at,
              workspaceLabel: t.lastAction.workspaceLabel,
              sessionId: t.lastAction.sessionId,
            }
          : null,
        lastActionAt: Math.max(t.lastActionAt ?? 0, t.lastAction?.at ?? 0) || t.updatedAt,
        doneAt: t.doneAt ?? (t.status === "done" ? (t.doneEvidence?.at ?? t.updatedAt) : null),
        starredAt: t.starredAt ?? null,
        next: nextStep(plan),
        steps: planProgress(plan),
        chats: chats.filter((c) => c.taskId === t.id),
        worked: t.sessions
          .flatMap((ref) => {
            const chat = chatBySession.get(ref.sessionId);
            return ref.ticked && chat && chat.taskId !== t.id
              ? [{ chat, step: ref.ticked.step, at: ref.ticked.at }]
              : [];
          })
          .toSorted((a, b) => b.at - a.at),
        items: t.items.map((i) => ({ id: i.id, kind: i.kind, text: i.text, done: i.done })),
        decisions: (t.decisions ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          type: decisionType(d),
          level: d.level || (t.level === 2 || t.level === 3 ? t.level : 1),
          raisedFrom: d.raisedFrom ?? null,
          r: d.rec?.r ?? null,
          ...(d.rec
            ? {
                recommendation: {
                  description: d.description ?? "",
                  area: d.rec.area ?? "",
                  verdict: d.verdict ?? "",
                  register: d.rec.register ?? null,
                  implemented: !!d.rec.implemented,
                },
              }
            : {}),
        })),
        links: (t.links ?? []).map((l) => ({ to: l.to, type: l.type, note: l.note })),
        owner: t.owner
          ? { root: norm(t.owner.root), label: t.owner.label, state: t.owner.state }
          : null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        ownerRoot: ownerRoot(t),
        goal: goals.get(t.id) ?? null,
        evidence: t.status === "done" && t.doneEvidence ? evidenceLine(t.doneEvidence) : null,
        doneNote: t.status === "done" ? (t.doneNote ?? null) : null,
        merge: mergeFor(t),
        mergeRequest: t.mergeRequest ?? null,
        landedIn: t.landedIn ?? null,
        foundIn: t.foundIn ?? null,
        inSlots: (t.inSlots ?? []).filter((id) => board.slots?.some((slot) => slot.id === id)),
      };
    }),
  );
  return {
    id: board.id,
    name: board.name,
    boardMode: !!board.boardMode,
    merge: board.merge ?? null,
    slots: board.slots ?? [],
    registers: board.registers ?? [],
    services: (board.services ?? []).map((s) => ({ id: s.id, name: s.name, match: s.match })),
    workspaces: board.roots.map((r) => ({ label: r.label, root: norm(r.path) })),
    tasks: tasks.toSorted((a, b) => b.updatedAt - a.updatedAt),
    // The Assistant is on no task by design: it is not a chat waiting to be put on one.
    unlinked: sessions
      .filter((s) => s.taskId === null && !s.assistant)
      .map((s) => chatOf(s, now))
      .filter((c) => c.live !== "ended"),
    goals: openGoals.toSorted((a, b) => b.id.localeCompare(a.id)),
    finishedGoals: finishedGoals
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, FINISHED_GOALS_SHOWN),
  };
}

/** One task's documents as its task views show them: the texts the board screen leaves out. */
export interface BoardTaskDetail {
  /** The master implementation plan of the task's master task (its own, for a master task). */
  readonly masterPlan: string;
  readonly masterTaskId: string;
  readonly plan: ReadonlyArray<PlanPhase>;
  /** plan.md as written, for editing. */
  readonly planMarkdown: string;
  /** The living handoff, without its header comment. */
  readonly handoff: string;
  readonly handoffCheckpoint: string | null;
  /** Other names search finds the task by. */
  readonly aliases: ReadonlyArray<string>;
  readonly checks: ReadonlyArray<CheckResult & { readonly taskTitle: string }>;
  /** Step notes, newest first. */
  readonly stepNotes: ReadonlyArray<{
    readonly step: string;
    readonly at: number;
    readonly text: string;
    readonly checkpointRef: string | null;
  }>;
  /** This task's documents (`from` null), then its parents'. */
  readonly docs: ReadonlyArray<
    Pick<TaskDoc, "id" | "kind" | "title" | "ref" | "note"> & {
      readonly from: { readonly id: string; readonly title: string; readonly level: Level } | null;
    }
  >;
  /**
   * `own`: filed on this task; `up`: raised here, filed on a parent; `inherited`: a parent's
   * own decisions.
   */
  readonly decisions: ReadonlyArray<
    Pick<
      Decision,
      "id" | "title" | "description" | "options" | "verdict" | "status" | "level" | "refs" | "at"
    > & {
      readonly type: DecisionType;
      readonly group: "own" | "up" | "inherited";
      readonly r: string | null;
      readonly area: string;
      /** A decided recommendation's record of how it was built. */
      readonly implemented: {
        readonly problem: string;
        readonly approach: string;
        readonly api: string;
        readonly code: string;
        readonly tests: string;
      } | null;
      readonly decidedAt: number | null;
      readonly raisedFrom: { readonly id: string; readonly title: string } | null;
      readonly filedOn: { readonly id: string; readonly title: string };
    }
  >;
  readonly repoState: ReadonlyArray<
    Pick<RepoState, "name" | "branch" | "head" | "at"> & RepoStanding
  >;
  /** A feature's or module's tasks below it, by the repo and branch they were last recorded on. */
  readonly repoTree: ReadonlyArray<RepoGroup>;
  /** Root first: each parent's objective line, as chats on this task see it. */
  readonly parents: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly level: Level;
    readonly objective: string;
  }>;
  /** What each chat on this task (on a master task, in its tree) last asked and answered. */
  readonly chats: ReadonlyArray<{
    readonly sessionId: string;
    readonly lastPrompt: string;
    readonly lastAnswer: string;
    readonly branch: string;
    readonly subfolder: string;
  }>;
}

type RepoStanding = Pick<RepoState, "upstream" | "ahead" | "behind" | "dirty"> & {
  /** The merge target at that checkpoint; null when no merge mode was set then. */
  readonly target: string | null;
  readonly aheadOfTarget: number | null;
};

const standingOf = (r: RepoState): RepoStanding => ({
  upstream: r.upstream,
  ahead: r.ahead,
  behind: r.behind,
  dirty: r.dirty,
  target: r.target ?? null,
  aheadOfTarget: r.aheadOfTarget ?? null,
});

export interface RepoGroup {
  readonly name: string;
  readonly branch: string;
  /** The newest commit recorded on the branch by any of its tasks. */
  readonly head: string;
  /** Push and clean state at the newest checkpoint; null when only done evidence names the branch. */
  readonly state: RepoStanding | null;
  readonly at: number;
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly head: string;
    readonly done: boolean;
    readonly at: number;
    /** Ids of the slots whose build holds the task's finished work. */
    readonly inSlots: ReadonlyArray<string>;
  }>;
}

/** Groups tasks by the repo and branch each was last recorded on, the newest record first. */
export function repoTreeOf(tasks: ReadonlyArray<Task>): RepoGroup[] {
  const groups = new Map<string, { -readonly [K in keyof RepoGroup]: RepoGroup[K] }>();
  for (const task of tasks) {
    const recorded = task.repoState?.length
      ? task.repoState.map((r) => ({ ...r, state: r }))
      : (task.doneEvidence?.repos ?? []).map((r) => ({
          ...r,
          at: task.doneEvidence?.at ?? 0,
          state: null,
        }));
    for (const r of recorded) {
      const key = `${r.name}
${r.branch}`;
      const entry = {
        id: task.id,
        title: task.title,
        head: r.head,
        done: task.status === "done",
        at: r.at,
        inSlots: task.inSlots ?? [],
      };
      const group = groups.get(key);
      const state = r.state ? standingOf(r.state) : null;
      if (!group) {
        groups.set(key, {
          name: r.name,
          branch: r.branch,
          head: r.head,
          state,
          at: r.at,
          tasks: [entry],
        });
        continue;
      }
      group.tasks = [...group.tasks, entry];
      if (r.at > group.at) {
        group.head = r.head;
        group.at = r.at;
      }
      // A checkpoint's push state outranks done evidence, which records none.
      if (state && (r.at >= group.at || !group.state)) group.state = state;
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, tasks: group.tasks.toSorted((a, b) => b.at - a.at) }))
    .toSorted((a, b) => b.at - a.at);
}

const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\s*/, "");
const checkpointOf = (md: string): string | null =>
  /^<!-- [^\r\n]* · checkpoint (\S+) -->/.exec(md)?.[1] ?? null;
const levelOf = (t: Task): Level => (t.level === 2 || t.level === 3 ? t.level : 1);

export async function checksForTask(
  store: BoardStore,
  boardId: string,
  task: Task,
  phases: ReadonlyArray<PlanPhase>,
) {
  const children = new Set(
    phases.flatMap((phase) =>
      phase.steps.flatMap((step) => (step.done && step.childId ? [step.childId] : [])),
    ),
  );
  const tasks = [
    task,
    ...(await Promise.all([...children].map((id) => store.loadTask(boardId, id)))),
  ];
  return tasks
    .flatMap((owner) =>
      owner ? (owner.checks ?? []).map((check) => ({ ...check, taskTitle: owner.title })) : [],
    )
    .toSorted((a, b) => b.at - a.at)
    .slice(0, 20);
}

export async function readTaskDetail(
  store: BoardStore,
  boardId: string,
  taskId: string,
): Promise<BoardTaskDetail | null> {
  const task = await store.loadTask(boardId, taskId);
  if (!task) return null;
  const ancestors = await store.ancestorsOf(boardId, task);
  const rootFirst = ancestors.toReversed();
  const master = rootFirst[0] ?? task;
  const [masterPlan, plan, handoff, stepNotes, parentHandoffs, sessions, all] = await Promise.all([
    store.readText(store.masterPath(boardId, master.id)),
    store.readText(store.planPath(boardId, task.id)),
    store.readText(store.livingPath(boardId, task.id)),
    store.stepNotes(boardId, task.id),
    Promise.all(rootFirst.map((a) => store.readText(store.livingPath(boardId, a.id)))),
    store.listSessions(boardId),
    levelOf(task) === 3 ? Promise.resolve([] as Task[]) : store.listTasks(boardId),
  ]);
  const tree = new Set([task.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of all)
      if (t.parentId && tree.has(t.parentId) && !tree.has(t.id)) {
        tree.add(t.id);
        grew = true;
      }
  }
  const decision =
    (group: "own" | "up" | "inherited", owner: Task) =>
    (d: Decision): BoardTaskDetail["decisions"][number] => ({
      id: d.id,
      title: d.title,
      description: d.description,
      options: d.options,
      verdict: d.verdict,
      status: d.status,
      type: decisionType(d),
      level: d.level,
      refs: d.refs ?? [],
      at: d.at,
      group,
      r: d.rec?.r ?? null,
      area: d.rec?.area ?? "",
      implemented: d.rec?.implemented
        ? {
            problem: d.rec.implemented.problem ?? "",
            approach: d.rec.implemented.approach ?? "",
            api: d.rec.implemented.api ?? "",
            code: d.rec.implemented.code ?? "",
            tests: d.rec.implemented.tests ?? "",
          }
        : null,
      decidedAt: d.decidedAt ?? null,
      raisedFrom: d.raisedFrom ?? null,
      filedOn: { id: owner.id, title: owner.title },
    });
  const phases = planPhases(plan);
  return {
    masterPlan,
    masterTaskId: master.id,
    plan: phases,
    planMarkdown: plan,
    handoff: stripHeader(handoff),
    handoffCheckpoint: checkpointOf(handoff),
    aliases: task.aliases ?? [],
    checks: await checksForTask(store, boardId, task, phases),
    stepNotes: stepNotes.map((n) => ({
      ...n,
      text: stripHeader(n.text),
      checkpointRef: checkpointOf(n.text),
    })),
    docs: [
      ...(task.docs ?? []).map((d) => ({ ...docOf(d), from: null })),
      ...rootFirst.flatMap((a) =>
        (a.docs ?? []).map((d) => ({
          ...docOf(d),
          from: { id: a.id, title: a.title, level: levelOf(a) },
        })),
      ),
    ],
    decisions: [
      ...(task.decisions ?? []).map(decision("own", task)),
      ...ancestors.flatMap((a) =>
        (a.decisions ?? []).filter((d) => d.raisedFrom?.id === task.id).map(decision("up", a)),
      ),
      ...ancestors.flatMap((a) =>
        (a.decisions ?? [])
          .filter((d) => d.raisedFrom?.id !== task.id)
          .map(decision("inherited", a)),
      ),
    ],
    repoState: (task.repoState ?? []).map((r) => ({
      name: r.name,
      branch: r.branch,
      head: r.head,
      at: r.at,
      ...standingOf(r),
    })),
    repoTree: repoTreeOf(all.filter((x) => x.id !== task.id && tree.has(x.id))),
    parents: rootFirst.map((a, i) => ({
      id: a.id,
      title: a.title,
      level: levelOf(a),
      objective: parentHandoffs[i] ? objectiveLine(parentHandoffs[i]) : a.description,
    })),
    // A master task's chats are every chat in its tree; a module's are its own.
    chats: sessions
      .filter(
        (x) =>
          !x.supersededBy &&
          x.taskId !== null &&
          (levelOf(task) === 1 ? tree.has(x.taskId) : x.taskId === task.id),
      )
      .map((x) => ({
        sessionId: x.sessionId,
        lastPrompt: x.lastPrompt,
        lastAnswer: x.lastAnswer,
        branch: x.branch,
        subfolder: x.subfolder,
      })),
  };
}

const docOf = (d: TaskDoc) => ({
  id: d.id,
  kind: d.kind,
  title: d.title,
  ref: d.ref,
  note: d.note,
});
