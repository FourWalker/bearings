// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { BoardStore, norm } from "@t3tools/board-core";
import { nodeIO } from "@t3tools/board-core/node";

import { BOARD_HOST } from "../shared/boardIssue.ts";
import * as BoardIssueTracker from "./BoardIssueTracker.ts";

let tmp: string;
let store: BoardStore;
let ws: string;

beforeEach(async () => {
  tmp = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-tracker-"));
  ws = norm(NodePath.join(tmp, "nfx"));
  store = new BoardStore(NodePath.join(tmp, "board"), nodeIO);
  await store.saveRegistry({
    version: 1,
    boards: [{ id: "nefx", name: "NEFX", createdAt: 0, roots: [{ path: ws, label: "main" }] }],
  });
  const base = { status: "active" as const, lastAction: null, items: [], sessions: [] };
  await store.saveTask("nefx", {
    ...base,
    id: "pay",
    title: "Payments",
    description: "Take money",
    createdAt: 1,
    updatedAt: 1,
    level: 1,
    parentId: null,
  });
  await store.saveTask("nefx", {
    ...base,
    id: "gw",
    title: "Gateway",
    description: "",
    createdAt: 2,
    updatedAt: 2,
    level: 2,
    parentId: "pay",
    services: ["api"],
  });
  await store.saveTask("nefx", {
    ...base,
    id: "old",
    title: "Old",
    description: "",
    createdAt: 3,
    updatedAt: 3,
    status: "done",
  });
  await nodeIO.write(store.planPath("nefx", "gw"), "## Phase A\n- [ ] A1 Client");
  await nodeIO.write(store.stepHandoffPath("nefx", "gw", "A0"), "Spike done.");
});

afterEach(async () => {
  await NodeFSP.rm(tmp, { recursive: true, force: true });
});

const target = { cwd: "", host: BOARD_HOST, scope: "nefx" };

describe("BoardIssueTracker", () => {
  it.effect("covers a project by the board root that contains its folder", () =>
    Effect.gen(function* () {
      const api = yield* BoardIssueTracker.make(store);
      expect(yield* api.scopesFor(`${ws}/api`)).toEqual(["nefx"]);
      expect(yield* api.scopesFor(NodePath.join(tmp, "elsewhere"))).toEqual([]);
    }),
  );

  it.effect("lists open tasks with their path, level and services", () =>
    Effect.gen(function* () {
      const api = yield* BoardIssueTracker.make(store);
      const page = yield* api.listIssues({
        ...target,
        involvement: "all",
        state: "open",
        limit: 10,
        sort: "created",
      });
      expect(page.items.map((i) => [i.key, i.title, i.labels.map((l) => l.name)])).toEqual([
        ["gw", "Payments › Gateway", ["L2 module", "api"]],
        ["pay", "Payments", ["L1 master task"]],
      ]);
      expect(page.nextCursor).toBeNull();
    }),
  );

  it.effect("reads a task with its plan and step notes as comments, and moves its state", () =>
    Effect.gen(function* () {
      const api = yield* BoardIssueTracker.make(store);
      const detail = yield* api.getIssue({ ...target, key: "gw" });
      expect(detail.comments.map((c) => c.id)).toEqual(["gw:plan", "gw:step:A0"]);
      expect(detail.states.map((s) => s.name)).toEqual(["Active", "Paused", "Done"]);

      yield* api.setState!({ ...target, key: "gw", state: "Done" });
      expect((yield* Effect.promise(() => store.loadTask("nefx", "gw")))?.status).toBe("done");
      const refused = yield* Effect.flip(api.setState!({ ...target, key: "gw", state: "Closed" }));
      expect(refused.detail).toContain("not a board task state");
    }),
  );

  it.effect("creates a master task and edits title and purpose", () =>
    Effect.gen(function* () {
      const api = yield* BoardIssueTracker.make(store);
      const created = yield* api.create!({
        ...target,
        title: "SFTP",
        body: "Move files",
        labels: [],
        assignees: [],
      });
      expect(created.key).toBe("sftp");
      yield* api.update!({ ...target, key: "sftp", title: "SFTP import" });
      const t = yield* Effect.promise(() => store.loadTask("nefx", "sftp"));
      expect(t).toMatchObject({
        title: "SFTP import",
        description: "Move files",
        level: 1,
        kind: "feature",
      });
    }),
  );
});
