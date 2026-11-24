import { type BoardChat, EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { boardAttentionOf } from "./boardAttention.logic";

const here = EnvironmentId.make("here");
const chat = (sessionId: string, threadId: string | null): BoardChat => ({
  sessionId,
  title: sessionId,
  live: "idle",
  workspaceLabel: "main",
  taskId: null,
  updatedAt: 0,
  threadId: threadId === null ? null : ThreadId.make(threadId),
  provider: null,
  turnStartedAt: 0,
});
const thread = (id: string, environmentId = here) => ({
  environmentId,
  id: ThreadId.make(id),
  hasActionableProposedPlan: false,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  interactionMode: "default" as const,
  lastVisitedAt: "2026-03-09T10:04:00.000Z",
  latestRun: {
    runId: "turn-1" as never,
    status: "completed" as const,
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: "2026-03-09T10:00:00.000Z",
    completedAt: "2026-03-09T10:05:00.000Z",
  },
  runtime: {
    status: "completed" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-03-09T10:05:00.000Z",
  },
});

it("reads what each board chat wants from its thread, and nothing from chats without one", () => {
  const attention = boardAttentionOf(
    here,
    [
      chat("asks", "t-asks"),
      chat("unseen", "t-unseen"),
      chat("seen", "t-seen"),
      chat("broke", "t-broke"),
      chat("elsewhere", "t-elsewhere"),
      chat("terminal", null),
    ],
    [
      { ...thread("t-asks"), hasPendingApprovals: true },
      thread("t-unseen"),
      { ...thread("t-seen"), lastVisitedAt: "2026-03-09T10:06:00.000Z" },
      {
        ...thread("t-broke"),
        latestRun: { ...thread("t-broke").latestRun, status: "failed" as const },
        runtime: { ...thread("t-broke").runtime, status: "failed" as const },
      },
      // The same thread id on another server is another thread.
      { ...thread("t-elsewhere", EnvironmentId.make("other")), hasPendingUserInput: true },
    ],
    {},
  );
  expect([...attention]).toEqual([
    ["asks", { kind: "needs", why: "approval" }],
    ["unseen", { kind: "finished", at: Date.parse("2026-03-09T10:05:00.000Z") }],
    ["broke", { kind: "stopped" }],
  ]);
});
