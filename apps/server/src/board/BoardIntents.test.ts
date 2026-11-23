import type { ClientActivityLease } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { expect } from "vite-plus/test";

import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import * as BoardIntents from "./BoardIntents.ts";

const lease = (clientId: string, patch: Partial<ClientActivityLease> = {}) =>
  ({
    clientId,
    clientKind: "web",
    visible: true,
    focused: false,
    recentlyInteracted: false,
    updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
    ...patch,
  }) as ClientActivityLease;

const withLeases = (leases: ReadonlyArray<ClientActivityLease>) =>
  BoardIntents.layer.pipe(
    Layer.provide(Layer.mock(BackgroundPolicy)({ snapshot: Effect.succeed({ leases } as never) })),
  );

it.effect("sends an intent to the window in use and reports only what that window answered", () =>
  Effect.gen(function* () {
    const intents = yield* BoardIntents.BoardIntents;
    const command = { type: "view.back" } as const;
    const seen = yield* intents
      .forClient("desk")
      .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
    const other = yield* intents
      .forClient("phone")
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
    yield* Effect.yieldNow;

    const first = yield* intents.send(command).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    // An answer for some other intent settles nothing.
    yield* intents.acknowledge({ id: "intent-unknown", ok: true });
    const second = yield* intents.send(command).pipe(Effect.forkChild);
    const [a, b] = yield* Fiber.join(seen);
    expect([a?.clientId, b?.clientId]).toEqual(["desk", "desk"]);
    yield* intents.acknowledge({ id: a!.id, ok: false, detail: "No such task." });
    expect(yield* Fiber.join(first)).toEqual({
      shown: false,
      reason: "answered",
      detail: "No such task.",
    });
    // A window that never answers was not shown anything.
    yield* TestClock.adjust("6 seconds");
    expect(yield* Fiber.join(second)).toEqual({ shown: false, reason: "no-answer" });
    yield* Fiber.interrupt(other);
  }).pipe(
    Effect.provide(
      withLeases([
        lease("phone", { visible: false, focused: true }),
        lease("tab"),
        lease("desk", { focused: true }),
      ]),
    ),
  ),
);

it.effect("answers that there is no window when none is visible", () =>
  Effect.gen(function* () {
    const intents = yield* BoardIntents.BoardIntents;
    expect(yield* intents.send({ type: "view.back" })).toEqual({
      shown: false,
      reason: "no-client",
    });
  }).pipe(Effect.provide(withLeases([lease("phone", { visible: false })]))),
);
