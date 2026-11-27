import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { BoardChat, EnvironmentId } from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "~/components/Sidebar.logic";

import type { BoardAttention, BoardChatAttention } from "./board.logic";

type ThreadStatus = Parameters<typeof resolveSidebarRowStatus>[0];

/**
 * Project Board fork: what a thread wants from the person, read exactly as the sidebar reads it,
 * so a note and the thread's sidebar row never disagree.
 */
function chatAttentionOf(thread: ThreadStatus): BoardChatAttention | null {
  const status = resolveSidebarRowStatus(thread);
  if (status === "approval") return { kind: "needs", why: "approval" };
  // A guest waiting on the owner is a question to the person too.
  if (status === "input" || status === "request") return { kind: "needs", why: "question" };
  if (status === "failed" || status === "limited") return { kind: "stopped" };
  const completedAt = thread.latestRun?.completedAt;
  if (status === "ready" && completedAt != null && hasUnseenCompletion(thread))
    return { kind: "finished", at: Date.parse(completedAt) };
  return null;
}

/** A thread sitting on background work it started, or on another thread: not done, not busy. */
export const isThreadWaiting = (thread: ThreadStatus): boolean =>
  resolveSidebarRowStatus(thread) === "waiting";

/** The board's chats that want something, by session id. Chats the app holds no thread for say nothing. */
export function boardAttentionOf(
  environmentId: EnvironmentId,
  chats: ReadonlyArray<BoardChat>,
  threads: ReadonlyArray<
    ThreadStatus & {
      readonly environmentId: EnvironmentId;
      readonly id: string;
      readonly lastVisitedAt?: string | null | undefined;
    }
  >,
  localVisits: Readonly<Record<string, string | undefined>>,
): BoardAttention {
  const byId = new Map(
    threads.flatMap((thread) =>
      thread.environmentId === environmentId ? [[thread.id, thread] as const] : [],
    ),
  );
  const out = new Map<string, BoardChatAttention>();
  for (const chat of chats) {
    const thread = chat.threadId === null ? undefined : byId.get(chat.threadId);
    if (thread === undefined) continue;
    const attention = chatAttentionOf({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localVisits[scopedThreadKey(scopeThreadRef(environmentId, chat.threadId!))],
      ),
    });
    if (attention !== null) out.set(chat.sessionId, attention);
  }
  return out;
}
