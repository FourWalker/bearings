import type { ThreadIssueLink } from "@t3tools/contracts";

/**
 * Project Board fork: the board tasks a thread is on, read from its issue links. The server writes
 * the task in hand and the tasks the thread ticked a step on (BoardReactor.mirrorToThread).
 */
export interface BoardThreadLine {
  readonly key: string;
  readonly title: string;
  /** 1 = feature, 2 = module, 3 = task; null on a link written before the level was kept. */
  readonly level: 1 | 2 | 3 | null;
  readonly inHand: boolean;
}

// The format is `boardTaskUrl` in packages/issue-tracker-board, which the web app does not depend on.
const MARK = /^t3board:\/\/[^?]+\?level=([123])(&hand=1)?$/;

/** The task in hand first, then the latest worked on; `more` counts what did not fit. */
export function boardLinesOf(
  issues: ReadonlyArray<ThreadIssueLink> | undefined,
  max = 3,
): { readonly lines: ReadonlyArray<BoardThreadLine>; readonly more: number } {
  const all = (issues ?? [])
    .filter((link) => link.tracker === "board")
    .map((link) => {
      const mark = MARK.exec(link.url);
      return {
        key: link.key,
        title: link.title,
        level: mark ? (Number(mark[1]) as 1 | 2 | 3) : null,
        inHand: mark?.[2] !== undefined,
        linkedAt: link.linkedAt,
      };
    })
    .toSorted(
      (a, b) => Number(b.inHand) - Number(a.inHand) || b.linkedAt.localeCompare(a.linkedAt),
    );
  return {
    lines: all.slice(0, max).map(({ linkedAt: _, ...line }) => line),
    more: Math.max(0, all.length - max),
  };
}
