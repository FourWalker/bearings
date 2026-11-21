// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Node implementations of the board's ports: the filesystem, and git through the `git` CLI.
 *
 * @module board-core/nodeIO
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { BoardGit, BoardIO } from "./io.ts";
import { base, norm } from "./text.ts";
import type { RepoState } from "./types.ts";

export const nodeIO: BoardIO = {
  read: (path) => NodeFSP.readFile(path, "utf8"),
  write: async (path, data) => {
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
    await NodeFSP.writeFile(path, data, "utf8");
  },
  list: async (path) => {
    const entries = await NodeFSP.readdir(path, { withFileTypes: true });
    return Promise.all(
      entries.map(async (e) => ({
        name: e.name,
        kind: e.isDirectory() ? ("dir" as const) : ("file" as const),
        mtimeMs: (await NodeFSP.stat(NodePath.join(path, e.name)).catch(() => ({ mtimeMs: 0 })))
          .mtimeMs,
      })),
    );
  },
  exists: (path) =>
    NodeFSP.access(path).then(
      () => true,
      () => false,
    ),
  stat: async (path) => ({ mtimeMs: (await NodeFSP.stat(path)).mtimeMs }),
};

/** `~/.claude-board`, or `T3_BOARD_HOME` when set (development and tests use a copy). */
export const defaultBoardHome = (): string =>
  norm(process.env.T3_BOARD_HOME || NodePath.join(NodeOS.homedir(), ".claude-board"));

const git = (dir: string, args: ReadonlyArray<string>, timeoutMs = 8000): Promise<string | null> =>
  new Promise((resolve) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", dir, ...args],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout) => resolve(error ? null : String(stdout).trim()),
    );
  });

export const nodeGit: BoardGit = {
  root: async (dir) => {
    const top = await git(dir, ["rev-parse", "--show-toplevel"]);
    return top ? norm(top) : null;
  },
  branch: async (dir) => (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"], 5000)) ?? "",
  state: async (dir): Promise<RepoState | null> => {
    const top = await git(dir, ["rev-parse", "--show-toplevel"]);
    if (!top) return null;
    const upstream = await git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    let ahead: number | null = null;
    let behind: number | null = null;
    if (upstream) {
      const c = await git(dir, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);
      if (c) {
        const [b, a] = c.split(/\s+/).map(Number);
        behind = b ?? null;
        ahead = a ?? null;
      }
    }
    const status = (await git(dir, ["status", "--porcelain"])) ?? "";
    return {
      repo: norm(top),
      name: base(top),
      branch: (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "?",
      head: (await git(dir, ["rev-parse", "--short", "HEAD"])) ?? "?",
      upstream,
      ahead,
      behind,
      dirty: status.split("\n").filter(Boolean).length,
      lastCommitAt: Number((await git(dir, ["log", "-1", "--format=%ct"])) ?? 0) * 1000,
      at: Date.now(),
    };
  },
};
