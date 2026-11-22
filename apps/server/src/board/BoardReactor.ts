/**
 * Keeps each thread's board record current from committed orchestration events, whatever its
 * provider: working and idle from its runs, the run's answer as the task's last action, service
 * tags from the files its checkpoints changed, and ended when the thread is archived or deleted.
 *
 * @module board/BoardReactor
 */
import type { OrchestrationV2DomainEvent, RunId, ThreadId } from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as BoardChats from "./BoardChats.ts";

export class BoardReactor extends Context.Service<
  BoardReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/board/BoardReactor") {}

const SETTLED = new Set(["completed", "failed", "interrupted", "cancelled", "rolled_back"]);
// The board app shows a chat offline after 2.5 minutes without a heartbeat.
const HEARTBEAT = "60 seconds";

export const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const chats = yield* BoardChats.BoardChats;
  // run.updated repeats a status; each run starts and settles on the board once.
  const started = new Map<ThreadId, RunId>();
  const settled = new Map<ThreadId, RunId>();

  const chatOf = (threadId: ThreadId) => chats.forThread(threadId);

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
            // Wakes and agent-sent messages aren't the person's words.
            yield* Effect.promise(() =>
              chat.turnStart(prompt?.createdBy === "user" ? prompt.text : ""),
            );
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
            yield* Effect.promise(() => chat.turnComplete(answer));
          }
          return;
        }
        case "checkpoint.captured": {
          if (event.payload.files.length === 0) return;
          const chat = yield* chatOf(event.threadId);
          for (const file of event.payload.files) {
            yield* Effect.promise(() => chat.fileChanged(file.path));
          }
          return;
        }
        case "thread.archived":
        case "thread.deleted": {
          started.delete(event.threadId);
          settled.delete(event.threadId);
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
