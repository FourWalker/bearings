/**
 * Reads the Project Board for clients: its boards, and one board's tasks and chats. A T3 thread's
 * status and title come from this server's own thread, not from the board's heartbeat, so a thread
 * nobody has used since a restart shows idle, not offline.
 *
 * @module board/BoardService
 */
import {
  type BoardChat as BoardChatRow,
  BoardReadError,
  type BoardSummary,
  type BoardView,
  ThreadId,
} from "@t3tools/contracts";
import { BoardStore, readBoardSummaries, readBoardView } from "@t3tools/board-core";
import { defaultBoardHome, nodeIO } from "@t3tools/board-core/node";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

export class BoardService extends Context.Service<
  BoardService,
  {
    readonly list: Effect.Effect<ReadonlyArray<BoardSummary>, BoardReadError>;
    readonly view: (input: {
      readonly boardId: string;
    }) => Effect.Effect<BoardView, BoardReadError>;
  }
>()("t3/board/BoardService") {}

const failed = (cause: unknown) =>
  new BoardReadError({ reason: "failed", detail: `The board could not be read: ${String(cause)}` });

export const make = Effect.fn("BoardService.make")(function* (store: BoardStore) {
  const threads = yield* ThreadManagementService.ThreadManagementService;

  // A board record can name a thread this server doesn't hold (another T3 install on the machine).
  const withThread = Effect.fn("BoardService.withThread")(function* (chat: BoardChatRow) {
    if (chat.threadId === null) return chat;
    const shell = yield* threads
      .getThreadShell(chat.threadId)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (shell === null) return { ...chat, threadId: null };
    return {
      ...chat,
      title: shell.title || chat.title,
      live:
        shell.archivedAt !== null || chat.live === "ended"
          ? ("ended" as const)
          : shell.activeRunId !== null
            ? ("working" as const)
            : ("idle" as const),
    };
  });

  const list = Effect.tryPromise({ try: () => readBoardSummaries(store), catch: failed }).pipe(
    Effect.withSpan("BoardService.list"),
  );

  const view = Effect.fn("BoardService.view")(function* (input: { readonly boardId: string }) {
    const now = yield* Clock.currentTimeMillis;
    const raw = yield* Effect.tryPromise({
      try: () => readBoardView(store, input.boardId, now),
      catch: failed,
    });
    if (raw === null) {
      return yield* new BoardReadError({ reason: "not-found", detail: "No such board." });
    }
    const resolve = (chats: ReadonlyArray<(typeof raw.unlinked)[number]>) =>
      Effect.forEach(
        chats,
        (chat) =>
          withThread({
            ...chat,
            threadId: chat.threadId === null ? null : ThreadId.make(chat.threadId),
          }),
        { concurrency: 8 },
      );
    const tasks = yield* Effect.forEach(raw.tasks, (task) =>
      resolve(task.chats).pipe(Effect.map((chats) => ({ ...task, chats }))),
    );
    // Only open chats: a T3 thread is open whenever this server holds it, whatever its heartbeat.
    const unlinked = (yield* resolve(raw.unlinked)).filter(
      (chat) => chat.live === "working" || chat.live === "idle",
    );
    return { ...raw, tasks, unlinked } satisfies BoardView;
  });

  return BoardService.of({ list, view });
});

export const layer = Layer.effect(
  BoardService,
  Effect.suspend(() => make(new BoardStore(defaultBoardHome(), nodeIO))),
);
