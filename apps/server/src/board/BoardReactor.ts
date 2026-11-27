/**
 * Keeps each thread's board record current from committed events, for every provider: runs set
 * working/idle and last action, checkpoints tag services, archive/delete ends the chat. The
 * board task also shows as a T3 issue link on the thread, mirrored both ways.
 *
 * @module board/BoardReactor
 */
import type { BoardChat } from "@t3tools/board-core";
import type {
  OrchestrationV2DomainEvent,
  RunId,
  ThreadId,
  ThreadIssueLink,
} from "@t3tools/contracts";
import {
  BOARD_HOST,
  BOARD_KIND,
  boardTaskUrl,
} from "@t3tools/issue-tracker-board/shared/boardIssue";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadIssueService from "../orchestration-v2/ThreadIssueService.ts";
import { forkParked } from "../serverActivation.ts";
import * as BoardChats from "./BoardChats.ts";
import { checksOf } from "./boardChecks.ts";

export class BoardReactor extends Context.Service<
  BoardReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/board/BoardReactor") {}

// A thread carries its task in hand and this many tasks it ticked a step on, the latest first.
const WORKED_SHOWN = 5;
const SETTLED = new Set(["completed", "failed", "interrupted", "cancelled", "rolled_back"]);
// The board app shows a chat offline after 2.5 minutes without a heartbeat.
const HEARTBEAT = "60 seconds";

