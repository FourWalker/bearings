// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { BoardEditError, createTask, editBoard, editTask } from "./edit.ts";
import { noGit } from "./io.ts";
import { nodeIO } from "./nodeIO.ts";
import { nextStep } from "./plan.ts";
import { BoardStore } from "./store.ts";
import { norm } from "./text.ts";
import type { Task } from "./types.ts";

let tmp: string;
let store: BoardStore;
const actor = { by: "t3-app" };

beforeEach(async () => {
  tmp = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "board-edit-"));
  let t = 1_700_000_000_000;
  store = new BoardStore(norm(NodePath.join(tmp, "board")), nodeIO, {
    now: () => (t += 1000),
    random: () => 0,
  });
  await store.saveRegistry({
    version: 1,
    boards: [{ id: "nefx", name: "NEFX", createdAt: 0, roots: [{ path: tmp, label: "main" }] }],
  });
});

afterEach(async () => {
  await NodeFSP.rm(tmp, { recursive: true, force: true });
});

const edit = (taskId: string, change: Parameters<typeof editTask>[3]) =>
  editTask(store, "nefx", taskId, change, actor);
const task = async (id: string) => (await store.loadTask("nefx", id)) as Task;
const plan = (id: string) => store.readText(store.planPath("nefx", id));

describe("editTask", () => {
  it("edits a task's fields, items, plan, handoff and master plan", async () => {
    await createTask(store, "nefx", { title: "Billing" }, actor);
    const { createdId } = await edit("billing", { op: "createChild", title: "Retries" });
    expect(createdId).toBe("retries");
    expect(await task("retries")).toMatchObject({ level: 2, parentId: "billing" });

    await edit("retries", { op: "update", title: "Retry handling", description: "Backoff" });
    expect(await task("retries")).toMatchObject({
      title: "Retry handling",
      description: "Backoff",
    });
    await expect(edit("retries", { op: "update", title: " " })).rejects.toBeInstanceOf(
      BoardEditError,
    );

    await edit("retries", { op: "addItem", kind: "mandatory", text: "Keep keys stable" });
    const [item] = (await task("retries")).items;
    expect(item).toMatchObject({ kind: "mandatory", done: false, by: "t3-app" });
    await edit("retries", { op: "toggleItem", itemId: item!.id });
    expect((await task("retries")).items[0]?.done).toBe(true);
    await edit("retries", { op: "deleteItem", itemId: item!.id });
    expect((await task("retries")).items).toEqual([]);

    await edit("retries", { op: "savePlan", markdown: "- [ ] A1 Key\n- [ ] A2 Test" });
    await edit("retries", { op: "toggleStep", step: "A1" });
    expect(nextStep(await plan("retries"))?.id).toBe("A2");
    await edit("retries", { op: "toggleStep", step: "a1" });
    expect(nextStep(await plan("retries"))?.id).toBe("A1");
    await expect(edit("retries", { op: "toggleStep", step: "Z9" })).rejects.toThrow("No step");

    await edit("retries", { op: "saveHandoff", markdown: "Objective: retries" });
    expect(await store.readText(store.livingPath("nefx", "retries"))).toMatch(
      /^<!-- living handoff.*last by t3-app.*-->\nObjective: retries\n$/,
    );
    // From a module, the master plan is its master task's.
    await edit("retries", { op: "saveMasterPlan", markdown: "# Billing plan" });
    expect(await store.readText(store.masterPath("nefx", "billing"))).toBe("# Billing plan\n");
  });

  it("takes over a parent step, and finishing or reopening the subtask moves that step", async () => {
    await createTask(store, "nefx", { title: "Billing" }, actor);
    await edit("billing", { op: "savePlan", markdown: "- [ ] A1 Retries\n- [ ] A2 Verify" });
    await edit("billing", { op: "createChild", title: "Retries", fromStep: "A1" });
    expect(await plan("billing")).toContain("A1 Retries → (task retries)");

    const done = await edit("retries", { op: "update", status: "done" });
    expect(done.message).toContain("Ticked A1");
    expect(nextStep(await plan("billing"))?.id).toBe("A2");
    await edit("retries", { op: "update", status: "active" });
    expect(nextStep(await plan("billing"))?.id).toBe("A1");
  });

  it("maps documents, links tasks from either side, and files and settles decisions", async () => {
    await createTask(store, "nefx", { title: "Billing" }, actor);
    await edit("billing", { op: "createChild", title: "Retries" });
    await createTask(store, "nefx", { title: "Invoice contract" }, actor);

    await edit("retries", { op: "addDoc", kind: "HLD", title: "", ref: "docs/hld.md", note: "" });
    const doc = (await task("retries")).docs?.[0];
    expect(doc).toMatchObject({ kind: "HLD", title: "hld.md", ref: "docs/hld.md" });
    await edit("retries", { op: "removeDoc", docId: doc!.id });
    expect((await task("retries")).docs).toEqual([]);

    // "blocks" is stored on the other task as blocked_by.
    await edit("invoice-contract", { op: "addLink", to: "retries", type: "blocks", note: "key" });
    expect((await task("retries")).links).toMatchObject([
      { to: "invoice-contract", type: "blocked_by", note: "key" },
    ]);
    await edit("invoice-contract", { op: "removeLink", to: "retries", type: "blocks" });
    expect((await task("retries")).links).toEqual([]);

    // Filed on the master task it affects, mapped to the module where it came up.
    const add = (title: string, recommendation?: { area: string }) =>
      edit("retries", {
        op: "addDecision",
        title,
        description: "",
        options: "",
        refs: [],
        level: 1,
        recommendation,
      });
    await add("Which key?");
    await add("Retry limit", { area: "billing" });
    await add("Backoff", { area: "billing" });
    const decisions = (await task("billing")).decisions ?? [];
    expect(decisions.map((d) => [d.title, d.raisedFrom?.id, d.rec?.r])).toEqual([
      ["Which key?", "retries", undefined],
      ["Retry limit", "retries", "R1"],
      ["Backoff", "retries", "R2"],
    ]);
    await edit("retries", {
      op: "setDecision",
      decisionId: "R1",
      action: "decide",
      verdict: "3 tries",
    });
    expect((await task("billing")).decisions?.[1]).toMatchObject({
      status: "decided",
      verdict: "3 tries",
    });
    await edit("retries", { op: "setDecision", decisionId: "R1", action: "reopen" });
    expect((await task("billing")).decisions?.[1]?.status).toBe("open");
  });
});

