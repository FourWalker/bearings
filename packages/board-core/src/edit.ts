// @effect-diagnostics extendsNativeError:off
/**
 * Changes to a board's tasks, for every caller: the person in an app (T3's task views, the board
 * app) and agents through the board tools share these, so a task changes the same way whoever
 * changes it.
 *
 * @module board-core/edit
 */
import { type BoardGit, systemClock } from "./io.ts";
import {
  markStepDelegated,
  planPhases,
  planProgress,
  setDelegatedDone,
  setStepDone,
  stepDone,
} from "./plan.ts";
import { type BoardStore, cleanMerge, decisionType, levelOf } from "./store.ts";
import { doneEvidence } from "./verify.ts";
import { base, isInside, norm, sameRoot, slug, stamp } from "./text.ts";
import type {
  Board,
  Decision,
  DecisionType,
  ItemKind,
  Level,
  LinkType,
  MergeMode,
  RepoState,
  Root,
  Session,
  Task,
  TaskDoc,
  TaskStatus,
} from "./types.ts";

/** Who made a change, recorded on what it adds: a chat's session id, or an app. */
export interface EditActor {
  readonly by: string;
}

/** A change that can't be made; its message says why, for the person or the agent. */
export class BoardEditError extends Error {}

export type TaskEdit =
  | {
      readonly op: "update";
      readonly title?: string | undefined;
      readonly description?: string | undefined;
      readonly status?: TaskStatus | undefined;
      readonly kind?: "feature" | "backlog" | undefined;
      readonly mainService?: string | null | undefined;
      readonly services?: ReadonlyArray<string> | undefined;
    }
  | { readonly op: "addItem"; readonly kind: Exclude<ItemKind, "decision">; readonly text: string }
  | { readonly op: "toggleItem"; readonly itemId: string }
  | { readonly op: "deleteItem"; readonly itemId: string }
  | { readonly op: "savePlan"; readonly markdown: string }
  | { readonly op: "toggleStep"; readonly step: string }
  | { readonly op: "star"; readonly on: boolean }
  | { readonly op: "saveHandoff"; readonly markdown: string }
  | { readonly op: "saveMasterPlan"; readonly markdown: string }
  | {
      readonly op: "addDoc";
      readonly kind: string;
      readonly title: string;
      readonly ref: string;
      readonly note: string;
    }
  | { readonly op: "removeDoc"; readonly docId: string }
  | { readonly op: "removeAlias"; readonly alias: string }
  | {
      readonly op: "addLink";
      readonly to: string;
      readonly type: LinkType | "blocks" | "led_to";
      readonly note: string;
    }
  | {
      readonly op: "removeLink";
      readonly to: string;
      readonly type: LinkType | "blocks" | "led_to";
    }
  | { readonly op: "createChild"; readonly title: string; readonly fromStep?: string | undefined }
  | { readonly op: "reportBug"; readonly title: string }
  | {
      readonly op: "addDecision";
      readonly title: string;
      readonly description: string;
      readonly options: string;
      readonly refs: ReadonlyArray<string>;
      /** The level it affects: filed on this task or the parent at that level. */
      readonly level: Level;
      readonly type?: DecisionType | undefined;
      readonly recommendation?:
        | {
            readonly area: string;
            readonly lldCheck?: string | undefined;
            readonly register?: string | null | undefined;
          }
        | undefined;
    }
  | {
      readonly op: "setDecision";
      readonly decisionId: string;
      readonly action: "decide" | "drop" | "skip" | "reopen";
      readonly verdict?: string | undefined;
    }
  | {
      readonly op: "updateDecision";
      readonly decisionId: string;
      readonly title?: string | undefined;
      readonly description?: string | undefined;
      readonly options?: string | undefined;
      readonly refs?: ReadonlyArray<string> | undefined;
      readonly type?: DecisionType | undefined;
      readonly area?: string | undefined;
      readonly lldCheck?: string | undefined;
      readonly register?: string | null | undefined;
    }
  | { readonly op: "deleteDecision"; readonly decisionId: string }
  | {
      readonly op: "implemented";
      readonly decisionId: string;
      readonly problem: string;
      readonly approach: string;
      readonly api: string;
      readonly code: string;
      readonly tests: string;
    }
  /** Re-parents the task (null: a master task); its subtasks move with it. */
  | { readonly op: "move"; readonly parentId: string | null }
  /** One level up: task → module → master task; its subtasks move with it. */
  | { readonly op: "promote" }
  /** Gives the task's module (or master task) to a workspace copy, or releases it (null). */
  | { readonly op: "setOwner"; readonly root: string | null }
  /** Hands the module over once everything is pushed, clean and checkpointed. */
  | { readonly op: "softRelease" }
  /** A feature's or module's own merge mode; null goes back to the parent's or the board's. */
  | { readonly op: "setMerge"; readonly merge: MergeMode | null }
  /** The open merge request for a feature's or module's work; "" clears it. */
  | { readonly op: "setMergeRequest"; readonly url: string }
  /** The build the work landed in, and for a bug the build it was found in; "" clears one. */
  | {
      readonly op: "setBuild";
      readonly landedIn?: string | undefined;
      readonly foundIn?: string | undefined;
    }
  | { readonly op: "reclaim" };

export interface EditResult {
  readonly message: string;
  /** A task the edit created. */
  readonly createdId?: string | undefined;
}

const LINK_FLIP: Partial<Record<string, LinkType>> = {
  blocks: "blocked_by",
  led_to: "found_during",
};

const newId = (store: BoardStore, prefix: string, upper = false, suffixMax = 0): string => {
  const t = store.clock.now().toString(36);
  return `${prefix}${upper ? t.toUpperCase() : t}${suffixMax ? store.clock.random(suffixMax) : ""}`;
};

/** Records an action on a task, and its done time once it is done or no plan step is left. */
export function stampProgress(task: Task, plan: string, now: number): void {
  task.lastActionAt = now;
  const { done, total } = planProgress(plan);
  if (task.status === "done" || (total > 0 && done === total)) task.doneAt ??= now;
  else delete task.doneAt;
}

const tickedIn = (plan: string) =>
  planPhases(plan).flatMap((phase) => phase.steps.filter((step) => step.done).map((s) => s.id));

/**
 * Lists a chat on a task whose plan steps it ticked between `before` and `after`. This is "worked
 * on", not the chat's link: its task in hand, context and ownership stay where they are.
 */
