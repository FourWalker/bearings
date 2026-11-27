import type { BoardTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { indexBoard } from "./board.logic";
import {
  type TreeOptions,
  orderTasks,
  stampOf,
  starredForReview,
  treeColumns,
} from "./boardTree.logic";

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
  lastActionAt: 0,
  doneAt: null,
  starredAt: null,
  next: null,
  steps: { done: 0, total: 0 },
  chats: [],
  worked: [],
  items: [],
  decisions: [],
  links: [],
  owner: null,
  createdAt: 0,
  updatedAt: 0,
  ownerRoot: null,
  goal: null,
  evidence: null,
  doneNote: null,
  ...patch,
});
const module = (id: string, parentId: string, patch: Partial<BoardTask> = {}) =>
  task(id, { level: 2, parentId, ...patch });
const leaf = (id: string, parentId: string, patch: Partial<BoardTask> = {}) =>
  task(id, { level: 3, parentId, ...patch });
const blockedBy = (to: string) => [{ to, type: "blocked_by" as const, note: "" }];

const index = indexBoard([
  task("core"),
  task("tack"),
  module("storage", "core", { lastActionAt: 30, createdAt: 1 }),
  module("search", "core", { status: "done", doneAt: 20, lastActionAt: 20, createdAt: 2 }),
  module("evidence", "core", { lastActionAt: 10, createdAt: 3, links: blockedBy("storage") }),
  module("binding", "core", { lastActionAt: 5, createdAt: 4 }),
  leaf("ids", "storage", { steps: { done: 1, total: 4 } }),
  leaf("backup", "storage", { status: "done", doneAt: 9 }),
  leaf("browse", "binding", { title: "Folder browse", starredAt: 7 }),
  leaf("checks", "evidence", { links: blockedBy("ids") }),
  module("pin", "tack", { title: "Pin bar" }),
]);
const options: TreeOptions = {
  order: "last",
  reversed: false,
  showDone: false,
  starredOnly: false,
  query: "",
};
const ids = (list: ReadonlyArray<BoardTask>) => list.map((item) => item.id);
const shape = (given: Partial<TreeOptions>) =>
  treeColumns(index, "active", { ...options, ...given }).map((column) => [
    column.root.id,
    column.modules.map((entry) => [entry.task.id, ids(entry.tasks)]),
  ]);

describe("orderTasks", () => {
  const modules = index.kidsOf("core");
  const order = (given: TreeOptions["order"], reversed = false) =>
    ids(orderTasks(index, modules, { order: given, reversed }));

  it("puts what holds a star first, then applies the chosen order", () => {
    // `binding` holds the starred task, so it leads every order.
    expect(order("last")).toEqual(["binding", "storage", "search", "evidence"]);
    expect(order("last", true)).toEqual(["binding", "evidence", "search", "storage"]);
    expect(order("done")).toEqual(["binding", "search", "storage", "evidence"]);
    expect(order("name")).toEqual(["binding", "evidence", "search", "storage"]);
    expect(order("completion")).toEqual(["binding", "search", "storage", "evidence"]);
    expect(order("blocked")).toEqual(["binding", "evidence", "storage", "search"]);
  });

  it("lists a blocker before what waits on it", () => {
    const list = [modules[2]!, modules[0]!, modules[1]!];
    expect(ids(orderTasks(index, list, { order: "deps", reversed: false }))).toEqual([
      "storage",
      "evidence",
      "search",
    ]);
  });
});

describe("treeColumns", () => {
  it("leaves done work out unless asked, and counts what it left out", () => {
    const columns = treeColumns(index, "active", options);
    expect(shape({})).toEqual([
      // The starred task's column leads.
      [
        "core",
        [
          ["binding", ["browse"]],
          ["storage", ["ids"]],
          ["evidence", ["checks"]],
        ],
      ],
      ["tack", [["pin", []]]],
    ]);
    expect(columns[0]?.hiddenDone).toBe(2);
    expect(shape({ showDone: true })[0]?.[1]).toContainEqual(["storage", ["ids", "backup"]]);
  });

  it("keeps a starred item in view when it is done", () => {
    const starredDone = indexBoard([
      task("core"),
      module("search", "core", { status: "done", starredAt: 3 }),
    ]);
    const [column] = treeColumns(starredDone, "active", options);
    expect(column?.modules.map((entry) => entry.task.id)).toEqual(["search"]);
    expect(column?.hiddenDone).toBe(0);
  });

  it("filters by name, keeping parents and opening the module a matching task is in", () => {
    expect(shape({ query: "BROWSE" })).toEqual([["core", [["binding", ["browse"]]]]]);
    expect(
      treeColumns(index, "active", { ...options, query: "browse" })[0]?.modules[0],
    ).toMatchObject({ forcedOpen: true });
    // A matching module keeps all its tasks; a matching master keeps its whole column.
    expect(shape({ query: "storage" })).toEqual([["core", [["storage", ["ids"]]]]]);
    expect(shape({ query: "tack" })).toEqual([["tack", [["pin", []]]]]);
    expect(shape({ query: "nothing like it" })).toEqual([]);
  });

  it("shows only what is starred, with its parents", () => {
    expect(shape({ starredOnly: true })).toEqual([["core", [["binding", ["browse"]]]]]);
    expect(shape({ starredOnly: true, query: "pin" })).toEqual([]);
  });
});

it("stamps a shut card with what matters most, and reviews finished stars first", () => {
  expect(stampOf(index, index.byId.get("search")!)).toBe("done");
  expect(stampOf(index, index.byId.get("evidence")!)).toBe("blocked");
  expect(stampOf(index, index.byId.get("storage")!)).toBeNull();
  expect(stampOf(index, task("later", { status: "paused" }))).toBe("paused");

  const review = starredForReview(
    indexBoard([
      task("open", { starredAt: 5 }),
      task("old", { status: "done", doneAt: 1, starredAt: 9 }),
      task("recent", { status: "done", doneAt: 4, starredAt: 2 }),
      task("plain"),
    ]),
  );
  expect(review.map(({ task: item, suggested }) => [item.id, suggested])).toEqual([
    ["recent", true],
    ["old", true],
    ["open", false],
  ]);
});
