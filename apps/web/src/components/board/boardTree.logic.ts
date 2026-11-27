import type { BoardTask } from "@t3tools/contracts";

import {
  type BoardDot,
  type BoardFilter,
  type BoardIndex,
  dotOf,
  flagsOf,
  subtreeOf,
  treeRoots,
} from "./board.logic";

/** Project Board fork: the Tree view's deck: what shows, in which order, and what is starred. */
export const TREE_ORDERS = ["last", "done", "blocked", "name", "completion", "deps"] as const;
export type TreeOrder = (typeof TREE_ORDERS)[number];

export interface TreeOptions {
  readonly order: TreeOrder;
  readonly reversed: boolean;
  readonly showDone: boolean;
  readonly starredOnly: boolean;
  /** Matched against titles, any case. */
  readonly query: string;
}

export interface TreeModule {
  readonly task: BoardTask;
  readonly tasks: ReadonlyArray<BoardTask>;
  /** A filter matched a task inside, so the card shows open whatever the person left it as. */
  readonly forcedOpen: boolean;
}

export interface TreeColumn {
  readonly root: BoardTask;
  readonly modules: ReadonlyArray<TreeModule>;
  /** Done modules and tasks left out because "Show done" is off. */
  readonly hiddenDone: number;
}

/** How far along an item is, 0 to 1: its tasks when it has any, else its own plan. */
function completionOf(index: BoardIndex, task: BoardTask): number {
  if (task.status === "done") return 1;
  const kids = index.kidsOf(task.id);
  if (kids.length > 0) return kids.filter((kid) => kid.status === "done").length / kids.length;
  return task.steps.total > 0 ? task.steps.done / task.steps.total : 0;
}

const starBelow = (index: BoardIndex, task: BoardTask) =>
  subtreeOf(index, task).some((other) => other !== task && other.starredAt !== null);

/** Blockers before what they block, among the listed tasks; the rest keep their order. */
function byDependencies(list: ReadonlyArray<BoardTask>): ReadonlyArray<BoardTask> {
  const listed = new Map(list.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const out: Array<BoardTask> = [];
  const visit = (task: BoardTask) => {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    for (const link of task.links) {
      const blocker = link.type === "blocked_by" ? listed.get(link.to) : undefined;
      if (blocker !== undefined) visit(blocker);
    }
    out.push(task);
  };
  list.forEach(visit);
  return out;
}

/** Starred first, then what holds a star below, then the rest; within each, the chosen order. */
export function orderTasks(
  index: BoardIndex,
  list: ReadonlyArray<BoardTask>,
  options: { readonly order: TreeOrder | "kept"; readonly reversed: boolean },
): ReadonlyArray<BoardTask> {
  const rank = (task: BoardTask): number => {
    switch (options.order) {
      case "last":
        return -task.lastActionAt;
      case "done":
        return task.doneAt === null ? 1 : -task.doneAt;
      case "completion":
        return -completionOf(index, task);
      case "blocked": {
        const flags = flagsOf(index, task);
        return flags.blockedBy.length > 0 ? 0 : flags.blockedBelow > 0 ? 1 : 2;
      }
      default:
        return 0;
    }
  };
  const keyed = (tasks: ReadonlyArray<BoardTask>, key: (task: BoardTask) => number) =>
    tasks
      .map((task) => ({ task, key: key(task) }))
      .toSorted((a, b) => a.key - b.key)
      .map(({ task }) => task);
  const ordered =
    options.order === "deps"
      ? byDependencies(list)
      : options.order === "name"
        ? list.toSorted((a, b) => a.title.localeCompare(b.title))
        : keyed(list, rank);
  return keyed(options.reversed ? ordered.toReversed() : ordered, (task) =>
    task.starredAt !== null ? 0 : starBelow(index, task) ? 1 : 2,
  );
}

/** The Tree view's columns: one per master task, its modules as a deck, their tasks inside. */
export function treeColumns(
  index: BoardIndex,
  filter: BoardFilter,
  options: TreeOptions,
): ReadonlyArray<TreeColumn> {
  const query = options.query.trim().toLowerCase();
  const filtering = query !== "" || options.starredOnly;
  // A starred item stays in view when it is done: the star is the person saying "keep this here".
  const visible = (task: BoardTask) =>
    options.showDone || task.status !== "done" || task.starredAt !== null;
  const hit = (task: BoardTask) =>
    (query === "" || task.title.toLowerCase().includes(query)) &&
    (!options.starredOnly || task.starredAt !== null);
  // Columns keep the board's order (most recently changed first) behind the starred ones.
  const roots = orderTasks(index, treeRoots(index, filter), { order: "kept", reversed: false });
  return roots.flatMap((root) => {
    const rootHit = hit(root);
    const modules = orderTasks(index, index.kidsOf(root.id).filter(visible), options).flatMap(
      (task): ReadonlyArray<TreeModule> => {
        const tasks = orderTasks(index, index.kidsOf(task.id).filter(visible), options);
        const matching = filtering ? tasks.filter(hit) : [];
        if (filtering && !rootHit && !hit(task) && matching.length === 0) return [];
        return [
          {
            task,
            tasks: filtering && !hit(task) && matching.length > 0 ? matching : tasks,
            forcedOpen: matching.length > 0,
          },
        ];
      },
    );
    if (filtering && !rootHit && modules.length === 0) return [];
    const hiddenDone = subtreeOf(index, root).filter(
      (task) => task !== root && !visible(task),
    ).length;
    return [{ root, modules, hiddenDone }];
  });
}

export type TreeStamp = "done" | "blocked" | "needs" | "stopped" | "working" | "paused";

/** The one word a shut card says about its item, most pressing first; null when nothing stands out. */
export function stampOf(index: BoardIndex, task: BoardTask): TreeStamp | null {
  if (task.status === "done") return "done";
  if (flagsOf(index, task).blockedBy.length > 0) return "blocked";
  const dot: BoardDot = dotOf(index, task);
  if (dot === "needs" || dot === "stopped" || dot === "working") return dot;
  return task.status === "paused" ? "paused" : null;
}

/** Every starred item for the daily review: finished ones first, as suggestions to unstar. */
export function starredForReview(
  index: BoardIndex,
): ReadonlyArray<{ readonly task: BoardTask; readonly suggested: boolean }> {
  const starred = index.tasks.filter((task) => task.starredAt !== null);
  const done = starred
    .filter((task) => task.status === "done")
    .toSorted((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const open = starred
    .filter((task) => task.status !== "done")
    .toSorted((a, b) => (b.starredAt ?? 0) - (a.starredAt ?? 0));
  return [
    ...done.map((task) => ({ task, suggested: true })),
    ...open.map((task) => ({ task, suggested: false })),
  ];
}
