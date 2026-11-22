// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { BoardStore, norm } from "@t3tools/board-core";
import { nodeIO } from "@t3tools/board-core/node";
import {
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BoardChats from "./BoardChats.ts";
import * as BoardReactor from "./BoardReactor.ts";

const threadId = ThreadId.make("thread:board-reactor");
const runId = RunId.make("run:board-reactor:1");
const promptId = MessageId.make("message:board-reactor:prompt");

const message = (
  fields: Pick<OrchestrationV2ConversationMessage, "id" | "role" | "text" | "createdBy">,
) => ({ ...fields, threadId, runId, streaming: false }) as OrchestrationV2ConversationMessage;

const event = (type: string, payload: object) =>
  ({ type, threadId, payload }) as unknown as OrchestrationV2DomainEvent;

const run = (status: string) =>
  event("run.updated", { id: runId, threadId, status, userMessageId: promptId });

it.effect("records a thread's turns, answers and changed files on its board task", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-reactor-")),
    );
    const ws = norm(NodePath.join(tmp, "nfx"));
    const store = new BoardStore(NodePath.join(tmp, "board"), nodeIO);
    yield* Effect.promise(() =>
      store.saveRegistry({
        version: 1,
        boards: [
          {
            id: "nefx",
            name: "NEFX",
            createdAt: 0,
            roots: [{ path: ws, label: "main" }],
            services: [{ id: "api", name: "API", match: ["api"] }],
          },
        ],
      }),
    );
    const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed({ ...liveThreadShell(threadId), worktreePath: ws }),
    });
    const projects = Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedNone,
    });
    const prompt = message({
      id: promptId,
      role: "user",
      text: "Add the refund API",
      createdBy: "user",
    });
    const answer = message({
      id: MessageId.make("message:board-reactor:answer"),
      role: "assistant",
      text: "Added POST /refunds.\n\nTests pass.",
      createdBy: "agent",
    });
    const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getMessagesById: () => Effect.succeed(new Map([[promptId, prompt]])),
      getThreadRecords: () => Effect.succeed({ messages: [answer] } as never),
    });
    const chats = Layer.effect(BoardChats.BoardChats, BoardChats.make(store)).pipe(
      Layer.provide(Layer.merge(threads, projects)),
    );
    const layer = Layer.effect(BoardReactor.BoardReactor, BoardReactor.make).pipe(
      Layer.provideMerge(chats),
      Layer.provide(Layer.merge(projections, Layer.mock(Orchestrator.OrchestratorV2)({}))),
    );

    yield* Effect.gen(function* () {
      const reactor = yield* BoardReactor.BoardReactor;
      const chat = yield* (yield* BoardChats.BoardChats).forThread(threadId);
      yield* Effect.promise(() => chat.linkTask({ newTaskTitle: "Refunds" }));
      const session = () => Effect.promise(() => store.readSession("nefx", threadId));
      const task = () => Effect.promise(() => store.loadTask("nefx", "refunds"));

      yield* reactor.handle(run("running"));
      expect(yield* session()).toMatchObject({
        status: "working",
        lastPrompt: "Add the refund API",
      });

      yield* reactor.handle(event("checkpoint.captured", { files: [{ path: "api/refunds.ts" }] }));
      expect((yield* task())?.services).toEqual(["api"]);

      yield* reactor.handle(run("completed"));
      expect((yield* session())?.status).toBe("idle");
      expect((yield* task())?.lastAction?.text).toBe("Added POST /refunds.");

      // A repeated status is the same turn: it doesn't restart or re-settle it.
      yield* Effect.promise(() => chat.updateTask({ lastAction: "Reviewed by hand" }));
      yield* reactor.handle(run("running"));
      yield* reactor.handle(run("completed"));
      expect((yield* session())?.status).toBe("idle");
      expect((yield* task())?.lastAction?.text).toBe("Reviewed by hand");

      yield* reactor.handle(event("thread.archived", {}));
      expect((yield* session())?.status).toBe("ended");
    }).pipe(Effect.provide(layer));
  }),
);
