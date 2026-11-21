// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { BoardStore, norm } from "@t3tools/board-core";
import { nodeIO } from "@t3tools/board-core/node";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as BoardChats from "../../../board/BoardChats.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as BoardHandlers from "./handlers.ts";
import { BoardToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:board");

it.effect("runs the board tools as the calling thread, on the board that holds its folder", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-mcp-")),
    );
    const ws = norm(NodePath.join(tmp, "nfx"));
    const store = new BoardStore(NodePath.join(tmp, "board"), nodeIO);
    yield* Effect.promise(() =>
      store.saveRegistry({
        version: 1,
        boards: [{ id: "nefx", name: "NEFX", createdAt: 0, roots: [{ path: ws, label: "main" }] }],
      }),
    );
    const scope = (thread: boolean): McpInvocationContext.McpInvocationScope => ({
      environmentId: EnvironmentId.make("environment:board"),
      requestNamespace: "provider:board",
      thread: thread
        ? {
            threadId,
            providerSessionId: "provider:board",
            providerInstanceId: ProviderInstanceId.make("codex"),
          }
        : undefined,
      client: undefined,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
    });
    const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({ ...liveThreadShell(threadId), worktreePath: `${ws}/wt` }),
    });
    const projects = Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedNone,
    });
    const chats = Layer.effect(BoardChats.BoardChats, BoardChats.make(store)).pipe(
      Layer.provide(Layer.merge(threads, projects)),
    );
    const handlers = (thread: boolean) =>
      McpToolAccess.HandlersLayer.layer(BoardHandlers.layer).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            chats,
            threads,
            Layer.succeed(McpInvocationContext.McpInvocationContext, scope(thread)),
          ),
        ),
      );
    const call = (name: keyof typeof BoardToolkit.tools, params: Record<string, unknown>) =>
      Effect.gen(function* () {
        const toolkit = yield* BoardToolkit;
        return yield* toolkit.handle(name, params as never).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );
      });

    yield* Effect.gen(function* () {
      expect(yield* call("board_link", { newTaskTitle: "SFTP" })).toMatchObject({
        text: expect.stringContaining('Linked this thread to the task.\n\nTask "SFTP"'),
      });
      yield* call("board_plan", { markdown: "## Phase A\n- [ ] A1 Client" });
      expect(yield* call("board_read", {})).toMatchObject({
        text: expect.stringContaining("Next step: A1 – Client"),
      });
    }).pipe(Effect.provide(handlers(true)));

    const record = yield* Effect.promise(() => store.readSession("nefx", threadId));
    expect(record).toMatchObject({
      taskId: "sftp",
      workspaceLabel: "main",
      subfolder: "wt",
      source: { kind: "t3-thread", threadId, provider: "codex", model: "gpt-5" },
    });

    // A client with no thread of its own is not a chat on any board.
    const refused = yield* call("board_read", {}).pipe(Effect.provide(handlers(false)));
    expect(refused).toHaveProperty("code");
    yield* Effect.promise(() => NodeFSP.rm(tmp, { recursive: true, force: true }));
  }),
);
