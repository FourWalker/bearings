// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { BoardChat, BoardStore, noGit, norm } from "@t3tools/board-core";
import { nodeIO } from "@t3tools/board-core/node";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as BoardService from "./BoardService.ts";

it.effect("shows a T3 thread's own status and title, and drops threads this server lacks", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-service-")),
    );
    const ws = norm(NodePath.join(tmp, "nfx"));
    // Ten minutes before the test clock: the board app would show every chat here offline.
    const store = new BoardStore(NodePath.join(tmp, "board"), nodeIO, {
      now: () => -600_000,
      random: () => 0,
    });
    yield* Effect.promise(async () => {
      await store.saveRegistry({
        version: 1,
        boards: [{ id: "nefx", name: "NEFX", createdAt: 0, roots: [{ path: ws, label: "main" }] }],
      });
      for (const [id, prompt] of [
        ["thread:idle", "Refunds"],
        ["thread:running", "Payouts"],
        ["thread:elsewhere", "Another install"],
      ] as const) {
        const chat = new BoardChat(store, noGit, "t3");
        await chat.open({ sessionId: id, cwd: ws, source: { kind: "t3-thread", threadId: id } });
        await chat.turnStart(prompt);
      }
    });
    const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed(
          threadId === "thread:elsewhere"
            ? null
            : {
                ...liveThreadShell(threadId),
                title: threadId === "thread:idle" ? "Refund API" : "Payout API",
                activeRunId: threadId === "thread:running" ? RunId.make("run:1") : null,
              },
        ),
    });
    const layer = Layer.effect(BoardService.BoardService, BoardService.make(store)).pipe(
      Layer.provide(threads),
    );

    yield* Effect.gen(function* () {
      const boards = yield* BoardService.BoardService;
      expect(yield* boards.list).toEqual([{ id: "nefx", name: "NEFX", taskCount: 0 }]);
      const view = yield* boards.view({ boardId: "nefx" });
      expect(view.unlinked.map((c) => [c.threadId, c.title, c.live])).toEqual(
        expect.arrayContaining([
          [ThreadId.make("thread:idle"), "Refund API", "idle"],
          [ThreadId.make("thread:running"), "Payout API", "working"],
        ]),
      );
      // Not held here: no link, and with a stale heartbeat it isn't an open chat.
      expect(view.unlinked).toHaveLength(2);
      const missing = yield* Effect.flip(boards.view({ boardId: "nope" }));
      expect(missing.reason).toBe("not-found");
    }).pipe(Effect.provide(layer));
  }),
);
