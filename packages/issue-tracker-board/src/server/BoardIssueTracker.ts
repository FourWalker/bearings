/**
 * The Project Board as a local issue tracker. A task is an issue, and a project's folder picks its board
 * (the deepest board root containing it). The body is the task's purpose; its plan, living
 * handoff and step notes read as comments, and nothing writes them from here.
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type {
  IssueCapabilities,
  IssueComment,
  IssueLabel,
  IssueState,
  IssueViewerPermissions,
} from "@t3tools/contracts";
import {
  IssueTrackerError,
  type LocalIssueTrackerApi,
  type TrackerIssueSummary,
} from "@t3tools/source-control-core/server/IssueTracker";
import {
  type BoardStore,
  LEVEL_NAME,
  type Task,
  type TaskStatus,
  findBoard,
  levelOf,
  slug,
} from "@t3tools/board-core";

import { BOARD_HOST, BOARD_KIND, boardTaskUrl } from "../shared/boardIssue.ts";

const CAPABILITIES: IssueCapabilities = {
  create: true,
  edit: true,
  comment: false,
  labels: false,
  assignees: false,
  reactions: false,
  templates: false,
  linkedPullRequests: false,
  events: false,
  search: true,
};

const PERMISSIONS: IssueViewerPermissions = {
  setState: true,
  comment: false,
  edit: true,
  labels: false,
  assignees: false,
};

const STATES: ReadonlyArray<readonly [TaskStatus, IssueState]> = [
  ["active", { category: "open", name: "Active" }],
  ["paused", { category: "open", name: "Paused" }],
  ["done", { category: "closed", name: "Done", closeReason: "completed" }],
];
const stateOf = (status: TaskStatus): IssueState =>
  (STATES.find(([s]) => s === status) ?? STATES[0])?.[1] ?? { category: "open", name: "Active" };

const VIEWER = "you";
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms || 0));

const failure = (
  operation: string,
  detail: string,
  reason: IssueTrackerError["reason"] = "failed",
) => new IssueTrackerError({ tracker: BOARD_KIND, operation, reason, detail });

const attempt = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new IssueTrackerError({
        tracker: BOARD_KIND,
        operation,
        reason: "failed",
        detail: "The board folder could not be read or written.",
        cause,
      }),
  });

const label = (name: string): IssueLabel => ({ name, color: null });

export const make = (store: BoardStore): Effect.Effect<LocalIssueTrackerApi> =>
  Effect.sync(() => {
    const loadTask = (operation: string, boardId: string, key: string) =>
      attempt(operation, () => store.loadTask(boardId, key)).pipe(
        Effect.filterOrFail(
          (task): task is Task => task !== null,
          () => failure(operation, `No task "${key}" on board ${boardId}.`, "not-found"),
        ),
      );

    const notesOf = async (boardId: string, t: Task): Promise<IssueComment[]> => {
      const notes: IssueComment[] = [];
      const plan = await store.readText(store.planPath(boardId, t.id));
      if (plan.trim())
        notes.push({
          id: `${t.id}:plan`,
          author: null,
          body: `### Plan\n\n${plan}`,
          createdAt: iso(t.createdAt),
          url: null,
        });
      const living = await store.readText(store.livingPath(boardId, t.id));
      if (living.trim())
        notes.push({
          id: `${t.id}:handoff`,
          author: null,
          body: `### Living handoff\n\n${living}`,
          createdAt: iso(t.updatedAt),
          url: null,
        });
      try {
        const files = (await store.io.list(`${store.taskDir(boardId, t.id)}/handoffs`))
          .filter((f) => f.kind === "file" && f.name.endsWith(".md"))
          .toSorted((a, b) => a.mtimeMs - b.mtimeMs);
        for (const f of files) {
          const step = f.name.replace(/\.md$/, "");
          const text = await store.readText(store.stepHandoffPath(boardId, t.id, step));
          notes.push({
            id: `${t.id}:step:${step}`,
            author: null,
            body: `### Step ${step}\n\n${text}`,
            createdAt: iso(f.mtimeMs),
            url: null,
          });
        }
      } catch {}
      return notes;
    };

    const summaryOf = (
      boardId: string,
      t: Task,
      byId: ReadonlyMap<string, Task>,
      commentCount: number,
    ): TrackerIssueSummary => {
      const lv = levelOf(t);
      const path: string[] = [];
      for (
        let c = t.parentId ? byId.get(t.parentId) : undefined, i = 0;
        c && i < 3;
        c = c.parentId ? byId.get(c.parentId) : undefined, i++
      )
        path.unshift(c.title);
      return {
        key: t.id,
        displayKey: t.id,
        title: path.length ? `${path.join(" › ")} › ${t.title}` : t.title,
        url: boardTaskUrl(boardId, t.id),
        author: null,
        state: stateOf(t.status),
        createdAt: iso(t.createdAt),
        updatedAt: iso(t.updatedAt),
        closedAt: t.status === "done" ? iso(t.updatedAt) : null,
        assignees: [],
        labels: [
          label(`L${lv} ${LEVEL_NAME[lv]}`),
          ...(lv === 1 && t.kind === "backlog" ? [label("backlog")] : []),
          ...(t.bug ? [label("bug")] : []),
          ...(t.services ?? []).map((s) => label(s)),
        ],
        commentCount,
      };
    };

    const api: LocalIssueTrackerApi = {
      kind: BOARD_KIND,
      capabilities: CAPABILITIES,
      local: { host: BOARD_HOST },

      scopesFor: (workspaceRoot) =>
        attempt("scopesFor", () => store.loadRegistry()).pipe(
          Effect.map((reg) => {
            const hit = findBoard(reg, workspaceRoot);
            return hit ? [hit.board.id] : [];
          }),
          Effect.orElseSucceed(() => []),
        ),

      getViewer: () => Effect.succeed(VIEWER),

      listIssues: (input) =>
        attempt("listIssues", async () => {
          const all = await store.listTasks(input.scope);
          const byId = new Map(all.map((t) => [t.id, t]));
          const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
          const hits = all
            .filter((t) => input.state === "all" || stateOf(t.status).category === input.state)
            .filter((t) =>
              words.every((w) => `${t.title} ${t.description} ${t.id}`.toLowerCase().includes(w)),
            )
            .filter(
              (t) =>
                !input.labels?.length ||
                input.labels.every((l) =>
                  summaryOf(input.scope, t, byId, 0).labels.some((x) => x.name === l),
                ),
            )
            .toSorted((a, b) =>
              input.sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt,
            );
          const start = Number(input.cursor ?? 0) || 0;
          const page = hits.slice(start, start + input.limit);
          return {
            items: page.map((t) => summaryOf(input.scope, t, byId, 0)),
            nextCursor: start + input.limit < hits.length ? String(start + input.limit) : null,
          };
        }),

      getIssue: Effect.fn("BoardIssueTracker.getIssue")(function* (input) {
        const t = yield* loadTask("getIssue", input.scope, input.key);
        const [all, notes] = yield* attempt("getIssue", () =>
          Promise.all([store.listTasks(input.scope), notesOf(input.scope, t)]),
        );
        const byId = new Map(all.map((x) => [x.id, x]));
        return {
          ...summaryOf(input.scope, t, byId, notes.length),
          body: t.description,
          viewer: VIEWER,
          viewerPermissions: PERMISSIONS,
          states: STATES.map(([, s]) => s),
          comments: notes,
          commentsCursor: null,
          events: [],
          linkedPullRequests: [],
        };
      }),

      getComments: () => Effect.succeed({ comments: [], nextCursor: null }),

      create: (input) =>
        attempt("create", async () => {
          const title = input.title.trim();
          const id = await store.freeTaskId(input.scope, slug(title));
          const now = store.clock.now();
          await store.saveTask(input.scope, {
            id,
            title,
            description: input.body.trim(),
            status: "active",
            createdAt: now,
            updatedAt: now,
            lastAction: null,
            items: [],
            sessions: [],
            level: 1,
            parentId: null,
            kind: "feature",
          });
          return { key: id, displayKey: id, url: boardTaskUrl(input.scope, id) };
        }),

      update: Effect.fn("BoardIssueTracker.update")(function* (input) {
        const t = yield* loadTask("update", input.scope, input.key);
        if (input.title !== undefined) t.title = input.title.trim();
        if (input.body !== undefined) t.description = input.body.trim();
        yield* attempt("update", () => store.saveTask(input.scope, t));
      }),

      setState: Effect.fn("BoardIssueTracker.setState")(function* (input) {
        const target = STATES.find(([, s]) => s.name === input.state);
        if (!target)
          return yield* failure("setState", `"${input.state}" is not a board task state.`);
        const t = yield* loadTask("setState", input.scope, input.key);
        t.status = target[0];
        yield* attempt("setState", () => store.saveTask(input.scope, t));
      }),
    };
    return api;
  });
