import type { BoardChat, BoardTask, BoardView, ProjectId } from "@t3tools/contracts";

/** The board app's views: a column per master task, one level at a time, or a column per service. */
export type BoardViewMode = "tree" | "1" | "2" | "3" | "svc";
export type BoardFilter = "active" | "paused" | "done" | "all";

export interface BoardSearch {
  readonly env?: string | undefined;
  readonly board?: string | undefined;
  readonly view?: BoardViewMode | undefined;
  readonly filter?: BoardFilter | undefined;
}

const VIEWS: ReadonlyArray<string> = ["tree", "1", "2", "3", "svc"];
const FILTERS: ReadonlyArray<string> = ["active", "paused", "done", "all"];

export function boardSearchFromUrl(search: Record<string, unknown>): BoardSearch {
  const text = (value: unknown) =>
    typeof value === "string" && value !== ""
      ? value
      : typeof value === "number"
        ? String(value)
        : undefined;
  const view = text(search.view);
  const filter = text(search.filter);
  return {
    env: text(search.env),
    board: text(search.board),
    view: view !== undefined && VIEWS.includes(view) ? (view as BoardViewMode) : undefined,
    filter: filter !== undefined && FILTERS.includes(filter) ? (filter as BoardFilter) : undefined,
  };
}

/** The board's tasks, with the lookups every view needs. Built once per board read. */
export interface BoardIndex {
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly byId: ReadonlyMap<string, BoardTask>;
  /** Children oldest first, as the board app lists them. */
  readonly kidsOf: (id: string) => ReadonlyArray<BoardTask>;
}

export function indexBoard(tasks: ReadonlyArray<BoardTask>): BoardIndex {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const kids = new Map<string, Array<BoardTask>>();
  for (const task of tasks) {
    if (task.parentId === null) continue;
    const list = kids.get(task.parentId) ?? [];
    list.push(task);
    kids.set(task.parentId, list);
  }
  for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return { tasks, byId, kidsOf: (id) => kids.get(id) ?? [] };
}

function subtreeOf(index: BoardIndex, task: BoardTask): ReadonlyArray<BoardTask> {
  return [task, ...index.kidsOf(task.id).flatMap((kid) => subtreeOf(index, kid))];
}

/** Root first; stops at a missing parent or a loop. */
export function ancestorsOf(index: BoardIndex, task: BoardTask): ReadonlyArray<BoardTask> {
  const out: Array<BoardTask> = [];
  const seen = new Set([task.id]);
  let parent = task.parentId === null ? undefined : index.byId.get(task.parentId);
  while (parent !== undefined && !seen.has(parent.id)) {
    out.unshift(parent);
    seen.add(parent.id);
    parent = parent.parentId === null ? undefined : index.byId.get(parent.parentId);
  }
  return out;
}

export const tagsOf = (task: BoardTask): ReadonlyArray<string> => [
  ...new Set([...(task.mainService === null ? [] : [task.mainService]), ...task.services]),
];

function blockersOf(index: BoardIndex, task: BoardTask): ReadonlyArray<BoardTask> {
  return task.links.flatMap((link) => {
    const other = link.type === "blocked_by" ? index.byId.get(link.to) : undefined;
    return other !== undefined && other.status !== "done" ? [other] : [];
  });
}

/** Unfinished fix tasks pointing at this task with a `fixes` link. */
function openFixesOf(index: BoardIndex, task: BoardTask): ReadonlyArray<BoardTask> {
  return index.tasks.filter(
    (other) =>
      other.status !== "done" &&
      other.links.some((link) => link.type === "fixes" && link.to === task.id),
  );
}

export interface BoardTaskFlags {
  /** This task's own unfinished blockers. */
  readonly blockedBy: ReadonlyArray<BoardTask>;
  /** Blocked tasks below it, when it isn't blocked itself. */
  readonly blockedBelow: number;
  /** For a fix task, the task it fixes. */
  readonly fixes: BoardTask | null;
  readonly openFixes: number;
  readonly openFixesBelow: number;
}

