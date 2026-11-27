// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import { vi } from "vite-plus/test";

import { boardCommand } from "./board.ts";

const runBoard = (args: ReadonlyArray<string>) =>
  Command.runWith(boardCommand, { version: "0.0.0" })(args).pipe(
    Effect.provide(Layer.merge(NodeServices.layer, TestConsole.layer)),
  );

it.effect("adds and updates tasks the way agents' tools do", () =>
  Effect.gen(function* () {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-board-cli-"));
    vi.stubEnv("T3_BOARD_HOME", home);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        vi.unstubAllEnvs();
        NodeFS.rmSync(home, { recursive: true, force: true });
      }),
    );
    const taskFile = (id: string, file = "task.json") =>
      NodePath.join(home, "projects", "demo", "tasks", id, file);
    const task = (id: string) => JSON.parse(NodeFS.readFileSync(taskFile(id), "utf8"));
    const planFile = NodePath.join(home, "plan.md");
    NodeFS.writeFileSync(planFile, "## Phase A\n- [ ] A1 Retries\n");

    yield* runBoard(["create", "Demo", "--path", home]);
    yield* runBoard(["add", "Billing", "--top-level", "--plan", planFile]);
    yield* runBoard(["add", "Retries", "--parent", "billing", "--from-step", "A1"]);
    assert.include(task("retries"), { parentId: "billing", level: 2 });

    const homeless = yield* Effect.flip(runBoard(["add", "Refunds"]));
    assert.include(String(homeless), "--top-level");
    const twice = yield* Effect.flip(runBoard(["add", "Retries", "--parent", "billing"]));
    assert.include(String(twice), "already have this");

    yield* runBoard(["update", "retries", "--status", "done", "--services", "api, web"]);
    assert.deepInclude(task("retries"), { status: "done", services: ["api", "web"] });
    assert.include(NodeFS.readFileSync(taskFile("billing", "plan.md"), "utf8"), "[x] A1");
  }).pipe(Effect.scoped),
);
