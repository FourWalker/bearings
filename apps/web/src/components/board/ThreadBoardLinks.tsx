import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { BoardTask, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ChevronRightIcon, SquareKanbanIcon } from "lucide-react";

import { boardEnvironment } from "~/state/board";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";

import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { ancestorsOf, indexBoard } from "./board.logic";
import { boardLinesOf } from "./boardThreadLinks.logic";

/**
 * Project Board fork: the board items a thread is on, in its details panel. The task in hand shows
 * under its feature and module; each name opens that item on the board.
 */
export function ThreadBoardLinks(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const links = (shell?.issues ?? []).filter((link) => link.tracker === "board");
  const { lines } = boardLinesOf(links, 6);
  const boardId = links[0]?.scope ?? null;
  // The board's own read, shared with the board screen, gives the feature and module above a task.
  const view = useEnvironmentQuery(
    boardId === null
      ? null
      : boardEnvironment.view({ environmentId: props.environmentId, input: { boardId } }),
  );
  if (boardId === null || lines.length === 0) return null;
  const index = view.data ? indexBoard(view.data.tasks) : null;
  const open = (taskId: string) =>
    void navigate({
      to: "/board",
      search: { env: props.environmentId, board: boardId, task: taskId },
    });
  const levelName = (level: 1 | 2 | 3 | null) =>
    level === 1 ? gt("Feature") : level === 2 ? gt("Module") : level === 3 ? gt("Task") : null;
  const [first, ...rest] = lines;
  const inHand = first?.inHand ? first : null;
  const others = inHand === null ? lines : rest;
  const handTask = inHand === null ? null : (index?.byId.get(inHand.key) ?? null);
  const path: ReadonlyArray<BoardTask> =
    index !== null && handTask !== null ? ancestorsOf(index, handTask) : [];

  return (
    <ThreadDetailsSection headingId="thread-details-board-heading" title={gt("Board")}>
      <div data-thread-board-links className="flex flex-col gap-1 px-1">
        {inHand !== null ? (
          <div
            data-thread-board-hand
            data-status={handTask?.status}
            className="relative grid gap-0.5 overflow-hidden rounded-md border border-border/70 bg-card py-1.5 ps-3 pe-2"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 start-0 w-[3px] bg-(--app-theme-accent,var(--primary))"
            />
            {path.length > 0 ? (
              <nav
                aria-label={gt("Where this task sits")}
                className="flex min-w-0 flex-wrap items-center gap-x-0.5 text-2xs text-muted-foreground"
              >
                {path.map((parent) => (
                  <span key={parent.id} className="flex min-w-0 items-center gap-0.5">
                    <button
                      type="button"
                      className="min-w-0 truncate hover:text-foreground hover:underline"
                      aria-label={`${levelName(parent.level) ?? ""} ${parent.title}`.trim()}
                      onClick={() => open(parent.id)}
                    >
                      {parent.title}
                    </button>
                    <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
                  </span>
                ))}
              </nav>
            ) : null}
            <button
              type="button"
              className="min-w-0 truncate text-start font-medium text-sm hover:underline"
              onClick={() => open(inHand.key)}
            >
              {inHand.title}
            </button>
            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              {levelName(inHand.level) ? <span>{levelName(inHand.level)}</span> : null}
              <span className="font-medium text-foreground">{gt("in hand")}</span>
              {handTask?.status === "paused" ? <span>· {gt("paused")}</span> : null}
              {handTask?.status === "done" ? <span>· {gt("done")}</span> : null}
            </div>
          </div>
        ) : null}
        {others.length > 0 ? (
          <ul className="flex flex-col">
            {others.map((line) => (
              <li key={line.key}>
                <button
                  type="button"
                  onClick={() => open(line.key)}
                  className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-start text-xs hover:bg-accent"
                >
                  <SquareKanbanIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  {levelName(line.level) ? (
                    <span className="shrink-0 text-muted-foreground">{levelName(line.level)}</span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{line.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
