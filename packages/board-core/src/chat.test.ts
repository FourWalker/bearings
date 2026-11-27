// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { BoardChat } from "./chat.ts";
import { editTask } from "./edit.ts";
import { closeGoal, loadGoal, saveGoal } from "./goal.ts";
import { type BoardGit, noGit } from "./io.ts";
import { nodeIO } from "./nodeIO.ts";
import { nextStep, tickStep } from "./plan.ts";
import { t3OnDemandRule } from "./protocol.ts";
import { BoardStore } from "./store.ts";
import { norm } from "./text.ts";
import { BOARD_TOOL_NAMES } from "./tools.ts";
import { MODEL_SETTLED, OFFLINE_MS, readBoardView, readTaskDetail } from "./view.ts";
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

async function openChat(store: BoardStore, sessionId: string, cwd: string, git: BoardGit = noGit) {
  const chat = new BoardChat(store, git);
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
    const worktree = new BoardChat(store, noGit);
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

  it("lists a chat on a task whose step it ticks, and leaves its link where it is", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.turnStart("Build transfers");
    await chat.createTask({ title: "Transfers", topLevel: true });
    await chat.createTask({ title: "Retries", parentId: "transfers" });
    await chat.createTask({ title: "Backoff", parentId: "transfers" });
    await chat.savePlan({ taskId: "retries", markdown: "- [ ] A1 Loop\n- [ ] A2 Test" });
    await chat.savePlan({ taskId: "backoff", markdown: "- [ ] B1 Jitter" });
    await chat.linkTask({ taskId: "retries" });
    const refs = async (id: string) =>
      ((await store.loadTask("nefx", id)) as Task).sessions.map((ref) => [
        ref.sessionId,
        ref.ticked?.step ?? null,
      ]);
    // Saving a plan with nothing ticked is not work on the task.
    expect(await refs("backoff")).toEqual([]);

    // A tick on another task lists the chat there; it stays linked to its own.
    await chat.savePlan({ taskId: "backoff", markdown: "- [x] B1 Jitter" });
    expect(await refs("backoff")).toEqual([["t1", "B1"]]);
    expect(chat.sess?.taskId).toBe("retries");
    expect((await chat.workedOn()).map((task) => task.id)).toEqual(["backoff"]);

    // A tick on its own task keeps it listed there after it links elsewhere.
    await chat.writeHandoff({ step: "A1", markdown: "Loop fixed." });
    await chat.linkTask({ taskId: "backoff" });
    expect(await refs("retries")).toEqual([["t1", "A1"]]);
    expect((await chat.workedOn()).map((task) => task.id)).toEqual(["retries"]);

    const view = await readBoardView(store, "nefx", 1_700_000_100_000);
    const shown = (id: string) => view?.tasks.find((task) => task.id === id);
    expect(shown("retries")?.worked.map((entry) => [entry.chat.sessionId, entry.step])).toEqual([
      ["t1", "A1"],
    ]);
    expect(shown("retries")?.chats).toEqual([]);
    expect(shown("backoff")?.worked).toEqual([]);

    // The person takes it off the task it only worked on; the linked task keeps it.
    await chat.dropWorked("retries");
    await chat.dropWorked("backoff");
    expect(await refs("retries")).toEqual([]);
    expect(await refs("backoff")).toEqual([["t1", null]]);
  });

  it("links a chat on no task to the item it creates, and to a task it records work on", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.turnStart("Why does the retry loop spin?");
    await chat.createTask({ title: "Transfers", topLevel: true });
    await chat.createTask({ title: "Retries", parentId: "transfers" });
    // The reply says so once, and leaves the item's context for the next turn.
    const made = await chat.runTool("board_create_task", {
      title: "Retry loop spins",
      parentId: "retries",
      bug: true,
    });
    expect((await made)?.text).toContain("is now linked to retry-loop-spins");
    expect(chat.contextSeen).not.toBe(chat.context);
    // It followed the items down to the last one it created.
    expect(chat.sess?.taskId).toBe("retry-loop-spins");
    expect((await store.loadTask("nefx", "retries"))?.sessions).toEqual([]);
    expect(
      (await store.loadTask("nefx", "retry-loop-spins"))?.sessions.map((s) => s.sessionId),
    ).toEqual(["t1"]);

    // Once it works on the item, what it creates next is other work and doesn't move it.
    await chat.filesChanged(["api/retry.ts"]);
    await chat.createTask({ title: "Backoff jitter", parentId: "retries" });
    expect(chat.sess?.taskId).toBe("retry-loop-spins");

    // Work recorded on a task by id links the chat that recorded it.
    const other = await openChat(store, "t2", ws);
    await other.turnStart("Look at transfers");
    await other.writeHandoff({ taskId: "retries", step: "note", markdown: "Mapped the callers." });
    expect(other.sess?.taskId).toBe("retries");

    // "Stay unlinked" is the person's call: creating an item no longer links the chat.
    const off = await openChat(store, "t3", ws);
    await off.turnStart("File the flaky test");
    await off.linkTask({ decline: true });
    await off.createTask({ title: "Flaky upload test", parentId: "retries" });
    expect(off.sess?.taskId).toBeNull();
  });

  it("lists the documents a task's thread wrote or linked as its outputs, once", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.turnStart("Write the runbook");
    await chat.linkTask({ newTaskTitle: "Runbook" });
    await chat.filesChanged(["docs/runbook.md", "api/retry.ts"]);
    await chat.turnComplete(
      "[Manual Test Runbook](https://claude.ai/artifact/abc) is ready.\n\nSee also plain https://example.com.",
    );
    const outputs = async () =>
      ((await store.loadTask("nefx", "runbook")) as Task).docs?.map((doc) => [doc.kind, doc.title]);
    expect(await outputs()).toEqual([
      ["Output", "runbook.md"],
      ["Output", "Manual Test Runbook"],
    ]);
    // Touched or linked again, it is not listed twice; removed by the person, it stays off.
    const task = (await store.loadTask("nefx", "runbook")) as Task;
    await editTask(
      store,
      "nefx",
      "runbook",
      { op: "removeDoc", docId: task.docs![0]!.id },
      { by: "me" },
    );
    await chat.filesChanged(["docs/runbook.md", "docs/notes.txt"]);
    await chat.turnComplete("[Manual Test Runbook](https://claude.ai/artifact/abc) again.");
    expect(await outputs()).toEqual([
      ["Output", "Manual Test Runbook"],
      ["Output", "notes.txt"],
    ]);
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
    const worker = new BoardChat(new BoardStore(home, nodeIO, clock()), noGit);
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
    const seed = await openChat(store, "seed", ws);
    for (let i = 0; i < 10; i++) await seed.createTask({ title: `Task ${i}`, topLevel: true });
    const chat = await openChat(store, "t1", ws);
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

  it("holds a task from done while a blocker or mandatory decision is open", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.linkTask({ newTaskTitle: "Payments" });
    await chat.createTask({ title: "Gateway", parentId: "payments" });
    await chat.linkTask({ taskId: "gateway" });
    await chat.fileDecision({ title: "Which provider?", level: 1 });
    await chat.fileDecision({ title: "Dark mode?", type: "feature" });
    await chat.fileDecision({ title: "Rename it?", type: "optional" });
    const held = (await chat.updateTask({ status: "done" })).text;
    expect(held).toContain('Not done: "Gateway"');
    expect(held).toContain('"Which provider?" (mandatory)');
    expect(held).not.toContain("Dark mode?");
    expect(held).not.toContain("Rename it?");
    expect((await store.loadTask("nefx", "gateway"))?.status).toBe("active");
    const filed = async () => ((await store.loadTask("nefx", "payments")) as Task).decisions ?? [];
    // An untyped decision reads as mandatory; a feature decision is filed on the master task.
    expect(await filed()).toMatchObject([
      { title: "Which provider?", raisedFrom: { id: "gateway" } },
      { title: "Dark mode?", type: "feature", level: 1 },
    ]);
    const id = (await filed())[0]?.id;

    await chat.fileDecision({ action: "update", id, type: "blocker" });
    expect((await chat.fileDecision({ action: "skip", id })).text).toContain("can't be skipped");
    await chat.fileDecision({ action: "update", id, type: "mandatory" });
    await chat.fileDecision({ action: "skip", id, verdict: "not needed for the demo" });
    expect((await filed())[0]).toMatchObject({
      status: "dropped",
      verdict: "Skipped by the person: not needed for the demo",
    });
    expect((await chat.updateTask({ status: "done" })).text).toContain("Board updated");
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

  it("gives T3 threads short rules apart from the task's state", async () => {
    const store = await seedBoard({ boardMode: true, rules: "Use pnpm." });
    const t3 = await openChat(store, "t1", ws);
    expect(t3.boardModeOn).toBe(false);
    expect(t3.context).toContain("standard conversation workflow");
    expect(t3.rules).toMatch(/^Token hygiene/);
    expect((await t3.createTask({ title: "Discussed feature" })).text).toMatch(
      /^Not created: a new item needs a parent/,
    );
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
    for (const rule of ["outOfScope", "decisions", "ownership"] as const)
      expect(t3OnDemandRule(rule)).not.toMatch(/\bchats?\b/);
  });

  it("finds work by a question's words, in plan steps too, and stops a duplicate task", async () => {
    const store = await seedBoard();
    const chat = await openChat(store, "t1", ws);
    await chat.createTask({ title: "Marketplace", topLevel: true });
    await chat.createTask({
      title: "Catalog",
      parentId: "marketplace",
      plan: "## Phase B\n- [ ] B2 Seller checkout flow",
    });
    expect((await chat.findTasks({ query: "do we have a plan for seller checkout" })).text).toBe(
      "- catalog [L2, active] Marketplace › Catalog · planned as B2 – Seller checkout flow",
    );
    // A miss is where another name for an item is learned, once the person agrees.
    expect((await chat.findTasks({ query: "storefront" })).text).toMatch(
      /^No matching tasks\. If the person points at the item/,
    );
    expect((await chat.findTasks({ alias: "Storefront", taskId: "marketplace" })).text).toBe(
      'Saved "storefront" as another name for "Marketplace" (marketplace).',
    );
    expect((await chat.findTasks({ query: "storefront" })).text).toBe(
      "- marketplace [L1 feature, active] Marketplace",
    );
    const again = { title: "Checkout flow", parentId: "marketplace" };
    expect((await chat.createTask(again)).text).toMatch(/^Not created: .*\n- catalog /s);
    expect((await chat.createTask({ ...again, createAnyway: true })).text).toMatch(
      /^Created Level 2/,
    );

    // Sharing one word with existing work is not being a duplicate of it.
    expect((await chat.createTask({ title: "Checkout emails", parentId: "catalog" })).text).toMatch(
      /^Created Level 3/,
    );
    // Three matches under one module come back as the module, unless one level is asked for.
    for (const title of ["Refund api", "Refund emails", "Refund report"])
      await chat.createTask({ title, parentId: "catalog", createAnyway: true });
    expect((await chat.findTasks({ query: "refund" })).text).toBe(
      "- catalog [L2, active] Marketplace › Catalog · 3 matching tasks below: refund-api, refund-emails, refund-report",
    );
    expect((await chat.findTasks({ query: "refund", level: 3 })).text.split("\n")).toHaveLength(3);

    // A file path finds the task that touched it.
    const api = (await store.loadTask("nefx", "refund-api")) as Task;
    await store.saveTask("nefx", { ...api, files: [`${ws}/api/src/refund.ts`] });
    expect((await chat.findTasks({ query: "which task touched `src/refund.ts`?" })).text).toBe(
      "- refund-api [L3, active] Marketplace › Catalog › Refund api · touched refund.ts",
    );

    // A superseded task is answered with the task that replaced it.
    await chat.runTool("board_link_task", {
      taskId: "refund-emails",
      to: "refund-report",
      type: "superseded_by",
    });
    expect((await chat.findTasks({ query: "refund emails", level: 3 })).text).toContain(
      "- refund-report [L3, active] Marketplace › Catalog › Refund report · replaces refund-emails (superseded)",
    );

    // Only a new thread's first prompt is matched, against whole titles and other names.
    const plain = await openChat(store, "t2", ws);
    await plain.turnStart("Can we speed up the storefront search?");
    expect(plain.context).toContain('Possibly related: marketplace "Marketplace".');
    const other = await openChat(store, "t3", ws);
    await other.turnStart("Fix the flaky test");
    await other.turnStart("It is in the storefront");
    expect(other.context).not.toContain("Possibly related");

    const removeAlias = { op: "removeAlias", alias: "storefront" } as const;
    await editTask(store, "nefx", "marketplace", removeAlias, { by: "t3-app" });
    expect((await chat.findTasks({ query: "storefront" })).text).toBe("No matching tasks.");
  });

  it("follows the nearest merge mode and records the commits not yet in its target", async () => {
    const asked: string[] = [];
    const git: BoardGit = {
      ...noGit,
      state: async () => ({
        repo: ws,
        name: "nfx",
        branch: "feature/retries",
        head: "abc1234",
        upstream: "origin/feature/retries",
        ahead: 0,
        behind: 0,
        dirty: 0,
        lastCommitAt: 0,
        at: 0,
      }),
      aheadOf: async (_dir, target) => {
        asked.push(target);
        return target === "develop" ? 3 : null;
      },
    };
    const store = await seedBoard({ merge: { mode: "direct", target: "main" } });
    const chat = await openChat(store, "t1", ws, git);
    await chat.createTask({ title: "Transfers", topLevel: true });
    await chat.createTask({ title: "Retries", parentId: "transfers" });
    await chat.createTask({ title: "Backoff", parentId: "retries" });
    await chat.linkTask({ taskId: "backoff" });
    expect(chat.context).toContain("is merged directly into main (the board's mode)");
    // The repo has no branch of that name: the board says so and does not call the work merged.
    expect((await chat.checkpoint({ markdown: "Objective: ship" })).text).toContain(
      "no branch main here",
    );

    const app = { by: "t3-app" };
    await expect(
      editTask(store, "nefx", "backoff", { op: "setMerge", merge: null }, app),
    ).rejects.toThrow("follows the merge mode of its module");
    await expect(
      editTask(
        store,
        "nefx",
        "retries",
        { op: "setMerge", merge: { mode: "request", target: " " } },
        app,
      ),
    ).rejects.toThrow("Name the branch");
    const request = { mode: "request", target: "develop" } as const;
    await editTask(store, "nefx", "retries", { op: "setMerge", merge: request }, app);
    await editTask(
      store,
      "nefx",
      "retries",
      { op: "setMergeRequest", url: "https://git.example/mr/7" },
      app,
    );
    const read = (await chat.readTask({})).text;
    expect(read).toContain(
      'reaches develop through a merge request, never merged straight in (set on "Retries")',
    );
    expect(read).toContain("only when the person asks in that turn");
    expect(read).toContain("Open merge request: https://git.example/mr/7");
    expect((await chat.checkpoint({ markdown: "Objective: ship" })).text).toContain(
      "3 commit(s) not in develop",
    );
    expect(asked).toEqual(["main", "develop"]);
    expect((await store.loadTask("nefx", "backoff"))?.repoState?.[0]).toMatchObject({
      target: "develop",
      aheadOfTarget: 3,
    });

    // A thread records the request it opened; from a task it lands on the module.
    await chat.updateTask({ mergeRequest: "https://git.example/mr/8" });
    expect((await store.loadTask("nefx", "retries"))?.mergeRequest).toBe(
      "https://git.example/mr/8",
    );
    expect((await chat.updateTask({ mergeRequest: "soon" })).text).toContain("link");

    // Back to inheriting: the module follows the board again.
    await editTask(store, "nefx", "retries", { op: "setMerge", merge: null }, app);
    expect((await chat.readTask({})).text).toContain("is merged directly into main");
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
    const chat = await openChat(store, "t1", ws, git);
    await chat.linkTask({ newTaskTitle: "Task" });
    await chat.filesChanged(["api/a.ts", ".local-run/logs/task/check.log"]);
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
    // Files reported after a task is done (the turn's checkpoint) are not its work.
    await chat.filesChanged(["api/later.ts"]);
    expect((await store.loadTask("nefx", "task"))?.files).toEqual([`${ws}/api/a.ts`]);
    since = "changed";
    expect(await finish()).toContain("re-run `npm test` before building on it");
    since = "unreachable";
    expect(await finish()).toContain("done elsewhere, not merged here");
    // What a reader found stands in for a check, until the files change; a bad finding stays.
    const review = async (ok: boolean, note: string) =>
      (await chat.updateTask({ taskId: "task", review: { ok, note } })).text;
    expect(await review(true, "")).toContain("A review needs ok");
    since = "same";
    expect(await review(true, "Matches the API spec.")).toContain("reviewed at abc1234");
    since = "changed";
    expect(await review(true, "Matches the API spec.")).toContain("re-run `npm test`");
    expect(await review(false, "Retries are lost.")).toContain("reassess its code in full");
    expect(await finish()).not.toContain("Retries are lost.");
  });

  it("runs a Goal: tasks in a row with light records, reconciling work done outside it", async () => {
    let pushed = false;
    const git: BoardGit = {
      ...noGit,
      state: async () => ({
        repo: ws,
        name: "nfx",
        branch: "main",
        head: "abc1234",
        upstream: pushed ? "origin/main" : null,
        ahead: pushed ? 0 : null,
        behind: null,
        dirty: 0,
        lastCommitAt: 0,
        at: 0,
      }),
      since: async () => "same",
    };
    const store = await seedBoard({ boardMode: true });
    const exec = await openChat(store, "t1", ws, git);
    await exec.createTask({ title: "Feature", topLevel: true });
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
    expect(exec.context).toContain("in its other workspace copies: copy-b.");
    const other = await openChat(store, "t2", ws, git);
    expect((await other.goalTool({ action: "start", scope: ["module"] })).text).toMatch(
      /^Not started: a task belongs to one active Goal/,
    );

    const taken = (await exec.goalTool({ action: "task", taskId: "alpha" })).text;
    expect(taken).toContain("### Task: Alpha");
    // A Goal's tasks get no plan stub.
    expect(taken).not.toContain("No plan yet");
    await exec.recordCheck({ id: "c1", command: "npm test", exitCode: 0, at: 1 });
    const done = (await exec.goalTool({ action: "done", note: "Built alpha" })).text;
    expect(done).toContain("npm test exited 0");
    expect(done).toContain('2 task(s) left. Next task: beta "Beta"');
    expect(
      (await exec.goalTool({ action: "decide", title: "Retry count", settled: "3, the default" }))
        .text,
    ).toContain("settled by the model");

    // Paused; meanwhile Beta is finished directly in another thread.
    const paused = (await exec.goalTool({ action: "pause", reason: "rate limit" })).text;
    expect(paused).toContain("Paused Goal g-ship-it: rate limit");
    expect(exec.rules).toContain("## Board Mode");
    // A paused Goal holds nothing, but unpushed work is not handed to another workspace.
    const owner = async () => (await store.loadTask("nefx", "module"))?.owner;
    expect(paused).toContain('"Module" stays owned by main: nfx: branch main has no upstream');
    expect((await owner())?.state).toBe("owned");
    pushed = true;
    await exec.goalTool({ action: "resume", goalId: "g-ship-it" });
    await exec.goalTool({ action: "pause", reason: "rate limit" });
    expect((await owner())?.state).toBe("soft");
    await other.linkTask({ taskId: "beta" });
    await other.updateTask({ status: "done", lastAction: "Fixed beta directly" });
    const resumed = (await other.goalTool({ action: "resume", goalId: "g-ship-it" })).text;
    expect(resumed).toContain('- beta "Beta": finished in another thread. done, unverified');
    expect(resumed).toContain("G1 Retry count → 3, the default (settled by the model)");
    expect(resumed).toContain('Next task: gamma "Gamma"');
    await other.goalTool({ action: "task", taskId: "gamma" });
    expect((await owner())?.state).toBe("owned");
    // The board shows which tasks an open Goal holds, and stops when it is finished.
    const goalOf = async (id: string) =>
      (await readBoardView(store, "nefx", 0))?.tasks.find((task) => task.id === id)?.goal;
    expect(await goalOf("gamma")).toEqual({ id: "g-ship-it", title: "Ship it", status: "running" });
    expect(await goalOf("module")).toBeNull();
    expect((await readBoardView(store, "nefx", 0))?.goals).toMatchObject([
      {
        id: "g-ship-it",
        status: "running",
        mode: "auto",
        executor: "t2",
        taskIds: ["alpha", "beta", "gamma"],
        decisions: [{ id: "G1", title: "Retry count", settled: "3, the default", by: "model" }],
      },
    ]);
    expect((await other.goalTool({ action: "done" })).text).toContain("Goal g-ship-it is finished");
    expect(await goalOf("gamma")).toBeNull();
    const finished = await readBoardView(store, "nefx", 0);
    expect(finished?.goals).toEqual([]);
    // A finished Goal stays readable, with its order of work and the chats that ran it.
    expect(finished?.finishedGoals).toMatchObject([
      { id: "g-ship-it", status: "done", taskIds: ["alpha", "beta", "gamma"] },
    ]);
    expect(finished?.finishedGoals[0]?.groups.flatMap((group) => group.taskIds)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(finished?.finishedGoals[0]?.chats.map((chat) => chat.sessionId)).toContain("t2");
  });

  it("keeps a Goal's plans and decisions true on the board, not only in its thread", async () => {
    const store = await seedBoard({ boardMode: true });
    const exec = await openChat(store, "t1", ws, noGit);
    await exec.createTask({ title: "Feature", topLevel: true });
    await exec.createTask({ title: "Module", parentId: "feature" });
    await exec.createTask({ title: "Rollout", parentId: "feature" });
    const plan = (id: string) => store.readText(store.planPath("nefx", id));
    await store.io.write(
      store.planPath("nefx", "feature"),
      "- [ ] C1 Manual test → module\n- [ ] C3 Decide the fixture → module\n- [ ] C5 Push → rollout\n",
    );
    await store.io.write(store.planPath("nefx", "module"), "- [ ] B1 Run it\n- [ ] B2 Decide\n");
    await store.io.write(store.planPath("nefx", "rollout"), "- [ ] A1 Rebase\n- [ ] A2 Push\n");
    await exec.goalTool({ action: "start", scope: ["feature"], mode: "auto", title: "Ship it" });

    // Finishing a task leaves the steps it names open, keeps the whole note, and points at the
    // parent's steps that name the task; the thread ticks the ones that are really finished.
    await exec.goalTool({ action: "task", taskId: "module" });
    const long = `All passed. ${"Receipt row. ".repeat(40)}`;
    const done = (await exec.goalTool({ action: "done", note: long, open: ["B2"] })).text;
    expect(await plan("module")).toBe("- [x] B1 Run it\n- [ ] B2 Decide\n");
    expect(
      (await readBoardView(store, "nefx", 0))?.tasks.find((t) => t.id === "module"),
    ).toMatchObject({ doneNote: long, status: "done" });
    expect(done).toContain("Steps C1, C3 of feature name this task and are still open");
    expect((await exec.goalTool({ action: "step", taskId: "feature", step: "C1" })).text).toBe(
      "Step C1 of feature is done.",
    );
    expect(await plan("feature")).toContain("- [x] C1 Manual test → module\n- [ ] C3");

    // A task that is worked but not finished gets its finished steps ticked one by one.
    await exec.goalTool({ action: "task", taskId: "rollout" });
    await exec.goalTool({ action: "step", step: "A1" });
    expect(await plan("rollout")).toBe("- [x] A1 Rebase\n- [ ] A2 Push\n");
    expect((await exec.goalTool({ action: "step", step: "A1", done: false })).text).toContain(
      "open",
    );
    expect((await exec.goalTool({ action: "step", step: "Z9" })).text).toContain(
      "Its steps: A1, A2",
    );
    expect((await exec.goalTool({ action: "step", taskId: "nope", step: "A1" })).text).toContain(
      "not in this Goal",
    );

    // Goal decisions are filed in the board's register: settled ones as decided by the model,
    // open ones as open. A person's verdict there answers the Goal.
    await exec.goalTool({ action: "decide", title: "Renumber", settled: "V86 to V89" });
    await exec.goalTool({ action: "decide", title: "Keep the fixture invoice?" });
    const rollout = await store.loadTask("nefx", "rollout");
    expect(rollout?.decisions).toMatchObject([
      { title: "Renumber", status: "decided" },
      { title: "Keep the fixture invoice?", status: "open", verdict: "" },
    ]);
    expect(rollout?.decisions?.[0]?.verdict).toContain(`V86 to V89 ${MODEL_SETTLED}g-ship-it)`);
    const open = rollout!.decisions![1]!;
    open.status = "decided";
    open.verdict = "Yes, keep it";
    await store.saveTask("nefx", rollout!);
    expect((await readBoardView(store, "nefx", 0))?.goals[0]?.decisions).toMatchObject([
      { id: "G1", title: "Renumber", settled: "V86 to V89", by: "model" },
      { id: "G2", title: "Keep the fixture invoice?", settled: "Yes, keep it", by: "person" },
    ]);

    // A blocker is the person's in Auto mode too: its task leaves the Goal's order and can't
    // be marked done.
    const blocker = await exec.goalTool({
      action: "decide",
      title: "Force-push demo?",
      settled: "yes",
      type: "blocker",
      taskIds: ["rollout"],
    });
    expect(blocker.text).toContain("G3 as a blocker for the person");
    expect((await store.loadTask("nefx", "rollout"))?.decisions?.[2]).toMatchObject({
      status: "open",
      type: "blocker",
    });
    expect((await exec.goalTool({ action: "status" })).text).toContain(
      "rollout wait on a blocker decision",
    );
    expect((await exec.goalTool({ action: "done" })).text).toContain('Not done: "Rollout"');
    expect((await readBoardView(store, "nefx", 0))?.goals[0]?.decisions[2]).toMatchObject({
      blocker: true,
      settled: "",
    });
  });

  it("ends a Goal for good: its tasks keep their progress and it can't be resumed", async () => {
    const store = await seedBoard({ boardMode: true });
    const exec = await openChat(store, "t1", ws);
    await exec.createTask({ title: "Feature", topLevel: true });
    await exec.createTask({ title: "Module", parentId: "feature" });
    await store.io.write(store.planPath("nefx", "module"), "- [ ] B1 Run it\n- [ ] B2 Decide\n");
    await exec.goalTool({ action: "start", scope: ["feature"], title: "Ship it" });
    await exec.goalTool({ action: "task", taskId: "module" });
    await exec.goalTool({ action: "step", step: "B1" });

    const goal = await loadGoal(store, "nefx", "g-ship-it");
    if (!goal) throw new Error("The Goal was not saved.");
    await exec.leaveGoal(goal);
    closeGoal(goal, "ended", "Ended by the person");
    await saveGoal(store, "nefx", goal);

    expect((await exec.goalTool({ action: "done" })).text).toContain("not running a Goal");
    expect((await exec.goalTool({ action: "resume", goalId: "g-ship-it" })).text).toContain(
      "can't be resumed",
    );
    const view = await readBoardView(store, "nefx", 0);
    expect(view?.goals).toEqual([]);
    expect(view?.finishedGoals[0]).toMatchObject({ id: "g-ship-it", status: "ended" });
    expect(view?.tasks.find((task) => task.id === "module")).toMatchObject({
      goal: null,
      status: "active",
    });
    expect(await store.readText(store.planPath("nefx", "module"))).toBe(
      "- [x] B1 Run it\n- [ ] B2 Decide\n",
    );
    expect(
      (await exec.goalTool({ action: "start", scope: ["feature"], title: "Again" })).text,
    ).toContain("Started Goal g-again");
  });

  it("hands a Goal's group to a child thread, which works it and reports once", async () => {
    const store = await seedBoard({ boardMode: true });
    const exec = await openChat(store, "t1", ws);
    await exec.createTask({ title: "Feature", topLevel: true });
    for (const module of ["Api", "Web"]) {
      await exec.createTask({ title: module, parentId: "feature", createAnyway: true });
      await exec.createTask({
        title: `${module} one`,
        parentId: module.toLowerCase(),
        createAnyway: true,
      });
    }
    await exec.goalTool({ action: "start", scope: ["feature"], title: "Ship" });
    // A Goal's executor is still its executor when the server opens its record again.
    expect((await openChat(store, "t1", ws)).rules).toContain("## Goal Mode");
    const brief = (await exec.goalTool({ action: "delegate", group: "web" })).text;
    expect(brief).toContain('board_goal {action: "work", goalId: "g-ship", group: "B"}');
    // The executor leaves a group that is out alone.
    expect(exec.context).toContain("B. Web [0/1 done] · with a child thread");
    expect(exec.context).toContain('Next task: api-one "Api one"');

    const child = await openChat(store, "t2", ws);
    const started = (await child.goalTool({ action: "work", goalId: "g-ship", group: "B" })).text;
    expect(started).toContain("## Goal worker");
    expect(started).toContain('Next task: web-one "Web one"');
    expect(child.rules).not.toContain("## Goal Mode");
    // A worker stays inside its group and decides nothing for the Goal.
    expect((await child.goalTool({ action: "task", taskId: "api-one" })).text).toContain(
      "is not in this Goal",
    );
    expect(
      (await child.goalTool({ action: "decide", title: "Port", settled: "8080" })).text,
    ).toMatch(/^A worker takes its group's tasks/);
    expect((await child.goalTool({ action: "task", taskId: "web-one" })).text).not.toContain(
      "No plan yet",
    );
    expect((await child.goalTool({ action: "done", note: "Built web" })).text).toContain(
      'The group is finished: call board_goal {action: "report", note}.',
    );
    await child.goalTool({ action: "report", note: "Web one built; nothing left." });
    expect(child.rules).not.toContain("## Goal worker");

    // The child's work is the Goal's own, not something that happened outside it.
    const status = (await exec.goalTool({ action: "status" })).text;
    expect(status).toContain(
      "B. Web [1/1 done]\n  Child thread reported: Web one built; nothing left.",
    );
    expect(status).not.toContain("Changed outside the Goal");
    expect((await exec.goalTool({ action: "finish" })).text).toBe(
      "Not finished: api-one still open.",
    );
    await exec.goalTool({ action: "task", taskId: "api-one" });
    expect((await exec.goalTool({ action: "done" })).text).toContain("Goal g-ship is finished");
    expect((await exec.goalTool({ action: "finish", goalId: "g-ship" })).text).toBe(
      "Goal g-ship is already finished.",
    );
  });

  it("lets the board's Assistant find and read, and write only after the person's yes", async () => {
    const store = await seedBoard({ boardMode: true });
    const setup = await openChat(store, "t1", ws);
    await setup.createTask({ title: "Marketplace", topLevel: true });
    const assistant = await openChat(store, "t2", ws);
    await assistant.becomeAssistant();
    await assistant.turnStart("Do we have anything on the marketplace?");
    expect(assistant.rules).toContain("## Board Assistant");
    // On no task by design, so not listed with the chats still waiting for one.
    expect((await readBoardView(store, "nefx", 0))?.unlinked).toEqual([]);
    expect(assistant.context).toContain("is the board's Assistant. The board has 1 open item(s)");
    expect((await assistant.runTool("board_find", { query: "marketplace" }))?.text).toContain(
      "- marketplace [L1 feature, active] Marketplace",
    );
    // It is on no task and runs no Goal, whatever a task's text or the model says.
    for (const tool of ["board_link", "board_update", "board_goal"])
      expect((await assistant.runTool(tool, { taskId: "marketplace" }))?.text).toMatch(
        /^The Board Assistant finds, reads and shows/,
      );

    const draft = { title: "Seller payouts", parentId: "marketplace" };
    // The thread stays the Assistant when the server opens its record again.
    const reopened = await openChat(store, "t2", ws);
    expect(reopened.rules).toContain("## Board Assistant");
    const asked = (await assistant.runTool("board_create_task", draft))?.text;
    expect(asked).toMatch(/^Not created yet: the person has to agree first/);
    // Saying it again in the same turn is the model agreeing with itself.
    expect((await assistant.runTool("board_create_task", draft))?.text).toMatch(/^Not created yet/);
    expect(await store.loadTask("nefx", "seller-payouts")).toBeNull();
    // A message that is not a yes lets through only the write that was already refused.
    await assistant.turnStart("what would that contain?");
    expect(
      (await assistant.runTool("board_create_task", { ...draft, title: "Refunds" }))?.text,
    ).toMatch(/^Not created yet/);
    await assistant.turnStart("the payouts one, as you said");
    expect((await assistant.runTool("board_create_task", draft))?.text).toMatch(/^Not created yet/);
    await assistant.turnStart("Yes, go ahead");
    expect((await assistant.runTool("board_create_task", draft))?.text).toMatch(/^Created Level 2/);
    // Agreeing once covers that turn, not the ones after it.
    await assistant.turnStart("and what else is open?");
    expect(
      (await assistant.runTool("board_create_task", { ...draft, title: "Seller fees" }))?.text,
    ).toMatch(/^Not created yet/);
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
    const chat = new BoardChat(new BoardStore(home, nodeIO), noGit);
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
    const gone = await openChat(store, "t3", ws);
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
