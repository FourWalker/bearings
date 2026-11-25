import type { BoardChat, BoardTask } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { type BoardAttention, indexBoard } from "./board.logic";
import { pinBurstDelayMs, pinNoticeKey, pinViewOf } from "./boardPin.logic";

const task = (id: string, patch: Partial<BoardTask> = {}): BoardTask => ({
  id,
  title: id,
  description: "",
  status: "active",
  level: 3,
  parentId: null,
  kind: null,
  bug: false,
  mainService: null,
  services: [],
  lastAction: null,
  lastActionAt: 0,
  doneAt: null,
  starredAt: null,
  next: null,
  steps: { done: 0, total: 0 },
  chats: [],
  worked: [],
  items: [],
  decisions: [],
  links: [],
  owner: null,
  createdAt: 0,
  updatedAt: 0,
  ownerRoot: null,
  goal: null,
  evidence: null,
  doneNote: null,
  ...patch,
});
const chat = (sessionId: string, live: BoardChat["live"], updatedAt = 0): BoardChat => ({
  sessionId,
  title: sessionId,
  live,
  workspaceLabel: "main",
  taskId: null,
  updatedAt,
  threadId: null,
  provider: null,
  turnStartedAt: 0,
});
const step = { next: { id: "A2", text: "Cap attempts" }, steps: { done: 1, total: 3 } };

it("shows a pinned task's step in hand, and a pinned module's task unless the module is worked directly", () => {
  const module = (chats: BoardChat[]) =>
    indexBoard([
      task("retries", { level: 2, chats, next: { id: "M3", text: "Split policy" } }),
      task("spins", { parentId: "retries", ...step, chats: [chat("c1", "working")] }),
      task("jitter", { parentId: "retries", status: "done" }),
    ]);
  const quiet = module([]);
  expect(pinViewOf(quiet, quiet.byId.get("spins")!)).toMatchObject({
    slot: { kind: "step", id: "A2" },
    progress: { done: 1, total: 3, unit: "steps" },
    why: "working",
  });
  expect(pinViewOf(quiet, quiet.byId.get("retries")!)).toMatchObject({
    slot: { kind: "task", task: { id: "spins" } },
    progress: { done: 1, total: 2, unit: "tasks" },
  });
  // A chat on the module itself wins, even while another chat works one of its tasks.
  const direct = module([chat("c0", "working")]);
  expect(pinViewOf(direct, direct.byId.get("retries")!)).toMatchObject({
    slot: { kind: "step", id: "M3" },
    others: 1,
  });
  const plain = indexBoard([task("done", { steps: { done: 2, total: 2 } }), task("bare")]);
  expect(pinViewOf(plain, plain.byId.get("done")!).slot).toEqual({ kind: "done" });
  expect(pinViewOf(plain, plain.byId.get("bare")!)).toMatchObject({
    slot: { kind: "empty" },
    why: "none",
    chat: null,
  });
});

it("names the most urgent state, and one notice per thing to deal with", () => {
  const view = (
    attention: Array<[string, NonNullable<ReturnType<BoardAttention["get"]>>]>,
    patch: Partial<BoardTask> = {},
    waiting: ReadonlyArray<string> = [],
  ) => {
    const tasks = [
      task("spins", {
        chats: [chat("c1", "working", 2), chat("c2", "idle", 1), chat("old", "ended")],
        ...patch,
      }),
      task("keys"),
    ];
    const index = indexBoard(tasks, { attention: new Map(attention) });
    return pinViewOf(index, index.byId.get("spins")!, new Set(waiting));
  };
  expect(view([])).toMatchObject({ why: "working", chat: { sessionId: "c1" }, others: 1 });
  expect(pinNoticeKey(view([]))).toBeNull();
  // Waiting on background work is still not done, and not a reason to call the person.
  expect(view([], {}, ["c1"]).why).toBe("waiting");
  expect(view([["c2", { kind: "finished", at: 5 }]], { chats: [chat("c2", "idle")] }).why).toBe(
    "finished",
  );
  expect(view([["c2", { kind: "stopped" }]]).why).toBe("stopped");
  const blocked = view([["c2", { kind: "stopped" }]], {
    links: [{ to: "keys", type: "blocked_by", note: "" }] as BoardTask["links"],
  });
  expect(blocked).toMatchObject({ why: "blocked", blocker: { id: "keys" } });
  expect(pinNoticeKey(blocked)).toBe("spins:blocked:c1");
  const asked = view([
    ["c2", { kind: "needs", why: "question" }],
    ["c1", { kind: "needs", why: "approval" }],
  ]);
  expect(asked).toMatchObject({ why: "approval", chat: { sessionId: "c1" } });
  expect(pinNoticeKey(asked)).not.toBe(pinNoticeKey(blocked));
});

it("moves again after 30 seconds, a minute, then every two minutes", () => {
  expect([1, 2, 3, 9].map(pinBurstDelayMs)).toEqual([30_000, 30_000, 120_000, 120_000]);
});