export function markWorked(
  task: Task,
  session: Pick<Session, "sessionId" | "workspaceLabel">,
  before: string,
  after: string,
  now: number,
): void {
  const had = new Set(tickedIn(before));
  const step = tickedIn(after)
    .filter((id) => !had.has(id))
    .at(-1);
  if (step === undefined) return;
  const ref = task.sessions.find((r) => r.sessionId === session.sessionId);
  if (ref) ref.ticked = { step, at: now };
  else
    task.sessions.push({
      sessionId: session.sessionId,
      linkedAt: now,
      workspaceLabel: session.workspaceLabel,
      ticked: { step, at: now },
    });
}

/** Takes a chat off a task it only worked on; a chat linked to the task stays listed. */
export async function dropWorked(
  store: BoardStore,
  boardId: string,
  taskId: string,
  session: Pick<Session, "sessionId" | "taskId">,
): Promise<void> {
  const task = await store.loadTask(boardId, taskId);
  const ref = task?.sessions.find((r) => r.sessionId === session.sessionId);
  if (!task || !ref?.ticked) return;
  if (session.taskId === taskId) delete ref.ticked;
  else task.sessions = task.sessions.filter((r) => r !== ref);
  await store.saveTask(boardId, task);
}

async function requireTask(store: BoardStore, boardId: string, id: string): Promise<Task> {
  const task = await store.loadTask(boardId, id);
  if (!task) throw new BoardEditError(`No task "${id}".`);
  return task;
}

/**
 * A subtask that took over a parent plan step finishes that step when it's done, and reopens
 * it when it's reopened, so the parent's next step never points at finished work. Returns the
 * step ids it changed.
 */
export async function syncDelegatedSteps(
  store: BoardStore,
  boardId: string,
  task: Task,
  /** The chat that finished the subtask: it is listed on the parent whose step that ticked. */
  by?: Pick<Session, "sessionId" | "workspaceLabel"> | null,
): Promise<string[]> {
  if (!task.parentId) return [];
  const path = store.planPath(boardId, task.parentId);
  const plan = await store.readText(path);
  const updated = setDelegatedDone(plan, task.id, task.status === "done");
  if (updated === plan) return [];
  await store.io.write(path, updated);
  const parent = await store.loadTask(boardId, task.parentId);
  if (parent) {
    if (by) markWorked(parent, by, plan, updated, store.clock.now());
    stampProgress(parent, updated, store.clock.now());
    await store.saveTask(boardId, parent);
  }
  const before = plan.split(/\r?\n/);
  return updated
    .split(/\r?\n/)
    .filter((line, i) => line !== before[i])
    .map((line) => /\]\s+([A-Za-z]*\d+[A-Za-z0-9.]*)/.exec(line)?.[1] ?? "")
    .filter(Boolean);
}

export interface NewTask {
  readonly title: string;
  readonly parentId?: string | null | undefined;
  readonly description?: string | undefined;
  readonly kind?: "feature" | "backlog" | undefined;
  readonly services?: ReadonlyArray<string> | undefined;
  readonly mainService?: string | undefined;
  readonly bug?: boolean | undefined;
  /** For a bug fix: the finished task it fixes. */
  readonly fixes?: string | undefined;
  readonly plan?: string | undefined;
  /** A parent plan step this task takes over. */
  readonly fromStep?: string | undefined;
}

/** Creates a master task, or a module or task under `parentId`. */
export async function createTask(
  store: BoardStore,
  boardId: string,
  input: NewTask,
  actor: EditActor,
): Promise<Task> {
  const title = input.title.trim();
  if (!title) throw new BoardEditError("title is required.");
  const parent = input.parentId ? await requireTask(store, boardId, input.parentId) : null;
  if (parent && levelOf(parent) >= 3)
    throw new BoardEditError(
      `"${parent.title}" is a Level 3 task and can't have subtasks. Promote it first, then create subtasks under it.`,
    );
  const now = store.clock.now();
  const level = (parent ? levelOf(parent) + 1 : 1) as Level;
  const task: Task = {
    id: await store.freeTaskId(boardId, slug(title)),
    title,
    description: input.description ?? "",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastAction: null,
    items: [],
    sessions: [],
    level,
    parentId: parent?.id ?? null,
  };
  if (level === 1) task.kind = input.kind === "backlog" ? "backlog" : "feature";
  if (input.services) task.services = [...input.services];
  else if (parent?.services?.length) task.services = [...parent.services];
  if (input.mainService) task.mainService = input.mainService;
  if (input.bug) task.bug = true;
  if (input.fixes) {
    const original = await requireTask(store, boardId, input.fixes);
    task.links = [
      { to: original.id, type: "fixes", note: input.description ?? "", at: now, by: actor.by },
    ];
  }
  await store.saveTask(boardId, task);
  if (input.plan) await store.io.write(store.planPath(boardId, task.id), input.plan);
  if (parent && input.fromStep) {
    const path = store.planPath(boardId, parent.id);
    const plan = await store.readText(path);
    const marked = markStepDelegated(plan, input.fromStep, task.id);
    if (marked !== plan) await store.io.write(path, marked);
  }
  return task;
}

/**
 * Files a decision at the level it affects: on `task`, or the parent at that level, mapped back
 * to `task` where it was raised. A recommendation gets the next board-wide R#.
 */
export function addDecision(
  ...args: Parameters<typeof fileDecision>
): ReturnType<typeof fileDecision> {
  const [store, boardId] = args;
  const key = store.projectDir(boardId).toLowerCase();
  const pending = pendingDecisions.get(key) ?? Promise.resolve();
  const result = pending.then(() => withDecisionLock(store, boardId, () => fileDecision(...args)));
  const settled = result.then(
    () => {},
    () => {},
  );
  pendingDecisions.set(key, settled);
  return result.finally(() => {
    if (pendingDecisions.get(key) === settled) pendingDecisions.delete(key);
  });
}

const pendingDecisions = new Map<string, Promise<void>>();

async function withDecisionLock<A>(store: BoardStore, boardId: string, write: () => Promise<A>) {
  const { claim, remove, delay, stat } = store.io;
  if (!claim || !remove || !delay) return write();
  const path = `${store.projectDir(boardId)}/.decision-write.lock`;
  for (let attempt = 0; attempt < 25; attempt++) {
    if (await claim(path)) {
      try {
        return await write();
      } finally {
        await remove(path);
      }
    }
    const previous = await stat(path).catch(() => null);
    // A process that quits without releasing the lock must not block the board permanently.
    if (previous && systemClock.now() - previous.mtimeMs > 120_000) {
      const current = await stat(path).catch(() => null);
      if (current?.mtimeMs === previous.mtimeMs) await remove(path);
      continue;
    }
    await delay(20 * Math.min(attempt + 1, 8));
  }
  throw new BoardEditError("The board is filing another decision. Try again.");
}

