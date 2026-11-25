import { BoardStore } from "@t3tools/board-core";
import { defaultBoardHome, nodeIO } from "@t3tools/board-core/node";

import * as BoardIssueTracker from "./BoardIssueTracker.ts";

/** The board tracker over the board folder (`~/.claude-board`, or `T3_BOARD_HOME`). */
export const make = BoardIssueTracker.make(new BoardStore(defaultBoardHome(), nodeIO));