export const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const chats = yield* BoardChats.BoardChats;
  const issues = yield* ThreadIssueService.ThreadIssueService;
  // The board tasks each thread's issue links were last set to, so an issue removed in T3 can be
  // told apart from one never mirrored (after a restart this starts empty).
  const mirrored = new Map<ThreadId, ReadonlySet<string>>();
  // run.updated repeats a status; each run starts and settles on the board once.
  const started = new Map<ThreadId, RunId>();
  const settled = new Map<ThreadId, RunId>();

  const chatOf = (threadId: ThreadId) => chats.forThread(threadId);

  const busyNow = (threadId: ThreadId) =>
    engine
      .getThreadShell(threadId)
      .pipe(Effect.map((shell) => shell !== null && BoardChats.threadBusy(shell)));

  const boardIssuesOf = (links: ReadonlyArray<ThreadIssueLink> | undefined, boardId: string) =>
    (links ?? []).filter(
      (link) =>
        link.tracker === BOARD_KIND &&
        link.host.toLowerCase() === BOARD_HOST &&
        link.scope === boardId,
    );

  // Board → thread: the thread's board issue links become its linked task (the one in hand) and
  // the tasks it ticked a step on. The URL carries which is which, so a relink rewrites it.
  const mirrorToThread = Effect.fn("BoardReactor.mirrorToThread")(function* (
    threadId: ThreadId,
    chat: BoardChat,
  ) {
    const boardId = chat.board?.id;
    if (boardId === undefined) return;
    const taskId = chat.sess?.taskId ?? null;
    const shell = yield* engine.getThreadShell(threadId);
    if (shell === null) return;
    const inHand =
      taskId === null ? null : yield* Effect.promise(() => chat.store.loadTask(boardId, taskId));
    const worked = yield* Effect.promise(() => chat.workedOn());
    const wanted = [...(inHand === null ? [] : [inHand]), ...worked.slice(0, WORKED_SHOWN)].map(
      (task) => ({
        task,
        url: boardTaskUrl(boardId, task.id, {
          level: task.level === 2 || task.level === 3 ? task.level : 1,
          inHand: task === inHand,
        }),
      }),
    );
    const linked = boardIssuesOf(shell.issues, boardId);
    const current = (link: ThreadIssueLink) =>
      wanted.some(({ task, url }) => task.id === link.key && url === link.url);
    for (const link of linked) {
      if (!current(link)) yield* issues.unlink({ threadId, key: link });
    }
    for (const { task, url } of wanted) {
      if (linked.some((link) => link.key === task.id && link.url === url)) continue;
      yield* issues.link({
        threadId,
        ref: {
          projectId: shell.projectId,
          tracker: BOARD_KIND,
          host: BOARD_HOST,
          scope: boardId,
          key: task.id,
        },
        url,
        displayKey: task.id,
        title: task.title,
        source: "agent",
      });
    }
    mirrored.set(threadId, new Set(wanted.map(({ task }) => task.id)));
  });

  // Thread → board: a board task linked or unlinked in T3's issue UI moves the board record.
  const mirrorFromThread = Effect.fn("BoardReactor.mirrorFromThread")(function* (
    threadId: ThreadId,
    links: ReadonlyArray<ThreadIssueLink> | undefined,
  ) {
    const chat = yield* chatOf(threadId);
    const boardId = chat.board?.id;
    if (boardId === undefined) return;
    // The thread as it is now: an event from this reactor's own relink carries a half-way list.
    const shell = yield* engine.getThreadShell(threadId);
    const keys = boardIssuesOf(shell?.issues ?? links, boardId).map((link) => link.key);
    const taskId = chat.sess?.taskId ?? null;
    const worked = (yield* Effect.promise(() => chat.workedOn())).map((task) => task.id);
    const requested = keys.filter((key) => key !== taskId && !worked.includes(key));
    const [next] = requested;
    if (requested.length === 1 && next !== undefined) {
      yield* Effect.promise(() => chat.linkTask({ taskId: next }));
      yield* mirrorToThread(threadId, chat);
      return;
    }
    // Only what this server put on the thread and the person then removed.
    const removed = [...(mirrored.get(threadId) ?? [])].filter((key) => !keys.includes(key));
    if (removed.length === 0) return;
    for (const key of removed) {
      if (key === taskId) yield* Effect.promise(() => chat.unlink());
      else yield* Effect.promise(() => chat.dropWorked(key));
    }
    yield* mirrorToThread(threadId, chat);
  });

  const handle: BoardReactor["Service"]["handle"] = Effect.fn("BoardReactor.handle")(
    function* (event) {
      switch (event.type) {
        case "run.updated": {
          const run = event.payload;
          if (run.status === "running" && started.get(run.threadId) !== run.id) {
            started.set(run.threadId, run.id);
            const prompts = yield* projections.getMessagesById(run.threadId, [run.userMessageId]);
            const prompt = prompts.get(run.userMessageId);
            const chat = yield* chatOf(run.threadId);
            // Wakes (the server's, a provider's buffered one) aren't the work's brief; people,
            // the CLI and delegating agents' are.
            const wake =
              prompt?.creationSource === "server" || prompt?.creationSource === "provider";
            yield* Effect.promise(() => chat.turnStart(wake ? "" : (prompt?.text ?? "")));
            yield* mirrorToThread(run.threadId, chat);
            return;
          }
          if (SETTLED.has(run.status) && settled.get(run.threadId) !== run.id) {
            settled.set(run.threadId, run.id);
            const { messages } = yield* projections.getThreadRecords(run.threadId, ["messages"], {
              messageRunIds: [run.id],
              messageRoles: ["assistant"],
            });
            // Only a finished run's answer says what was done.
            const answer =
              run.status === "completed"
                ? (messages.filter((message) => !message.streaming).at(-1)?.text ?? "")
                : "";
            const chat = yield* chatOf(run.threadId);
            // A newer run may already be going, or this one waits on background work.
            const busy = yield* busyNow(run.threadId);
            yield* Effect.promise(() => chat.turnComplete(answer, busy));
            // The agent may have linked or relinked the thread during the run.
            yield* mirrorToThread(run.threadId, chat);
          }
          return;
        }
        case "checkpoint.captured": {
          const { runId, ref, status, files } = event.payload;
          if (runId == null && files.length === 0) return;
          const chat = yield* chatOf(event.threadId);
          if (runId != null)
            yield* Effect.promise(() =>
              chat.attachCheckpoint(runId, status === "ready" ? ref : null),
            );
          yield* Effect.promise(() => chat.filesChanged(files.map((file) => file.path)));
          for (const file of files) {
            yield* Effect.promise(() => chat.fileChanged(file.path));
          }
          return;
        }
        case "turn-item.updated": {
          const item = event.payload;
          if (item.runId === null) return;
          if (item.type === "file_change") {
            // The checkpoint lists a turn's files after it ends: too late for a task finished in it.
            const chat = yield* chatOf(event.threadId);
            const files = [item.fileName, ...(item.changes ?? []).map((change) => change.path)];
            yield* Effect.promise(() => chat.filesChanged(files));
            return;
          }
          if (item.type !== "command_execution") return;
          const { completedAt } = item;
          if (completedAt === null) return;
          const checks = checksOf(item);
          if (checks.length === 0) return;
          const chat = yield* chatOf(event.threadId);
          for (const [index, check] of checks.entries()) {
            yield* Effect.promise(() =>
              chat.recordCheck({
                id: index === 0 ? item.id : `${item.id}:${index}`,
                ...check,
                at: DateTime.toEpochMillis(completedAt),
              }),
            );
          }
          return;
        }
        // Background work ending with no wake is the only sign that the chat is done.
        case "provider-thread.updated":
        case "run.background-work-cancelled": {
          const chat = yield* chatOf(event.threadId);
          if (chat.sess?.status !== "working") return;
          const busy = yield* busyNow(event.threadId);
          yield* Effect.promise(() => chat.setLive(busy));
          return;
        }
        case "thread.issue-synced": {
          yield* mirrorFromThread(event.threadId, event.payload.issues);
          return;
        }
        case "thread.archived":
        case "thread.deleted": {
          started.delete(event.threadId);
          settled.delete(event.threadId);
          mirrored.delete(event.threadId);
          const chat = yield* chatOf(event.threadId);
          yield* Effect.promise(() => chat.end());
          return;
        }
        default:
          return;
      }
    },
    // The board is a side record: a failure is logged and never reaches orchestration.
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("updating the Project Board failed", {
            threadId: event.threadId,
            type: event.type,
            cause,
          }),
        ),
      ),
  );

  const start: BoardReactor["Service"]["start"] = Effect.fn("BoardReactor.start")(function* () {
    const threads = yield* KeyedLock.makeRunner<ThreadId>();
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        threads.run(event.threadId, handle(event)),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Project Board event stream failed", { cause }),
        ),
      ),
    );
    yield* forkParked(chats.heartbeat.pipe(Effect.repeat(Schedule.spaced(HEARTBEAT))));
  });

  return BoardReactor.of({ start, handle });
});

export const layer = Layer.effect(BoardReactor, make).pipe(Layer.provide(BoardChats.layer));
