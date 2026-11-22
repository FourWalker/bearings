import type { BoardTask } from "@t3tools/contracts";

export interface BoardSearch {
  readonly env?: string | undefined;
  readonly board?: string | undefined;
  readonly done?: true | undefined;
}

export function boardSearchFromUrl(search: Record<string, unknown>): BoardSearch {
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  return {
    env: text(search.env),
    board: text(search.board),
    done: search.done === true || search.done === "true" ? true : undefined,
  };
}

export interface BoardTreeRow {
  readonly task: BoardTask;
  readonly depth: number;
}

/**
 * Master task › module › task, each level in the order given (newest first). A task whose parent
 * is missing or filtered out shows at the top, so nothing disappears. Done tasks show only on ask.
 */
export function boardTaskTree(
  tasks: ReadonlyArray<BoardTask>,
  showDone: boolean,
): ReadonlyArray<BoardTreeRow> {
  const shown = tasks.filter((task) => showDone || task.status !== "done");
  const ids = new Set(shown.map((task) => task.id));
  const rows: Array<BoardTreeRow> = [];
  const visit = (task: BoardTask, depth: number) => {
    rows.push({ task, depth });
    for (const child of shown) if (child.parentId === task.id) visit(child, depth + 1);
  };
  for (const task of shown) {
    if (task.parentId === null || !ids.has(task.parentId)) visit(task, 0);
  }
  return rows;
}
