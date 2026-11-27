/**
 * Reads the Project Board for clients: its boards, and one board's tasks and chats. A T3 thread's
 * status and title come from this server's own thread, not from the board's heartbeat, so a thread
 * nobody has used since a restart shows idle, not offline. Also puts a new thread on a task.
 *
 * @module board/BoardService
 */
import {
  type BoardCreateBoardInput,
  type BoardCreateBoardResult,
  type BoardCreateTaskInput,
  type BoardWorkspaceCandidate,
  CommandId,
  type BoardEditBoardInput,
  type BoardSettings,
  BoardEditFailure,
  type BoardEditResult,
  type BoardEditTaskInput,
  BoardLinkError,
  type BoardLinkThreadInput,
  type BoardChat as BoardChatRow,
  BoardReadError,
  type BoardSummary,
  type BoardTaskDetail,
  type BoardTaskDetailInput,
  type BoardView,
  type OrchestrationV2ThreadTranscript,
  type Project,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  BoardChat,
  BoardEditError,
  base,
  createBoard as createNewBoard,
  createTask as createBoardTask,
  editBoard as editBoardSettings,
  editTask as editBoardTask,
  type BoardGit,
  type BoardViewChat,
  BoardStore,
  closeGoal,
  findBoard,
  goalOpen,
  loadGoal,
  norm,
  readBoardSummaries,
  readBoardView,
  readTaskDetail,
  saveGoal,
  readUnassignedChats,
} from "@t3tools/board-core";
import { defaultBoardHome, nodeGit, nodeIO } from "@t3tools/board-core/node";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as KeyedLock from "@t3tools/shared/KeyedLock";

import * as BoardFile from "./BoardFile.ts";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";

export class BoardService extends Context.Service<
  BoardService,
  {
    readonly list: Effect.Effect<ReadonlyArray<BoardSummary>, BoardReadError>;
    readonly unassigned: Effect.Effect<ReadonlyArray<BoardChatRow>, BoardReadError>;
    readonly view: (input: {
      readonly boardId: string;
    }) => Effect.Effect<BoardView, BoardReadError>;
    readonly taskDetail: (
      input: BoardTaskDetailInput,
    ) => Effect.Effect<BoardTaskDetail, BoardReadError>;
    readonly editTask: (
      input: BoardEditTaskInput,
    ) => Effect.Effect<BoardEditResult, BoardEditFailure>;
    readonly createTask: (
      input: BoardCreateTaskInput,
    ) => Effect.Effect<BoardEditResult, BoardEditFailure>;
    readonly settings: (input: {
      readonly boardId: string;
    }) => Effect.Effect<BoardSettings, BoardReadError>;
    readonly editBoard: (
      input: BoardEditBoardInput,
    ) => Effect.Effect<BoardEditResult, BoardEditFailure>;
    /** A new board on the given folders; each folder without a T3 project gets one. */
    readonly createBoard: (
      input: BoardCreateBoardInput,
    ) => Effect.Effect<BoardCreateBoardResult, BoardEditFailure>;
    readonly workspaceCandidates: Effect.Effect<
      ReadonlyArray<BoardWorkspaceCandidate>,
      BoardReadError
    >;
    readonly archivedThreads: (input: {
      readonly boardId: string;
    }) => Effect.Effect<ReadonlyArray<OrchestrationV2ThreadTranscript>, BoardReadError>;
    readonly openFile: (input: {
      readonly contents: string;
    }) => Effect.Effect<string, BoardEditFailure>;
    readonly exportFile: (input: {
      readonly boardId: string;
      readonly includeThreads: boolean;
    }) => Effect.Effect<string, BoardReadError>;
    readonly linkThread: (input: BoardLinkThreadInput) => Effect.Effect<void, BoardLinkError>;
  }
>()("t3/board/BoardService") {}

const failed = (cause: unknown) =>
  new BoardReadError({ reason: "failed", detail: `The board could not be read: ${String(cause)}` });
const linkFailed = (cause: unknown) =>
  new BoardLinkError({
    reason: "failed",
    detail: `The thread could not be linked: ${String(cause)}`,
  });

