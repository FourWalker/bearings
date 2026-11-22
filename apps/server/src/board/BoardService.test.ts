// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { BoardChat, BoardStore, noGit, norm } from "@t3tools/board-core";
import { nodeIO } from "@t3tools/board-core/node";
import { type Project, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BoardService from "./BoardService.ts";

const project = (id: string, workspaceRoot: string): Project => ({
  id: ProjectId.make(id),
  title: id,
  workspaceRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const projectsAt = (all: ReadonlyArray<Project>) =>
  Layer.mock(ProjectService.ProjectService)({
    listPage: () => Effect.succeed({ projects: all, nextCursor: null }),
    getById: (id) => Effect.succeed(Option.fromNullishOr(all.find((p) => p.id === id))),
  });

it.effect("shows a T3 thread's own status and title, and drops threads this server lacks", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-service-")),
    );
    const ws = norm(NodePath.join(tmp, "nfx"));
    // Ten minutes before the test clock: the board app would show every chat here offline.
    const store = new BoardStore(NodePath.join(tmp, "board"), nodeIO, {
      now: () => -600_000,
      random: () => 0,
    });
    yield* Effect.promise(async () => {
      await store.saveRegistry({
        version: 1,
        boards: [{ id: "nefx", name: "NEFX", createdAt: 0, roots: [{ path: ws, label: "main" }] }],
      });
      for (const [id, prompt] of [
        ["thread:idle", "Refunds"],
        ["thread:running", "Payouts"],
        ["thread:elsewhere", "Another install"],
      ] as const) {
        const chat = new BoardChat(store, noGit, "t3");
        await chat.open({ sessionId: id, cwd: ws, source: { kind: "t3-thread", threadId: id } });
        await chat.turnStart(prompt);
      }
    });
    const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed(
          threadId === "thread:elsewhere"
            ? null
            : {
                ...liveThreadShell(threadId),
                title: threadId === "thread:idle" ? "Refund API" : "Payout API",
                activeRunId: threadId === "thread:running" ? RunId.make("run:1") : null,
              },
        ),
    });
    const layer = Layer.effect(BoardService.BoardService, BoardService.make(store, noGit)).pipe(
      Layer.provide(Layer.merge(threads, projectsAt([]))),
    );

    yield* Effect.gen(function* () {
      const boards = yield* BoardService.BoardService;
      expect(yield* boards.list).toEqual([{ id: "nefx", name: "NEFX", taskCount: 0 }]);
      const view = yield* boards.view({ boardId: "nefx" });
      expect(view.unlinked.map((c) => [c.threadId, c.title, c.live])).toEqual(
        expect.arrayContaining([
          [ThreadId.make("thread:idle"), "Refund API", "idle"],
          [ThreadId.make("thread:running"), "Payout API", "working"],
        ]),
      );
      // Not held here: no link, and with a stale heartbeat it isn't an open chat.
      expect(view.unlinked).toHaveLength(2);
      const missing = yield* Effect.flip(boards.view({ boardId: "nope" }));
      expect(missing.reason).toBe("not-found");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect(
  "links a new thread to a task before its first turn, and maps workspaces to projects",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-link-")),
      );
      const main = norm(NodePath.join(tmp, "nfx"));
      const copy = norm(NodePath.join(tmp, "nfx-copy"));
      const store = new BoardStore(NodePath.join(tmp, "board"), nodeIO);
      const draft = ThreadId.make("thread:draft");
      yield* Effect.promise(async () => {
        await store.saveRegistry({
          version: 1,
          boards: [
            {
              id: "nefx",
              name: "NEFX",
              createdAt: 0,
              roots: [
                { path: main, label: "main" },
                { path: copy, label: "copy" },
              ],
            },
          ],
        });
        const setup = new BoardChat(store, noGit, "t3");
        await setup.open({ sessionId: "thread:setup", cwd: main });
        await setup.createTask({ title: "Refunds" });
        await setup.createTask({ title: "Payouts", parentId: "refunds" });
        const payouts = await store.loadTask("nefx", "payouts");
        if (payouts === null) throw new Error("no task");
        await store.saveTask("nefx", {
          ...payouts,
          owner: { root: copy, label: "copy", state: "owned", since: 0 },
        });
      });
      const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed(threadId === "thread:started" ? liveThreadShell(threadId) : null),
      });
      const layer = Layer.effect(BoardService.BoardService, BoardService.make(store, noGit)).pipe(
        Layer.provide(
          Layer.merge(
            threads,
            projectsAt([
              project("project:main", main),
              project("project:main-api", `${main}/api`),
              project("project:other", norm(NodePath.join(tmp, "elsewhere"))),
            ]),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const boards = yield* BoardService.BoardService;
        const link = (threadId: ThreadId, projectId: string, taskId: string) =>
          boards.linkThread({
            boardId: "nefx",
            taskId,
            threadId,
            projectId: ProjectId.make(projectId),
          });
        // An unsent draft on a task isn't a chat there yet.
        yield* link(draft, "project:main", "refunds");
        const before = yield* boards.view({ boardId: "nefx" });
        expect(before.workspaces).toEqual([
          { label: "main", root: main, projectId: ProjectId.make("project:main") },
          { label: "copy", root: copy, projectId: null },
        ]);
        expect(before.tasks.find((t) => t.id === "refunds")?.chats).toEqual([]);
        expect(before.tasks.find((t) => t.id === "payouts")?.ownerRoot).toBe(copy);
        // The thread's board chat, opened at its first turn, keeps the link.
        yield* Effect.promise(async () => {
          const first = new BoardChat(store, noGit, "t3");
          await first.open({ sessionId: draft, cwd: main });
          await first.turnStart("Continue the refunds work");
        });
        expect((yield* Effect.promise(() => store.readSession("nefx", draft)))?.taskId).toBe(
          "refunds",
        );

        const reasons = yield* Effect.forEach(
          [
            link(ThreadId.make("thread:started"), "project:main", "refunds"),
            link(ThreadId.make("thread:b"), "project:other", "refunds"),
            link(ThreadId.make("thread:c"), "project:main", "nope"),
            link(ThreadId.make("thread:d"), "project:main", "payouts"),
          ],
          (attempt) => Effect.flip(attempt).pipe(Effect.map((error) => error.reason)),
        );
        expect(reasons).toEqual(["started", "not-on-board", "not-found", "blocked"]);
      }).pipe(Effect.provide(layer));
    }),
);