async function reserveRecommendation(store: BoardStore, boardId: string, requested?: string) {
  const used = new Set<number>();
  for (const task of await store.listTasks(boardId)) {
    for (const decision of task.decisions ?? []) {
      const number = Number(String(decision.rec?.r ?? "").replace(/\D/g, ""));
      if (Number.isSafeInteger(number) && number > 0) used.add(number);
    }
  }
  const reserve = (number: number) =>
    store.io.claim?.(`${store.projectDir(boardId)}/recommendation-numbers/R${number}`) ??
    Promise.resolve(true);
  if (requested) {
    const number = Number(/^R(\d+)$/i.exec(requested.trim())?.[1]);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new BoardEditError("Use a recommendation number like R12.");
    if (used.has(number) || !(await reserve(number)))
      throw new BoardEditError(`Recommendation R${number} is already on this board.`);
    return `R${number}`;
  }
  let number = Math.max(0, ...used) + 1;
  while (!(await reserve(number))) number += 1;
  return `R${number}`;
}

async function fileDecision(
  store: BoardStore,
  boardId: string,
  task: Task,
  input: {
    readonly title: string;
    readonly description?: string | undefined;
    readonly options?: string | undefined;
    readonly refs?: ReadonlyArray<string> | undefined;
    readonly level?: number | undefined;
    readonly type?: DecisionType | undefined;
    readonly recommendation?:
      | {
          readonly r?: string | undefined;
          readonly area?: string | undefined;
          readonly lldCheck?: string | undefined;
          readonly register?: string | null | undefined;
        }
      | undefined;
  },
  actor: EditActor,
): Promise<{ readonly decision: Decision; readonly owner: Task }> {
  const title = input.title.trim();
  if (!title) throw new BoardEditError("title is required.");
  const current = await requireTask(store, boardId, task.id);
  const chain = [current, ...(await store.ancestorsOf(boardId, current))];
  const want = input.type === "feature" ? 1 : (input.level ?? levelOf(task));
  const owner = chain.find((x) => levelOf(x) <= want) ?? chain.at(-1) ?? task;
  const decision: Decision = {
    id: newId(store, "D-", true, 1_000_000),
    title,
    description: input.description ?? "",
    level: levelOf(owner),
    raisedFrom: owner.id === task.id ? null : { id: task.id, title: task.title },
    refs: [...(input.refs ?? [])],
    options: input.options ?? "",
    verdict: "",
    status: "open",
    at: store.clock.now(),
    by: actor.by,
    ...(input.type ? { type: input.type } : {}),
  };
  if (input.recommendation) {
    decision.rec = {
      r: await reserveRecommendation(store, boardId, input.recommendation.r),
      area: input.recommendation.area ?? "",
      lldCheck: input.recommendation.lldCheck ?? "",
      register: input.recommendation.register || null,
      implemented: null,
    };
  }
  owner.decisions = [...(owner.decisions ?? []), decision];
  await store.saveTask(boardId, owner);
  return { decision, owner };
}

/** Finds a decision by id or R# on `task`, its parents, or anywhere on the board. */
export async function findDecision(
  store: BoardStore,
  boardId: string,
  task: Task,
  id: string,
): Promise<{ readonly decision: Decision; readonly owner: Task } | null> {
  const has = (x: Task) => (x.decisions ?? []).some((d) => d.id === id || d.rec?.r === id);
  const chain = [task, ...(await store.ancestorsOf(boardId, task))];
  const owner = chain.find(has) ?? (await store.listTasks(boardId)).find(has);
  const decision = owner?.decisions?.find((d) => d.id === id || d.rec?.r === id);
  return owner && decision ? { decision, owner } : null;
}

/** Whether an open decision of this type keeps its task from done. */
export const holdsDone = (decision: Pick<Decision, "type" | "rec" | "status">): boolean =>
  decision.status === "open" &&
  (decisionType(decision) === "blocker" || decisionType(decision) === "mandatory");

/** The open decisions that keep `task` from done: its own, and those it raised higher up. */
export function holdingDecisions(task: Task, all: ReadonlyArray<Task>): Decision[] {
  return [
    ...(task.decisions ?? []).filter(holdsDone),
    ...all
      .filter((other) => other.id !== task.id)
      .flatMap((other) => other.decisions ?? [])
      .filter((decision) => decision.raisedFrom?.id === task.id && holdsDone(decision)),
  ];
}

/**
 * Records the person's verdict, drops, skips or reopens a decision. The caller saves `owner`.
 * A skip is a drop that says who skipped: reopening undoes it.
 */
export function settleDecision(
  store: BoardStore,
  decision: Decision,
  action: "decide" | "drop" | "skip" | "reopen",
  verdict: string,
  by = "the person",
): void {
  if (action === "decide") {
    decision.status = "decided";
    decision.verdict = verdict;
    decision.decidedAt = store.clock.now();
  } else if (action === "skip") {
    if (decisionType(decision) === "blocker")
      throw new BoardEditError("A blocker can't be skipped: decide it, or change its type.");
    decision.status = "dropped";
    decision.verdict = `Skipped by ${by}${verdict ? `: ${verdict}` : ""}`;
  } else if (action === "drop") {
    decision.status = "dropped";
    decision.verdict = verdict;
  } else decision.status = "open";
}

export async function setSessionTask(
  store: BoardStore,
  boardId: string,
  session: Session,
  task: Task | null,
): Promise<Session> {
  if (task) {
    if (!task.sessions.some((ref) => ref.sessionId === session.sessionId)) {
      task.sessions.push({
        sessionId: session.sessionId,
        linkedAt: store.clock.now(),
        workspaceLabel: session.workspaceLabel,
      });
    }
    await store.saveTask(boardId, task);
  }
  const linked = {
    ...session,
    taskId: task?.id ?? null,
    linkDeclined: task === null,
    pickupNote: task === null ? undefined : session.pickupNote,
    updatedAt: store.clock.now(),
  };
  await store.writeSession(boardId, linked);
  if (session.taskId && session.taskId !== task?.id) {
    const previous = await store.loadTask(boardId, session.taskId);
    // A chat that ticked a step there stays listed as having worked on it.
    if (previous?.sessions.some((ref) => ref.sessionId === session.sessionId && !ref.ticked)) {
      previous.sessions = previous.sessions.filter((ref) => ref.sessionId !== session.sessionId);
      await store.saveTask(boardId, previous);
    }
  }
  return linked;
}

