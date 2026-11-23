import {
  type BoardChat,
  type BoardGoal,
  type BoardTask,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assistantBubbles,
  latestExchange,
  boardPickupTargets,
  boardSearchFromUrl,
  boardSearchOfIntent,
  chatsForView,
  chatStatusOf,
  collisionsOf,
  externalLinksOf,
  flagsOf,
  goalLanes,
  goalLaunchPreview,
  goalScopeRows,
  goalStartPrompt,
  goalsOf,
  goalThreadOf,
  indexBoard,
  levelKindOf,
  openDecisionCount,
  ownerHolderOf,
  panelOf,
  recommendationsOf,
  serviceColumns,
  treeRoots,
} from "./board.logic";

const task = (id: string, patch: Partial<BoardTask> = {}): BoardTask => ({
  id,
  title: id,
  description: "",
  status: "active",
  level: 1,
  parentId: null,
  kind: null,
  bug: false,
  mainService: null,
  services: [],
  lastAction: null,
  next: null,
  steps: { done: 0, total: 0 },
  chats: [],
  items: [],
  decisions: [],
  links: [],
  owner: null,
  createdAt: 0,
  updatedAt: 0,
  ownerRoot: null,
  goal: null,
  evidence: null,
  ...patch,
});

const group = (id: string, taskIds: Array<string>, dependsOn: Array<string> = []) => ({
  id,
  title: id,
  taskIds,
  dependsOn,
  delegated: false,
  worker: null,
  report: null,
});

const chat = (sessionId: string, patch: Partial<BoardChat> = {}): BoardChat => ({
  sessionId,
  title: sessionId,
  live: "idle",
  workspaceLabel: "main",
  taskId: null,
  updatedAt: 0,
  threadId: null,
  provider: null,
  turnStartedAt: 0,
  ...patch,
});

it("shows only what was said and answered in the Assistant chat", () => {
  const message = (id: string, role: string, text: string, streaming = false) => ({
    id,
    role,
    text,
    streaming,
  });
  expect(
    assistantBubbles([
      message("1", "user", "What is blocked?"),
      message("2", "system", "MCP client failed to start"),
      message("3", "assistant", "  "),
      message("4", "assistant", "Nothing is blocked.", true),
    ]),
  ).toEqual([
    { id: "1", role: "user", text: "What is blocked?", streaming: false },
    { id: "4", role: "assistant", text: "Nothing is blocked.", streaming: true },
  ]);
  // The small chat keeps the question and the last thing said back, not the notes between.
  const said = assistantBubbles([
    message("1", "user", "Old question"),
    message("2", "assistant", "Old answer"),
    message("3", "user", "What is blocked?"),
    message("4", "assistant", "I will check the board."),
    message("5", "assistant", "Nothing is blocked."),
  ]);
  expect(latestExchange(said).map((bubble) => bubble.id)).toEqual(["3", "5"]);
  expect(latestExchange(said.slice(0, 3)).map((bubble) => bubble.id)).toEqual(["3"]);
});

it("turns an open intent into the board address, naming only what was asked", () => {
  expect(boardSearchOfIntent("env-1", { type: "board.open", boardId: "nefx" })).toEqual({
    env: "env-1",
    board: "nefx",
  });
  expect(
    boardSearchOfIntent("env-1", {
      type: "board.open",
      boardId: "nefx",
      taskId: "refunds",
      view: "3",
      filter: "all",
    }),
  ).toEqual({ env: "env-1", board: "nefx", open: "refunds", view: "3", filter: "all" });
});

