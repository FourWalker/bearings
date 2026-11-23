import type {
  BoardGoal,
  BoardIntent,
  BoardChat,
  BoardTask,
  BoardTaskDetail,
  BoardView,
  ProjectId,
} from "@t3tools/contracts";

/** The board app's views: a column per master task, one level at a time, or a column per service. */
export type BoardViewMode = "tree" | "1" | "2" | "3" | "svc" | "register";
export type BoardFilter = "active" | "paused" | "done" | "all";
export type BoardTaskTab = "overview" | "threads" | "plan" | "handoff" | "subtasks" | "decisions";
export type RecommendationFilter = "open" | "decided" | "all";

export interface BoardSearch {
  readonly env?: string | undefined;
  readonly board?: string | undefined;
  readonly view?: BoardViewMode | undefined;
  readonly filter?: BoardFilter | undefined;
  /** The master task whose page is open, in place of the board. */
  readonly task?: string | undefined;
  /** The module or task open in a modal, over the board or a master task's page. */
  readonly open?: string | undefined;
  readonly tab?: BoardTaskTab | undefined;
  readonly picker?: boolean | undefined;
  readonly recommendationFilter?: RecommendationFilter | undefined;
}

const VIEWS: ReadonlyArray<string> = ["tree", "1", "2", "3", "svc", "register"];
const FILTERS: ReadonlyArray<string> = ["active", "paused", "done", "all"];
const TABS: ReadonlyArray<string> = [
  "overview",
  "threads",
  "plan",
  "handoff",
  "subtasks",
  "decisions",
];

export function boardSearchFromUrl(search: Record<string, unknown>): BoardSearch {
  const text = (value: unknown) =>
    typeof value === "string" && value !== ""
      ? value
      : typeof value === "number"
        ? String(value)
        : undefined;
  const view = text(search.view);
  const filter = text(search.filter);
  const tab = text(search.tab);
  const recommendationFilter = text(search.recommendationFilter);
  return {
    env: text(search.env),
    board: text(search.board),
    view: view !== undefined && VIEWS.includes(view) ? (view as BoardViewMode) : undefined,
    filter: filter !== undefined && FILTERS.includes(filter) ? (filter as BoardFilter) : undefined,
    task: text(search.task),
    open: text(search.open),
    tab: tab !== undefined && TABS.includes(tab) ? (tab as BoardTaskTab) : undefined,
    picker: search.picker === true ? true : undefined,
    recommendationFilter:
      recommendationFilter === "open" ||
      recommendationFilter === "decided" ||
      recommendationFilter === "all"
        ? recommendationFilter
        : undefined,
  };
}