/**
 * Links two tasks, or removes the link. `blocks` and `led_to` are stored as the other task's
 * `blocked_by` and `found_during`, so each link lives on one side.
 */
export async function setTaskLink(
  store: BoardStore,
  boardId: string,
  task: Task,
  input: {
    readonly to: string;
    readonly type: string;
    readonly note?: string | undefined;
    readonly remove?: boolean | undefined;
  },
  actor: EditActor,
): Promise<{ readonly from: Task; readonly to: Task; readonly type: LinkType }> {
  const other = await store.loadTask(boardId, slug(input.to));
  if (!other) throw new BoardEditError(`No task "${input.to}".`);
  const flipped = LINK_FLIP[input.type];
  const type = flipped ?? input.type;
  const [from, to] = flipped ? [other, task] : [task, other];
  if (
    type !== "blocked_by" &&
    type !== "found_during" &&
    type !== "related" &&
    type !== "fixes" &&
    type !== "superseded_by"
  )
    throw new BoardEditError(
      "type must be blocked_by, blocks, found_during, led_to, related, fixes or superseded_by.",
    );
  if (from.id === to.id) throw new BoardEditError("A task cannot link to itself.");
  from.links = (from.links ?? []).filter((l) => !(l.to === to.id && l.type === type));
  if (!input.remove)
    from.links.push({
      to: to.id,
      type,
      note: input.note ?? "",
      at: store.clock.now(),
      by: actor.by,
    });
  await store.saveTask(boardId, from);
  return { from, to, type };
}

const LEVEL_NAME: Record<Level, string> = { 1: "master task", 2: "module", 3: "task" };

/** Re-parents `task` with its subtree; levels follow, at most three deep. */
export async function moveTask(
  store: BoardStore,
  boardId: string,
  task: Task,
  parentId: string | null,
): Promise<Task | null> {
  const all = await store.listTasks(boardId);
  const parent = parentId ? (all.find((x) => x.id === slug(parentId)) ?? null) : null;
  if (parentId && !parent) throw new BoardEditError(`No task "${parentId}".`);
  const kids = (id: string) => all.filter((x) => x.parentId === id);
  const below = (id: string): Task[] => kids(id).flatMap((k) => [k, ...below(k.id)]);
  if (parent && (parent.id === task.id || below(task.id).some((d) => d.id === parent.id)))
    throw new BoardEditError("Cannot move a task under itself.");
  const height = (id: string): number => 1 + Math.max(0, ...kids(id).map((k) => height(k.id)));
  const level = parent ? levelOf(parent) + 1 : 1;
  if (level + height(task.id) - 1 > 3)
    throw new BoardEditError("That would go deeper than 3 levels.");
  const delta = level - levelOf(task);
  const old = task.parentId ? all.find((x) => x.id === task.parentId) : undefined;
  if (old && old.id !== parent?.id)
    task.origin = [...(task.origin ?? []), { id: old.id, title: old.title }];
  task.parentId = parent?.id ?? null;
  for (const x of [task, ...below(task.id)]) {
    x.level = Math.min(3, Math.max(1, levelOf(x) + delta)) as Level;
    if (x.level === 1 && !x.kind) x.kind = "feature";
    await store.saveTask(boardId, x);
  }
  return parent;
}

/** Moves `task` one level up; its former parent stays reachable as an origin. */
export async function promoteTask(
  store: BoardStore,
  boardId: string,
  task: Task,
): Promise<Task | null> {
  const level = levelOf(task);
  if (level === 1) throw new BoardEditError(`"${task.title}" is already a master task.`);
  const parent = task.parentId ? await store.loadTask(boardId, task.parentId) : null;
  task.origin = [
    ...(task.origin ?? []),
    ...(parent ? [{ id: parent.id, title: parent.title }] : []),
  ];
  task.parentId = parent?.parentId ?? null;
  task.level = (level - 1) as Level;
  for (const d of task.decisions ?? []) if (d.level === level) d.level = task.level;
  if (task.level === 1 && !task.kind) task.kind = "feature";
  await store.saveTask(boardId, task);
  for (const kid of await store.childrenOf(boardId, task.id)) {
    kid.level = (levelOf(kid) - 1 || 1) as Level;
    await store.saveTask(boardId, kid);
  }
  return parent;
}

/** Ownership lives on modules and master tasks; a task belongs to its module's owner. */
async function ownerNodeOf(store: BoardStore, boardId: string, task: Task): Promise<Task> {
  if (levelOf(task) === 3 && task.parentId)
    return (await store.loadTask(boardId, task.parentId)) ?? task;
  return task;
}

function ownerHistory(
  store: BoardStore,
  task: Task,
  type: string,
  actor: EditActor,
  extra: { from?: string | undefined; to?: string | undefined },
): void {
  task.ownerHistory = [
    ...(task.ownerHistory ?? []),
    { type, at: store.clock.now(), by: actor.by, ...extra },
  ].slice(-30);
}

/** The repos a module works in, in workspace copy `root`: its tree's service folders there. */
async function reposAt(
  store: BoardStore,
  boardId: string,
  board: Board,
  node: Task,
  root: string,
  git: BoardGit,
): Promise<RepoState[]> {
  const all = await store.listTasks(boardId);
  const below = (id: string): Task[] =>
    all.filter((x) => x.parentId === id).flatMap((k) => [k, ...below(k.id)]);
  const ids = new Set(
    [node, ...below(node.id)].flatMap((x) => [
      ...(x.services ?? []),
      ...(x.mainService ? [x.mainService] : []),
    ]),
  );
  const seen = new Map<string, RepoState>();
  for (const svc of board.services ?? [])
    if (ids.has(svc.id))
      for (const m of svc.match) {
        const dir = `${norm(root)}/${m}`;
        if (!(await store.io.exists(dir).catch(() => false))) continue;
        const state = await git.state(dir);
        if (state && !seen.has(state.repo)) seen.set(state.repo, { ...state, service: svc.id });
      }
  if (seen.size === 0) {
    const state = await git.state(norm(root)).catch(() => null);
    if (state) seen.set(state.repo, state);
  }
  return [...seen.values()];
}