it("reads a Goal's progress from its tasks and skips ones no longer on the board", () => {
  const index = indexBoard([
    task("a", { status: "done" }),
    task("b"),
    task("c", { status: "paused" }),
  ]);
  const goal: BoardGoal = {
    id: "g-1",
    title: "Ship",
    status: "running",
    mode: "auto",
    pausedReason: null,
    executor: "s-exec",
    taskIds: ["c", "a", "gone", "b"],
    decisions: [],
    groups: [
      { ...group("A", ["a"]) },
      { ...group("B", ["c", "gone"], ["A"]) },
      { ...group("C", ["b"], ["B"]) },
      { ...group("D", ["b"]), delegated: true, worker: "s-child" },
    ],
    chats: [
      chat("s-child", { threadId: ThreadId.make("t-child") }),
      chat("s-old", { threadId: ThreadId.make("t-old") }),
      chat("s-exec", { threadId: ThreadId.make("t-exec") }),
    ],
    createdAt: 0,
    updatedAt: 0,
  };
  expect(goalsOf(index, [goal])).toMatchObject([
    { done: 1, total: 3, open: [{ id: "c" }, { id: "b" }] },
  ]);
  // Lanes: A is finished, B is the executor's group in hand, C waits for B, D is with a child.
  expect(goalLanes(index, goal).map((lane) => [lane.group.id, lane.state, lane.done])).toEqual([
    ["A", "done", 1],
    ["B", "working", 0],
    ["C", "waiting", 0],
    ["D", "working", 0],
  ]);
  expect(goalLanes(index, goal)[3]?.worker?.sessionId).toBe("s-child");
  expect(goalLanes(index, { ...goal, status: "paused" })[1]?.state).toBe("ready");
  // The board talks to the executor; once paused, to the last thread that ran it, never a child.
  expect(goalThreadOf(goal)?.sessionId).toBe("s-exec");
  expect(goalThreadOf({ ...goal, executor: null })?.sessionId).toBe("s-old");
  expect(goalThreadOf({ ...goal, chats: [chat("s-exec")] })).toBeNull();
});

it("previews a Goal as the open leaf tasks no Goal holds, one group per parent", () => {
  const held = { id: "g-1", title: "Ship", status: "running" as const };
  const index = indexBoard([
    task("checkout"),
    task("payments", { level: 2, parentId: "checkout" }),
    task("refund", { level: 3, parentId: "payments" }),
    task("capture", { level: 3, parentId: "payments", status: "done" }),
    task("cart", { level: 2, parentId: "checkout" }),
    task("coupons", { level: 3, parentId: "cart", goal: held }),
    task("empty", { level: 2, parentId: "checkout" }),
    task("old", { status: "done" }),
  ]);
  const preview = goalLaunchPreview(index, ["checkout", "payments"]);
  expect(preview.map((entry) => [entry.parent?.id, entry.tasks.map((t) => t.id)])).toEqual([
    ["payments", ["refund"]],
    ["checkout", ["empty"]],
  ]);
  // Only features and modules with open work are offered; a module whose task is held is not.
  expect(goalScopeRows(index).map((row) => [row.task.id, row.open])).toEqual([
    ["checkout", 2],
    ["payments", 1],
    ["empty", 1],
  ]);
  expect(goalStartPrompt(["payments", "cart"], "auto")).toContain(
    'board_goal {action: "start", scope: ["payments","cart"], mode: "auto"}',
  );
});

