import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { boardTaskUrl } from "@t3tools/issue-tracker-board/shared/boardIssue";
import * as Effect from "effect/Effect";

import * as BoardChats from "../../../board/BoardChats.ts";
import * as BoardIntents from "../../../board/BoardIntents.ts";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
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
    const threads = yield* ThreadManagementService;
    const t3RunId =
      name === "board_handoff" || name === "board_checkpoint"
        ? ((yield* threads
            .getThreadShell(caller.thread.threadId)
            .pipe(Effect.catchCause(() => Effect.succeed(null))))?.activeRunId ?? undefined)
        : undefined;
    const reply = yield* Effect.tryPromise({
      try: () => chat.runTool(name, params, { t3RunId }) ?? Promise.resolve(null),
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

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/** Asks the person's open window to show something; a link is the answer when none is open. */
const show = Effect.fn("BoardHandlers.show")(function* (params: {
  readonly action: "open" | "back" | "draft";
  readonly taskId?: string;
  readonly view?: "tree" | "1" | "2" | "3" | "svc" | "register";
  readonly filter?: "active" | "paused" | "done" | "all";
  readonly threadId?: string;
  readonly text?: string;
}) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const caller = yield* McpInvocationContext.requireThreadScope(scope, "The board tools");
  const chat = yield* (yield* BoardChats.BoardChats).forThread(caller.thread.threadId);
  const intents = yield* BoardIntents.BoardIntents;
  const boardId = chat.board?.id;
  if (boardId === undefined) return yield* invalid("This thread's folder is not on a board.");
  let link = boardTaskUrl(boardId, params.taskId ?? "");
  let what = "the board";
  let command: Parameters<typeof intents.send>[0];
  if (params.action === "back") {
    command = { type: "view.back" };
    what = "the page before";
  } else if (params.action === "draft") {
    if (!params.threadId || !params.text?.trim())
      return yield* invalid("draft needs threadId and text.");
    command = { type: "thread.draftPrompt", threadId: params.threadId, text: params.text };
    what = "the draft in that thread's composer";
  } else {
    const taskId = params.taskId;
    if (taskId !== undefined) {
      const task = yield* Effect.promise(() =>
        chat.store.loadTask(boardId, taskId).catch(() => null),
      );
      // A guess must not navigate: only an id the board knows opens anything.
      if (task === null)
        return yield* invalid(`No task "${taskId}" on this board. Find its id with board_find.`);
      link = boardTaskUrl(boardId, task.id);
      what = `"${task.title}"`;
    }
    command = {
      type: "board.open",
      boardId,
      ...(taskId === undefined ? {} : { taskId }),
      ...(params.view === undefined ? {} : { view: params.view }),
      ...(params.filter === undefined ? {} : { filter: params.filter }),
    };
  }
  const result = yield* intents.send(command);
  if (result.shown) return { text: `→ showed ${what} in the person's window.` };
  return {
    text:
      result.reason === "answered"
        ? `The window could not show ${what}${result.detail ? `: ${result.detail}` : ""}.`
        : `No T3 window answered, so nothing was shown. Give the person this link instead: ${link}`,
  };
});

const writes = (name: string) => McpToolAccess.actsAsCaller(run(name));
const reads = (name: string) => McpToolAccess.readsAsCaller(run(name));

const handlers = {
  board_show: McpToolAccess.readsAsCaller(show),
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
  board_goal: writes("board_goal"),
  board_promote: writes("board_promote"),
  board_checkpoint: writes("board_checkpoint"),
  board_read: reads("board_read"),
} satisfies McpToolAccess.Handlers<typeof BoardToolkit.tools>;

export const layer = McpToolAccess.toLayer(BoardToolkit, handlers);
