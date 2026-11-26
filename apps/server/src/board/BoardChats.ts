/**
 * Each T3 thread as a chat on the Project Board, whatever its provider: placed on the board whose
 * root holds the thread's folder (its worktree, else its project's root), with its own record.
 *
 * @module board/BoardChats
 */
import { BoardChat, BoardStore } from "@t3tools/board-core";
import { defaultBoardHome, nodeGit, nodeIO } from "@t3tools/board-core/node";
import {
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";

export class BoardChats extends Context.Service<
  BoardChats,
  {
    /** The thread's board chat, opened on first use and reopened when its folder moves. */
    readonly forThread: (threadId: ThreadId) => Effect.Effect<BoardChat, OrchestratorMcpFailure>;
    /** Marks every open, not ended chat as alive: the board shows a chat offline without it. */
    readonly heartbeat: Effect.Effect<void>;
  }
>()("t3/board/BoardChats") {}

/** A thread is still at it while a run is live or it waits on background work it started. */
export const threadBusy = (
  shell: Pick<OrchestrationV2ThreadShell, "activityRunStatus" | "pendingBackgroundTasks">,
): boolean =>
  (shell.activityRunStatus ?? null) !== null ||
  backgroundWorkHoldsCompletion(shell.pendingBackgroundTasks ?? []);

const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message });

export const make = Effect.fn("BoardChats.make")(function* (store: BoardStore) {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const open = new Map<ThreadId, { readonly cwd: string; readonly chat: BoardChat }>();

  const forThread = Effect.fn("BoardChats.forThread")(function* (threadId: ThreadId) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => failure("The thread could not be read.")));
    if (shell === null) return yield* failure("The thread was not found.");
    const project = yield* projects
      .getById(shell.projectId)
      .pipe(Effect.mapError(() => failure("The thread's project could not be read.")));
    const projectRoot = Option.getOrUndefined(project)?.workspaceRoot;
    const cwd = shell.worktreePath ?? projectRoot;
    if (cwd === undefined) return yield* failure("The thread has no folder.");
    const known = open.get(threadId);
    if (known !== undefined && known.cwd === cwd) return known.chat;
    const chat = new BoardChat(store, nodeGit);
    yield* Effect.promise(() =>
      chat.open({
        sessionId: threadId,
        cwd,
        projectRoot,
        source: {
          kind: "t3-thread",
          threadId,
          projectId: shell.projectId,
          provider: shell.providerInstanceId,
          model: shell.modelSelection.model,
        },
      }),
    );
    // A chat opens idle; one opened mid-turn (a restart, a move into a worktree) is not.
    if (threadBusy(shell)) yield* Effect.promise(() => chat.setLive(true));
    open.set(threadId, { cwd, chat });
    return chat;
  });

  const heartbeat = Effect.promise(() =>
    Promise.allSettled([...open.values()].map(({ chat }) => chat.heartbeat())),
  ).pipe(Effect.asVoid, Effect.withSpan("BoardChats.heartbeat"));

  return BoardChats.of({ forThread, heartbeat });
});

export const layer = Layer.effect(
  BoardChats,
  Effect.suspend(() => make(new BoardStore(defaultBoardHome(), nodeIO))),
);