/** Why a module isn't ready to hand over: unpushed or uncommitted work, or a stale handoff. */
async function softReleaseProblems(
  store: BoardStore,
  boardId: string,
  node: Task,
  repos: ReadonlyArray<RepoState>,
): Promise<string[]> {
  const problems: string[] = [];
  if (!repos.length) problems.push("no repos found: tag the services it touches first");
  for (const r of repos) {
    if (!r.upstream) problems.push(`${r.name}: branch ${r.branch} has no upstream, push it`);
    else if (r.ahead) problems.push(`${r.name}: ${r.ahead} commit(s) on ${r.branch} not pushed`);
    if (r.dirty) problems.push(`${r.name}: ${r.dirty} uncommitted change(s)`);
  }
  const all = await store.listTasks(boardId);
  const below = (id: string): Task[] =>
    all.filter((x) => x.parentId === id).flatMap((k) => [k, ...below(k.id)]);
  let handoffAt = 0;
  for (const x of [node, ...below(node.id)]) {
    const at = await store.io
      .stat(store.livingPath(boardId, x.id))
      .then((s) => s.mtimeMs)
      .catch(() => 0);
    handoffAt = Math.max(handoffAt, at);
  }
  const lastCommit = Math.max(0, ...repos.map((r) => r.lastCommitAt));
  if (repos.length && handoffAt < lastCommit)
    problems.push("the living handoff is older than the last commit: checkpoint first");
  return problems;
}

export async function checkSoftRelease(
  store: BoardStore,
  boardId: string,
  task: Task,
  git: BoardGit,
) {
  const node = await ownerNodeOf(store, boardId, task);
  if (!node.owner) throw new BoardEditError("Nobody owns this module or master task.");
  const board = (await store.loadRegistry()).boards.find((b) => b.id === boardId);
  if (!board) throw new BoardEditError("No such board.");
  const pickup = await reposAt(store, boardId, board, node, node.owner.root, git);
  const problems = await softReleaseProblems(store, boardId, node, pickup);
  return { ok: problems.length === 0, problems, pickup, node, owner: node.owner };
}

/** The workspace copy an unowned task was done in: the only one, or the one all its files are in. */
function copyOf(task: Task, roots: ReadonlyArray<Root>): string | undefined {
  if (roots.length === 1) return roots[0]?.path;
  const files = task.files ?? [];
  if (files.length === 0) return undefined;
  return roots
    .filter((root) => files.every((file) => isInside(file, root.path)))
    .toSorted((a, b) => b.path.length - a.path.length)[0]?.path;
}