describe("structure and ownership", () => {
  it("moves and promotes tasks with their subtrees, and refuses a fourth level", async () => {
    await createTask(store, "nefx", { title: "Billing" }, actor);
    await edit("billing", { op: "createChild", title: "Retries" });
    await edit("retries", { op: "createChild", title: "Key" });
    await createTask(store, "nefx", { title: "Invoice" }, actor);

    await expect(edit("invoice", { op: "move", parentId: "key" })).rejects.toThrow("deeper than 3");
    await expect(edit("billing", { op: "move", parentId: "key" })).rejects.toThrow("under itself");

    await edit("retries", { op: "move", parentId: "invoice" });
    expect(await task("retries")).toMatchObject({
      parentId: "invoice",
      level: 2,
      origin: [{ id: "billing" }],
    });
    expect((await task("key")).level).toBe(3);

    await edit("retries", { op: "promote" });
    expect(await task("retries")).toMatchObject({ parentId: null, level: 1, kind: "feature" });
    expect((await task("key")).level).toBe(2);
    await expect(edit("retries", { op: "promote" })).rejects.toThrow("already a master task");
  });

  it("gives a module to a workspace copy, refuses an unready soft release, reclaims and releases", async () => {
    await createTask(store, "nefx", { title: "Billing" }, actor);
    await edit("billing", { op: "createChild", title: "Retries" });
    await edit("retries", { op: "createChild", title: "Key" });

    // A task's owner is its module's.
    await edit("key", { op: "setOwner", root: tmp });
    expect((await task("retries")).owner).toMatchObject({ label: "main", state: "owned" });
    await expect(edit("key", { op: "setOwner", root: `${tmp}/elsewhere` })).rejects.toThrow(
      "not a workspace",
    );
    // No repo here: nothing to hand over.
    await expect(
      editTask(store, "nefx", "retries", { op: "softRelease" }, actor, noGit),
    ).rejects.toThrow("no repos found");

    const retries = await task("retries");
    await store.saveTask("nefx", {
      ...retries,
      owner: { ...retries.owner!, state: "soft", softAt: 1 },
    });
    await edit("retries", { op: "reclaim" });
    expect((await task("retries")).owner).toMatchObject({ state: "owned" });
    expect((await task("retries")).owner?.softAt).toBeUndefined();
    await edit("retries", { op: "setOwner", root: null });
    expect((await task("retries")).owner).toBeNull();
    expect((await task("retries")).ownerHistory?.map((h) => h.type)).toEqual([
      "assigned",
      "reclaim",
      "release",
    ]);
  });

  it("edits a decision's text and records how a recommendation was implemented", async () => {
    await createTask(store, "nefx", { title: "Billing" }, actor);
    const file = (recommendation?: { area: string }) =>
      edit("billing", {
        op: "addDecision",
        title: "Retry limit",
        description: "",
        options: "",
        refs: [],
        level: 1,
        recommendation,
      });
    await file();
    await file({ area: "billing" });
    const [plain, rec] = (await task("billing")).decisions ?? [];
    await edit("billing", {
      op: "updateDecision",
      decisionId: plain!.id,
      title: "Retry cap",
      refs: ["docs/hld.md"],
    });
    expect((await task("billing")).decisions?.[0]).toMatchObject({
      title: "Retry cap",
      refs: ["docs/hld.md"],
    });
    const implemented = { problem: "p", approach: "a", api: "", code: "c", tests: "t" };
    await expect(
      edit("billing", { op: "implemented", decisionId: plain!.id, ...implemented }),
    ).rejects.toThrow("Only recommendations");
    await edit("billing", { op: "implemented", decisionId: rec!.id, ...implemented });
    expect((await task("billing")).decisions?.[1]?.rec?.implemented).toMatchObject(implemented);
  });
});

