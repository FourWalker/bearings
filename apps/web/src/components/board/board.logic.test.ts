import { type BoardChat, type BoardTask, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardPickupTargets,
  boardSearchFromUrl,
  chatsForView,
  chatStatusOf,
  collisionsOf,
  externalLinksOf,
  flagsOf,
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
  ...patch,
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
