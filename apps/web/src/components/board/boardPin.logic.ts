import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { BoardChat, BoardTask } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { type BoardIndex, flagsOf, openDecisionCount, subtreeOf } from "./board.logic";

/**
 * Project Board fork: the Pin bar. One task or module per board is kept in view; everything the
 * bar says is read from the board's files and the chats' own events, never reported by a model.
 */
export const PIN_CATCHES = ["off", "theme", "tack"] as const;
/** How the bar catches the eye when the pinned item needs the person. */
export type PinCatch = (typeof PIN_CATCHES)[number];

/** Most urgent first: what the bar's chip says. */
export type PinWhy =
  | "approval"
  | "question"
  | "decision"
  | "blocked"
  | "stopped"
  | "working"
  | "waiting"
  | "finished"
  | "idle"
  | "none";

const NEEDS_YOU: ReadonlySet<PinWhy> = new Set([
  "approval",
  "question",
  "decision",
  "blocked",
  "stopped",
]);
/** The states that colour the bar and, when asked to, make it move. */
export const pinNeedsYou = (why: PinWhy): boolean => NEEDS_YOU.has(why);

export type PinSlot =
  /** The plan step in hand: the first one not ticked. */
  | { readonly kind: "step"; readonly id: string; readonly text: string }
  /** A pinned module nobody works on directly: the task being done under it. */
  | { readonly kind: "task"; readonly task: BoardTask }
  | { readonly kind: "done" }
  | { readonly kind: "empty" };

export interface PinView {
  readonly task: BoardTask;
  readonly slot: PinSlot;
  readonly progress: {
    readonly done: number;
    readonly total: number;
    readonly unit: "steps" | "tasks";
  };
  readonly why: PinWhy;
  /** The chat that state is about, which the bar peeks at and opens. */
  readonly chat: BoardChat | null;
  /** Other chats still on the item. */
  readonly others: number;
  readonly blocker: BoardTask | null;
}

const alive = (chat: BoardChat) => chat.live === "working" || chat.live === "idle";

/**
 * What the bar shows for a pinned item. `waiting` holds the chats that sit on background work
 * they started (the board calls those working: they are not done).
 */
