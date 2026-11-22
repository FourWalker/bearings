// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { BoardChat } from "./chat.ts";
import { type BoardGit, noGit } from "./io.ts";
import { nodeIO } from "./nodeIO.ts";
import { nextStep, tickStep } from "./plan.ts";
import { boardModeProtocol } from "./protocol.ts";
import { BoardStore } from "./store.ts";
import { norm } from "./text.ts";
import { BOARD_TOOL_NAMES } from "./tools.ts";
import { OFFLINE_MS, readBoardView } from "./view.ts";
import type { Registry, Session, Task } from "./types.ts";

let home: string;
let ws: string;
let wsB: string;

const clock = () => {
  let t = 1_700_000_000_000;
  return { now: () => (t += 1000), random: () => 0 };
};

async function seedBoard(extra: Partial<Registry["boards"][number]> = {}) {
  const store = new BoardStore(home, nodeIO, clock());
  await store.saveRegistry({
    version: 1,
    boards: [
      {
        id: "nefx",
        name: "NEFX",
        createdAt: 0,
        roots: [
          { path: ws, label: "main" },
          { path: wsB, label: "copy-b" },
        ],
        ...extra,
      },
    ],
  });
  return store;
}

async function openChat(
  store: BoardStore,
  sessionId: string,
  cwd: string,
  host: "t3" | "claude-code" = "t3",
  git: BoardGit = noGit,
) {
  const chat = new BoardChat(store, git, host);
  await chat.open({
    sessionId,
    cwd,
    source: { kind: "t3-thread", threadId: sessionId, provider: "codex" },
  });
  return chat;
}

beforeEach(async () => {
  const tmp = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-core-"));
  home = norm(NodePath.join(tmp, "board"));
  ws = norm(NodePath.join(tmp, "nfx"));
  wsB = norm(NodePath.join(tmp, "nfx-b"));
  await NodeFSP.mkdir(NodePath.join(ws, "api"), { recursive: true });
  await NodeFSP.mkdir(wsB, { recursive: true });
});

afterEach(async () => {
  await NodeFSP.rm(NodePath.dirname(home), { recursive: true, force: true });
});

describe("plan", () => {
  it("finds the first unticked step and ticks by id", () => {
    const plan =
      "# Plan\n\n## Phase A — Conn\n- [x] A1 Client\n- [ ] A2 Retry handling\n- [ ] A3 Timeouts";
    expect(nextStep(plan)).toEqual({ id: "A2", text: "Retry handling" });
    expect(nextStep(tickStep(plan, "a2"))).toEqual({ id: "A3", text: "Timeouts" });
  });
});