it.effect("creates and edits tasks for the person, and says why an edit is refused", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-edit-service-")),
    );
    const store = new BoardStore(NodePath.join(tmp, "board"), nodeIO);
    yield* Effect.promise(() =>
      store.saveRegistry({
        version: 1,
        boards: [
          { id: "nefx", name: "NEFX", createdAt: 0, roots: [{ path: norm(tmp), label: "main" }] },
        ],
      }),
    );
    const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed(null),
    });
    const layer = Layer.effect(BoardService.BoardService, BoardService.make(store, noGit)).pipe(
      Layer.provide(Layer.merge(threads, projectsAt([]))),
    );
    yield* Effect.gen(function* () {
      const boards = yield* BoardService.BoardService;
      const created = yield* boards.createTask({ boardId: "nefx", title: "Billing" });
      expect(created.createdId).toBe("billing");
      const child = yield* boards.editTask({
        boardId: "nefx",
        taskId: "billing",
        edit: { op: "createChild", title: "Retries" },
      });
      expect(child.createdId).toBe("retries");
      const refused = yield* Effect.flip(
        boards.editTask({ boardId: "nefx", taskId: "retries", edit: { op: "update", title: " " } }),
      );
      expect(refused).toMatchObject({ reason: "invalid", detail: "The title can't be empty." });
      const missing = yield* Effect.flip(
        boards.editTask({ boardId: "nope", taskId: "x", edit: { op: "toggleItem", itemId: "i" } }),
      );
      expect(missing.reason).toBe("not-found");
    }).pipe(Effect.provide(layer));
  }),
);