export function pinViewOf(
  index: BoardIndex,
  task: BoardTask,
  waiting: ReadonlySet<string> = new Set(),
): PinView {
  const tree = subtreeOf(index, task);
  const below = tree.slice(1).filter((other) => other.status !== "done");
  const chats = tree.flatMap((other) => other.chats).filter((chat) => chat.live !== "ended");
  const wants = (kind: "needs" | "stopped" | "finished", why?: "approval" | "question") =>
    chats.find((chat) => {
      const attention = index.attention.get(chat.sessionId);
      return (
        attention?.kind === kind &&
        (why === undefined || (attention.kind === "needs" && attention.why === why))
      );
    });
  const working = chats.filter((chat) => chat.live === "working");
  const recent = chats.toSorted((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  const blocker =
    flagsOf(index, task).blockedBy[0] ??
    below.flatMap((other) => flagsOf(index, other).blockedBy)[0] ??
    null;
  const state = ((): { readonly why: PinWhy; readonly chat: BoardChat | null } => {
    const approval = wants("needs", "approval");
    if (approval) return { why: "approval", chat: approval };
    const question = wants("needs", "question");
    if (question) return { why: "question", chat: question };
    if (tree.some((other) => other.status !== "done" && openDecisionCount(index, other) > 0))
      return { why: "decision", chat: working[0] ?? recent };
    if (blocker !== null) return { why: "blocked", chat: working[0] ?? recent };
    const stopped = wants("stopped");
    if (stopped) return { why: "stopped", chat: stopped };
    const busy = working.find((chat) => !waiting.has(chat.sessionId));
    if (busy) return { why: "working", chat: busy };
    if (working[0]) return { why: "waiting", chat: working[0] };
    const finished = wants("finished");
    if (finished) return { why: "finished", chat: finished };
    const idle = chats.find((chat) => chat.live === "idle");
    return idle ? { why: "idle", chat: idle } : { why: "none", chat: null };
  })();

  // A chat working on the module itself outranks the tasks under it: its own step shows.
  const direct = task.chats.some((chat) => chat.live === "working");
  const own = (): Pick<PinView, "slot" | "progress"> => ({
    slot:
      task.next !== null
        ? { kind: "step", id: task.next.id, text: task.next.text }
        : task.steps.total > 0
          ? { kind: "done" }
          : { kind: "empty" },
    progress: { ...task.steps, unit: "steps" },
  });
  const inHand =
    below.find((other) => other.chats.some((chat) => chat.live === "working")) ??
    below
      .filter((other) => other.chats.some(alive))
      .toSorted((a, b) => b.updatedAt - a.updatedAt)[0] ??
    below.find((other) => other.level === 3) ??
    below[0];
  const kids = tree.slice(1).filter((other) => index.kidsOf(other.id).length === 0);
  const shown =
    direct || (inHand === undefined && (kids.length === 0 || task.steps.total > 0))
      ? own()
      : inHand === undefined
        ? {
            // Every task under it is finished and it has no plan of its own.
            slot: { kind: "done" as const },
            progress: { done: kids.length, total: kids.length, unit: "tasks" as const },
          }
        : {
            slot: { kind: "task" as const, task: inHand },
            progress: {
              done: kids.filter((other) => other.status === "done").length,
              total: kids.length,
              unit: "tasks" as const,
            },
          };
  return {
    task,
    ...shown,
    ...state,
    others: chats.filter((chat) => alive(chat) && chat.sessionId !== state.chat?.sessionId).length,
    blocker,
  };
}

/** One identity per thing to deal with: a new one makes the bar move again. */
export const pinNoticeKey = (view: PinView): string | null =>
  pinNeedsYou(view.why)
    ? `${view.task.id}:${view.why}:${view.chat?.sessionId ?? view.blocker?.id ?? ""}`
    : null;

/** When the bar moves again for a notice nobody dealt with: after 30s, 60s, then every 2 minutes. */
export function pinBurstDelayMs(burstsSoFar: number): number {
  return burstsSoFar <= 2 ? 30_000 : 120_000;
}

export type PinPeekVerb = "ran" | "running" | "edited" | "searched" | "tool" | "board" | "wants";
export interface PinPeekRow {
  readonly id: string;
  readonly verb: PinPeekVerb;
  readonly text: string;
  readonly at: number | null;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** What the agent did last, newest first, from the thread's own activity rows. */
export function pinPeekRows(
  items: ThreadStructure["turnItems"],
  limit: number,
): ReadonlyArray<PinPeekRow> {
  const out: Array<PinPeekRow> = [];
  for (let i = items.length - 1; i >= 0 && out.length < limit; i--) {
    const item = items[i]!;
    const row = ((): Pick<PinPeekRow, "verb" | "text"> | null => {
      switch (item.type) {
        case "command_execution":
          return { verb: item.completedAt === null ? "running" : "ran", text: item.input };
        case "file_change":
          return { verb: "edited", text: item.fileName };
        case "file_search":
          return item.pattern ? { verb: "searched", text: item.pattern } : null;
        case "web_search":
          return item.patterns?.[0] ? { verb: "searched", text: item.patterns[0] } : null;
        case "approval_request":
          return item.completedAt === null
            ? { verb: "wants", text: item.prompt ?? item.title ?? item.requestKind }
            : null;
        case "dynamic_tool": {
          const name = (item.toolName ?? "").replace(/^.*(?:__|\.)/, "");
          return { verb: name.startsWith("board_") ? "board" : "tool", text: name };
        }
        default:
          return null;
      }
    })();
    if (row === null || !row.text.trim()) continue;
    const at = item.startedAt;
    out.push({
      id: item.id,
      ...row,
      text: oneLine(row.text),
      at: at === null ? null : DateTime.toEpochMillis(at),
    });
  }
  return out;
}

/** The newest finished board tool call: the plan may have a new tick, so the board is read again. */
export function lastBoardCallId(items: ThreadStructure["turnItems"]): string | null {
  const call = items.findLast(
    (item) =>
      item.type === "dynamic_tool" &&
      item.completedAt !== null &&
      /board_/.test(item.toolName ?? ""),
  );
  return call?.id ?? null;
}