describe("BoardChat", () => {
  it("places a chat on the board of the deepest root and records where it runs", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", `${ws}/api`);
    expect(chat.board?.id).toBe("nefx");
    expect(chat.sess).toMatchObject({ workspace: ws, workspaceLabel: "main", subfolder: "api" });
    expect(chat.context).toContain("not linked to a board task yet");
  });

  it("writes nothing for a chat until the person speaks or links it", async () => {
    const store = await seedBoard();
    await openChat(store, "t1", ws);
    expect(await store.readSession("nefx", "t1")).toBeNull();
  });

  // T3 thread ids hold colons, which Windows reads as an NTFS stream; the board app names files the same way.
  it("stores a thread whose id isn't a file name under the board app's safe name", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "mcp:3bbe-f26a", ws);
    await chat.turnStart("Add the refund API");
    expect(await NodeFSP.readdir(NodePath.join(home, "projects", "nefx", "sessions"))).toEqual([
      "mcp3bbe-f26a.json",
    ]);
    expect((await store.readSession("nefx", "mcp:3bbe-f26a"))?.lastPrompt).toBe(
      "Add the refund API",
    );
  });

  it("links a new task, then keeps plan, handoffs and last action on it", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.turnStart("Build the SFTP client");
    const linked = await chat.linkTask({
      newTaskTitle: "SFTP",
      description: "Move files over SFTP",
    });
    expect(linked.text).toContain("Linked this thread to the task.");

    await chat.savePlan({ markdown: "## Phase A — Conn\n- [ ] A1 Client\n- [ ] A2 Retry" });
    const ho = await chat.writeHandoff({ step: "A1", markdown: "Client wrapper done." });
    expect(ho.text).toContain("Next step: A2 – Retry");

    const task = (await store.loadTask("nefx", "sftp")) as Task;
    expect(task.sessions.map((s) => s.sessionId)).toEqual(["t1"]);
    expect(task.lastAction?.text).toBe("Finished A1: Client wrapper done.");
    expect(await store.readText(store.planPath("nefx", "sftp"))).toContain("- [x] A1 Client");

    const sess = (await store.readSession("nefx", "t1")) as Session;
    expect(sess).toMatchObject({
      taskId: "sftp",
      status: "working",
      title: "Build the SFTP client",
    });
    expect(sess.source).toEqual({ kind: "t3-thread", threadId: "t1", provider: "codex" });
  });

  it("uses the answer's first paragraph as last action unless a tool set one this turn", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.linkTask({ newTaskTitle: "SFTP" });
    await chat.turnStart("go");
    await chat.turnComplete("Added retries.\n\nDetails follow.");
    expect((await store.loadTask("nefx", "sftp"))?.lastAction?.text).toBe("Added retries.");

    await chat.turnStart("again");
    await chat.updateTask({ lastAction: "Wrote the tests" });
    await chat.turnComplete("Something else.");
    expect((await store.loadTask("nefx", "sftp"))?.lastAction?.text).toBe("Wrote the tests");
  });

  it("files a decision at the level it affects and maps it back to the task", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.linkTask({ newTaskTitle: "Payments" });
    await chat.createTask({ title: "Gateway", parentId: "payments" });
    await chat.linkTask({ taskId: "gateway" });
    const r = await chat.fileDecision({
      title: "Which provider?",
      level: 1,
      recommendation: true,
      area: "payments",
    });
    expect(r.text).toContain("Recommendation R1");
    const master = (await store.loadTask("nefx", "payments")) as Task;
    expect(master.decisions?.[0]).toMatchObject({
      level: 1,
      raisedFrom: { id: "gateway" },
      rec: { r: "R1" },
    });
  });

  it("blocks another workspace copy from an owned module until the person overrides", async () => {
    const store = await seedBoard();
    const a = await openChat(store, "t1", ws);
    await a.linkTask({ newTaskTitle: "Feature" });
    await a.createTask({ title: "Module", parentId: "feature" });
    await a.linkTask({ taskId: "module" }); // claims the module for "main"

    const b = await openChat(store, "t2", wsB);
    expect((await b.linkTask({ taskId: "module" })).text).toMatch(
      /^BLOCKED: "Module" is owned by workspace main/,
    );
    expect((await b.linkTask({ taskId: "module", override: "once" })).text).toMatch(
      /needs the person's approval/,
    );
    expect(
      (await b.linkTask({ taskId: "module", override: "once", personSaid: "yes, once" })).text,
    ).toContain("one-time override");
    expect((await b.updateTask({ lastAction: "edit" })).text).toContain("Board updated");
  });

  it("tags the task with a service from a changed file and warns once when scope widens", async () => {
    const store = await seedBoard({
      services: [
        { id: "api", name: "API", match: ["api"] },
        { id: "web", name: "Web", match: ["web"] },
      ],
    });
    const chat = await openChat(store, "t1", ws);
    await chat.linkTask({ newTaskTitle: "Task" });
    expect(await chat.fileChanged(`${ws}/api/src/a.ts`)).toBeNull();
    expect(await chat.fileChanged(`${ws}/web/src/b.ts`)).toContain(
      "outside this task's services so far (API)",
    );
    expect((await store.loadTask("nefx", "task"))?.services).toEqual(["api", "web"]);
  });

  it("adds the reconciled Board Mode protocol for T3 threads and the mod's own for Claude chats", async () => {
    const store = await seedBoard({ boardMode: true, rules: "Use pnpm." });
    const t3 = await openChat(store, "t1", ws, "t3");
    await t3.linkTask({ newTaskTitle: "Task" });
    expect(t3.context).toContain("one phase per thread");
    expect(t3.context).toContain("## Project rules for the NEFX board\nUse pnpm.");
    const cc = await openChat(store, "c1", ws, "claude-code");
    expect(cc.context).toContain("one phase per chat");
    expect(boardModeProtocol("t3")).not.toMatch(/\bchat\b/);
  });

  it("creates a board on request and moves an unassigned record into it", async () => {
    const store = new BoardStore(home, nodeIO, clock());
    const chat = await openChat(store, "t1", ws);
    expect(chat.board).toBeNull();
    await chat.turnStart("hello");
    expect(await store.readSession(null, "t1")).not.toBeNull();
    const r = await chat.setupBoard({ action: "create", name: "NEFX", root: ws });
    expect(r.toast).toBe("Board: created NEFX");
    expect((await store.readSession(null, "t1"))?.movedTo).toBe("nefx");
    expect((await store.readSession("nefx", "t1"))?.title).toBe("hello");
  });

  it("exposes every board tool through runTool", () => {
    const chat = new BoardChat(new BoardStore(home, nodeIO), noGit, "t3");
    for (const name of BOARD_TOOL_NAMES) expect(chat.runTool(name, {})).not.toBeNull();
    expect(chat.runTool("not_a_tool", {})).toBeNull();
  });
});