export const make = Effect.fn("BoardService.make")(function* (store: BoardStore, git: BoardGit) {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;

  // A board record can name a thread this server doesn't hold (another T3 install on the machine).
  const withThread = Effect.fn("BoardService.withThread")(function* (chat: BoardChatRow) {
    if (chat.threadId === null) return chat;
    const shell = yield* threads
      .getThreadShell(chat.threadId)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
    // Untitled and never prompted: a thread linked as a draft that was never sent.
    if (shell === null) return chat.title === "" ? null : { ...chat, threadId: null };
    return {
      ...chat,
      title: shell.title || chat.title,
      live:
        shell.archivedAt !== null || chat.live === "ended"
          ? ("ended" as const)
          : shell.activeRunId !== null
            ? ("working" as const)
            : ("idle" as const),
    };
  });

  const allProjects = Effect.gen(function* () {
    const all: Array<Project> = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page: {
        readonly projects: ReadonlyArray<Project>;
        readonly nextCursor: number | null;
      } = yield* projects.listPage({ cursor, limit: 200 });
      all.push(...page.projects);
      cursor = page.nextCursor;
    }
    return all;
  });

  // Each root's project is the one a thread there lands on this board through: the root's own
  // folder, else the project nearest the root inside it.
  const workspaceProjects = Effect.fn("BoardService.workspaceProjects")(function* (
    boardId: string,
  ) {
    const reg = yield* Effect.tryPromise({ try: () => store.loadRegistry(), catch: failed });
    const found = yield* allProjects.pipe(Effect.catchCause(() => Effect.succeed([])));
    const byRoot = new Map<string, { readonly id: ProjectId; readonly depth: number }>();
    for (const project of found) {
      const hit = findBoard(reg, project.workspaceRoot);
      if (hit === null || hit.board.id !== boardId) continue;
      const root = norm(hit.root.path);
      const depth = norm(project.workspaceRoot).length - root.length;
      const held = byRoot.get(root);
      if (held === undefined || depth < held.depth) byRoot.set(root, { id: project.id, depth });
    }
    return byRoot;
  });

  const list = Effect.tryPromise({ try: () => readBoardSummaries(store), catch: failed }).pipe(
    Effect.withSpan("BoardService.list"),
  );

  const resolve = (chats: ReadonlyArray<BoardViewChat>) =>
    Effect.forEach(
      chats,
      (chat) =>
        withThread({
          ...chat,
          threadId: chat.threadId === null ? null : ThreadId.make(chat.threadId),
        }),
      { concurrency: 8 },
    ).pipe(Effect.map((rows) => rows.filter((row) => row !== null)));

  const unassigned = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const chats = yield* Effect.tryPromise({
      try: () => readUnassignedChats(store, now),
      catch: failed,
    });
    return yield* resolve(chats);
  }).pipe(Effect.withSpan("BoardService.unassigned"));

  const view = Effect.fn("BoardService.view")(function* (input: { readonly boardId: string }) {
    const now = yield* Clock.currentTimeMillis;
    const raw = yield* Effect.tryPromise({
      try: () => readBoardView(store, input.boardId, now),
      catch: failed,
    });
    if (raw === null) {
      return yield* new BoardReadError({ reason: "not-found", detail: "No such board." });
    }
    const tasks = yield* Effect.forEach(raw.tasks, (task) =>
      Effect.all([resolve(task.chats), resolve(task.worked.map((entry) => entry.chat))]).pipe(
        Effect.map(([chats, workers]) => ({
          ...task,
          chats,
          // `resolve` drops a chat whose thread is gone, so match by chat, not by position.
          worked: task.worked.flatMap((entry) => {
            const chat = workers.find((row) => row.sessionId === entry.chat.sessionId);
            return chat === undefined ? [] : [{ ...entry, chat }];
          }),
        })),
      ),
    );
    // Only open chats: a T3 thread is open whenever this server holds it, whatever its heartbeat.
    const unlinked = (yield* resolve(raw.unlinked)).filter(
      (chat) => chat.live === "working" || chat.live === "idle",
    );
    const byRoot = yield* workspaceProjects(input.boardId);
    const workspaces = raw.workspaces.map((workspace) => ({
      ...workspace,
      projectId: byRoot.get(workspace.root)?.id ?? null,
    }));
    const hasArchivedThreads = yield* Effect.tryPromise({
      try: () => BoardFile.hasArchivedThreads(store, input.boardId),
      catch: failed,
    });
    const withChats = (goals: typeof raw.goals) =>
      Effect.forEach(goals, (goal) =>
        resolve(goal.chats).pipe(Effect.map((chats) => ({ ...goal, chats }))),
      );
    return {
      ...raw,
      workspaces,
      tasks,
      unlinked,
      goals: yield* withChats(raw.goals),
      finishedGoals: yield* withChats(raw.finishedGoals),
      ...(hasArchivedThreads ? { hasArchivedThreads } : {}),
    } satisfies BoardView;
  });

  const taskDetail = Effect.fn("BoardService.taskDetail")(function* (input: BoardTaskDetailInput) {
    const detail = yield* Effect.tryPromise({
      try: () => readTaskDetail(store, input.boardId, input.taskId),
      catch: failed,
    });
    if (detail === null)
      return yield* new BoardReadError({ reason: "not-found", detail: "No such task." });
    return detail satisfies BoardTaskDetail;
  });

  // The person's edits, made in an app: one board at a time, so two quick edits to one task
  // can't overwrite each other.
  const editLock = yield* KeyedLock.make<string>();
  const APP = { by: "T3 Code" };
  const editFailed = (cause: unknown) =>
    cause instanceof BoardEditError
      ? new BoardEditFailure({
          reason: cause.message.startsWith("No task") ? "not-found" : "invalid",
          detail: cause.message,
        })
      : new BoardEditFailure({
          reason: "failed",
          detail: `The board could not be saved: ${String(cause)}`,
        });
  const onBoard = Effect.fn("BoardService.onBoard")(function* (boardId: string) {
    const reg = yield* Effect.tryPromise({ try: () => store.loadRegistry(), catch: editFailed });
    if (!reg.boards.some((b) => b.id === boardId))
      return yield* new BoardEditFailure({ reason: "not-found", detail: "No such board." });
  });

  const editTask = Effect.fn("BoardService.editTask")(function* (input: BoardEditTaskInput) {
    yield* onBoard(input.boardId);
    const result = yield* editLock.withLock(
      input.boardId,
      Effect.tryPromise({
        try: () => editBoardTask(store, input.boardId, input.taskId, input.edit, APP, git),
        catch: editFailed,
      }),
    );
    return { message: result.message, createdId: result.createdId ?? null };
  });

  const createTask = Effect.fn("BoardService.createTask")(function* (input: BoardCreateTaskInput) {
    yield* onBoard(input.boardId);
    const task = yield* editLock.withLock(
      input.boardId,
      Effect.tryPromise({
        try: () =>
          createBoardTask(store, input.boardId, { title: input.title, kind: input.kind }, APP),
        catch: editFailed,
      }),
    );
    return { message: `Created "${task.title}".`, createdId: task.id };
  });

  const settings = Effect.fn("BoardService.settings")(function* (input: {
    readonly boardId: string;
  }) {
    const reg = yield* Effect.tryPromise({ try: () => store.loadRegistry(), catch: failed });
    const board = reg.boards.find((b) => b.id === input.boardId);
    if (!board) return yield* new BoardReadError({ reason: "not-found", detail: "No such board." });
    const byRoot = yield* workspaceProjects(input.boardId);
    return {
      name: board.name,
      roots: board.roots.map((r) => ({
        path: norm(r.path),
        label: r.label,
        projectId: byRoot.get(norm(r.path))?.id ?? null,
      })),
      services: (board.services ?? []).map((s) => ({ id: s.id, name: s.name, match: s.match })),
      rules: board.rules ?? "",
      boardMode: !!board.boardMode,
      merge: board.merge ?? null,
      registers: (board.registers ?? []).map((r) => ({ id: r.id, topic: r.topic, url: r.url })),
    } satisfies BoardSettings;
  });

  const addProject = Effect.fn("BoardService.addProject")(function* (root: {
    readonly path: string;
    readonly label: string;
  }) {
    const id = `${(yield* Random.nextInt) >>> 0}-${(yield* Random.nextInt) >>> 0}`;
    yield* projects
      .bootstrap({
        commandId: CommandId.make(`board-workspace-project:${id}`),
        projectId: ProjectId.make(`board-${id}`),
        title: root.label,
        workspaceRoot: root.path,
      })
      .pipe(
        // bootstrap reads before locking; a racing create already made the project.
        Effect.catchTags({ ProjectConflictError: () => Effect.void }),
        Effect.mapError(
          (cause) =>
            new BoardEditFailure({
              reason: "failed",
              detail: `${root.path} could not be added as a T3 project: ${cause.message}`,
            }),
        ),
      );
  });

  const rootsWithoutProject = Effect.fn("BoardService.rootsWithoutProject")(function* (
    boardId: string,
  ) {
    const reg = yield* Effect.tryPromise({ try: () => store.loadRegistry(), catch: editFailed });
    const byRoot = yield* workspaceProjects(boardId).pipe(Effect.mapError(editFailed));
    const board = reg.boards.find((b) => b.id === boardId);
    return (board?.roots ?? []).filter((root) => !byRoot.has(norm(root.path)));
  });

  // The person's Pause and End: they hold whether or not the Goal's thread goes along.
  const stopGoal = Effect.fn("BoardService.stopGoal")(function* (
    boardId: string,
    goalId: string,
    to: "paused" | "ended",
  ) {
    yield* onBoard(boardId);
    const running = yield* editLock.withLock(
      boardId,
      Effect.tryPromise({
        try: async () => {
          const goal = await loadGoal(store, boardId, goalId);
          if (goal === null) throw new BoardEditError("No such Goal.");
          if (!goalOpen(goal) || goal.status === to)
            throw new BoardEditError(`The Goal is already ${goal.status}.`);
          const sessions = [goal.executor, ...goal.groups.map((group) => group.worker)].filter(
            (id) => id !== null && id !== undefined,
          );
          for (const sessionId of sessions) {
            const session = await store.readSession(boardId, sessionId);
            if (session === null) continue;
            const chat = new BoardChat(store, git);
            await chat.open({ sessionId, cwd: session.cwd, source: session.source });
            await chat.leaveGoal(goal);
          }
          closeGoal(goal, to, to === "ended" ? "Ended by the person" : "Paused by the person");
          await saveGoal(store, boardId, goal);
          return sessions;
        },
        catch: editFailed,
      }),
    );
    yield* Effect.forEach(
      running,
      (sessionId) =>
        Effect.gen(function* () {
          const threadId = ThreadId.make(sessionId);
          const shell = yield* threads.getThreadShell(threadId);
          if (shell === null || shell.activeRunId === null) return;
          yield* threads.interruptThread({
            projectId: shell.projectId,
            commandId: CommandId.make(`board-goal-stop:${goalId}:${shell.activeRunId}`),
            threadId,
            reason: `Goal ${to} by the person`,
          });
        }).pipe(Effect.ignore),
      { discard: true },
    );
    return {
      message: to === "ended" ? "The Goal is ended." : "The Goal is paused.",
      createdId: null,
    };
  });

  const editBoard = Effect.fn("BoardService.editBoard")(function* (input: BoardEditBoardInput) {
    const edit = input.edit;
    if (edit.op === "stopGoal") return yield* stopGoal(input.boardId, edit.goalId, edit.to);
    if (edit.op === "addProject") {
      const missing = yield* rootsWithoutProject(input.boardId);
      const root = missing.find((candidate) => norm(candidate.path) === norm(edit.path));
      if (root) yield* addProject(root);
      return { message: "Added the T3 project.", createdId: null };
    }
    const result = yield* editLock.withLock(
      "$registry",
      Effect.tryPromise({
        try: () => editBoardSettings(store, input.boardId, edit),
        catch: editFailed,
      }),
    );
    // The workspace is saved either way; its row offers the project again if this fails.
    if (edit.op === "addRoot")
      yield* rootsWithoutProject(input.boardId).pipe(
        Effect.flatMap((missing) => Effect.forEach(missing, addProject, { discard: true })),
        Effect.ignore,
      );
    return { message: result.message, createdId: null };
  });

  const createBoard = Effect.fn("BoardService.createBoard")(function* (
    input: BoardCreateBoardInput,
  ) {
    const board = yield* editLock.withLock(
      "$registry",
      Effect.tryPromise({ try: () => createNewBoard(store, input), catch: editFailed }),
    );
    yield* rootsWithoutProject(board.id).pipe(
      Effect.flatMap((missing) => Effect.forEach(missing, addProject, { discard: true })),
      Effect.ignore,
    );
    return { boardId: board.id };
  });

  const workspaceCandidates = Effect.gen(function* () {
    const reg = yield* Effect.tryPromise({ try: () => store.loadRegistry(), catch: failed });
    const found = yield* allProjects.pipe(Effect.mapError(failed));
    return found
      .filter((project) => project.deletedAt === null)
      .map((project) => {
        const hit = findBoard(reg, project.workspaceRoot)?.board;
        return {
          projectId: project.id,
          title: project.title || base(norm(project.workspaceRoot)),
          path: norm(project.workspaceRoot),
          board: hit ? { id: hit.id, name: hit.name } : null,
        };
      });
  }).pipe(Effect.withSpan("BoardService.workspaceCandidates"));

  // Only a thread with no turn yet: a running thread's open board chat holds its own link.
  const linkThread = Effect.fn("BoardService.linkThread")(function* (input: BoardLinkThreadInput) {
    const shell = yield* threads.getThreadShell(input.threadId).pipe(Effect.mapError(linkFailed));
    if (shell !== null)
      return yield* new BoardLinkError({
        reason: "started",
        detail: "Only a new thread can be put on a task here.",
      });
    const project = yield* projects.getById(input.projectId).pipe(Effect.mapError(linkFailed));
    if (Option.isNone(project))
      return yield* new BoardLinkError({ reason: "not-found", detail: "No such project." });
    const cwd = project.value.workspaceRoot;
    yield* Effect.tryPromise({
      try: async () => {
        const hit = findBoard(await store.loadRegistry(), cwd);
        if (hit === null || hit.board.id !== input.boardId)
          return new BoardLinkError({
            reason: "not-on-board",
            detail: "The project's folder is not on this board.",
          });
        const taskId = input.taskId;
        if (taskId !== null && (await store.loadTask(input.boardId, taskId)) === null)
          return new BoardLinkError({ reason: "not-found", detail: "No such task." });
        const chat = new BoardChat(store, git);
        await chat.open({
          sessionId: input.threadId,
          cwd,
          source: { kind: "t3-thread", threadId: input.threadId, projectId: input.projectId },
        });
        if (taskId === null) {
          await chat.becomeAssistant();
          return null;
        }
        const reply = await chat.linkTask({
          taskId,
          override: input.override,
          personSaid:
            input.override === "once"
              ? "Continue once in this workspace"
              : input.override === "takeover"
                ? "Take over in this workspace"
                : undefined,
        });
        const linked = await store.readSession(input.boardId, input.threadId);
        return linked?.taskId === taskId
          ? null
          : new BoardLinkError({ reason: "blocked", detail: reply.text });
      },
      catch: linkFailed,
    }).pipe(Effect.flatMap((error) => (error === null ? Effect.void : Effect.fail(error))));
  });

  const archivedThreads = Effect.fn("BoardService.archivedThreads")(
    ({ boardId }: { readonly boardId: string }) =>
      Effect.tryPromise({
        try: () => BoardFile.readArchivedThreads(store, boardId),
        catch: failed,
      }),
  );

  const openFile = ({ contents }: { readonly contents: string }) =>
    editLock.withLock(
      "$registry",
      Effect.tryPromise({
        try: () => BoardFile.openBoardFile(store, contents),
        catch: editFailed,
      }),
    );

  const exportFile = Effect.fn("BoardService.exportFile")(function* (input: {
    readonly boardId: string;
    readonly includeThreads: boolean;
  }) {
    const boardSettings = yield* settings(input);
    const { files, createdAt, archived, sessions } = yield* Effect.tryPromise({
      try: async () => {
        const registry = await store.loadRegistry();
        const board = registry.boards.find((board) => board.id === input.boardId);
        if (!board) throw new Error("No such board.");
        return {
          files: await BoardFile.readBoardFiles(store, input.boardId),
          createdAt: board.createdAt,
          archived: input.includeThreads
            ? await BoardFile.readArchivedThreads(store, input.boardId)
            : [],
          sessions: input.includeThreads ? await store.listSessions(input.boardId) : [],
        };
      },
      catch: failed,
    });
    const transcripts = new Map(archived.map((thread) => [thread.threadId, thread]));
    for (const session of sessions) {
      if (session.source?.kind !== "t3-thread") continue;
      const id = ThreadId.make(session.source.threadId);
      if (transcripts.has(id)) continue;
      const shell = yield* threads.getThreadShell(id).pipe(Effect.mapError(failed));
      if (shell === null) {
        if (session.title === "") continue;
        return yield* new BoardReadError({
          reason: "not-found",
          detail: `The thread "${session.title}" is unavailable in this environment. Export from the environment that holds it or choose Board only.`,
        });
      }
      const { projection } = yield* threads.getThreadSnapshot(id).pipe(Effect.mapError(failed));
      transcripts.set(id, {
        threadId: id,
        title: projection.thread.title,
        updatedAt: projection.updatedAt,
        items: projection.visibleTurnItems,
      });
    }
    return yield* Effect.try({
      try: () =>
        BoardFile.encodeBoardFile({
          id: input.boardId,
          createdAt,
          settings: boardSettings,
          files,
          threads: [...transcripts.values()],
        }),
      catch: failed,
    });
  });

  return BoardService.of({
    list,
    unassigned,
    view,
    taskDetail,
    editTask,
    createTask,
    settings,
    editBoard,
    createBoard,
    workspaceCandidates,
    archivedThreads,
    openFile,
    exportFile,
    linkThread,
  });
});

export const layer = Layer.effect(
  BoardService,
  Effect.suspend(() => make(new BoardStore(defaultBoardHome(), nodeIO), nodeGit)),
);
