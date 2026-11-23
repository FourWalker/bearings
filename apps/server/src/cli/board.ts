/**
 * Project Board fork: the board from a terminal or a script. Reads the board folder directly, so
 * it needs no running server. It has no window to steer: where an agent would show a task, this
 * prints the task's link.
 */
import {
  BoardStore,
  findBoard,
  findOnBoard,
  levelOf,
  LEVEL_NAME,
  nextStep,
  planProgress,
  readBoardSummaries,
} from "@t3tools/board-core";
import { defaultBoardHome, nodeIO } from "@t3tools/board-core/node";
import { boardTaskUrl } from "@t3tools/issue-tracker-board/shared/boardIssue";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

export class BoardCliError extends Schema.TaggedError<BoardCliError>()("BoardCliError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const boardFlag = Flag.String("board").pipe(
  Flag.withDescription("Board id. Defaults to the board of this directory, or the only board."),
  Flag.optional,
);

const read = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: () => new BoardCliError({ detail: "The board folder could not be read." }),
  });

/** The board a command means: the one named, this directory's, or the only one there is. */
const resolveBoard = Effect.fn("boardCli.resolveBoard")(function* (
  store: BoardStore,
  named: Option.Option<string>,
) {
  const registry = yield* read(() => store.loadRegistry());
  const ids = registry.boards.map((board) => board.id).join(", ") || "none";
  if (Option.isSome(named)) {
    const board = registry.boards.find((candidate) => candidate.id === named.value);
    if (board) return board;
    return yield* new BoardCliError({ detail: `No board "${named.value}". Boards: ${ids}.` });
  }
  const here = findBoard(registry, yield* HostProcess.WorkingDirectory)?.board;
  const [only] = registry.boards;
  const board = here ?? (registry.boards.length === 1 ? only : undefined);
  if (board) return board;
  return yield* new BoardCliError({
    detail: `This directory is on no board. Pass --board, one of: ${ids}.`,
  });
});

const isBoardCliError = Schema.is(BoardCliError);

const reportBoardErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((error) =>
      isBoardCliError(error) ? Console.error(error.message) : Effect.void,
    ),
  );

const openBoard = Effect.fn("boardCli.openBoard")(function* (named: Option.Option<string>) {
  const store = new BoardStore(defaultBoardHome(), nodeIO);
  const board = yield* resolveBoard(store, named);
  return { store, boardId: board.id };
});

const loadTask = Effect.fn("boardCli.loadTask")(function* (
  store: BoardStore,
  boardId: string,
  taskId: string,
) {
  const task = yield* read(() => store.loadTask(boardId, taskId));
  if (task) return task;
  return yield* new BoardCliError({
    detail: `No task "${taskId}" on board ${boardId}. Find its id with: t3 board find <words>`,
  });
});

const boardListCommand = Command.make("list").pipe(
  Command.withDescription("List the boards on this machine."),
  Command.withHandler(() =>
    read(() => readBoardSummaries(new BoardStore(defaultBoardHome(), nodeIO))).pipe(
      Effect.flatMap((boards) =>
        Console.log(
          boards.length === 0
            ? "No boards yet."
            : boards
                .map((board) => `${board.id}  ${board.name}  (${board.taskCount} tasks)`)
                .join("\n"),
        ),
      ),
    ),
  ),
);

const boardFindCommand = Command.make("find", {
  board: boardFlag,
  level: Flag.Literals("level", ["1", "2", "3"]).pipe(
    Flag.withDescription(
      "Only this level: 1 feature, 2 module, 3 task. Without it, several matches under one parent come back as the parent.",
    ),
    Flag.optional,
  ),
  query: Argument.String("query").pipe(
    Argument.withDescription("Words, or a file path a task touched. Empty lists the board."),
  ),
}).pipe(
  Command.withDescription("Find work on a board: the same search agents use."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { store, boardId } = yield* openBoard(flags.board);
      const { lines } = yield* read(() =>
        findOnBoard(store, boardId, flags.query, {
          level: Option.match(flags.level, {
            onNone: () => undefined,
            onSome: (level) => (level === "1" ? 1 : level === "2" ? 2 : 3),
          }),
        }),
      );
      yield* Console.log(lines.length > 0 ? lines.join("\n") : "No matching tasks.");
    }).pipe(reportBoardErrors),
  ),
);

const taskArgument = Argument.String("task").pipe(Argument.withDescription("Task id."));

const boardShowCommand = Command.make("show", { board: boardFlag, task: taskArgument }).pipe(
  Command.withDescription("Show one task: where it stands and what is next."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { store, boardId } = yield* openBoard(flags.board);
      {
        const task = yield* loadTask(store, boardId, flags.task);
        const plan = yield* read(() => store.readText(store.planPath(boardId, task.id)));
        const parents = yield* read(() => store.ancestorsOf(boardId, task));
        const next = nextStep(plan);
        const steps = planProgress(plan);
        yield* Console.log(
          [
            `${task.title} (${task.id}, ${LEVEL_NAME[levelOf(task)]}, ${task.status})`,
            parents.length > 0 && `Under: ${parents.map((parent) => parent.title).join(" › ")}`,
            task.description && `Purpose: ${task.description}`,
            steps.total > 0 && `Plan: ${steps.done}/${steps.total} steps done`,
            next && `Next step: ${next.id} – ${next.text}`,
            task.lastAction && `Last action: ${task.lastAction.text}`,
            `Link: ${boardTaskUrl(boardId, task.id)}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }).pipe(reportBoardErrors),
  ),
);

const boardLinkCommand = Command.make("link", { board: boardFlag, task: taskArgument }).pipe(
  Command.withDescription("Print the link that opens a task in T3 Code."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { store, boardId } = yield* openBoard(flags.board);
      const task = yield* loadTask(store, boardId, flags.task);
      yield* Console.log(boardTaskUrl(boardId, task.id));
    }).pipe(reportBoardErrors),
  ),
);

export const boardCommand = Command.make("board").pipe(
  Command.withDescription("Read the Project Board: list boards, find work, show a task."),
  Command.withSubcommands([boardListCommand, boardFindCommand, boardShowCommand, boardLinkCommand]),
);