export function recommendationsOf(index: BoardIndex) {
  const numberOf = (r: string) => Number(r.replace(/\D/g, "")) || 0;
  return index.tasks
    .flatMap((owner) =>
      owner.decisions.flatMap((decision) =>
        decision.r
          ? [
              {
                decision,
                r: decision.r,
                task:
                  (decision.raisedFrom ? index.byId.get(decision.raisedFrom.id) : undefined) ??
                  owner,
                owner,
              },
            ]
          : [],
      ),
    )
    .toSorted((a, b) => numberOf(a.r) - numberOf(b.r));
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

export function subtreeOf(index: BoardIndex, task: BoardTask): ReadonlyArray<BoardTask> {
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

export function handoffBrief(
  { index, task }: { readonly index: BoardIndex; readonly task: BoardTask },
  detail: BoardTaskDetail,
): string {
  const blockers = blockersOf(index, task);
  const decisions = detail.decisions.filter((decision) => decision.status === "decided");
  const latest = detail.stepNotes[0];
  return [
    `# ${[...ancestorsOf(index, task), task].map((node) => node.title).join(" / ")}`,
    `Task: ${task.id} (${task.status})`,
    task.description,
    task.next ? `## Next action\n${task.next.id} ${task.next.text}` : "",
    blockers.length
      ? `## Blocked by\n${blockers.map((blocker) => `- ${blocker.title} (${blocker.id})`).join("\n")}`
      : "",
    decisions.length
      ? `## Binding decisions\n${decisions.map((decision) => `- ${decision.title}: ${decision.verdict}`).join("\n")}`
      : "",
    detail.handoff ? `## Living handoff\n${detail.handoff}` : "",
    detail.handoffCheckpoint ? `T3 checkpoint: ${detail.handoffCheckpoint}` : "",
    detail.checks?.length
      ? `## Recorded checks\n${detail.checks
          .map((check) => `- ${check.taskTitle}: ${check.command} exited ${check.exitCode}`)
          .join("\n")}`
      : "",
    latest
      ? `## Latest step note (${latest.step})\n${latest.text.replace(/<!--[\s\S]*?-->/g, "").trim()}`
      : "",
    detail.repoState.length
      ? `## Recorded repository state\n${detail.repoState
          .map(
            (repo) =>
              `- ${repo.name}: ${repo.branch} at ${repo.head}, ${repo.dirty} uncommitted changes`,
          )
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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
export function openFixesOf(index: BoardIndex, task: BoardTask): ReadonlyArray<BoardTask> {
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

/** Where a `board.open` intent sends the window: only what it names changes from the defaults. */
export function boardSearchOfIntent(
  environmentId: string,
  command: Extract<BoardIntent["command"], { readonly type: "board.open" }>,
): BoardSearch {
  return {
    env: environmentId,
    board: command.boardId,
    ...(command.taskId === undefined ? {} : { open: command.taskId }),
    ...(command.view === undefined ? {} : { view: command.view }),
    ...(command.filter === undefined ? {} : { filter: command.filter }),
  };
}

export interface BoardGoalProgress {
  readonly goal: BoardGoal;
  readonly done: number;
  readonly total: number;
  /** Its unfinished tasks, in the Goal's order. */
  readonly open: ReadonlyArray<BoardTask>;
}

/** Each open Goal with its progress, read from its tasks: a Goal keeps no status copy. */
export function goalsOf(
  index: BoardIndex,
  goals: ReadonlyArray<BoardGoal>,
): ReadonlyArray<BoardGoalProgress> {
  return goals.map((goal) => {
    const tasks = goal.taskIds.flatMap((id) => index.byId.get(id) ?? []);
    const open = tasks.filter((task) => task.status !== "done");
    return { goal, done: tasks.length - open.length, total: tasks.length, open };
  });
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
  readonly override?: "once" | "takeover";
}

export function boardPickupTargets(
  index: BoardIndex,
  workspaces: BoardView["workspaces"],
  task: BoardTask,
): ReadonlyArray<BoardContinueTarget> {
  const owner = ownerHolderOf(index, task)?.owner;
  return workspaces.flatMap((workspace): BoardContinueTarget[] => {
    if (workspace.projectId === null) return [];
    const target = { label: workspace.label, projectId: workspace.projectId };
    if (owner == null || workspace.root === owner.root || owner.state === "soft") return [target];
    return [
      { ...target, override: "once" },
      { ...target, override: "takeover" },
    ];
  });
}

/** Open decisions a task's views count: its own, those raised here and filed higher up, and old
 * decision items. */
export function openDecisionCount(index: BoardIndex, task: BoardTask): number {
  const raisedHere = ancestorsOf(index, task).flatMap((parent) =>
    parent.decisions.filter((d) => d.status === "open" && d.raisedFrom?.id === task.id),
  );
  return (
    task.decisions.filter((d) => d.status === "open").length +
    raisedHere.length +
    task.items.filter((item) => item.kind === "decision" && !item.done).length
  );
}

/** How a link reads from the side of the task's tree, as the board app groups them. */
export type BoardLinkGroup =
  | "blockingUs"
  | "weBlock"
  | "fixedBy"
  | "fixes"
  | "cameFrom"
  | "spunOff"
  | "replacedBy"
  | "replaces"
  | "related";

export const LINK_GROUP_ORDER: ReadonlyArray<BoardLinkGroup> = [
  "blockingUs",
  "weBlock",
  "fixedBy",
  "fixes",
  "cameFrom",
  "spunOff",
  "replacedBy",
  "replaces",
  "related",
];

export interface BoardExternalLink {
  readonly group: BoardLinkGroup;
  /** The task outside the tree, or null when it's gone. */
  readonly other: BoardTask | null;
  readonly otherId: string;
  /** The task inside the tree the link is on. */
  readonly ours: BoardTask | null;
  readonly note: string;
  /** Where the link is stored, to remove it: on `owner`, pointing at `to` with `type`. */
  readonly owner: string;
  readonly to: string;
  readonly type: BoardTask["links"][number]["type"];
}

const GROUPS: Record<string, BoardLinkGroup> = {
  "out:fixes": "fixes",
  "in:fixes": "fixedBy",
  "out:blocked_by": "blockingUs",
  "in:blocked_by": "weBlock",
  "out:found_during": "cameFrom",
  "in:found_during": "spunOff",
  "out:superseded_by": "replacedBy",
  "in:superseded_by": "replaces",
  "out:related": "related",
  "in:related": "related",
};

/** Links between the task's tree and tasks outside it, from the tree's point of view. */
export function externalLinksOf(
  index: BoardIndex,
  task: BoardTask,
): ReadonlyArray<BoardExternalLink> {
  const inside = new Set(subtreeOf(index, task).map((t) => t.id));
  const out: Array<BoardExternalLink> = [];
  for (const from of index.tasks)
    for (const link of from.links) {
      const fromIn = inside.has(from.id);
      if (fromIn === inside.has(link.to)) continue;
      const group = GROUPS[`${fromIn ? "out" : "in"}:${link.type}`];
      if (group === undefined) continue;
      out.push({
        group,
        other: fromIn ? (index.byId.get(link.to) ?? null) : from,
        otherId: fromIn ? link.to : from.id,
        ours: fromIn ? from : (index.byId.get(link.to) ?? null),
        note: link.note,
        owner: from.id,
        to: link.to,
        type: link.type,
      });
    }
  return out.toSorted(
    (a, b) => LINK_GROUP_ORDER.indexOf(a.group) - LINK_GROUP_ORDER.indexOf(b.group),
  );
}

const LIVE_ORDER = { working: 0, idle: 1, offline: 2, ended: 3 } as const;

/** A task's chats (on a master task, its tree's), working first, then most recent. */
export function chatsForView(
  index: BoardIndex,
  task: BoardTask,
  rollUp: boolean,
): ReadonlyArray<{ readonly chat: BoardChat; readonly task: BoardTask }> {
  const owners = rollUp ? subtreeOf(index, task) : [task];
  return owners
    .flatMap((owner) => owner.chats.map((chat) => ({ chat, task: owner })))
    .toSorted(
      (a, b) =>
        LIVE_ORDER[a.chat.live] - LIVE_ORDER[b.chat.live] || b.chat.updatedAt - a.chat.updatedAt,
    );
}