describe("board tree", () => {
  it("puts master tasks and orphans in columns, children oldest first, and reads levels", () => {
    const index = indexBoard([
      task("checkout"),
      task("refunds", { level: 2, parentId: "checkout", createdAt: 2 }),
      task("payments", { level: 2, parentId: "checkout", createdAt: 1 }),
      task("orphan", { level: 3, parentId: "gone" }),
      task("old", { status: "done" }),
      task("api", { kind: "backlog" }),
      task("retry-bug", { level: 2, parentId: "api" }),
    ]);
    expect(treeRoots(index, "active").map((t) => t.id)).toEqual(["checkout", "orphan", "api"]);
    expect(treeRoots(index, "all").map((t) => t.id)).toContain("old");
    expect(index.kidsOf("checkout").map((t) => t.id)).toEqual(["payments", "refunds"]);
    const kinds = ["checkout", "api", "payments", "retry-bug", "orphan"].map((id) =>
      levelKindOf(index, index.byId.get(id)!),
    );
    expect(kinds).toEqual(["master", "backlog", "module", "backlogItem", "task"]);
  });

  it("flags blockers, fixes and the owner a task inherits", () => {
    const index = indexBoard([
      task("feature", { owner: { root: "d:/nfx-b", label: "b", state: "owned" } }),
      task("module", { level: 2, parentId: "feature" }),
      task("a", {
        level: 3,
        parentId: "module",
        links: [{ to: "b", type: "blocked_by", note: "" }],
      }),
      task("b", { level: 3, parentId: "module" }),
      task("shipped", { level: 3, parentId: "module", status: "done" }),
      task("fix", { bug: true, links: [{ to: "shipped", type: "fixes", note: "" }] }),
    ]);
    const flags = (id: string) => flagsOf(index, index.byId.get(id)!);
    expect(flags("a").blockedBy.map((t) => t.id)).toEqual(["b"]);
    expect(flags("module")).toMatchObject({ blockedBelow: 1, openFixesBelow: 1 });
    expect(flags("shipped").openFixes).toBe(1);
    expect(flags("fix").fixes?.id).toBe("shipped");
    expect(ownerHolderOf(index, index.byId.get("a")!)?.id).toBe("feature");
  });
});

describe("chat status", () => {
  it("rolls working chats up from subtasks", () => {
    const index = indexBoard([
      task("feature", { chats: [chat("s1", { live: "idle" })] }),
      task("module", {
        level: 2,
        parentId: "feature",
        chats: [chat("s2", { live: "working", workspaceLabel: "b", turnStartedAt: 50 })],
      }),
    ]);
    expect(chatStatusOf(index, index.byId.get("feature")!, 100)).toEqual({
      kind: "working",
      workspaces: ["b"],
      since: 50,
      inSubtasks: 1,
    });
    expect(chatStatusOf(index, indexBoard([task("x")]).byId.get("x")!, 0)).toEqual({
      kind: "none",
    });
  });

  it("warns when two chats work in one workspace copy", () => {
    const tasks = [task("t", { chats: [chat("s1", { live: "working" })] })];
    expect(collisionsOf(tasks, [chat("s2", { live: "working" })])).toEqual([
      { workspace: "main", count: 2 },
    ]);
    expect(collisionsOf(tasks, [chat("s2", { live: "idle" })])).toEqual([]);
  });
});

describe("panelOf", () => {
  it("collects open items and decisions from unfinished tasks, and open unlinked chats", () => {
    const index = indexBoard([
      task("live", {
        items: [
          { id: "1", kind: "mandatory", text: "Keep ids", done: false },
          { id: "2", kind: "todo", text: "Docs", done: true },
          { id: "3", kind: "decision", text: "Old style", done: false },
        ],
        decisions: [
          { id: "d", title: "UUIDs?", status: "open", level: 2, raisedFrom: null, r: null },
          { id: "e", title: "Done", status: "decided", level: 1, raisedFrom: null, r: "R1" },
        ],
      }),
      task("finished", {
        status: "done",
        items: [{ id: "4", kind: "mandatory", text: "Hidden", done: false }],
      }),
    ]);
    const panel = panelOf(index, [chat("open"), chat("gone", { live: "ended" })]);
    expect(panel.mandatory.map((e) => e.text)).toEqual(["Keep ids"]);
    expect(panel.decisions.map((e) => [e.text, e.level])).toEqual([
      ["UUIDs?", 2],
      ["Old style", undefined],
    ]);
    expect(panel.todo).toEqual([]);
    expect(panel.unlinked.map((c) => c.sessionId)).toEqual(["open"]);
  });
});

