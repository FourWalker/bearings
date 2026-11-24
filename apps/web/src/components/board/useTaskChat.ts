import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  BoardTask,
  EnvironmentId,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { newMessageId, newThreadId } from "~/lib/utils";
import { boardEnvironment } from "~/state/board";
import { readThreadShell, useThreadProjection, useThreadShell } from "~/state/entities";
import { formatEnvironmentQueryError } from "~/state/query";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { type BoardContinueTarget, assistantBubbles, isAssistantBusy } from "./board.logic";
import { boardThreadModelSelection, boardThreadRunMode } from "./boardThread";
import { tackMood } from "./tackAvatar.logic";

export const TASK_TACK_SIZES = ["line", "panel"] as const;
export type TaskTackSize = (typeof TASK_TACK_SIZES)[number];
const SizeSchema = Schema.Literals(TASK_TACK_SIZES);

/** How much room Tack takes in an open task, on this device. */
export function useTaskTackSize() {
  return useLocalStorage<TaskTackSize, TaskTackSize>("t3.board.task.tack.size", "line", SizeSchema);
}

/** Ask: Tack answers and changes nothing without approval. Run: the agent works on the task. */
export type TaskChatHow = "ask" | "run";

/**
 * Project Board fork: Tack's chat inside an open task. Every chat is a thread on that task: the
 * first message of a new chat creates one in the task's workspace and puts it on the task before
 * its first turn, as "Continue in new thread" does, so that turn carries the plan and handoff.
 */
export function useTaskChat(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly task: Pick<BoardTask, "id" | "title">;
  /** The thread loaded in Tack; null is a new chat with no thread yet. */
  readonly threadId: ThreadId | null;
  readonly onThread: (threadId: ThreadId) => void;
  /** Where a new chat's thread may start. */
  readonly targets: ReadonlyArray<BoardContinueTarget>;
}) {
  const gt = useGT();
  const { environmentId, boardId, task, targets } = props;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [how, setHow] = useState<TaskChatHow>("ask");
  const [targetAt, setTargetAt] = useState(0);
  const linkThread = useAtomCommand(boardEnvironment.linkThread, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const threadRef = props.threadId === null ? null : scopeThreadRef(environmentId, props.threadId);
  const shell = useThreadShell(threadRef);
  // Followed only while it is the thread loaded in Tack.
  const thread = useThreadProjection(threadRef);
  const bubbles = assistantBubbles(thread?.projection.messages ?? []);
  const busy = sending || isAssistantBusy(shell?.runtime?.status);
  const waiting = shell?.hasPendingApprovals === true || shell?.hasPendingUserInput === true;
  const target = targets[targetAt] ?? targets[0] ?? null;

  const fail = (description: string) => {
    setFailed(true);
    toastManager.add({ type: "error", title: gt("Tack could not send that"), description });
  };
  // A thread the person already let work keeps that; one that only ever asked gets the project's.
  const runMode = (projectId: ProjectId, current?: RuntimeMode): RuntimeMode =>
    current !== undefined && current !== "approval-required"
      ? current
      : boardThreadRunMode(environmentId, projectId);

  const send = async (
    text: string,
    options: {
      readonly as?: TaskChatHow;
      readonly title?: string;
      readonly into?: BoardContinueTarget;
    } = {},
  ) => {
    const as = options.as ?? how;
    const into = options.into ?? target;
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setFailed(false);
    setDraft("");
    try {
      const createdAt = new Date().toISOString();
      const turn = {
        messageId: newMessageId(),
        role: "user" as const,
        text: message,
        attachments: [],
      };
      const existing = threadRef === null ? null : readThreadShell(threadRef);
      if (threadRef !== null && existing !== null) {
        const result = await startTurn({
          environmentId,
          input: {
            threadId: threadRef.threadId,
            message: turn,
            runtimeMode:
              as === "ask"
                ? "approval-required"
                : runMode(existing.projectId, existing.runtimeMode),
            interactionMode: existing.interactionMode,
            createdAt,
          },
        });
        if (result._tag === "Failure") fail(gt("The message could not be sent."));
        return;
      }
      if (into === null) {
        fail(gt("No workspace of this board can start a thread on this task."));
        return;
      }
      const modelSelection = boardThreadModelSelection(environmentId, into.projectId);
      if (modelSelection === null) {
        fail(gt("No model is set up for this project."));
        return;
      }
      const threadId = newThreadId();
      // On the task before its first turn, so that turn already carries the plan and handoff.
      const linked = await linkThread({
        environmentId,
        input: {
          boardId,
          taskId: task.id,
          threadId,
          projectId: into.projectId,
          override: into.override,
        },
      });
      if (linked._tag === "Failure") {
        fail(formatEnvironmentQueryError(linked.cause));
        return;
      }
      const modes = {
        runtimeMode: as === "ask" ? ("approval-required" as const) : runMode(into.projectId),
        interactionMode: "default" as const,
      };
      const named = options.title ?? message.split("\n", 1)[0]!.slice(0, 80);
      const result = await startTurn({
        environmentId,
        input: {
          threadId,
          message: turn,
          modelSelection,
          ...modes,
          bootstrap: {
            createThread: {
              projectId: into.projectId,
              title: named,
              modelSelection,
              ...modes,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        fail(gt("The message could not be sent."));
        return;
      }
      props.onThread(threadId);
    } finally {
      setSending(false);
    }
  };

  return {
    threadRef,
    title: shell?.title ?? null,
    /** The thread's messages have arrived (or there is no thread yet). */
    loaded: threadRef === null || thread !== null,
    bubbles,
    busy,
    waiting,
    sending,
    mood: tackMood({
      open: threadRef !== null || draft.length > 0,
      busy,
      waiting,
      typing: draft.length > 0 && !busy,
      failed,
    }),
    draft,
    setDraft,
    how,
    setHow,
    target,
    setTarget: (next: BoardContinueTarget) => setTargetAt(Math.max(0, targets.indexOf(next))),
    send,
    /** One click: the agent picks the task up from its handoff. */
    resume: (into?: BoardContinueTarget) =>
      send(gt("Continue this task from its handoff."), {
        as: "run",
        title: gt("Continue · {task}", { task: task.title }),
        ...(into === undefined ? {} : { into }),
      }),
    stop: () =>
      threadRef === null
        ? undefined
        : void interruptTurn({ environmentId, input: { threadId: threadRef.threadId } }),
  };
}

export type TaskChat = ReturnType<typeof useTaskChat>;
