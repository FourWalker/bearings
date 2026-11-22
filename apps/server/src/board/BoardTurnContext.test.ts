// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { BoardStore, norm } from "@t3tools/board-core";
import { nodeIO } from "@t3tools/board-core/node";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BoardChats from "./BoardChats.ts";
import * as BoardTurnContext from "./BoardTurnContext.ts";

const threadId = ThreadId.make("thread:board-context");

const setup = (folder: (ws: string) => string | null) =>
  Effect.gen(function* () {
    const tmp = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-turn-")),
    );
    const ws = norm(NodePath.join(tmp, "nfx"));
    const store = new BoardStore(NodePath.join(tmp, "board"), nodeIO);
    yield* Effect.promise(() =>
      store.saveRegistry({
        version: 1,
        boards: [{ id: "nefx", name: "NEFX", createdAt: 0, roots: [{ path: ws, label: "main" }] }],
      }),
    );
    const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({ ...liveThreadShell(threadId), worktreePath: folder(ws) }),
    });
    const projects = Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedNone,
    });
    const chats = Layer.effect(BoardChats.BoardChats, BoardChats.make(store)).pipe(
      Layer.provide(Layer.merge(threads, projects)),
    );
    return Layer.effect(BoardTurnContext.BoardTurnContext, BoardTurnContext.make()).pipe(
      Layer.provide(chats),
    );
  });

it.effect("sends the board context once, again when it changes, and again after compaction", () =>
  Effect.gen(function* () {
    const layer = yield* setup((ws) => `${ws}/wt`);
    yield* Effect.gen(function* () {
      const board = yield* BoardTurnContext.BoardTurnContext;
      const first = yield* board.forTurn({ threadId, fresh: false });
      expect(first.text).toMatch(/^<project_board>\n## Claude Project Board\n/);
      expect(first.text).toContain("of the NEFX board");
      expect(first.text).toContain("not linked to a board task yet");

      // Not yet accepted by the provider: offered again.
      expect((yield* board.forTurn({ threadId, fresh: false })).text).toBe(first.text);
      yield* first.sent;
      expect((yield* board.forTurn({ threadId, fresh: false })).text).toBe("");

      // A new native thread has seen nothing.
      expect((yield* board.forTurn({ threadId, fresh: true })).text).toBe(first.text);

      yield* board.forget(threadId);
      expect((yield* board.forTurn({ threadId, fresh: false })).text).toBe(first.text);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a board failure never stops the turn", () =>
  Effect.gen(function* () {
    const layer = yield* setup(() => null);
    yield* Effect.gen(function* () {
      const board = yield* BoardTurnContext.BoardTurnContext;
      // No worktree and no project: BoardChats fails; the turn gets no board context.
      expect((yield* board.forTurn({ threadId, fresh: true })).text).toBe("");
    }).pipe(Effect.provide(layer));
  }),
);