export function flagsOf(index: BoardIndex, task: BoardTask): BoardTaskFlags {
  const below = subtreeOf(index, task).slice(1);
  const fixesLink = task.bug ? task.links.find((link) => link.type === "fixes") : undefined;
  return {
    blockedBy: blockersOf(index, task),
    blockedBelow: below.filter((other) => blockersOf(index, other).length > 0).length,
    fixes: fixesLink === undefined ? null : (index.byId.get(fixesLink.to) ?? null),
    openFixes: openFixesOf(index, task).length,
    openFixesBelow: below.reduce((n, other) => n + openFixesOf(index, other).length, 0),
  };
}

/** A task belongs to its module's owner, else the nearest owned parent (as board-core rules). */
export function ownerHolderOf(index: BoardIndex, task: BoardTask): BoardTask | null {
  let current: BoardTask | undefined =
    task.level === 3 && task.parentId !== null ? (index.byId.get(task.parentId) ?? task) : task;
  for (let i = 0; i < 3 && current !== undefined; i++) {
    if (current.owner !== null) return current;
    current = current.parentId === null ? undefined : index.byId.get(current.parentId);
  }
  return null;
}

/** Items directly under a service backlog read as backlog items rather than modules. */
export type BoardLevelKind = "master" | "backlog" | "module" | "backlogItem" | "task";

export function levelKindOf(index: BoardIndex, task: BoardTask): BoardLevelKind {
  if (task.level === 1) return task.kind === "backlog" ? "backlog" : "master";
  if (task.level === 3) return "task";
  return ancestorsOf(index, task)[0]?.kind === "backlog" ? "backlogItem" : "module";
}

function rolledChats(index: BoardIndex, task: BoardTask): ReadonlyArray<BoardChat> {
  return subtreeOf(index, task).flatMap((other) => other.chats);
}

export type BoardDot = "working" | "idle" | "offline";

export function dotOf(index: BoardIndex, task: BoardTask): BoardDot {
  const chats = rolledChats(index, task);
  return chats.some((chat) => chat.live === "working")
    ? "working"
    : chats.some((chat) => chat.live === "idle")
      ? "idle"
      : "offline";
}

/** The status strip at a note's foot, from every chat in its subtree. */
export type BoardChatStatus =
  | {
      readonly kind: "working";
      readonly workspaces: ReadonlyArray<string>;
      readonly since: number;
      readonly inSubtasks: number;
    }
  | { readonly kind: "idle"; readonly open: number }
  | { readonly kind: "offline" }
  | { readonly kind: "none" };

export function chatStatusOf(index: BoardIndex, task: BoardTask, now: number): BoardChatStatus {
  const chats = rolledChats(index, task);
  const working = chats.filter((chat) => chat.live === "working");
  if (working.length > 0) {
    const own = new Set(task.chats.map((chat) => chat.sessionId));
    return {
      kind: "working",
      workspaces: [...new Set(working.map((chat) => chat.workspaceLabel))],
      since: Math.min(...working.map((chat) => chat.turnStartedAt || now)),
      inSubtasks: working.filter((chat) => !own.has(chat.sessionId)).length,
    };
  }
  const idle = chats.filter((chat) => chat.live === "idle").length;
  if (idle > 0) return { kind: "idle", open: idle };
  return chats.length > 0 ? { kind: "offline" } : { kind: "none" };
}

export function statusMatches(filter: BoardFilter, task: BoardTask): boolean {
  return filter === "all" || task.status === filter;
}

/** Tree view: one column per master task (and any task whose parent is gone). */
export function treeRoots(index: BoardIndex, filter: BoardFilter): ReadonlyArray<BoardTask> {
  return index.tasks.filter(
    (task) =>
      (task.level === 1 || task.parentId === null || !index.byId.has(task.parentId)) &&
      statusMatches(filter, task),
  );
}

export interface BoardServiceColumn {
  readonly service: BoardView["services"][number] | null;
  readonly tasks: ReadonlyArray<BoardTask>;
}

