import type { BoardTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardSearchFromUrl, boardTaskTree } from "./board.logic";

const task = (id: string, parentId: string | null, status: BoardTask["status"] = "active") =>
  ({ id, parentId, status }) as BoardTask;

describe("boardTaskTree", () => {
  it("nests modules and tasks under their parents and keeps orphans visible", () => {
    const tasks = [
      task("checkout", null),
      task("payments", "checkout"),
      task("refunds", "payments"),
      task("orphan", "gone"),
      task("old", null, "done"),
      task("old-child", "old"),
    ];
    expect(boardTaskTree(tasks, false).map((r) => [r.task.id, r.depth])).toEqual([
      ["checkout", 0],
      ["payments", 1],
      ["refunds", 2],
      ["orphan", 0],
      // Its parent is done and hidden; it still shows.
      ["old-child", 0],
    ]);
    expect(boardTaskTree(tasks, true).map((r) => r.task.id)).toEqual([
      "checkout",
      "payments",
      "refunds",
      "orphan",
      "old",
      "old-child",
    ]);
  });
});

describe("boardSearchFromUrl", () => {
  it("keeps only meaningful values", () => {
    expect(boardSearchFromUrl({ board: "nefx", env: "", done: "true", x: 1 })).toEqual({
      env: undefined,
      board: "nefx",
      done: true,
    });
  });
});
