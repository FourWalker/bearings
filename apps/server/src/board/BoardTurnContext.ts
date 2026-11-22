/**
 * The Project Board's context for a thread's next turn, whatever its provider: board placement,
 * the linked task's plan and handoff, Board Mode and the board's project rules. Sent inline ahead
 * of the user's words, and only when it changed since the thread last saw it.
 *
 * @module board/BoardTurnContext
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as BoardChats from "./BoardChats.ts";

export interface BoardTurnContextText {
  /** The block to put ahead of the user's message; "" when there is nothing new to send. */
  readonly text: string;
  /** Records the text as seen by the thread. Call once the provider accepted the turn. */
  readonly sent: Effect.Effect<void>;
}

export class BoardTurnContext extends Context.Service<
  BoardTurnContext,
  {
    /** `fresh`: the provider's native thread has no turns yet, so it has seen nothing. */
    readonly forTurn: (input: {
      readonly threadId: ThreadId;
      readonly fresh: boolean;
    }) => Effect.Effect<BoardTurnContextText>;
    /** The thread lost its context (compaction): send the board context again next turn. */
    readonly forget: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/board/BoardTurnContext") {}

export const NONE: BoardTurnContextText = { text: "", sent: Effect.void };

const wrap = (context: string): string => `<project_board>\n${context}\n</project_board>`;

export const make = Effect.fn("BoardTurnContext.make")(function* () {
  const chats = yield* BoardChats.BoardChats;
  const lastSent = new Map<ThreadId, string>();

  const forTurn = Effect.fn("BoardTurnContext.forTurn")(
    function* (input: { readonly threadId: ThreadId; readonly fresh: boolean }) {
      const chat = yield* chats.forThread(input.threadId);
      // Plans, handoffs and links can change between turns (other threads, the board app).
      yield* Effect.promise(() => chat.rebuildContext());
      const context = chat.context.trim();
      if (context === "") return NONE;
      if (!input.fresh && lastSent.get(input.threadId) === context) return NONE;
      return {
        text: wrap(context),
        sent: Effect.sync(() => void lastSent.set(input.threadId, context)),
      } satisfies BoardTurnContextText;
    },
    // The board must never stop a turn: on any failure the turn goes ahead without it.
    (effect, input) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Project Board context unavailable for this turn", {
            threadId: input.threadId,
            cause,
          }).pipe(Effect.as(NONE)),
        ),
      ),
  );

  const forget = Effect.fn("BoardTurnContext.forget")(function* (threadId: ThreadId) {
    yield* Effect.sync(() => lastSent.delete(threadId));
  });

  return BoardTurnContext.of({ forTurn, forget });
});

export const layer = Layer.effect(BoardTurnContext, make()).pipe(Layer.provide(BoardChats.layer));
