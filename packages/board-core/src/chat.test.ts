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
import { OFFLINE_MS, readBoardView, readTaskDetail } from "./view.ts";
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

    // A T3 worktree outside every root goes on its project folder's board.
    const worktree = new BoardChat(store, noGit, "t3");
    await worktree.open({ sessionId: "t2", cwd: `${ws}-worktrees/retry`, projectRoot: ws });
    expect(worktree.board?.id).toBe("nefx");
    expect(worktree.sess).toMatchObject({ workspace: ws, subfolder: "" });
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

  it("finishes a step and its living handoff in one call, and a delegated subtask ticks its parent step", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.linkTask({ newTaskTitle: "Retries" });
    await chat.savePlan({
      markdown: "## Phase A — Retry\n- [ ] A1 Retry handling\n- [ ] A2 Run the integration test",
    });
    await chat.createTask({ title: "Retry key", parentId: "retries", fromStep: "A1" });
    expect(nextStep(await store.readText(store.planPath("nefx", "retries")))?.id).toBe("A1");

    // The subtask finishes: the parent's next step moves past the work it took over.
    const worker = new BoardChat(new BoardStore(home, nodeIO, clock()), noGit, "t3");
    await worker.open({
      sessionId: "t2",
      cwd: wsB,
      source: { kind: "t3-thread", threadId: "t2", provider: "devReplay" },
    });
    await worker.linkTask({ taskId: "retry-key" });
    await worker.savePlan({ markdown: "- [ ] B1 Persist the key" });
    const done = await worker.writeHandoff(
      {
        step: "B1",
        markdown: "Key persisted. Unit check exited 0.",
        handoff: "Objective: retry key\nVerified: unit check exited 0.\nNext step: none, task done",
      },
      undefined,
      "run:worker",
    );
    expect(done.text).toContain("Living handoff rewritten");
    expect(await store.readText(store.livingPath("nefx", "retry-key"))).toContain(
      "Next step: none, task done",
    );
    expect(await store.readText(store.planPath("nefx", "retry-key"))).toContain("- [x] B1");
    await worker.recordCheck({
      id: "check:worker",
      command: "vp test",
      exitCode: 0,
      at: store.clock.now(),
    });
    const finished = await worker.updateTask({ status: "done" });
    expect(finished.text).toContain("(A1)");
    const parentPlan = () => store.readText(store.planPath("nefx", "retries"));
    expect(nextStep(await parentPlan())).toEqual({ id: "A2", text: "Run the integration test" });
    const resumed = await openChat(store, "t3", ws);
    await resumed.attachCheckpoint("run:unrelated", "refs/t3/unrelated");
    expect((await readTaskDetail(store, "nefx", "retry-key"))?.handoffCheckpoint).toBeNull();
    await resumed.attachCheckpoint("run:worker", "refs/t3/worker");
    const record = await readTaskDetail(store, "nefx", "retry-key");
    expect(record?.handoffCheckpoint).toBe("refs/t3/worker");
    expect(record?.stepNotes[0]).toMatchObject({
      checkpointRef: "refs/t3/worker",
      text: "Key persisted. Unit check exited 0.",
    });
    await resumed.linkTask({ taskId: "retries" });
    expect(resumed.context).toContain("Next action: A2");
    expect(resumed.context).toContain(
      "Completed delegated steps:\n- A1 – Retry handling (task retry-key)",
    );
    expect(resumed.context).toContain("Retry key: vp test exited 0");

    // Reopened, it takes its step back.
    await worker.updateTask({ status: "active" });
    expect(nextStep(await parentPlan())?.id).toBe("A1");

    // Without a handoff the reply says the living handoff is now behind.
    await chat.linkTask({ taskId: "retries" });
    const bare = await chat.writeHandoff({ step: "A2", markdown: "Ran it." });
    expect(bare.text).toContain("living handoff was not rewritten");
  });

  it("keeps binding decisions in the resume context ahead of open questions", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.linkTask({ newTaskTitle: "Retries" });
    const task = (await store.loadTask("nefx", "retries")) as Task;
    const decision = (id: string, status: "open" | "decided") => ({
      id,
      title: `Question ${id}`,
      description: "",
      level: 1 as const,
      raisedFrom: null,
      refs: [],
      options: "",
      verdict: status === "decided" ? "Retry at most 3 times" : "",
      status,
      at: 0,
    });
    await store.saveTask("nefx", {
      ...task,
      decisions: [
        ...Array.from({ length: 20 }, (_, i) => decision(`D-${i}`, "open")),
        decision("D-final", "decided"),
      ],
    });
    const text = await chat.describeTask((await store.loadTask("nefx", "retries")) as Task, true);
    expect(text).toContain("Retry at most 3 times");
  });

  it("gives a linked T3 thread a short resume summary, and an unlinked one only recent tasks", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    for (let i = 0; i < 10; i++) await chat.createTask({ title: `Task ${i}` });
    await chat.turnStart("Hi");
    await chat.rebuildContext();
    expect(chat.context).toContain("…and 2 more: search them with board_find");
    expect(chat.context.match(/^- task-/gm)).toHaveLength(8);

    await chat.linkTask({ taskId: "task-0" });
    await chat.savePlan({ markdown: "- [x] A1 Done thing\n- [ ] A2 Next thing" });
    await chat.linkTasks({ to: "task-1", type: "blocked_by", note: "contract" });
    await chat.checkpoint({ markdown: "Objective: ship\nNext step: an old next step" });
    expect(chat.context).toContain("Next action: A2 – Next thing (step 2 of 2)");
    expect(chat.context).toContain('Blocked by "Task 1"');
    expect(chat.context).toContain("### Living handoff");
    expect(chat.context).not.toContain("### Plan (plan.md)");
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

  it("gives T3 threads short rules apart from the task's state, and Claude chats the mod's protocol", async () => {
    const store = await seedBoard({ boardMode: true, rules: "Use pnpm." });
    const t3 = await openChat(store, "t1", ws, "t3");
    expect(t3.boardModeOn).toBe(false);
    expect(t3.context).toContain("standard conversation workflow");
    expect(t3.rules).toMatch(/^Token hygiene/);
    await t3.createTask({ title: "Discussed feature" });
    expect(t3.sess?.taskId).toBeFalsy();
    const linked = await t3.runTool("board_link", { newTaskTitle: "Task" });
    expect(t3.boardModeOn).toBe(true);
    expect(t3.context).not.toContain("Board Mode");
    expect(t3.rules).toContain("## Board Mode");
    expect(t3.rules).toContain("## Project rules for the NEFX board\nUse pnpm.");
    // The link's reply carried both, so the next turn has nothing new to send.
    expect(linked?.text).toContain(t3.rules);
    expect(t3.rulesSeen).toBe(t3.rules);
    expect(t3.contextSeen).toBe(t3.context);
    // A situational rule arrives once, with the tool that meets the situation.
    expect((await t3.findTasks({ query: "zzz" })).text).toContain("STOP and ask ONE question");
    expect((await t3.findTasks({ query: "zzz" })).text).toBe("No matching tasks.");
    // The thread's own answer doesn't change what it is sent.
    const before = t3.context;
    await t3.turnStart("go");
    await t3.turnComplete("Did the thing.");
    await t3.rebuildContext();
    expect(t3.context).toBe(before);
    t3.forgetSeen();
    expect((await t3.findTasks({ query: "zzz" })).text).toContain("STOP and ask ONE question");
    const cc = await openChat(store, "c1", ws, "claude-code");
    expect(cc.context).not.toContain("one phase per chat");
    await cc.linkTask({ taskId: "task" });
    expect(cc.context).toContain("one phase per chat");
    expect(boardModeProtocol("t3")).not.toMatch(/\bchat\b/);
  });

  it("finds work by a question's words, in plan steps too, and stops a duplicate task", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws, "t3");
    await chat.createTask({ title: "Marketplace" });
    await chat.createTask({
      title: "Catalog",
      parentId: "marketplace",
      plan: "## Phase B\n- [ ] B2 Seller checkout flow",
    });
    expect((await chat.findTasks({ query: "do we have a plan for seller checkout" })).text).toBe(
      "- catalog [L2, active] Marketplace › Catalog · planned as B2 – Seller checkout flow",
    );
    expect((await chat.findTasks({ query: "refunds" })).text).toBe("No matching tasks.");
    const again = { title: "Checkout flow", parentId: "marketplace" };
    expect((await chat.createTask(again)).text).toMatch(/^Not created: .*\n- catalog /s);
    expect((await chat.createTask({ ...again, createAnyway: true })).text).toMatch(
      /^Created Level 2/,
    );
  });

  it("records evidence when a task is done and checks it cheapest first", async () => {
    let since: "same" | "changed" | "unreachable" = "same";
    const git: BoardGit = {
      ...noGit,
      state: async () => ({
        repo: ws,
        name: "nfx",
        branch: "main",
        head: "abc1234",
        upstream: null,
        ahead: null,
        behind: null,
        dirty: 0,
        lastCommitAt: 0,
        at: 0,
      }),
      since: async () => since,
    };
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws, "t3", git);
    await chat.linkTask({ newTaskTitle: "Task" });
    await chat.filesChanged(["api/a.ts"]);
    const finish = async () => {
      await chat.updateTask({ status: "active" });
      const done = (await chat.updateTask({ status: "done" })).text;
      return `${done}\n${(await chat.readTask({})).text}`;
    };
    // Nothing proves it works: a later reader has to look for itself.
    expect(await finish()).toContain("done, unverified (no passing check)");
    await chat.recordCheck({ id: "c1", command: "npm test", exitCode: 0, at: 1 });
    const verified = await finish();
    expect(verified).toContain("nfx main @ abc1234, 1 file(s), npm test exited 0");
    expect(verified).toContain("files unchanged since; npm test passed");
    expect((await store.loadTask("nefx", "task"))?.doneEvidence?.files).toEqual([`${ws}/api/a.ts`]);
    since = "changed";
    expect(await finish()).toContain("re-run `npm test` before building on it");
    since = "unreachable";
    expect(await finish()).toContain("done elsewhere, not merged here");
  });

  it("runs a Goal: tasks in a row with light records, reconciling work done outside it", async () => {
    const git: BoardGit = {
      ...noGit,
      state: async () => ({
        repo: ws,
        name: "nfx",
        branch: "main",
        head: "abc1234",
        upstream: null,
        ahead: null,
        behind: null,
        dirty: 0,
        lastCommitAt: 0,
        at: 0,
      }),
      since: async () => "same",
    };
    const store = await seedBoard({ boardMode: true });
    const exec = await openChat(store, "t1", ws, "t3", git);
    await exec.createTask({ title: "Feature" });
    await exec.createTask({ title: "Module", parentId: "feature" });
    for (const title of ["Alpha", "Beta", "Gamma"])
      await exec.createTask({ title, parentId: "module" });

    const started = (
      await exec.goalTool({ action: "start", scope: ["module"], mode: "auto", title: "Ship it" })
    ).text;
    expect(started).toContain("Started Goal g-ship-it");
    expect(started).toContain("## Goal Mode");
    expect(started).toContain('Next task: alpha "Alpha"');
    expect(exec.rules).not.toContain("## Board Mode");
    const other = await openChat(store, "t2", ws, "t3", git);
    expect((await other.goalTool({ action: "start", scope: ["module"] })).text).toMatch(
      /^Not started: a task belongs to one active Goal/,
    );

    expect((await exec.goalTool({ action: "task", taskId: "alpha" })).text).toContain(
      "### Task: Alpha",
    );
    await exec.recordCheck({ id: "c1", command: "npm test", exitCode: 0, at: 1 });
    const done = (await exec.goalTool({ action: "done", note: "Built alpha" })).text;
    expect(done).toContain("npm test exited 0");
    expect(done).toContain('2 task(s) left. Next task: beta "Beta"');
    expect(
      (await exec.goalTool({ action: "decide", title: "Retry count", settled: "3, the default" }))
        .text,
    ).toContain("settled by the model");

    // Paused; meanwhile Beta is finished directly in another thread.
    expect((await exec.goalTool({ action: "pause", reason: "rate limit" })).text).toContain(
      "Paused Goal g-ship-it: rate limit",
    );
    expect(exec.rules).toContain("## Board Mode");
    await other.linkTask({ taskId: "beta" });
    await other.updateTask({ status: "done", lastAction: "Fixed beta directly" });
    const resumed = (await other.goalTool({ action: "resume", goalId: "g-ship-it" })).text;
    expect(resumed).toContain('- beta "Beta": finished in another thread. done, unverified');
    expect(resumed).toContain("G1 Retry count → 3, the default (settled by the model)");
    expect(resumed).toContain('Next task: gamma "Gamma"');
    await other.goalTool({ action: "task", taskId: "gamma" });
    expect((await other.goalTool({ action: "done" })).text).toContain("Goal g-ship-it is finished");
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
  it("reads one task's plan, handoff, master plan and the decisions raised in it", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.linkTask({ newTaskTitle: "Payments" });
    await chat.saveMasterPlan({ markdown: "Objective: payments" });
    await chat.createTask({ title: "Gateway", parentId: "payments" });
    await chat.linkTask({ taskId: "gateway" });
    await chat.turnStart("Wire the gateway");
    await chat.savePlan({
      markdown: ["## Phase A — Client", "- [x] A1 Client", "- [ ] A2 Retry"].join("\n"),
    });
    await chat.writeHandoff({ step: "A1", markdown: "Client done.", markStepDone: false });
    await chat.checkpoint({ markdown: "Objective: gateway" });
    await chat.fileDecision({ title: "Which provider?", level: 1 });
    await chat.mapDoc({ taskId: "payments", kind: "HLD", title: "Design", ref: "docs/hld.md" });
    const detail = await readTaskDetail(store, "nefx", "gateway");
    expect(detail).toMatchObject({
      masterTaskId: "payments",
      masterPlan: expect.stringContaining("Objective: payments"),
      plan: [
        {
          title: "Phase A — Client",
          steps: [
            { id: "A1", text: "Client", done: true, childId: null },
            { id: "A2", text: "Retry", done: false, childId: null },
          ],
        },
      ],
      handoff: expect.stringContaining("Objective: gateway"),
      stepNotes: [{ step: "A1", text: "Client done." }],
      docs: [{ title: "Design", from: { id: "payments", level: 1 } }],
      decisions: [
        { title: "Which provider?", status: "open", group: "up", filedOn: { id: "payments" } },
      ],
      parents: [{ id: "payments", level: 1 }],
      chats: [{ sessionId: "t1", lastPrompt: "Wire the gateway" }],
    });
    expect(await readTaskDetail(store, "nefx", "nope")).toBeNull();
  });

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
    expect(view?.services).toEqual([{ id: "api", name: "API", match: ["api"] }]);
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
    await linked.createTask({ title: "Retry", level: 3, parentId: "sftp", createAnyway: true });
    const sftp = (await store.loadTask("nefx", "sftp")) as Task;
    await store.saveTask("nefx", {
      ...sftp,
      owner: { root: wsB, label: "copy-b", state: "owned", since: 0 },
      items: [{ id: "i1", kind: "mandatory", text: "Keep ids stable", done: false, at: 0 }],
      links: [{ to: "retry", type: "blocked_by", note: "", at: 0 }],
    });
    // Past the heartbeat window a chat is offline.
    const later = await readBoardView(store, "nefx", t2.heartbeatAt + OFFLINE_MS * 2);
    const sftpLater = later?.tasks.find((t) => t.id === "sftp");
    expect(sftpLater?.chats[0]?.live).toBe("offline");
    expect(sftpLater).toMatchObject({
      kind: "feature",
      owner: { root: norm(wsB), label: "copy-b", state: "owned" },
      items: [{ id: "i1", kind: "mandatory", text: "Keep ids stable", done: false }],
      links: [{ to: "retry", type: "blocked_by", note: "" }],
      lastAction: null,
    });
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
