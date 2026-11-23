// @effect-diagnostics nodeBuiltinImport:off
import { BoardStore } from "@t3tools/board-core";
import { nodeIO } from "@t3tools/board-core/node";
import { MessageId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";

import {
  encodeBoardFile,
  openBoardFile,
  readArchivedThreads,
  readBoardFiles,
} from "./BoardFile.ts";

const board = {
  id: "nefx",
  createdAt: 100,
  settings: {
    name: "NEFX",
    roots: [],
    services: [],
    rules: "Keep the plan current.",
    boardMode: true,
    registers: [],
  },
  files: {
    "tasks/pilot/task.json": JSON.stringify({
      id: "pilot",
      title: "Pilot",
      items: [],
      sessions: [],
    }),
    "tasks/pilot/plan.md": "# Delivery",
    "tasks/pilot/handoffs/A1.md": "Verified.",
  },
};

it.each([false, true])("round-trips a board with includeThreads=%s", async (includeThreads) => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-board-file-"));
  try {
    const store = new BoardStore(home, nodeIO);
    const threadId = ThreadId.make("thread:pilot");
    const itemId = TurnItemId.make("item:pilot");
    const updatedAt = DateTime.makeUnsafe(0);
    const threads = includeThreads
      ? [
          {
            threadId,
            title: "Pilot chat",
            updatedAt,
            items: [
              {
                position: 0,
                visibility: "local" as const,
                sourceThreadId: threadId,
                sourceItemId: itemId,
                item: {
                  id: itemId,
                  threadId,
                  runId: null,
                  nodeId: null,
                  providerThreadId: null,
                  providerTurnId: null,
                  nativeItemRef: null,
                  parentItemId: null,
                  ordinal: 0,
                  status: "completed" as const,
                  title: null,
                  startedAt: null,
                  completedAt: updatedAt,
                  updatedAt,
                  type: "assistant_message" as const,
                  messageId: MessageId.make("message:pilot"),
                  text: "The pilot checks passed.",
                  streaming: false,
                },
              },
            ],
          },
        ]
      : [];
    const contents = encodeBoardFile({ ...board, threads });
    expect(await openBoardFile(store, contents)).toBe(board.id);
    expect((await store.loadRegistry()).boards).toEqual([
      { id: board.id, createdAt: board.createdAt, ...board.settings },
    ]);
    expect(await readBoardFiles(store, board.id)).toEqual(board.files);
    expect(await readArchivedThreads(store, board.id)).toEqual(threads);
    await expect(openBoardFile(store, contents)).rejects.toThrow("already exists");
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});

it("rejects path traversal before writing any board records", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-board-file-"));
  try {
    const store = new BoardStore(home, nodeIO);
    const contents = encodeBoardFile({
      ...board,
      files: { ...board.files, "tasks/../task.json": "{}" },
      threads: [],
    });
    await expect(openBoardFile(store, contents)).rejects.toThrow("invalid task path");
    expect(await store.io.list(home)).toEqual([]);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