/** Applies one change a person made to a task in an app. `git` reads repo state for a soft release. */
export async function editTask(
  store: BoardStore,
  boardId: string,
  taskId: string,
  edit: TaskEdit,
  actor: EditActor,
  git?: BoardGit,
): Promise<EditResult> {
  const task = await requireTask(store, boardId, taskId);
  const now = store.clock.now();
  switch (edit.op) {
    case "update": {
      const wasDone = task.status === "done";
      if (edit.title !== undefined) {
        const title = edit.title.trim();
        if (!title) throw new BoardEditError("The title can't be empty.");
        task.title = title;
      }
      if (edit.description !== undefined) task.description = edit.description;
      if (edit.status !== undefined) task.status = edit.status;
      if (wasDone && task.status !== "done") delete task.doneEvidence;
      if (!wasDone && task.status === "done" && git) {
        const node = await ownerNodeOf(store, boardId, task);
        const board = (await store.loadRegistry()).boards.find((b) => b.id === boardId);
        const root = node.owner?.root ?? copyOf(task, board?.roots ?? []);
        // With no copy to name, the files and check still count; its commit is left unknown.
        if (board)
          task.doneEvidence = doneEvidence(
            task,
            root ? await reposAt(store, boardId, board, node, root, git) : [],
            now,
          );
      }
      if (edit.kind !== undefined && levelOf(task) === 1) task.kind = edit.kind;
      if (edit.mainService !== undefined) task.mainService = edit.mainService;
      if (edit.services !== undefined) task.services = [...new Set(edit.services)];
      if (edit.status !== undefined)
        stampProgress(task, await store.readText(store.planPath(boardId, task.id)), now);
      await store.saveTask(boardId, task);
      const steps =
        wasDone !== (task.status === "done") ? await syncDelegatedSteps(store, boardId, task) : [];
      return {
        message: steps.length
          ? `Saved. ${task.status === "done" ? "Ticked" : "Reopened"} ${steps.join(", ")} in the parent's plan.`
          : "Saved.",
      };
    }
    case "addItem": {
      const text = edit.text.trim();
      if (!text) throw new BoardEditError("The item is empty.");
      task.items.push({
        id: newId(store, edit.kind[0] ?? "t", false, 99),
        kind: edit.kind,
        text,
        done: false,
        at: now,
        by: actor.by,
      });
      await store.saveTask(boardId, task);
      return { message: "Added." };
    }
    case "toggleItem":
    case "deleteItem": {
      const item = task.items.find((i) => i.id === edit.itemId);
      if (!item) throw new BoardEditError("No such item.");
      if (edit.op === "toggleItem") {
        item.done = !item.done;
        task.lastActionAt = now;
      } else task.items = task.items.filter((i) => i.id !== edit.itemId);
      await store.saveTask(boardId, task);
      return { message: "Saved." };
    }
    case "savePlan":
      await store.io.write(store.planPath(boardId, task.id), edit.markdown.trimEnd() + "\n");
      stampProgress(task, edit.markdown, now);
      await store.saveTask(boardId, task);
      return { message: "Plan saved." };
    case "toggleStep": {
      const path = store.planPath(boardId, task.id);
      const plan = await store.readText(path);
      const done = stepDone(plan, edit.step);
      if (done === null) throw new BoardEditError(`No step "${edit.step}" in the plan.`);
      const next = setStepDone(plan, edit.step, !done);
      await store.io.write(path, next);
      stampProgress(task, next, now);
      await store.saveTask(boardId, task);
      return { message: "Saved." };
    }
    case "setMerge": {
      if (levelOf(task) === 3)
        throw new BoardEditError("A task follows the merge mode of its module.");
      if (edit.merge === null) delete task.merge;
      else {
        const merge = cleanMerge(edit.merge);
        if (typeof merge === "string") throw new BoardEditError(merge);
        task.merge = merge;
      }
      await store.saveTask(boardId, task);
      return { message: "Saved." };
    }
    case "setMergeRequest": {
      if (levelOf(task) === 3)
        throw new BoardEditError("A merge request is recorded on the module or feature.");
      const url = edit.url.trim();
      if (url && !/^https?:\/\/\S+$/.test(url))
        throw new BoardEditError("A merge request is recorded by its link.");
      if (url) task.mergeRequest = url;
      else delete task.mergeRequest;
      await store.saveTask(boardId, task);
      return { message: "Saved." };
    }
    case "setBuild": {
      for (const key of ["landedIn", "foundIn"] as const) {
        const version = edit[key]?.trim();
        if (version) task[key] = version;
        else if (version === "") delete task[key];
      }
      await store.saveTask(boardId, task);
      return { message: "Saved." };
    }
    case "star":
      if (edit.on) task.starredAt ??= now;
      else delete task.starredAt;
      await store.saveTask(boardId, task);
      return { message: edit.on ? "Starred." : "Star removed." };
    case "saveHandoff": {
      const md = edit.markdown.trim();
      const header = `<!-- living handoff, rewritten in place · last by ${actor.by}, ${stamp(now)} -->\n`;
      await store.io.write(store.livingPath(boardId, task.id), md ? header + md + "\n" : "");
      await store.saveTask(boardId, task);
      return { message: "Handoff saved." };
    }
    case "saveMasterPlan": {
      const ancestors = await store.ancestorsOf(boardId, task);
      const master = levelOf(task) === 1 ? task : (ancestors.at(-1) ?? task);
      await store.io.write(store.masterPath(boardId, master.id), edit.markdown.trimEnd() + "\n");
      await store.saveTask(boardId, master);
      return { message: "Master plan saved." };
    }
    case "addDoc": {
      const ref = edit.ref.trim();
      if (!ref) throw new BoardEditError("A path or URL is required.");
      const doc: TaskDoc = {
        id: newId(store, "doc-"),
        kind: edit.kind || "Reference",
        title: edit.title.trim() || ref.split(/[\\/]/).pop() || ref,
        ref,
        note: edit.note,
        at: now,
        by: actor.by,
      };
      task.docs = [...(task.docs ?? []), doc];
      await store.saveTask(boardId, task);
      return { message: "Document added." };
    }
    case "removeDoc":
      if (!(task.docs ?? []).some((d) => d.id === edit.docId))
        throw new BoardEditError("No such document on this task.");
      // A removed output stays off the list when its file is touched again.
      for (const doc of task.docs ?? [])
        if (doc.id === edit.docId && doc.kind === "Output")
          task.outputsDropped = [doc.ref, ...(task.outputsDropped ?? [])].slice(0, 50);
      task.docs = (task.docs ?? []).filter((d) => d.id !== edit.docId);
      await store.saveTask(boardId, task);
      return { message: "Document removed." };
    case "removeAlias":
      if (!task.aliases?.includes(edit.alias))
        throw new BoardEditError("No such other name on this task.");
      task.aliases = task.aliases.filter((alias) => alias !== edit.alias);
      await store.saveTask(boardId, task);
      return { message: "Other name removed." };
    case "addLink":
    case "removeLink":
      await setTaskLink(
        store,
        boardId,
        task,
        {
          to: edit.to,
          type: edit.type,
          note: edit.op === "addLink" ? edit.note : "",
          remove: edit.op === "removeLink",
        },
        actor,
      );
      return { message: edit.op === "addLink" ? "Linked." : "Link removed." };
    case "createChild": {
      const child = await createTask(
        store,
        boardId,
        { title: edit.title, parentId: task.id, fromStep: edit.fromStep },
        actor,
      );
      return { message: `Created "${child.title}".`, createdId: child.id };
    }
    case "reportBug": {
      const fix = await createTask(
        store,
        boardId,
        {
          title: edit.title,
          parentId: levelOf(task) === 3 ? task.parentId : task.id,
          bug: true,
          fixes: task.id,
          services: [
            ...new Set([...(task.services ?? []), ...(task.mainService ? [task.mainService] : [])]),
          ],
        },
        actor,
      );
      return { message: `Created "${fix.title}".`, createdId: fix.id };
    }
    case "addDecision": {
      const { decision, owner } = await addDecision(
        store,
        boardId,
        task,
        {
          title: edit.title,
          description: edit.description,
          options: edit.options,
          refs: edit.refs,
          level: edit.level,
          type: edit.type,
          recommendation: edit.recommendation,
        },
        actor,
      );
      return {
        message: `${decision.rec ? `Recommendation ${decision.rec.r}` : "Decision"} filed on "${owner.title}".`,
      };
    }
    case "setDecision": {
      const found = await findDecision(store, boardId, task, edit.decisionId);
      if (!found) throw new BoardEditError(`No decision "${edit.decisionId}".`);
      settleDecision(store, found.decision, edit.action, edit.verdict ?? "");
      await store.saveTask(boardId, found.owner);
      return { message: `Decision is now ${found.decision.status}.` };
    }
    case "updateDecision": {
      const found = await findDecision(store, boardId, task, edit.decisionId);
      if (!found) throw new BoardEditError(`No decision "${edit.decisionId}".`);
      const d = found.decision;
      if (edit.title !== undefined) {
        if (!edit.title.trim()) throw new BoardEditError("The question can't be empty.");
        d.title = edit.title.trim();
      }
      if (edit.description !== undefined) d.description = edit.description;
      if (edit.options !== undefined) d.options = edit.options;
      if (edit.refs !== undefined) d.refs = [...edit.refs];
      if (edit.type !== undefined) d.type = edit.type;
      if (d.rec) {
        if (edit.area !== undefined) d.rec.area = edit.area;
        if (edit.lldCheck !== undefined) d.rec.lldCheck = edit.lldCheck;
        if (edit.register !== undefined) d.rec.register = edit.register;
      }
      await store.saveTask(boardId, found.owner);
      return { message: "Decision saved." };
    }
    case "deleteDecision": {
      task.decisions = (task.decisions ?? []).filter((decision) => decision.id !== edit.decisionId);
      await store.saveTask(boardId, task);
      return { message: "Decision removed." };
    }
    case "implemented": {
      const found = await findDecision(store, boardId, task, edit.decisionId);
      if (!found) throw new BoardEditError(`No decision "${edit.decisionId}".`);
      if (!found.decision.rec)
        throw new BoardEditError("Only recommendations have a How implemented record.");
      found.decision.rec.implemented = {
        problem: edit.problem,
        approach: edit.approach,
        api: edit.api,
        code: edit.code,
        tests: edit.tests,
        at: now,
      };
      await store.saveTask(boardId, found.owner);
      return { message: "How implemented saved." };
    }
    case "move": {
      const parent = await moveTask(store, boardId, task, edit.parentId);
      return {
        message: parent
          ? `Moved under "${parent.title}" (now a ${LEVEL_NAME[levelOf(task)]}).`
          : "Moved to the top level (master task).",
      };
    }
    case "promote": {
      await promoteTask(store, boardId, task);
      return { message: `Promoted to ${LEVEL_NAME[levelOf(task)]}.` };
    }
    case "setOwner": {
      const node = await ownerNodeOf(store, boardId, task);
      if (edit.root === null) {
        if (node.owner) ownerHistory(store, node, "release", actor, { from: node.owner.label });
        node.owner = null;
        await store.saveTask(boardId, node);
        return { message: `Released "${node.title}": the next workspace to link claims it.` };
      }
      const board = (await store.loadRegistry()).boards.find((b) => b.id === boardId);
      const root = board?.roots.find((r) => sameRoot(r.path, edit.root ?? ""));
      if (!root) throw new BoardEditError("That folder is not a workspace of this board.");
      ownerHistory(store, node, node.owner ? "takeover" : "assigned", actor, {
        from: node.owner?.label,
        to: root.label,
      });
      node.owner = { root: norm(root.path), label: root.label, state: "owned", since: now };
      await store.saveTask(boardId, node);
      return { message: `"${node.title}" is owned by ${root.label}.` };
    }
    case "softRelease": {
      if (!git) throw new BoardEditError("Repo state can't be read here.");
      const { node, owner, pickup, problems, ok } = await checkSoftRelease(
        store,
        boardId,
        task,
        git,
      );
      if (!ok) throw new BoardEditError(`Not ready for a soft release: ${problems.join("; ")}.`);
      node.owner = { ...owner, state: "soft", softAt: now, pickup };
      ownerHistory(store, node, "soft-release", actor, { from: owner.label });
      await store.saveTask(boardId, node);
      return { message: `Soft-released "${node.title}": another workspace can take over.` };
    }
    case "reclaim": {
      const node = await ownerNodeOf(store, boardId, task);
      if (!node.owner) throw new BoardEditError("Nobody owns this module or master task.");
      const { softAt: _softAt, pickup: _pickup, ...owned } = node.owner;
      node.owner = { ...owned, state: "owned" };
      ownerHistory(store, node, "reclaim", actor, { to: node.owner.label });
      await store.saveTask(boardId, node);
      return { message: `"${node.title}" is owned by ${node.owner.label} again.` };
    }
  }
}

