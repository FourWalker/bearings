// @effect-diagnostics nodeBuiltinImport:off
import { BoardSettings, OrchestrationV2ThreadTranscript } from "@t3tools/contracts";
import { type Board, BoardStore } from "@t3tools/board-core";
import * as Schema from "effect/Schema";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const Archive = Schema.Struct({
  format: Schema.Literal("t3-board"),
  version: Schema.Literal(1),
  id: Schema.String,
  createdAt: Schema.Number,
  settings: BoardSettings,
  files: Schema.Record(Schema.String, Schema.String),
  threads: Schema.Array(OrchestrationV2ThreadTranscript),
});
type Archive = typeof Archive.Type;
const boardJson = Schema.fromJsonString(Schema.toCodecJson(Archive));
const threadsJson = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Array(OrchestrationV2ThreadTranscript)),
);

const safeSegment = (value: string) =>
  /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(value) &&
  !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);

function assertBoardFile(path: string) {
  const [folder, id, name, step, ...rest] = path.split("/");
  if (
    folder !== "tasks" ||
    !id ||
    !safeSegment(id) ||
    rest.length ||
    (step === undefined
      ? !["task.json", "plan.md", "handoff.md", "masterplan.md"].includes(name ?? "")
      : name !== "handoffs" || !safeSegment(step) || !step.endsWith(".md"))
  ) {
    throw new Error("The board file contains an invalid task path.");
  }
}

export async function readBoardFiles(store: BoardStore, id: string) {
  const root = store.projectDir(id);
  const files: Record<string, string> = Object.create(null);
  async function visit(relative: string): Promise<void> {
    const path = `${root}/${relative}`;
    if (!(await store.io.exists(path))) return;
    for (const entry of await store.io.list(path)) {
      const next = `${relative}/${entry.name}`;
      if (entry.kind === "dir") {
        if (
          (relative === "tasks" && safeSegment(entry.name)) ||
          (relative.split("/").length === 2 && entry.name === "handoffs")
        )
          await visit(next);
      } else if (!entry.name.endsWith(".tmp")) {
        assertBoardFile(next);
        files[next] = await store.io.read(`${root}/${next}`);
      }
    }
  }
  await visit("tasks");
  return files;
}

export function hasArchivedThreads(store: BoardStore, id: string) {
  return store.io.exists(`${store.projectDir(id)}/thread-archive.json`);
}

export async function readArchivedThreads(store: BoardStore, id: string) {
  const path = `${store.projectDir(id)}/thread-archive.json`;
  if (!(await store.io.exists(path))) return [];
  return Schema.decodeSync(threadsJson)(await store.io.read(path));
}

export function encodeBoardFile(archive: Omit<Archive, "format" | "version">) {
  return Schema.encodeSync(boardJson)({ format: "t3-board", version: 1, ...archive });
}

export async function openBoardFile(store: BoardStore, contents: string) {
  const { id, createdAt, settings, files, threads } = Schema.decodeSync(boardJson)(contents);
  if (!safeSegment(id) || !settings.name.trim()) throw new Error("Invalid board identity.");
  const registry = await store.loadRegistry();
  const destination = store.projectDir(id);
  if (
    registry.boards.some((board) => board.id.toLowerCase() === id.toLowerCase()) ||
    (await store.io.exists(destination))
  ) {
    throw new Error("A board with this ID already exists in this environment.");
  }

  const paths = new Set<string>();
  for (const [path, contents] of Object.entries(files)) {
    assertBoardFile(path);
    const normalized = path.toLowerCase();
    if (paths.has(normalized)) throw new Error("The board file contains duplicate task paths.");
    paths.add(normalized);
    if (path.endsWith("/task.json")) {
      const task = JSON.parse(contents);
      if (
        !task ||
        task.id !== path.split("/")[1] ||
        typeof task.title !== "string" ||
        !Array.isArray(task.items) ||
        !Array.isArray(task.sessions)
      ) {
        throw new Error("The board file contains an invalid task record.");
      }
    }
  }
  const board: Board = {
    ...settings,
    id,
    createdAt,
    roots: settings.roots.map((root) => ({ ...root })),
    services: settings.services.map((service) => ({ ...service, match: [...service.match] })),
    registers: settings.registers.map((register) => ({ ...register })),
  };

  await NodeFSP.mkdir(store.home, { recursive: true });
  const staging = await NodeFSP.mkdtemp(NodePath.join(store.home, ".board-import-"));
  const stagedStore = new BoardStore(staging, store.io);
  const stagedBoard = stagedStore.projectDir(id);
  let installed = false;
  try {
    await NodeFSP.mkdir(stagedBoard, { recursive: true });
    for (const [path, contents] of Object.entries(files)) {
      await store.io.write(`${stagedBoard}/${path}`, contents);
    }
    if (threads.length) {
      const archived = Schema.encodeSync(threadsJson)(threads);
      await store.io.write(`${stagedBoard}/thread-archive.json`, archived);
    }
    await NodeFSP.mkdir(NodePath.join(store.home, "projects"), { recursive: true });
    await NodeFSP.rename(stagedBoard, destination);
    installed = true;
    await store.saveRegistry({ ...registry, boards: [...registry.boards, board] });
    return id;
  } catch (error) {
    if (installed) await NodeFSP.rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await NodeFSP.rm(staging, { recursive: true, force: true });
  }
}