/** By service: every task tagged with each service, then Level 3 tasks tagged with none. */
export function serviceColumns(
  index: BoardIndex,
  services: BoardView["services"],
  filter: BoardFilter,
): ReadonlyArray<BoardServiceColumn> {
  const shown = index.tasks.filter((task) => statusMatches(filter, task));
  const columns: Array<BoardServiceColumn> = services
    .map((service) => ({
      service,
      tasks: shown.filter((task) => tagsOf(task).includes(service.id)),
    }))
    .filter((column) => column.tasks.length > 0);
  const untagged = shown.filter((task) => task.level === 3 && tagsOf(task).length === 0);
  if (untagged.length > 0) columns.push({ service: null, tasks: untagged });
  return columns;
}

export interface BoardPanelEntry {
  readonly key: string;
  readonly text: string;
  readonly task: BoardTask;
  /** For a decision: its level and where it was raised, when that differs. */
  readonly level?: 1 | 2 | 3 | undefined;
  readonly raisedIn?: string | undefined;
}

export interface BoardPanel {
  readonly blocked: ReadonlyArray<{ readonly task: BoardTask; readonly by: string }>;
  readonly mandatory: ReadonlyArray<BoardPanelEntry>;
  readonly decisions: ReadonlyArray<BoardPanelEntry>;
  readonly todo: ReadonlyArray<BoardPanelEntry>;
  readonly unlinked: ReadonlyArray<BoardChat>;
}

/** The right panel, from every task that isn't done. Old decision items count as decisions. */
export function panelOf(index: BoardIndex, unlinked: ReadonlyArray<BoardChat>): BoardPanel {
  const active = index.tasks.filter((task) => task.status !== "done");
  const items = (kind: "mandatory" | "todo" | "decision") =>
    active.flatMap((task) =>
      task.items
        .filter((item) => item.kind === kind && !item.done)
        .map((item) => ({ key: `${task.id}:${item.id}`, text: item.text, task })),
    );
  return {
    blocked: active.flatMap((task) => {
      const by = blockersOf(index, task);
      return by.length > 0 ? [{ task, by: by.map((other) => other.title).join(", ") }] : [];
    }),
    mandatory: items("mandatory"),
    decisions: [
      ...active.flatMap((task) =>
        task.decisions
          .filter((decision) => decision.status === "open")
          .map((decision) => ({
            key: `${task.id}:${decision.id}`,
            text: decision.title,
            task,
            level: decision.level,
            raisedIn: decision.raisedFrom?.title,
          })),
      ),
      ...items("decision"),
    ],
    todo: items("todo"),
    unlinked: unlinked.filter((chat) => chat.live === "working" || chat.live === "idle"),
  };
}

/** Workspace copies with more than one chat working at once: they edit the same clone. */
export function collisionsOf(
  tasks: ReadonlyArray<BoardTask>,
  unlinked: ReadonlyArray<BoardChat>,
): ReadonlyArray<{ readonly workspace: string; readonly count: number }> {
  const working = new Map<string, Set<string>>();
  for (const chat of [...tasks.flatMap((task) => task.chats), ...unlinked]) {
    if (chat.live !== "working") continue;
    const ids = working.get(chat.workspaceLabel) ?? new Set();
    ids.add(chat.sessionId);
    working.set(chat.workspaceLabel, ids);
  }
  return [...working]
    .filter(([, ids]) => ids.size > 1)
    .map(([workspace, ids]) => ({ workspace, count: ids.size }));
}

export interface BoardContinueTarget {
  readonly label: string;
  readonly projectId: ProjectId;
}

/**
 * The workspace copies a new thread on the task can start in: the owning copy alone when the
 * task's module is owned (the others would be blocked), else every copy this server has a
 * project for.
 */
export function boardContinueTargets(
  workspaces: BoardView["workspaces"],
  task: Pick<BoardTask, "ownerRoot">,
): ReadonlyArray<BoardContinueTarget> {
  return workspaces.flatMap((workspace) =>
    workspace.projectId === null || (task.ownerRoot !== null && workspace.root !== task.ownerRoot)
      ? []
      : [{ label: workspace.label, projectId: workspace.projectId }],
  );
}
