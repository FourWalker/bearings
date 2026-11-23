/**
 * Goals: one thread (the executor) finishing several tasks in a row. A Goal points at tasks and
 * never owns them: progress is read from the tasks, so work done on a task outside the Goal is
 * already where the Goal looks. The Goal keeps only the grouping, the order and its decisions.
 *
 * @module board-core/goal
 */
import type { BoardStore } from "./store.ts";
import { safeFileName } from "./text.ts";
import type { Task, TaskStatus } from "./types.ts";

export interface GoalGroup {
  id: string;
  title: string;
  taskIds: string[];
  /** Groups whose tasks must be finished first. */
  dependsOn: string[];
  /** Handed to a child thread: the executor leaves its tasks alone until that thread reports. */
  delegated?: boolean | undefined;
  /** The child thread working the group. */
  worker?: string | undefined;
  /** What the last worker reported, in its words. Progress is still read from the tasks. */
  report?: string | undefined;
}

export interface GoalDecision {
  id: string;
  title: string;
  /** How it was settled; "" while it is an open question for the person. */
  settled: string;
  /** A row the model settled in Auto mode is never a person's verdict. */
  by: "model" | "person";
  taskIds: string[];
  at: number;
}

export interface Goal {
  id: string;
  title: string;
  scope: string[];
  groups: GoalGroup[];
  decisions: GoalDecision[];
  /** auto: the executor settles decisions itself and records how; ask: it queues them. */
  mode: "auto" | "ask";
  status: "running" | "paused" | "done";
  pausedReason?: string | undefined;
  /** The thread running it now; null while paused or done. */
  executor: string | null;
  /** Every thread that has run it: their work on its tasks is not drift. */
  executors: string[];
  /** Modules the Goal claimed for its workspace: released when it pauses. */
  claimed?: string[] | undefined;
  /** Each task as the Goal last saw it. */
  baseline: Record<string, { status: TaskStatus; at: number }>;
  createdAt: number;
  updatedAt: number;
}

const goalPath = (store: BoardStore, boardId: string, id: string) =>
  `${store.projectDir(boardId)}/goals/${safeFileName(id)}.json`;

export const loadGoal = (store: BoardStore, boardId: string, id: string): Promise<Goal | null> =>
  store.readJson<Goal | null>(goalPath(store, boardId, id), null);

export async function saveGoal(store: BoardStore, boardId: string, goal: Goal): Promise<void> {
  goal.updatedAt = store.clock.now();
  await store.writeJson(goalPath(store, boardId, goal.id), goal);
}

export async function listGoals(store: BoardStore, boardId: string): Promise<Goal[]> {
  try {
    const files = await store.io.list(`${store.projectDir(boardId)}/goals`);
    const goals = await Promise.all(
      files
        .filter((file) => file.kind === "file" && file.name.endsWith(".json"))
        .map((file) =>
          store.readJson<Goal | null>(`${store.projectDir(boardId)}/goals/${file.name}`, null),
        ),
    );
    return goals.filter((goal) => goal !== null);
  } catch {
    return [];
  }
}

/** The tasks a scope stands for: each id's open tasks that have no subtasks of their own. */
export function scopeTasks(all: ReadonlyArray<Task>, scope: ReadonlyArray<string>): Task[] {
  const kids = (id: string) => all.filter((task) => task.parentId === id);
  const leaves = (task: Task): Task[] => {
    const children = kids(task.id);
    return children.length === 0 ? [task] : children.flatMap(leaves);
  };
  const seen = new Set<string>();
  return scope
    .flatMap((id) => all.filter((task) => task.id === id))
    .flatMap(leaves)
    .filter((task) => task.status !== "done" && !seen.has(task.id) && seen.add(task.id));
}

/** One group per parent, so tasks sharing a module run together; blocked_by links order them. */
export function planGroups(all: ReadonlyArray<Task>, tasks: ReadonlyArray<Task>): GoalGroup[] {
  const byParent = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.parentId ?? task.id;
    byParent.set(key, [...(byParent.get(key) ?? []), task]);
  }
  const groups = [...byParent.entries()].map(([parentId, members], index) => ({
    id: String.fromCharCode(65 + (index % 26)) + (index >= 26 ? String(index) : ""),
    title: all.find((task) => task.id === parentId)?.title ?? members[0]?.title ?? parentId,
    parentId,
    taskIds: members.map((task) => task.id),
    members,
  }));
  return groups.map(({ id, title, taskIds, members }) => ({
    id,
    title,
    taskIds,
    dependsOn: groups
      .filter(
        (other) =>
          other.id !== id &&
          members.some((task) =>
            (task.links ?? []).some(
              (link) =>
                link.type === "blocked_by" &&
                (other.taskIds.includes(link.to) || other.parentId === link.to),
            ),
          ),
      )
      .map((other) => other.id),
  }));
}

export interface GoalDrift {
  /** What changed outside the Goal since it last looked, one line each. */
  readonly notes: string[];
  readonly removed: string[];
  readonly doneElsewhere: string[];
}

