/**
 * How a Project Board task is addressed as an issue: tracker `board`, host `local`, scope the
 * board id, key the task id. The URL is a board link the client opens in its Board view.
 */
import { IssueTrackerKind } from "@t3tools/contracts";

export const BOARD_KIND = IssueTrackerKind.make("board");
export const BOARD_HOST = "local";

export const boardTaskUrl = (boardId: string, taskId: string): string =>
  `t3board://${encodeURIComponent(boardId)}/${encodeURIComponent(taskId)}`;
