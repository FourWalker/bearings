/**
 * Project Board fork: the board from a terminal or a script. Reads the board folder directly, so
 * it needs no running server. It has no window to steer: where an agent would show a task, this
 * prints the task's link.
 */
import {
  BoardEditError,
  BoardStore,
  createBoard,
  createTask,
  editTask,
  type TaskEdit,
  findBoard,
  findOnBoard,
  levelOf,
  LEVEL_NAME,
  nextStep,
  planProgress,
  readBoardSummaries,
} from "@t3tools/board-core";
import { defaultBoardHome, nodeGit, nodeIO } from "@t3tools/board-core/node";
import { boardTaskUrl } from "@t3tools/issue-tracker-board/shared/boardIssue";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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

const write = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new BoardCliError({
        detail:
          cause instanceof BoardEditError
            ? cause.message
            : "The board folder could not be written.",
      }),
  });

const readMarkdown = Effect.fn("boardCli.readMarkdown")(function* (path: Option.Option<string>) {
  if (Option.isNone(path)) return undefined;
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(path.value)
    .pipe(Effect.mapError(() => new BoardCliError({ detail: `Could not read ${path.value}.` })));
});

const listOf = (value: Option.Option<string>) =>
  Option.getOrUndefined(
    Option.map(value, (text) =>
      text
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  );

const CLI_ACTOR = { by: "t3-cli" };

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

const boardCreateCommand = Command.make("create", {
  name: Argument.String("name").pipe(Argument.withDescription("The new board's name.")),
  path: Flag.String("path").pipe(
    Flag.withDescription("The board's first workspace folder. Defaults to this directory."),
    Flag.optional,
  ),
  label: Flag.String("label").pipe(
    Flag.withDescription("The workspace's label. Defaults to the folder's name."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Create a board on a folder. Add the folder as a T3 project to start threads there.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const path = Option.getOrElse(flags.path, () => "") || (yield* HostProcess.WorkingDirectory);
      const board = yield* write(() =>
        createBoard(new BoardStore(defaultBoardHome(), nodeIO), {
          name: flags.name,
          roots: [{ path, label: Option.getOrElse(flags.label, () => "") }],
        }),
      );
      yield* Console.log(
        `Created the ${board.name} board (id ${board.id}) on ${board.roots[0]?.path}.`,
      );
    }).pipe(reportBoardErrors),
  ),
);

const servicesFlag = Flag.String("services").pipe(
  Flag.withDescription("Service ids it touches, separated by commas."),
  Flag.optional,
);
const planFlag = Flag.String("plan").pipe(
  Flag.withDescription(
    'A markdown file with the whole plan: "## Phase A" headings, "- [ ] A1 name" steps.',
  ),
  Flag.optional,
);
const descriptionFlag = Flag.String("description").pipe(
  Flag.withDescription("One-line purpose."),
  Flag.optional,
);

const boardAddCommand = Command.make("add", {
  board: boardFlag,
  title: Argument.String("title").pipe(Argument.withDescription("The new item's title.")),
  parent: Flag.String("parent").pipe(
    Flag.withDescription("Id of the feature (for a module) or module (for a task) it belongs to."),
    Flag.optional,
  ),
  topLevel: Flag.Boolean("top-level").pipe(
    Flag.withDescription("Create a feature, which has no parent."),
    Flag.withDefault(false),
  ),
  backlog: Flag.Boolean("backlog").pipe(
    Flag.withDescription("With --top-level: a service's backlog instead of a feature."),
    Flag.withDefault(false),
  ),
  fromStep: Flag.String("from-step").pipe(
    Flag.withDescription("The parent plan step this item takes over."),
    Flag.optional,
  ),
  bug: Flag.Boolean("bug").pipe(
    Flag.withDescription("It fixes a bug found in finished work."),
    Flag.withDefault(false),
  ),
  createAnyway: Flag.Boolean("create-anyway").pipe(
    Flag.withDescription("Create it although the board has similar work."),
    Flag.withDefault(false),
  ),
  description: descriptionFlag,
  services: servicesFlag,
  plan: planFlag,
}).pipe(
  Command.withDescription("Add a feature, module or task to a board. Prints its id."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { store, boardId } = yield* openBoard(flags.board);
      if (Option.isNone(flags.parent) !== flags.topLevel)
        return yield* new BoardCliError({
          detail: "Pass either --parent with the item it belongs to, or --top-level.",
        });
      if (!flags.createAnyway && Option.isNone(flags.fromStep)) {
        const { lines } = yield* read(() =>
          findOnBoard(store, boardId, flags.title, { every: true }),
        );
        if (lines.length > 0)
          return yield* new BoardCliError({
            detail: `Not created: the board may already have this.\n${lines.slice(0, 3).join("\n")}\nPass --create-anyway if none of these is it.`,
          });
      }
      const plan = yield* readMarkdown(flags.plan);
      const task = yield* write(() =>
        createTask(
          store,
          boardId,
          {
            title: flags.title,
            parentId: Option.getOrNull(flags.parent),
            description: Option.getOrUndefined(flags.description),
            kind: flags.backlog ? "backlog" : "feature",
            services: listOf(flags.services),
            bug: flags.bug,
            fromStep: Option.getOrUndefined(flags.fromStep),
            plan,
          },
          CLI_ACTOR,
        ),
      );
      yield* Console.log(task.id);
    }).pipe(reportBoardErrors),
  ),
);

const boardUpdateCommand = Command.make("update", {
  board: boardFlag,
  task: taskArgument,
  title: Flag.String("title").pipe(Flag.withDescription("A new title."), Flag.optional),
  description: descriptionFlag,
  status: Flag.Literals("status", ["active", "paused", "done"]).pipe(Flag.optional),
  services: servicesFlag,
  plan: planFlag,
  handoff: Flag.String("handoff").pipe(
    Flag.withDescription("A markdown file with the whole living handoff."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Change a task's title, purpose, status, services, plan or handoff."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const { store, boardId } = yield* openBoard(flags.board);
      const task = yield* loadTask(store, boardId, flags.task);
      const plan = yield* readMarkdown(flags.plan);
      const handoff = yield* readMarkdown(flags.handoff);
      const fields = {
        title: Option.getOrUndefined(flags.title),
        description: Option.getOrUndefined(flags.description),
        status: Option.getOrUndefined(flags.status),
        services: listOf(flags.services),
      };
      const edits: TaskEdit[] = [];
      if (plan !== undefined) edits.push({ op: "savePlan", markdown: plan });
      if (handoff !== undefined) edits.push({ op: "saveHandoff", markdown: handoff });
      if (Object.values(fields).some((value) => value !== undefined))
        edits.push({ op: "update", ...fields });
      if (edits.length === 0)
        return yield* new BoardCliError({ detail: "Nothing to change: pass at least one flag." });
      for (const edit of edits) {
        const { message } = yield* write(() =>
          editTask(store, boardId, task.id, edit, CLI_ACTOR, nodeGit),
        );
        yield* Console.log(message);
      }
    }).pipe(reportBoardErrors),
  ),
);

export const boardCommand = Command.make("board").pipe(
  Command.withDescription(
    "The Project Board: list or create boards, add, find, show and update tasks.",
  ),
  Command.withSubcommands([
    boardListCommand,
    boardCreateCommand,
    boardAddCommand,
    boardUpdateCommand,
    boardFindCommand,
    boardShowCommand,
    boardLinkCommand,
  ]),
);
