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
  type ThreadIssueLink,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
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
    // The thread's T3 issue links, as the reactor mirrors the board task onto them.
    let issues: Array<ThreadIssueLink> = [];
    const issueLink = (key: string) =>
      ({ tracker: "board", host: "local", scope: "nefx", key }) as ThreadIssueLink;
    const engine = Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: () => Effect.succeed({ ...liveThreadShell(threadId), issues }),
    });
    const threadIssues = Layer.mock(ThreadIssueService.ThreadIssueService)({
      link: (input) =>
        Effect.sync(() => {
          issues = [...issues, issueLink(input.ref.key)];
          return { alreadyLinked: false };
        }),
      unlink: (input) =>
        Effect.sync(() => {
          issues = issues.filter((link) => link.key !== input.key.key);
          return { wasLinked: true };
        }),
    });
    const layer = Layer.effect(BoardReactor.BoardReactor, BoardReactor.make).pipe(
      Layer.provideMerge(chats),
      Layer.provide(Layer.mergeAll(projections, engine, threadIssues)),
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
      // The board task shows on the thread as one of its issue links.
      expect(issues.map((link) => link.key)).toEqual(["refunds"]);

      yield* Effect.promise(async () => {
        await chat.createTask({ title: "Billing", topLevel: true });
        const billing = (await store.loadTask("nefx", "billing"))!;
        billing.owner = { root: `${ws}-other`, label: "other", state: "owned", since: 0 };
        await store.saveTask("nefx", billing);
      });
      issues = [...issues, issueLink("billing")];
      yield* reactor.handle(event("thread.issue-synced", { issues }));
      expect(issues.map((link) => link.key)).toEqual(["refunds"]);
      expect((yield* session())?.taskId).toBe("refunds");

      yield* reactor.handle(event("checkpoint.captured", { files: [{ path: "api/refunds.ts" }] }));
      expect((yield* task())?.services).toEqual(["api"]);

      const completedAt = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
      const check = event("turn-item.updated", {
        id: "check:1",
        type: "command_execution",
        runId,
        completedAt,
        exitCode: 1,
        input: "vp test run failing.test.ts",
      });
      yield* reactor.handle(check);
      yield* reactor.handle(check);
      yield* reactor.handle(
        event("turn-item.updated", {
          id: "check:pwsh",
          type: "command_execution",
          runId,
          completedAt,
          exitCode: 0,
          input: `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'npm test'`,
        }),
      );
      yield* reactor.handle(
        event("turn-item.updated", {
          id: "check:2",
          type: "command_execution",
          runId,
          completedAt,
          exitCode: 0,
          input: `powershell.exe -Command "vp test run failing.test.ts; echo done"`,
        }),
      );
      // Agents log a check to a file and pass its exit code on: the result is still the check's.
      yield* reactor.handle(
        event("turn-item.updated", {
          id: "check:logged",
          type: "command_execution",
          runId,
          completedAt,
          exitCode: 0,
          input: `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'New-Item -ItemType Directory -Force .local-run/logs/add-max | Out-Null; npm test *> .local-run/logs/add-max/check.log; $checkExit = $LASTEXITCODE; Get-Content .local-run/logs/add-max/check.log -Tail 30; exit $checkExit'`,
        }),
      );
      yield* reactor.handle(
        event("turn-item.updated", {
          id: "check:bash",
          type: "command_execution",
          runId,
          completedAt,
          exitCode: 2,
          input:
            "npm run lint > .local-run/logs/lint.log 2>&1; code=$?; tail -n 20 .local-run/logs/lint.log; exit $code",
        }),
      );
      // Without the exit code passed on, the command's result is the last statement's.
      yield* reactor.handle(
        event("turn-item.updated", {
          id: "check:lost",
          type: "command_execution",
          runId,
          completedAt,
          exitCode: 0,
          input: "npm test > test.log 2>&1; tail -n 20 test.log",
        }),
      );
      // A file the agent wrote counts before the turn's checkpoint, so "done" in the same turn has it.
      yield* reactor.handle(
        event("turn-item.updated", {
          id: "file:1",
          type: "file_change",
          runId,
          completedAt,
          fileName: "api/refunds.test.ts",
          changes: [
            { operation: "add", path: "api/refunds.test.ts" },
            { operation: "add", path: "api/fixtures.ts" },
          ],
        }),
      );
      expect((yield* task())?.files).toEqual([
        `${ws}/api/refunds.test.ts`,
        `${ws}/api/fixtures.ts`,
        `${ws}/api/refunds.ts`,
      ]);
      expect((yield* task())?.checks).toEqual([
        {
          id: "check:bash",
          command: "npm run lint",
          exitCode: 2,
          at: DateTime.toEpochMillis(completedAt),
        },
        {
          id: "check:logged",
          command: "npm test",
          exitCode: 0,
          at: DateTime.toEpochMillis(completedAt),
        },
        {
          id: "check:pwsh",
          command: "npm test",
          exitCode: 0,
          at: DateTime.toEpochMillis(completedAt),
        },
        { id: "check:1", command: "vp test", exitCode: 1, at: DateTime.toEpochMillis(completedAt) },
      ]);

      yield* reactor.handle(run("completed"));
      expect((yield* session())?.status).toBe("idle");
      expect((yield* task())?.lastAction?.text).toBe("Added POST /refunds.");

      // A repeated status is the same turn: it doesn't restart or re-settle it.
      yield* Effect.promise(() => chat.updateTask({ lastAction: "Reviewed by hand" }));
      yield* reactor.handle(run("running"));
      yield* reactor.handle(run("completed"));
      expect((yield* session())?.status).toBe("idle");
      expect((yield* task())?.lastAction?.text).toBe("Reviewed by hand");

      // Unlinking the board issue in T3 unlinks the task; linking it again relinks it.
      issues = [];
      yield* reactor.handle(event("thread.issue-synced", { issues }));
      expect((yield* session())?.taskId).toBeNull();
      issues = [issueLink("refunds")];
      yield* reactor.handle(event("thread.issue-synced", { issues }));
      expect((yield* session())?.taskId).toBe("refunds");

      yield* reactor.handle(event("thread.archived", {}));
      expect((yield* session())?.status).toBe("ended");
    }).pipe(Effect.provide(layer));
  }),
);