/** What happened to the Goal's tasks outside it: pure, from the baseline and the tasks now. */
export function goalDrift(goal: Goal, all: ReadonlyArray<Task>): GoalDrift {
  const byId = new Map(all.map((task) => [task.id, task]));
  const notes: string[] = [];
  const removed: string[] = [];
  const doneElsewhere: string[] = [];
  const mine = new Set(goal.executors);
  const inGoal = new Set(goal.groups.flatMap((group) => group.taskIds));
  for (const id of inGoal) {
    const task = byId.get(id);
    const was = goal.baseline[id];
    if (!task) {
      removed.push(id);
      notes.push(`- ${id}: removed from the board; dropped from the Goal.`);
      continue;
    }
    const elsewhere =
      !!task.lastAction &&
      !mine.has(task.lastAction.sessionId) &&
      task.lastAction.at > (was?.at ?? 0);
    if (task.status === "done" && was?.status !== "done" && elsewhere) {
      doneElsewhere.push(id);
      continue;
    }
    if (elsewhere)
      notes.push(
        `- ${id} "${task.title}": worked on in another thread since (${task.lastAction?.text ?? ""}). Re-read it with board_read before working on it.`,
      );
  }
  const fresh = scopeTasks(all, goal.scope).filter(
    (task) => !inGoal.has(task.id) && task.createdAt > goal.createdAt,
  );
  if (fresh.length > 0)
    notes.push(
      `- New in scope: ${fresh.map((task) => `${task.id} "${task.title}"`).join(", ")}. Add them with board_goal {action: "include"} if they belong.`,
    );
  return { notes, removed, doneElsewhere };
}

const done = (group: GoalGroup, byId: ReadonlyMap<string, Task>) =>
  group.taskIds.every((id) => byId.get(id)?.status === "done");

/** The next task to work: the first open one in the first group whose dependencies are finished. */
export function nextGoalTask(goal: Goal, all: ReadonlyArray<Task>): Task | null {
  const byId = new Map(all.map((task) => [task.id, task]));
  const finished = new Set(goal.groups.filter((group) => done(group, byId)).map((g) => g.id));
  for (const group of goal.groups) {
    if (group.delegated) continue;
    if (finished.has(group.id) || !group.dependsOn.every((id) => finished.has(id))) continue;
    for (const id of group.taskIds) {
      const task = byId.get(id);
      if (task && task.status !== "done") return task;
    }
  }
  return null;
}

/** A worker's next task: the first open one in the group it was given. */
export function nextGroupTask(group: GoalGroup, all: ReadonlyArray<Task>): Task | null {
  const byId = new Map(all.map((task) => [task.id, task]));
  return (
    group.taskIds.map((id) => byId.get(id)).find((task) => task && task.status !== "done") ?? null
  );
}

/** The Goal as its executor reads it: groups, the current group's tasks, decisions, what's next. */
export function goalLedger(goal: Goal, all: ReadonlyArray<Task>): string {
  const byId = new Map(all.map((task) => [task.id, task]));
  const next = nextGoalTask(goal, all);
  const groups = goal.groups.map((group) => {
    const tasks = group.taskIds.map((id) => byId.get(id)).filter((task) => task !== undefined);
    const count = tasks.filter((task) => task.status === "done").length;
    const head = `- ${group.id}. ${group.title} [${count}/${tasks.length} done]${group.dependsOn.length ? ` · after ${group.dependsOn.join(", ")}` : ""}${group.delegated ? " · with a child thread" : ""}${
      group.report
        ? `
  Child thread reported: ${group.report}`
        : ""
    }`;
    // Only the group in hand is listed task by task.
    if (!next || !group.taskIds.includes(next.id)) return head;
    return `${head}\n${tasks.map((task) => `  - [${task.status === "done" ? "x" : " "}] ${task.id} "${task.title}"`).join("\n")}`;
  });
  const settled = goal.decisions.filter((decision) => decision.settled);
  const open = goal.decisions.filter((decision) => !decision.settled);
  return [
    `### Goal: ${goal.title} (id ${goal.id}, ${goal.status}${goal.pausedReason ? `: ${goal.pausedReason}` : ""}, ${goal.mode === "auto" ? "Auto mode" : "asks before deciding"})`,
    `Groups:\n${groups.join("\n")}`,
    settled.length > 0 &&
      `Decisions:\n${settled
        .slice(-10)
        .map((d) => `- ${d.id} ${d.title} → ${d.settled} (settled by the ${d.by})`)
        .join("\n")}`,
    open.length > 0 &&
      `Open questions for the person:\n${open.map((d) => `- ${d.id} ${d.title}${d.taskIds.length ? ` (blocks ${d.taskIds.join(", ")})` : ""}`).join("\n")}`,
    next
      ? `Next task: ${next.id} "${next.title}". Take it with board_goal {action: "task", taskId: "${next.id}"}.`
      : goal.groups.every((group) => done(group, byId))
        ? 'Every task is done. Run the full checks, call board_goal {action: "finish"}, then report to the person.'
        : goal.groups.some((group) => group.delegated)
          ? 'No task is ready for this thread: child threads hold the open groups. End your turn; you are woken when one finishes, then read board_goal {action: "status"}.'
          : "No task is ready: the remaining groups wait on others. Pause with the reason.",
  ]
    .filter(Boolean)
    .join("\n");
}
