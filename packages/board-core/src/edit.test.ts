// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { BoardEditError, createTask, editTask } from "./edit.ts";
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
