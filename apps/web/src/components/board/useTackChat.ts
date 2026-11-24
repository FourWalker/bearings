import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ProjectId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { newMessageId, newThreadId } from "~/lib/utils";
import { boardEnvironment } from "~/state/board";
import { readThreadShell, useThreadProjection, useThreadShell } from "~/state/entities";
import { formatEnvironmentQueryError } from "~/state/query";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { assistantBubbles, isAssistantBusy } from "./board.logic";
import { boardThreadModelSelection } from "./boardThread";
import { tackMood, tackNoteCount } from "./tackAvatar.logic";

/** How long after the last keystroke Tack still counts as being typed to. */
const TYPING_LINGER_MS = 800;

const AssistantState = Schema.Struct({
  threadId: Schema.NullOr(Schema.String),
  view: Schema.Literals(["closed", "open", "expanded"]),
});
const CLOSED: typeof AssistantState.Type = { threadId: null, view: "closed" };
export type TackView = (typeof AssistantState.Type)["view"];

export interface TackChatProps {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly boardName: string;
  /** A T3 project in one of the board's workspaces: where the Assistant's thread lives. */
  readonly projectId: ProjectId;
}

/**
 * Project Board fork: Tack's conversation, shared by every way Tack can sit on the board. It is a
 * real thread marked as the Assistant, so its history is kept and it can open as a full thread.
 */
export function useTackChat(
  props: TackChatProps,
  options: {
    readonly follow: boolean;
    /** Tack on the board sleeps until called, whatever view was stored the last time. */
    readonly asleep?: boolean;
  },
) {
  const gt = useGT();
  const { environmentId, boardId, projectId } = props;
  const [state, setState] = useLocalStorage(
    `t3.board.assistant:${environmentId}:${boardId}`,
    CLOSED,
    AssistantState,
  );
  const [draft, setDraftValue] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [failed, setFailed] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const canAsk = useAtomValue(boardEnvironment.linkThread.permissionAtom(environmentId));
  const linkThread = useAtomCommand(boardEnvironment.linkThread, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const threadRef =
    state.threadId === null ? null : scopeThreadRef(environmentId, ThreadId.make(state.threadId));
  const shell = useThreadShell(threadRef);
  // The thread's messages are followed only while Tack is talking or its history is shown.
  const view: TackView = options.asleep === true ? "closed" : state.view;
  const open = view !== "closed";
  const thread = useThreadProjection(open || options.follow ? threadRef : null);
  const bubbles = assistantBubbles(thread?.projection.messages ?? []);
  const busy = sending || isAssistantBusy(shell?.runtime?.status);
  const waiting = shell?.hasPendingApprovals === true || shell?.hasPendingUserInput === true;
  const mood = tackMood({ open, busy, waiting, typing, failed });
  const notes = tackNoteCount(thread?.projection.turnItems ?? []);

  const fail = (description: string) => {
    setFailed(true);
    toastManager.add({
      type: "error",
      title: gt("Could not start the Board Assistant"),
      description,
    });
  };
  const setDraft = (value: string) => {
    setDraftValue(value);
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), TYPING_LINGER_MS);
  };
  const setView = (next: TackView) => setState((previous) => ({ ...previous, view: next }));
  const reset = () => setState((previous) => ({ ...previous, threadId: null }));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setFailed(false);
    setTyping(false);
    setDraftValue("");
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
            runtimeMode: existing.runtimeMode,
            interactionMode: existing.interactionMode,
            createdAt,
          },
        });
        if (result._tag === "Failure") fail(gt("The message could not be sent."));
        return;
      }
      const modelSelection = boardThreadModelSelection(environmentId, projectId);
      if (modelSelection === null) {
        fail(gt("No model is set up for this project."));
        return;
      }
      const threadId = newThreadId();
      // Marked as the Assistant before its first turn, so that turn already gets its rules.
      const linked = await linkThread({
        environmentId,
        input: { boardId, taskId: null, threadId, projectId },
      });
      if (linked._tag === "Failure") {
        fail(formatEnvironmentQueryError(linked.cause));
        return;
      }
      // Supervised: the Assistant answers and shows; it is not there to change code.
      const modes = { runtimeMode: "approval-required", interactionMode: "default" } as const;
      const title = gt("Tack · {board}", { board: props.boardName });
      const result = await startTurn({
        environmentId,
        input: {
          threadId,
          message: turn,
          modelSelection,
          ...modes,
          bootstrap: {
            createThread: {
              projectId,
              title,
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
      setState((previous) => ({ ...previous, threadId }));
    } finally {
      setSending(false);
    }
  };

  return {
    canAsk,
    view,
    setView,
    /** The thread's messages have arrived (or there is no thread yet). */
    loaded: threadRef === null || thread !== null,
    reset,
    threadRef,
    bubbles,
    busy,
    waiting,
    sending,
    mood,
    notes,
    draft,
    setDraft,
    send,
  };
}

export type TackChat = ReturnType<typeof useTackChat>;
