/**
 * Project Board fork: asks the person's open T3 window to show something on the board. An intent
 * only navigates or pre-fills a composer; it never writes board data.
 *
 * @module BoardIntents
 */
import type {
  BoardIntent,
  BoardIntentAck,
  BoardIntentCommand,
  ClientActivityLease,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Random from "effect/Random";
import * as Stream from "effect/Stream";

import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";

export type BoardIntentResult =
  /** No window is open to show it in: the caller gives a link instead. */
  | { readonly shown: false; readonly reason: "no-client" | "no-answer" }
  | { readonly shown: boolean; readonly reason: "answered"; readonly detail?: string | undefined };

export class BoardIntents extends Context.Service<
  BoardIntents,
  {
    /** Sends one command to the window the person is using, and waits for it to answer. */
    readonly send: (command: BoardIntentCommand) => Effect.Effect<BoardIntentResult>;
    readonly forClient: (clientId: string) => Stream.Stream<BoardIntent>;
    readonly acknowledge: (ack: BoardIntentAck) => Effect.Effect<void>;
  }
>()("t3/board/BoardIntents") {}

// An intent the window hasn't answered by then was not seen: the caller must not claim it was.
const ANSWER_WITHIN = "5 seconds";

/** The window the person is looking at: focused first, then the one they used last. */
function activeClient(leases: ReadonlyArray<ClientActivityLease>): string | null {
  const rank = (lease: ClientActivityLease) =>
    (lease.focused ? 2 : 0) + (lease.recentlyInteracted ? 1 : 0);
  const [best] = leases
    .filter(
      (lease) =>
        lease.visible && (lease.clientKind === "web" || lease.clientKind === "desktop-renderer"),
    )
    .toSorted(
      (a, b) =>
        rank(b) - rank(a) ||
        DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt),
    );
  return best?.clientId ?? null;
}

const make = Effect.gen(function* () {
  const policy = yield* BackgroundPolicy;
  const intents = yield* PubSub.unbounded<BoardIntent>();
  const waiting = new Map<string, Deferred.Deferred<BoardIntentAck>>();

  const send: BoardIntents["Service"]["send"] = Effect.fn("BoardIntents.send")(function* (command) {
    const clientId = activeClient((yield* policy.snapshot).leases);
    if (clientId === null) return { shown: false, reason: "no-client" };
    const id = `intent-${yield* Random.nextIntBetween(0, 2 ** 31)}`;
    const answer = yield* Deferred.make<BoardIntentAck>();
    waiting.set(id, answer);
    yield* PubSub.publish(intents, { id, clientId, command });
    const ack = yield* Deferred.await(answer).pipe(
      Effect.timeoutOption(ANSWER_WITHIN),
      Effect.ensuring(Effect.sync(() => waiting.delete(id))),
    );
    return Option.match(ack, {
      onNone: () => ({ shown: false, reason: "no-answer" }) as const,
      onSome: ({ ok, detail }) => ({ shown: ok, reason: "answered", detail }) as const,
    });
  });

  const acknowledge: BoardIntents["Service"]["acknowledge"] = Effect.fn("BoardIntents.acknowledge")(
    function* (ack) {
      const answer = waiting.get(ack.id);
      if (answer) yield* Deferred.succeed(answer, ack);
    },
  );

  return BoardIntents.of({
    send,
    forClient: (clientId) =>
      Stream.fromPubSub(intents).pipe(Stream.filter((intent) => intent.clientId === clientId)),
    acknowledge,
  });
});

export const layer = Layer.effect(BoardIntents, make);