/** A change to a board's own settings, made with ⚙ in an app. */
export type BoardSettingsEdit =
  | { readonly op: "rename"; readonly name: string }
  | { readonly op: "addRoot"; readonly path: string; readonly label: string }
  | { readonly op: "removeRoot"; readonly path: string }
  | { readonly op: "labelRoot"; readonly path: string; readonly label: string }
  | {
      readonly op: "saveServices";
      readonly services: ReadonlyArray<{
        readonly id?: string | undefined;
        readonly name: string;
        readonly match: ReadonlyArray<string>;
      }>;
    }
  | { readonly op: "saveRules"; readonly rules: string }
  | { readonly op: "setBoardMode"; readonly on: boolean }
  /** The board's merge mode, which features and modules follow unless they set their own. */
  | { readonly op: "setMerge"; readonly merge: MergeMode | null }
  | ({ readonly op: "setSlot" } & Omit<SlotBuild, "dir">)
  | { readonly op: "removeSlot"; readonly id: string }
  | {
      readonly op: "saveRegisters";
      readonly registers: ReadonlyArray<{
        readonly id?: string | undefined;
        readonly topic: string;
        readonly url: string;
      }>;
    };

async function workspaceRoot(
  store: BoardStore,
  boards: ReadonlyArray<Board>,
  rawPath: string,
  label: string,
  boardId?: string,
): Promise<Root> {
  const path = norm(rawPath.trim());
  if (
    !/^(?:[A-Za-z]:\/|\/)/.test(path) ||
    !(await store.io.list(path).then(
      () => true,
      () => false,
    ))
  )
    throw new BoardEditError(`No folder at ${path}.`);
  const taken = boards.find((board) =>
    board.roots.some((r) => isInside(path, r.path) || isInside(r.path, path)),
  );
  if (taken)
    throw new BoardEditError(
      taken.id === boardId
        ? "That folder is already a workspace of this board, or inside one."
        : `That folder overlaps a workspace of the ${taken.name} board.`,
    );
  return { path, label: label.trim() || base(path) };
}

export async function createBoard(
  store: BoardStore,
  input: {
    readonly name: string;
    readonly roots: ReadonlyArray<{ readonly path: string; readonly label: string }>;
    readonly boardMode?: boolean | undefined;
  },
): Promise<Board> {
  const name = input.name.trim();
  if (!name) throw new BoardEditError("The board needs a name.");
  const registry = await store.loadRegistry();
  if (registry.boards.some((board) => board.name.toLowerCase() === name.toLowerCase()))
    throw new BoardEditError(`A board named ${name} already exists.`);
  if (input.roots.length === 0) throw new BoardEditError("The board needs a workspace.");
  const roots: Root[] = [];
  for (const root of input.roots)
    roots.push(
      await workspaceRoot(
        store,
        [...registry.boards, { id: "", name, roots, createdAt: 0 }],
        root.path,
        root.label,
        "",
      ),
    );
  const prefix = slug(name);
  let id = prefix;
  for (
    let n = 2;
    registry.boards.some((board) => board.id === id) ||
    (await store.io.exists(store.projectDir(id)));
    n++
  )
    id = `${prefix}-${n}`;
  const board: Board = {
    id,
    name,
    roots,
    createdAt: store.clock.now(),
    ...(input.boardMode ? { boardMode: true } : {}),
  };
  registry.boards.push(board);
  await store.saveRegistry(registry);
  return board;
}

/** A build put in a slot. An empty `version` empties the slot. */
export interface SlotBuild {
  /** The slot's name; a new name makes a new slot. */
  readonly slot: string;
  readonly version: string;
  /** The commit the build was made from. Without it and with `dir`, HEAD there. */
  readonly ref?: string | undefined;
  /** The checkout the build was made in. Without it `ref` is looked up in the board's workspaces. */
  readonly dir?: string | undefined;
  readonly note?: string | undefined;
}

