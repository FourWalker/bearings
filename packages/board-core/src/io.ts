// @effect-diagnostics globalDate:off globalRandom:off
/**
 * What the board needs from its host: T3 Code passes Node's filesystem and its own git service.
 * Keeping these as ports keeps the core free of Node and Effect imports, and lets tests use fakes.
 *
 * @module board-core/io
 */
import type { RepoState } from "./types.ts";

export interface BoardDirEntry {
  readonly name: string;
  readonly kind: "file" | "dir";
  readonly mtimeMs: number;
}

export interface BoardIO {
  /** Rejects when the file is missing. */
  readonly read: (path: string) => Promise<string>;
  /** Creates missing parent folders. */
  readonly write: (path: string, data: string) => Promise<void>;
  /** Atomically creates an empty file. Returns false only if the file already exists. */
  readonly claim?: ((path: string) => Promise<boolean>) | undefined;
  readonly remove?: ((path: string) => Promise<void>) | undefined;
  readonly delay?: ((milliseconds: number) => Promise<void>) | undefined;
  /** Rejects when the folder is missing. */
  readonly list: (path: string) => Promise<ReadonlyArray<BoardDirEntry>>;
  readonly exists: (path: string) => Promise<boolean>;
  /** Rejects when the path is missing. */
  readonly stat: (path: string) => Promise<{ readonly mtimeMs: number }>;
}

export interface BoardGit {
  /** The repo containing `dir`, or null when `dir` is not in a git repo. */
  readonly state: (dir: string) => Promise<RepoState | null>;
  /** The checked-out branch of `dir`, or "" outside a repo. */
  readonly branch: (dir: string) => Promise<string>;
  /** The top folder of the repo containing `dir`, or null. */
  readonly root: (dir: string) => Promise<string | null>;
  /**
   * How `files` differ between commit `head` and the working tree at `dir`: "unreachable" when
   * `head` is not in the checked-out history, null when git can't say.
   */
  readonly since?: (
    dir: string,
    head: string,
    files: ReadonlyArray<string>,
  ) => Promise<"same" | "changed" | "unreachable" | null>;
  /** Commits on HEAD at `dir` that branch `target` lacks; null when the repo has no such branch. */
  readonly aheadOf?: (dir: string, target: string) => Promise<number | null>;
}

export interface BoardClock {
  readonly now: () => number;
  /** A small random integer below `n`, for id suffixes. */
  readonly random: (n: number) => number;
}

export const systemClock: BoardClock = {
  now: () => Date.now(),
  random: (n) => Math.floor(Math.random() * n),
};

/** Git that reports nothing: for hosts (and tests) that record repo state some other way. */
export const noGit: BoardGit = {
  state: async () => null,
  branch: async () => "",
  root: async () => null,
};
