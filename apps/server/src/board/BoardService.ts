/**
 * Reads the Project Board for clients: its boards, and one board's tasks and chats. A T3 thread's
 * status and title come from this server's own thread, not from the board's heartbeat, so a thread
 * nobody has used since a restart shows idle, not offline. Also puts a new thread on a task.
 *
 * @module board/BoardService
 */
import {
  BoardLinkError,
  type BoardLinkThreadInput,
  type BoardChat as BoardChatRow,
  BoardReadError,
  type BoardSummary,
  type BoardView,
  type Project,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  BoardChat,
  type BoardGit,
  BoardStore,
  findBoard,
  norm,
  readBoardSummaries,
  readBoardView,
} from "@t3tools/board-core";
import { defaultBoardHome, nodeGit, nodeIO } from "@t3tools/board-core/node";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";

export class BoardService extends Context.Service<
  BoardService,
  {
    readonly list: Effect.Effect<ReadonlyArray<BoardSummary>, BoardReadError>;
    readonly view: (input: {
      readonly boardId: string;
    }) => Effect.Effect<BoardView, BoardReadError>;
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

  const view = Effect.fn("BoardService.view")(function* (input: { readonly boardId: string }) {
    const now = yield* Clock.currentTimeMillis;
    const raw = yield* Effect.tryPromise({
      try: () => readBoardView(store, input.boardId, now),
      catch: failed,
    });
    if (raw === null) {
      return yield* new BoardReadError({ reason: "not-found", detail: "No such board." });
    }
    const resolve = (chats: ReadonlyArray<(typeof raw.unlinked)[number]>) =>
      Effect.forEach(
        chats,
        (chat) =>
          withThread({
            ...chat,
            threadId: chat.threadId === null ? null : ThreadId.make(chat.threadId),
          }),
        { concurrency: 8 },
      ).pipe(Effect.map((rows) => rows.filter((row) => row !== null)));
    const tasks = yield* Effect.forEach(raw.tasks, (task) =>
      resolve(task.chats).pipe(Effect.map((chats) => ({ ...task, chats }))),
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
    return { ...raw, workspaces, tasks, unlinked } satisfies BoardView;
  });

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
        if ((await store.loadTask(input.boardId, input.taskId)) === null)
          return new BoardLinkError({ reason: "not-found", detail: "No such task." });
        const chat = new BoardChat(store, git, "t3");
        await chat.open({
          sessionId: input.threadId,
          cwd,
          source: { kind: "t3-thread", threadId: input.threadId, projectId: input.projectId },
        });
        const reply = await chat.linkTask({ taskId: input.taskId });
        const linked = await store.readSession(input.boardId, input.threadId);
        return linked?.taskId === input.taskId
          ? null
          : new BoardLinkError({ reason: "blocked", detail: reply.text });
      },
      catch: linkFailed,
    }).pipe(Effect.flatMap((error) => (error === null ? Effect.void : Effect.fail(error))));
  });

  return BoardService.of({ list, view, linkThread });
});

export const layer = Layer.effect(
  BoardService,
  Effect.suspend(() => make(new BoardStore(defaultBoardHome(), nodeIO), nodeGit)),
);