/**
 * Points a slot at a build, then marks which finished tasks that build holds: those whose done
 * commits in the build's repo are all in its history. A task's first such build is where it landed.
 */
export async function setSlot(
  store: BoardStore,
  boardId: string,
  input: SlotBuild,
  actor: EditActor,
  git?: BoardGit,
): Promise<EditResult> {
  const reg = await store.loadRegistry();
  const board = reg.boards.find((b) => b.id === boardId);
  if (!board) throw new BoardEditError("No such board.");
  const id = slug(input.slot);
  if (!id) throw new BoardEditError("Name the slot.");
  const version = input.version.trim();
  const asked = input.ref?.trim() ?? "";
  if (!version && asked) throw new BoardEditError("A build needs a version.");
  let built: { dir: string; repo: string; ref: string } | undefined;
  if (version && git?.commit && (asked || input.dir)) {
    for (const dir of input.dir ? [input.dir] : board.roots.map((r) => r.path)) {
      const ref = await git.commit(dir, asked || "HEAD").catch(() => null);
      if (!ref) continue;
      built = { dir, ref, repo: (await git.state(dir).catch(() => null))?.name ?? base(dir) };
      break;
    }
    if (!built && asked)
      throw new BoardEditError(
        `No commit "${asked}" in ${input.dir ?? "this board's workspaces"}.`,
      );
  }
  const slots = (board.slots ??= []);
  let slot = slots.find((x) => x.id === id);
  if (!slot) {
    slot = { id, name: input.slot.trim(), version, note: "", at: 0 };
    slots.push(slot);
  }
  slot.version = version;
  slot.note = input.note?.trim() ?? "";
  slot.at = store.clock.now();
  slot.by = actor.by;
  if (built) Object.assign(slot, { repo: built.repo, ref: built.ref });
  else {
    delete slot.repo;
    delete slot.ref;
  }
  await store.saveRegistry(reg);

  const inBuild = new Map<string, boolean>();
  let held = 0;
  for (const task of await store.listTasks(boardId)) {
    const heads = built
      ? (task.doneEvidence?.repos.filter((r) => r.name === built.repo).map((r) => r.head) ?? [])
      : [];
    let holds = heads.length > 0;
    for (const head of heads) {
      if (built && !inBuild.has(head))
        inBuild.set(
          head,
          (await git?.contains?.(built.dir, head, built.ref).catch(() => null)) === true,
        );
      holds &&= inBuild.get(head) === true;
    }
    const was = task.inSlots?.includes(id) ?? false;
    const lands = holds && !task.landedIn;
    if (holds) held++;
    if (holds === was && !lands) continue;
    const rest = (task.inSlots ?? []).filter((x) => x !== id);
    if (holds) rest.push(id);
    if (rest.length) task.inSlots = rest;
    else delete task.inSlots;
    if (lands) task.landedIn = version;
    // Not saveTask: a new build is not work on the task, and must not reorder the board.
    await store.writeJson(`${store.taskDir(boardId, task.id)}/task.json`, task);
  }
  if (!version) return { message: `Slot "${slot.name}" is empty.` };
  return {
    message: built
      ? `Slot "${slot.name}" holds ${version} @ ${built.ref} (${built.repo}): ${held} finished task(s) are in it.`
      : `Slot "${slot.name}" holds ${version}. No commit is recorded for it, so the board cannot say which tasks it holds.`,
  };
}

/** Applies one change to the board's settings in `boards.json`. `git` resolves a slot's commit. */
export async function editBoard(
  store: BoardStore,
  boardId: string,
  edit: BoardSettingsEdit,
  git?: BoardGit,
): Promise<EditResult> {
  if (edit.op === "setSlot") return setSlot(store, boardId, edit, { by: "t3-app" }, git);
  const reg = await store.loadRegistry();
  const board = reg.boards.find((b) => b.id === boardId);
  if (!board) throw new BoardEditError("No such board.");
  switch (edit.op) {
    case "rename": {
      const name = edit.name.trim();
      if (!name) throw new BoardEditError("The board needs a name.");
      if (reg.boards.some((b) => b.id !== boardId && b.name.toLowerCase() === name.toLowerCase()))
        throw new BoardEditError(`A board named ${name} already exists.`);
      board.name = name;
      break;
    }
    case "addRoot": {
      board.roots.push(await workspaceRoot(store, reg.boards, edit.path, edit.label, boardId));
      break;
    }
    case "removeRoot": {
      if (board.roots.length <= 1)
        throw new BoardEditError("A board keeps at least one workspace.");
      const before = board.roots.length;
      board.roots = board.roots.filter((r) => !sameRoot(r.path, edit.path));
      if (board.roots.length === before) throw new BoardEditError("No such workspace.");
      break;
    }
    case "labelRoot": {
      const root = board.roots.find((r) => sameRoot(r.path, edit.path));
      if (!root) throw new BoardEditError("No such workspace.");
      if (!edit.label.trim()) throw new BoardEditError("The workspace needs a label.");
      root.label = edit.label.trim();
      break;
    }
    case "saveServices":
      board.services = edit.services
        .map((x) => ({
          id: slug(x.id || x.name),
          name: x.name.trim(),
          match: x.match
            .map((m) =>
              m
                .trim()
                .replace(/\\/g, "/")
                .replace(/^\/+|\/+$/g, ""),
            )
            .filter(Boolean),
        }))
        .filter((x) => x.name);
      break;
    case "saveRules":
      board.rules = edit.rules;
      break;
    case "setBoardMode":
      board.boardMode = edit.on;
      break;
    case "setMerge":
      if (edit.merge === null) delete board.merge;
      else {
        const merge = cleanMerge(edit.merge);
        if (typeof merge === "string") throw new BoardEditError(merge);
        board.merge = merge;
      }
      break;
    case "removeSlot": {
      const rest = (board.slots ?? []).filter((x) => x.id !== edit.id);
      if (rest.length === (board.slots ?? []).length) throw new BoardEditError("No such slot.");
      if (rest.length) board.slots = rest;
      else delete board.slots;
      break;
    }
    case "saveRegisters":
      board.registers = edit.registers
        .map((x) => ({ id: slug(x.id || x.topic), topic: x.topic.trim(), url: x.url.trim() }))
        .filter((x) => x.topic);
      break;
  }
  await store.saveRegistry(reg);
  return { message: "Saved." };
}
