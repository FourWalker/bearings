/**
 * How a Project Board task is addressed as an issue: tracker `board`, host `local`, scope the
 * board id, key the task id. The URL is a board link the client opens in its Board view.
 */
import { IssueTrackerKind } from "@t3tools/contracts";

export const BOARD_KIND = IssueTrackerKind.make("board");
export const BOARD_HOST = "local";

/** What a thread's link to a board task says about it: its level, and whether it is the task in hand. */
export interface BoardTaskMark {
  readonly level: 1 | 2 | 3;
  readonly inHand: boolean;
}

export const boardTaskUrl = (boardId: string, taskId: string, mark?: BoardTaskMark): string =>
  `t3board://${encodeURIComponent(boardId)}/${encodeURIComponent(taskId)}${
    mark ? `?level=${mark.level}${mark.inHand ? "&hand=1" : ""}` : ""
  }`;

/** The mark a board task URL carries; null for another URL or one written before marks. */
export function boardTaskMark(url: string): BoardTaskMark | null {
  const match = /^t3board:\/\/[^?]+\?level=([123])(&hand=1)?$/.exec(url);
  return match ? { level: Number(match[1]) as 1 | 2 | 3, inHand: match[2] !== undefined } : null;
}
