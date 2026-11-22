import { createFileRoute } from "@tanstack/react-router";

import { BoardPage } from "../components/board/BoardPage";
import { boardSearchFromUrl } from "../components/board/board.logic";

/** Project Board fork. */
export const Route = createFileRoute("/_chat/board")({
  validateSearch: boardSearchFromUrl,
  component: BoardPage,
});
