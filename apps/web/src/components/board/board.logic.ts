import type {
  BoardGoal,
  BoardIntent,
  BoardChat,
  BoardDecision,
  BoardTask,
  BoardTaskDetail,
  BoardView,
  ProjectId,
} from "@t3tools/contracts";

/** The board app's views: a column per master task, one level at a time, or a column per service. */
export type BoardViewMode = "tree" | "1" | "2" | "3" | "svc" | "register" | "goals";
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
  /** The New board dialog is open. */
  readonly create?: boolean | undefined;
  readonly recommendationFilter?: RecommendationFilter | undefined;
}

const VIEWS: ReadonlyArray<string> = ["tree", "1", "2", "3", "svc", "register", "goals"];
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
    create: search.create === true ? true : undefined,
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

/**
 * What a chat on the board wants from the person. Only threads this app holds can say; a chat
 * running elsewhere is just working or idle.
 */
export type BoardChatAttention =
  | { readonly kind: "needs"; readonly why: "approval" | "question" }
  | { readonly kind: "stopped" }
  | { readonly kind: "finished"; readonly at: number };
/** By chat session id. */
export type BoardAttention = ReadonlyMap<string, BoardChatAttention>;

/** The board's tasks, with the lookups every view needs. Built once per board read. */
export interface BoardIndex {
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly byId: ReadonlyMap<string, BoardTask>;
  /** Children oldest first, as the board app lists them. */
  readonly kidsOf: (id: string) => ReadonlyArray<BoardTask>;
  readonly attention: BoardAttention;
  /** Where each open Goal stands, by Goal id. */
  readonly goalStanding: ReadonlyMap<string, BoardGoalStanding>;
}