describe("readBoardView", () => {
  it("shows tasks with plan progress and their chats, and chats not on a task", async () => {
    const store = await seedBoard({ services: [{ id: "api", name: "API", match: ["api"] }] });
    const linked = await openChat(store, "t1", ws);
    await linked.turnStart("Build the SFTP client");
    await linked.linkTask({ newTaskTitle: "SFTP" });
    await linked.savePlan({ markdown: "## Phase A\n- [x] A1 Client\n- [ ] A2 Retry" });
    const loose = await openChat(store, "t2", ws);
    await loose.turnStart("A quick question");
    const gone = await openChat(store, "t3", ws, "claude-code");
    await gone.turnStart("Old chat");

    const t2 = (await store.readSession("nefx", "t2")) as Session;
    const view = await readBoardView(store, "nefx", t2.heartbeatAt + OFFLINE_MS / 2);
    expect(view?.services).toEqual([{ id: "api", name: "API" }]);
    expect(view?.workspaces).toEqual([
      { label: "main", root: norm(ws) },
      { label: "copy-b", root: norm(wsB) },
    ]);
    expect(view?.tasks).toMatchObject([
      {
        id: "sftp",
        title: "SFTP",
        level: 1,
        next: { id: "A2", text: "Retry" },
        steps: { done: 1, total: 2 },
        chats: [{ sessionId: "t1", threadId: "t1", provider: "codex", live: "working" }],
        ownerRoot: null,
      },
    ]);
    expect(view?.unlinked.map((c) => [c.sessionId, c.title, c.threadId])).toEqual([
      ["t3", "Old chat", "t3"],
      ["t2", "A quick question", "t2"],
    ]);
    // A task with no owner of its own belongs to the nearest owned parent's workspace copy.
    await linked.createTask({ title: "Retry", level: 3, parentId: "sftp" });
    const sftp = (await store.loadTask("nefx", "sftp")) as Task;
    await store.saveTask("nefx", {
      ...sftp,
      owner: { root: wsB, label: "copy-b", state: "owned", since: 0 },
    });
    // Past the heartbeat window a chat is offline.
    const later = await readBoardView(store, "nefx", t2.heartbeatAt + OFFLINE_MS * 2);
    const sftpLater = later?.tasks.find((t) => t.id === "sftp");
    expect(sftpLater?.chats[0]?.live).toBe("offline");
    expect(later?.tasks.map((t) => [t.id, t.ownerRoot])).toEqual(
      expect.arrayContaining([
        ["sftp", norm(wsB)],
        ["retry", norm(wsB)],
      ]),
    );
    expect(later?.unlinked.map((c) => c.live)).toEqual(["offline", "offline"]);
    expect(await readBoardView(store, "nope", 0)).toBeNull();
  });
});