describe("editBoard", () => {
  it("renames, keeps workspaces apart, and saves services, rules, Board Mode and registers", async () => {
    const board = async () => (await store.loadRegistry()).boards[0]!;
    await editBoard(store, "nefx", { op: "rename", name: "NEFX core" });
    expect((await board()).name).toBe("NEFX core");

    const copy = norm(NodePath.join(tmp, "..", `${NodePath.basename(tmp)}-copy`));
    await NodeFSP.mkdir(copy, { recursive: true });
    await NodeFSP.mkdir(NodePath.join(tmp, "api"), { recursive: true });
    await expect(
      editBoard(store, "nefx", { op: "addRoot", path: `${tmp}/api`, label: "" }),
    ).rejects.toThrow("already a workspace");
    await editBoard(store, "nefx", { op: "addRoot", path: copy, label: "" });
    await editBoard(store, "nefx", { op: "labelRoot", path: copy, label: "copy-b" });
    expect((await board()).roots.map((r) => r.label)).toEqual(["main", "copy-b"]);
    await editBoard(store, "nefx", { op: "removeRoot", path: copy });
    await expect(editBoard(store, "nefx", { op: "removeRoot", path: tmp })).rejects.toThrow(
      "at least one",
    );
    await NodeFSP.rm(copy, { recursive: true, force: true });

    await editBoard(store, "nefx", {
      op: "saveServices",
      services: [{ name: "Invoice API", match: [" BE\\invoice/ ", ""] }],
    });
    await editBoard(store, "nefx", { op: "saveRules", rules: "Use the invoice key." });
    await editBoard(store, "nefx", { op: "setBoardMode", on: true });
    await editBoard(store, "nefx", {
      op: "saveRegisters",
      registers: [
        { topic: "FI SFTP", url: "https://example.com/r" },
        { topic: " ", url: "" },
      ],
    });
    expect(await board()).toMatchObject({
      services: [{ id: "invoice-api", name: "Invoice API", match: ["BE/invoice"] }],
      rules: "Use the invoice key.",
      boardMode: true,
      registers: [{ id: "fi-sftp", topic: "FI SFTP", url: "https://example.com/r" }],
    });
    await expect(
      editBoard(store, "nope", { op: "setBoardMode", on: false }),
    ).rejects.toBeInstanceOf(BoardEditError);
  });
});