describe("serviceColumns", () => {
  it("lists tagged tasks per service, then untagged Level 3 tasks", () => {
    const index = indexBoard([
      task("a", { mainService: "api", services: ["api", "web"] }),
      task("b", { level: 3, parentId: "a" }),
      task("c", { level: 2, parentId: "a" }),
    ]);
    const services = [
      { id: "api", name: "API", match: ["api"] },
      { id: "web", name: "Web", match: ["web"] },
      { id: "db", name: "DB", match: ["db"] },
    ];
    expect(
      serviceColumns(index, services, "active").map((c) => [
        c.service?.id ?? null,
        c.tasks.map((t) => t.id),
      ]),
    ).toEqual([
      ["api", ["a"]],
      ["web", ["a"]],
      [null, ["b"]],
    ]);
  });
});

describe("boardPickupTargets", () => {
  it("offers explicit override and takeover choices for an owned task in another copy", () => {
    const workspaces = [
      { label: "main", root: "d:/nfx", projectId: ProjectId.make("p:main") },
      { label: "copy", root: "d:/nfx-copy", projectId: ProjectId.make("p:copy") },
      { label: "laptop", root: "e:/nfx", projectId: null },
    ];
    const parent = task("root", { owner: { root: "d:/nfx-copy", label: "copy", state: "owned" } });
    const child = task("child", { level: 2, parentId: parent.id });
    expect(boardPickupTargets(indexBoard([parent, child]), workspaces, child)).toEqual([
      { label: "main", projectId: "p:main", override: "once" },
      { label: "main", projectId: "p:main", override: "takeover" },
      { label: "copy", projectId: "p:copy" },
    ]);
    expect(
      boardPickupTargets(indexBoard([child]), workspaces, child).map((target) => target.label),
    ).toEqual(["main", "copy"]);
  });
});

it("sorts recommendations numerically and links to the task where they were raised", () => {
  const raisedFrom = { id: "module", title: "Module" };
  const question = {
    id: "d",
    title: "Which strategy?",
    status: "open",
    level: 1,
    raisedFrom,
    r: null,
  } as const;
  const root = task("root", {
    decisions: [
      question,
      { ...question, id: "d10", r: "R10", raisedFrom: null },
      { ...question, id: "d2", r: "R2" },
    ],
  });
  const module = task("module", { level: 2, parentId: root.id });
  expect(recommendationsOf(indexBoard([root, module])).map(({ r, task }) => [r, task.id])).toEqual([
    ["R2", module.id],
    ["R10", root.id],
  ]);
});

describe("boardSearchFromUrl", () => {
  it("keeps only known views and filters", () => {
    expect(boardSearchFromUrl({ board: "nefx", env: "", view: 2, filter: "nope" })).toEqual({
      env: undefined,
      board: "nefx",
      view: "2",
      filter: undefined,
    });
  });
});

describe("task views", () => {
  it("groups links to work outside the tree, counts open decisions, and rolls up chats", () => {
    const index = indexBoard([
      task("feature", {
        decisions: [
          {
            id: "d1",
            title: "Up",
            status: "open",
            level: 1,
            raisedFrom: { id: "module", title: "module" },
            r: null,
          },
        ],
      }),
      task("module", {
        level: 2,
        parentId: "feature",
        links: [{ to: "contract", type: "blocked_by", note: "invoice" }],
        decisions: [
          { id: "d2", title: "Own", status: "open", level: 2, raisedFrom: null, r: null },
        ],
        items: [{ id: "i1", kind: "decision", text: "Old style", done: false }],
        chats: [chat("idle", { live: "idle", updatedAt: 5 })],
      }),
      task("contract", { links: [{ to: "feature", type: "related", note: "" }] }),
    ]);
    const feature = index.byId.get("feature")!;
    const module = index.byId.get("module")!;
    expect(externalLinksOf(index, feature).map((l) => [l.group, l.otherId, l.ours?.id])).toEqual([
      ["blockingUs", "contract", "module"],
      ["related", "contract", "feature"],
    ]);
    expect(openDecisionCount(index, module)).toBe(3);
    expect(chatsForView(index, feature, true).map((c) => [c.chat.sessionId, c.task.id])).toEqual([
      ["idle", "module"],
    ]);
    expect(chatsForView(index, feature, false)).toEqual([]);
  });
});
