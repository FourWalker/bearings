import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * Project Board fork: the boards on an environment's machine, and one board's tasks and chats.
 * Threads change a board while they work, so the open board refreshes on its own.
 */
export function createBoardEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // A person's edits to one board apply in order.
  const editScheduler = createAtomCommandScheduler();
  const serialPerBoard = {
    mode: "serial" as const,
    key: ({
      environmentId,
      input,
    }: {
      readonly environmentId: string;
      readonly input: { readonly boardId: string };
    }) => `${environmentId}\u0000${input.boardId}`,
  };
  return {
    boards: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:list",
      tag: WS_METHODS.boardList,
    }),
    unassigned: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:unassigned",
      tag: WS_METHODS.boardUnassigned,
      refreshIntervalMs: 10_000,
    }),
    view: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:view",
      tag: WS_METHODS.boardView,
      refreshIntervalMs: 10_000,
    }),
    /** One task's plan, handoff and decisions, read while its task view is open. */
    taskDetail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:task-detail",
      tag: WS_METHODS.boardTaskDetail,
      refreshIntervalMs: 10_000,
    }),
    /** One change to a task; the open board and task view refresh once it's saved. */
    editTask: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:edit-task",
      tag: WS_METHODS.boardEditTask,
      scheduler: editScheduler,
      concurrency: serialPerBoard,
    }),
    createTask: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:create-task",
      tag: WS_METHODS.boardCreateTask,
      scheduler: editScheduler,
      concurrency: serialPerBoard,
    }),
    /** A board's settings, read while ⚙ is open. */
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:board:settings",
      tag: WS_METHODS.boardSettings,
    }),
    archivedThreads: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:archived-threads",
      tag: WS_METHODS.boardArchivedThreads,
    }),
    openFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:open-file",
      tag: WS_METHODS.boardOpenFile,
    }),
    exportFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:export-file",
      tag: WS_METHODS.boardExportFile,
    }),
    editBoard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:edit-board",
      tag: WS_METHODS.boardEditBoard,
      scheduler: editScheduler,
      concurrency: serialPerBoard,
    }),
    /** What the server asks this window to show; every one must arrive. */
    intents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:board:intents",
      tag: WS_METHODS.boardSubscribeIntents,
      transform: (stream) => stream.pipe(Stream.rechunk(1)),
    }),
    ackIntent: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:ack-intent",
      tag: WS_METHODS.boardAckIntent,
    }),
    /** Puts a new thread on a task before its first turn. */
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:board:link-thread",
      tag: WS_METHODS.boardLinkThread,
      scheduler: createAtomCommandScheduler(),
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
      },
    }),
  };
}
