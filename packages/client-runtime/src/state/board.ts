import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * Project Board fork: the boards on an environment's machine, and one board's tasks and chats.
 * Threads change a board while they work, so the open board refreshes on its own.
 */
export function createBoardEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    boards: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:list",
      tag: WS_METHODS.boardList,
    }),
    view: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:view",
      tag: WS_METHODS.boardView,
      refreshIntervalMs: 10_000,
    }),
  };
}