export function indexBoard(
  tasks: ReadonlyArray<BoardTask>,
  live: {
    readonly attention?: BoardAttention;
    readonly goals?: ReadonlyArray<BoardGoal>;
  } = {},
): BoardIndex {
  const attention = live.attention ?? new Map<string, BoardChatAttention>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const kids = new Map<string, Array<BoardTask>>();
  for (const task of tasks) {
    if (task.parentId === null) continue;
    const list = kids.get(task.parentId) ?? [];
    list.push(task);
    kids.set(task.parentId, list);
  }
  for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  const goalStanding = new Map(
    (live.goals ?? []).map((goal) => [goal.id, goalStandingOf({ byId, attention }, goal)]),
  );
  return { tasks, byId, kidsOf: (id) => kids.get(id) ?? [], attention, goalStanding };
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

export type BoardDot = "needs" | "stopped" | "working" | "finished" | "idle" | "offline";

/** The chats among these that want this from the person. */
function wanting<Kind extends BoardChatAttention["kind"]>(
  index: Pick<BoardIndex, "attention">,
  chats: ReadonlyArray<BoardChat>,
  kind: Kind,
) {
  return chats.flatMap((chat) => {
    const attention = index.attention.get(chat.sessionId);
    return attention?.kind === kind
      ? [{ chat, attention: attention as Extract<BoardChatAttention, { readonly kind: Kind }> }]
      : [];
  });
}

/** A waiting answer outranks work under way, which outranks a result nobody has looked at. */
export function dotOf(index: BoardIndex, task: BoardTask): BoardDot {
  const chats = rolledChats(index, task);
  if (wanting(index, chats, "needs").length > 0) return "needs";
  if (wanting(index, chats, "stopped").length > 0) return "stopped";
  if (chats.some((chat) => chat.live === "working")) return "working";
  if (wanting(index, chats, "finished").length > 0) return "finished";
  return chats.some((chat) => chat.live === "idle") ? "idle" : "offline";
}

/** The status strip at a note's foot, from every chat in its subtree. */
export type BoardChatStatus =
  | {
      /** A turn halted on an approval or a question. */
      readonly kind: "needs";
      readonly count: number;
      readonly why: "approval" | "question" | "both";
      readonly since: number;
      readonly inSubtasks: number;
    }
  | {
      /** A turn failed; nobody has opened it since. */
      readonly kind: "stopped";
      readonly count: number;
      readonly since: number;
      readonly inSubtasks: number;
    }
  | {
      /** A turn ended by itself and nobody has looked at it. */
      readonly kind: "finished";
      readonly count: number;
      readonly at: number;
      readonly inSubtasks: number;
    }
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
  const own = new Set(task.chats.map((chat) => chat.sessionId));
  const below = (list: ReadonlyArray<{ readonly chat: BoardChat }>) =>
    list.filter(({ chat }) => !own.has(chat.sessionId)).length;
  const needs = wanting(index, chats, "needs");
  if (needs.length > 0) {
    const whys = new Set(needs.map(({ attention }) => attention.why));
    return {
      kind: "needs",
      count: needs.length,
      why: whys.size > 1 ? "both" : needs[0]!.attention.why,
      since: Math.min(...needs.map(({ chat }) => chat.updatedAt)),
      inSubtasks: below(needs),
    };
  }
  const stopped = wanting(index, chats, "stopped");
  if (stopped.length > 0)
    return {
      kind: "stopped",
      count: stopped.length,
      since: Math.max(...stopped.map(({ chat }) => chat.updatedAt)),
      inSubtasks: below(stopped),
    };
  const working = chats.filter((chat) => chat.live === "working");
  if (working.length > 0) {
    return {
      kind: "working",
      workspaces: [...new Set(working.map((chat) => chat.workspaceLabel))],
      since: Math.min(...working.map((chat) => chat.turnStartedAt || now)),
      inSubtasks: working.filter((chat) => !own.has(chat.sessionId)).length,
    };
  }
  const finished = wanting(index, chats, "finished");
  if (finished.length > 0)
    return {
      kind: "finished",
      count: finished.length,
      at: Math.max(...finished.map(({ attention }) => attention.at)),
      inSubtasks: below(finished),
    };
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

/** A chat that wants something from the person, and the task it is on (null: on no task). */
export interface BoardPanelChat {
  readonly chat: BoardChat;
  readonly task: BoardTask | null;
  readonly attention: BoardChatAttention;
}

export interface BoardPanel {
  /** Halted on an answer first, then stopped on an error. */
  readonly needsYou: ReadonlyArray<BoardPanelChat>;
  /** Newest first. */
  readonly finished: ReadonlyArray<BoardPanelChat>;
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
  const wants = [
    ...index.tasks.flatMap((task) => task.chats.map((chat) => ({ chat, task }))),
    ...unlinked.map((chat) => ({ chat, task: null })),
  ].flatMap(({ chat, task }): ReadonlyArray<BoardPanelChat> => {
    const attention = index.attention.get(chat.sessionId);
    return attention === undefined ? [] : [{ chat, task, attention }];
  });
  const at = (entry: BoardPanelChat) =>
    entry.attention.kind === "finished" ? entry.attention.at : 0;
  return {
    needsYou: [
      ...wants.filter(({ attention }) => attention.kind === "needs"),
      ...wants.filter(({ attention }) => attention.kind === "stopped"),
    ],
    finished: wants
      .filter(({ attention }) => attention.kind === "finished")
      .toSorted((a, b) => at(b) - at(a)),
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

export interface BoardAssistantBubble {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly streaming: boolean;
}

/**
 * What the floating Assistant chat shows of its thread: what the person said and what it
 * answered, oldest first. Tool calls, system notes and empty replies stay in the full thread.
 */
export function assistantBubbles(
  messages: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
  }>,
): ReadonlyArray<BoardAssistantBubble> {
  return messages.flatMap((message) =>
    (message.role === "user" || message.role === "assistant") && message.text.trim().length > 0
      ? [{ id: message.id, role: message.role, text: message.text, streaming: message.streaming }]
      : [],
  );
}

/**
 * The small chat shows one exchange: the person's last message and the latest thing said back.
 * Notes the Assistant made on the way to its answer are in the history.
 */
export function latestExchange(
  bubbles: ReadonlyArray<BoardAssistantBubble>,
): ReadonlyArray<BoardAssistantBubble> {
  const asked = bubbles.findLastIndex((bubble) => bubble.role === "user");
  if (asked < 0) return bubbles.slice(-1);
  const answer = bubbles.length - 1 > asked ? [bubbles[bubbles.length - 1]!] : [];
  return [bubbles[asked]!, ...answer];
}

/** Whether the Assistant's thread is working on an answer right now. */
export function isAssistantBusy(status: string | undefined): boolean {
  return (
    status === "preparing" || status === "queued" || status === "starting" || status === "running"
  );
}

export interface BoardGoalProgress {
  readonly goal: BoardGoal;
  readonly done: number;
  readonly total: number;
  /** Its unfinished tasks, in the Goal's order. */
  readonly open: ReadonlyArray<BoardTask>;
  readonly standing: BoardGoalStanding;
}

/** Each open Goal with its progress, read from its tasks: a Goal keeps no status copy. */
export function goalsOf(
  index: BoardIndex,
  goals: ReadonlyArray<BoardGoal>,
): ReadonlyArray<BoardGoalProgress> {
  return goals.map((goal) => {
    const tasks = goal.taskIds.flatMap((id) => index.byId.get(id) ?? []);
    const open = tasks.filter((task) => task.status !== "done");
    return {
      goal,
      done: tasks.length - open.length,
      total: tasks.length,
      open,
      standing: goalStandingOf(index, goal),
    };
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

/** Open decisions bearing on a task: its own, and those raised here and filed higher up. */
export function openDecisionsOf(index: BoardIndex, task: BoardTask): Array<BoardDecision> {
  return [
    ...task.decisions.filter((d) => d.status === "open"),
    ...ancestorsOf(index, task).flatMap((parent) =>
      parent.decisions.filter((d) => d.status === "open" && d.raisedFrom?.id === task.id),
    ),
  ];
}

/** A blocker or mandatory decision holds its task from done; optional and feature ones don't. */
export const holdsDone = (decision: Pick<BoardDecision, "type">): boolean =>
  decision.type === "blocker" || decision.type === "mandatory";

/** What a task's badge counts: the open decisions that hold it, and old decision items. */
export function openDecisionCount(index: BoardIndex, task: BoardTask): number {
  return (
    openDecisionsOf(index, task).filter(holdsDone).length +
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
): ReadonlyArray<{
  readonly chat: BoardChat;
  readonly task: BoardTask;
  /** Set on a chat linked elsewhere that ticked a step here; those follow the linked chats. */
  readonly worked?: { readonly step: string; readonly at: number };
}> {
  const owners = rollUp ? subtreeOf(index, task) : [task];
  const linked = owners
    .flatMap((owner) => owner.chats.map((chat) => ({ chat, task: owner })))
    .toSorted(
      (a, b) =>
        LIVE_ORDER[a.chat.live] - LIVE_ORDER[b.chat.live] || b.chat.updatedAt - a.chat.updatedAt,
    );
  const seen = new Set(linked.map(({ chat }) => chat.sessionId));
  const worked = owners
    .flatMap((owner) =>
      owner.worked.map(({ chat, step, at }) => ({ chat, task: owner, worked: { step, at } })),
    )
    .toSorted((a, b) => b.worked.at - a.worked.at)
    .filter(({ chat }) => !seen.has(chat.sessionId) && seen.add(chat.sessionId));
  return [...linked, ...worked];
}

export interface BoardGoalLane {
  readonly group: BoardGoal["groups"][number];
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly done: number;
  /** waiting: a group it depends on is unfinished. working: the executor or a child is on it. */
  readonly state: "done" | "working" | "ready" | "waiting";
  /** The child thread the group was handed to. */
  readonly worker: BoardChat | null;
}

/** A Goal's groups as lanes, in its order, each with where it stands. Read from the tasks. */
export function goalLanes(index: BoardIndex, goal: BoardGoal): ReadonlyArray<BoardGoalLane> {
  const tasksOf = (group: BoardGoal["groups"][number]) =>
    group.taskIds.flatMap((id) => index.byId.get(id) ?? []);
  const finished = new Set(
    goal.groups
      .filter((group) => tasksOf(group).every((task) => task.status === "done"))
      .map((group) => group.id),
  );
  // The executor works its own groups one at a time, in order: the first open one is in hand.
  const inHand = goal.groups.find(
    (group) =>
      !finished.has(group.id) &&
      !group.delegated &&
      group.dependsOn.every((id) => finished.has(id)),
  )?.id;
  return goal.groups.map((group) => {
    const tasks = tasksOf(group);
    const open = group.dependsOn.every((id) => finished.has(id));
    const running = goal.status === "running" && (group.delegated || group.id === inHand);
    return {
      group,
      tasks,
      done: tasks.filter((task) => task.status === "done").length,
      state: finished.has(group.id) ? "done" : !open ? "waiting" : running ? "working" : "ready",
      worker: goal.chats.find((chat) => chat.sessionId === group.worker) ?? null,
    };
  });
}

/** The thread to talk to about a Goal: its executor, or the last thread that ran it. */
/** Something on the board that wants the person: what Tack announces and holds. */
export interface BoardNotice {
  /** Stable while the notice stands; a new key is a new arrival. */
  readonly key: string;
  readonly kind: BoardChatAttention["kind"];
  readonly why: "approval" | "question" | null;
  /** The task's title, the Goal's, or the chat's when it is on no task. */
  readonly title: string;
  /** The chat's own title under a task's; null when the title is already the chat's. */
  readonly detail: string | null;
  readonly task: BoardTask | null;
  readonly chat: BoardChat | null;
  readonly goal: BoardGoal | null;
}

/** Waiting answers first, then failures, then results nobody has looked at. */
export function noticesOf(
  panel: Pick<BoardPanel, "needsYou" | "finished">,
  goals: ReadonlyArray<BoardGoalProgress>,
): ReadonlyArray<BoardNotice> {
  const ofChat = ({ chat, task, attention }: BoardPanelChat): BoardNotice => ({
    key: `${attention.kind}:${chat.sessionId}`,
    kind: attention.kind,
    why: attention.kind === "needs" ? attention.why : null,
    title: task?.title ?? chat.title,
    detail: task === null || chat.title === "" ? null : chat.title,
    task,
    chat,
    goal: null,
  });
  const chats = [...panel.needsYou, ...panel.finished].map(ofChat);
  const taken = new Set(chats.map((notice) => notice.chat?.sessionId));
  const ofGoals = goals.flatMap(({ goal, standing }): ReadonlyArray<BoardNotice> => {
    // A Goal whose thread is on a task is already told by that chat.
    const runner = goalThreadOf(goal)?.sessionId ?? goal.executor;
    if (runner !== null && taken.has(runner)) return [];
    const kind =
      standing.kind === "needs" || standing.kind === "stalled"
        ? "needs"
        : standing.kind === "stopped"
          ? "stopped"
          : null;
    return kind === null
      ? []
      : [
          {
            key: `goal:${goal.id}:${standing.kind}`,
            kind,
            why: standing.kind === "needs" ? standing.why : null,
            title: goal.title,
            detail: null,
            task: null,
            chat: null,
            goal,
          },
        ];
  });
  const rank = { needs: 0, stopped: 1, finished: 2 } as const;
  return [...chats, ...ofGoals].toSorted((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Why a Goal is, or is not, moving. "running · thread idle" told none of these apart. */
export type BoardGoalStanding =
  | { readonly kind: "running" }
  /** Its thread halted on an approval or a question. */
  | { readonly kind: "needs"; readonly why: "approval" | "question" }
  /** Its thread's turn failed. */
  | { readonly kind: "stopped" }
  /** Its thread ended a turn with tasks still open, and nothing is waiting on the person. */
  | { readonly kind: "stalled"; readonly open: number }
  | { readonly kind: "paused"; readonly reason: string; readonly waiting: number }
  | { readonly kind: "done" };

export function goalStandingOf(
  index: Pick<BoardIndex, "byId" | "attention">,
  goal: BoardGoal,
): BoardGoalStanding {
  if (goal.status === "done" || goal.status === "ended") return { kind: "done" };
  if (goal.status === "paused")
    return {
      kind: "paused",
      reason: goal.pausedReason ?? "",
      waiting: goal.decisions.filter((decision) => decision.settled === "").length,
    };
  // A Goal run from outside the app has no thread here: its executor's chat is all there is.
  const runner =
    goalThreadOf(goal) ?? goal.chats.find((chat) => chat.sessionId === goal.executor) ?? null;
  if (runner === null) return { kind: "running" };
  const attention = index.attention.get(runner.sessionId);
  if (attention?.kind === "needs") return attention;
  if (attention?.kind === "stopped") return attention;
  if (runner.live === "working") return { kind: "running" };
  return {
    kind: "stalled",
    open: goal.taskIds.filter((id) => index.byId.get(id)?.status !== "done").length,
  };
}

export function goalThreadOf(goal: BoardGoal): BoardChat | null {
  const held = goal.chats.filter((chat) => chat.threadId !== null);
  return (
    held.find((chat) => chat.sessionId === goal.executor) ??
    held.find((chat) => !goal.groups.some((group) => group.worker === chat.sessionId)) ??
    null
  );
}

export interface BoardGoalScopeRow {
  readonly task: BoardTask;
  /** Open tasks without subtasks under it: what a Goal over it would work. */
  readonly open: number;
}

/** What a Goal can be started over: features and modules with open work no Goal holds yet. */
export function goalScopeRows(index: BoardIndex): ReadonlyArray<BoardGoalScopeRow> {
  const rows = (task: BoardTask): ReadonlyArray<BoardGoalScopeRow> => {
    const open = goalLaunchPreview(index, [task.id]).reduce(
      (count, group) => count + group.tasks.length,
      0,
    );
    if (open === 0 || task.level === 3) return [];
    return [{ task, open }, ...index.kidsOf(task.id).flatMap(rows)];
  };
  return index.tasks
    .filter((task) => task.parentId === null)
    .toSorted((a, b) => a.title.localeCompare(b.title))
    .flatMap(rows);
}

/**
 * The groups a Goal over `scope` would work, as the server plans them: each id's open tasks that
 * have no subtasks, one group per parent. Tasks already in an open Goal are left out.
 */
export function goalLaunchPreview(
  index: BoardIndex,
  scope: ReadonlyArray<string>,
): ReadonlyArray<{ readonly parent: BoardTask | null; readonly tasks: ReadonlyArray<BoardTask> }> {
  const leaves = (task: BoardTask): ReadonlyArray<BoardTask> => {
    const kids = index.kidsOf(task.id);
    return kids.length === 0 ? [task] : kids.flatMap(leaves);
  };
  const seen = new Set<string>();
  const groups = new Map<string, Array<BoardTask>>();
  for (const task of scope.flatMap((id) => index.byId.get(id) ?? []).flatMap(leaves)) {
    if (task.status === "done" || task.goal !== null || seen.has(task.id)) continue;
    seen.add(task.id);
    const key = task.parentId ?? task.id;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups].map(([parentId, tasks]) => ({
    parent: index.byId.get(parentId) ?? null,
    tasks,
  }));
}

// What the board says to a Goal's thread. A Goal is driven only by its thread, so the board
// asks that thread instead of writing the Goal itself. English: the model reads these.
const withInstructions = (prompt: string, instructions: string) =>
  instructions.trim() === ""
    ? prompt
    : `${prompt}\n\nInstructions from the person:\n${instructions.trim()}`;
export const goalStartPrompt = (
  scope: ReadonlyArray<string>,
  mode: BoardGoal["mode"],
  instructions = "",
) =>
  withInstructions(
    `Start a Goal on the board over ${scope.join(", ")} in ${mode} mode: call board_goal {action: "start", scope: ${JSON.stringify(scope)}, mode: "${mode}"}, then work through it until it is finished.`,
    instructions,
  );
/** Opens the Goal's thread without starting the Goal, so the person can clarify things first. */
export const goalDiscussPrompt = (
  scope: ReadonlyArray<string>,
  mode: BoardGoal["mode"],
  instructions = "",
) =>
  withInstructions(
    `I want a Goal on the board over ${scope.join(", ")} in ${mode} mode. Do not start it yet. Read those tasks with board_read, then tell me in a few lines the order you would work in and ask me what is unclear. When I say go, call board_goal {action: "start", scope: ${JSON.stringify(scope)}, mode: "${mode}"} and work through it until it is finished.`,
    instructions,
  );
/** A message as the Goals chat shows it: of the board's own start prompts, only the person's part. */
export function goalChatText(text: string): string {
  if (!/^(Start a Goal on the board over|I want a Goal on the board over) /.test(text)) return text;
  const marker = "\n\nInstructions from the person:\n";
  const at = text.indexOf(marker);
  return at < 0 ? "" : text.slice(at + marker.length);
}
export const GOAL_GO_PROMPT = "Go: start the Goal now and work through it until it is finished.";
export const goalResumePrompt = (goalId: string) =>
  `Resume Goal ${goalId}: call board_goal {action: "resume", goalId: "${goalId}"} and carry on until it is finished.`;
export const goalAnswerPrompt = (
  goalId: string,
  decision: BoardGoal["decisions"][number],
  answer: string,
) => `My answer to open question ${decision.id} of Goal ${goalId} ("${decision.title}"): ${answer}`;
