/**
 * Project Board fork: a board tool asking this window to show a task can send Tack to that note
 * instead of opening the task, when Tack lives on that board and the note is on screen. The board
 * page registers the handler; the intent listener asks it first.
 */
type TackShow = (boardId: string, taskId: string) => boolean;

let handler: TackShow | null = null;

export function registerTackShow(show: TackShow): () => void {
  handler = show;
  return () => {
    if (handler === show) handler = null;
  };
}

/** True when Tack went to the note, so the task need not open. */
export function tackShow(boardId: string, taskId: string): boolean {
  return handler?.(boardId, taskId) ?? false;
}
