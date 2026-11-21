import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as BoardChats from "../../../board/BoardChats.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { BoardToolkit } from "./tools.ts";

/** Runs a board tool as the calling thread's own chat on its board. */
const run = (name: string) => (params: Record<string, unknown>) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const caller = yield* McpInvocationContext.requireThreadScope(scope, "The board tools");
    const chats = yield* BoardChats.BoardChats;
    const chat = yield* chats.forThread(caller.thread.threadId);
    const reply = yield* Effect.tryPromise({
      try: () => chat.runTool(name, params) ?? Promise.resolve(null),
      catch: () =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: `${name} could not read or write the board folder.`,
        }),
    });
    if (reply === null)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `${name} is not a board tool.`,
      });
    return { text: reply.text };
  });

const writes = (name: string) => McpToolAccess.actsAsCaller(run(name));
const reads = (name: string) => McpToolAccess.readsAsCaller(run(name));

const handlers = {
  board_setup: writes("board_setup"),
  board_link: writes("board_link"),
  board_update: writes("board_update"),
  board_plan: writes("board_plan"),
  board_handoff: writes("board_handoff"),
  board_create_task: writes("board_create_task"),
  board_decision: writes("board_decision"),
  board_master_plan: writes("board_master_plan"),
  board_doc: writes("board_doc"),
  board_release: writes("board_release"),
  board_link_task: writes("board_link_task"),
  board_move: writes("board_move"),
  board_find: reads("board_find"),
  board_promote: writes("board_promote"),
  board_checkpoint: writes("board_checkpoint"),
  board_read: reads("board_read"),
} satisfies McpToolAccess.Handlers<typeof BoardToolkit.tools>;

export const layer = McpToolAccess.toLayer(BoardToolkit, handlers);
