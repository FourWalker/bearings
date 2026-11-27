/**
 * Whether a finished task can be relied on, cheapest first: git when its files are untouched, its
 * recorded check when they changed, else a recorded read of its handoff and diff.
 * @module board-core/verify
 */
import type { BoardGit } from "./io.ts";
import type { DoneEvidence, Task } from "./types.ts";

export interface DoneCheck {
  readonly state: "verified" | "recheck" | "unverified" | "not-merged";
  /** What to do before building on the task; for the agent, in one line. */
  readonly text: string;
}

const unverified = (why: string): DoneCheck => ({
  state: "unverified",
  text: `done, unverified (${why}): read its handoff and the diff of its files before relying on it, then record what you found with board_update {taskId, review: {ok, note}} so the next reader needn't.`,
});

/** What was on record when the task was finished: each repo's commit, the files, the last check. */
export function doneEvidence(
  task: Task,
  repos: ReadonlyArray<{ repo: string; name: string; branch: string; head: string; dirty: number }>,
  at: number,
): DoneEvidence {
  const check = task.checks?.[0];
  return {
    repos: repos.map(({ repo, name, branch, head, dirty }) => ({
      repo,
      name,
      branch,
      head,
      dirty,
    })),
    files: task.files ?? [],
    ...(check ? { check } : {}),
    at,
  };
}

export function evidenceLine(evidence: DoneEvidence): string {
  const commits = evidence.repos.map((r) => `${r.name} ${r.branch} @ ${r.head}`).join(", ");
  const dirty = evidence.repos.filter((r) => r.dirty > 0).map((r) => r.name);
  return [
    `Done evidence: ${commits || "no repo"}, ${evidence.files.length} file(s), ${evidence.check ? `${evidence.check.command} exited ${evidence.check.exitCode}` : "no check recorded"}.`,
    dirty.length > 0 &&
      `Uncommitted changes in ${dirty.join(", ")}: the recorded commit doesn't hold this work, so it counts as unverified until committed.`,
    !evidence.check &&
      "Run the task's tests as a single command so T3 records the result; without one it counts as unverified.",
    evidence.review &&
      `Reviewed since: ${evidence.review.ok ? "holds" : "does not hold"}. ${evidence.review.note}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** How the task's files differ between the named commits and the working trees here. */
async function sameSince(
  git: BoardGit,
  evidence: DoneEvidence,
  repos: ReadonlyArray<{ readonly repo: string; readonly name: string; readonly head: string }>,
  here: (repoName: string, recordedPath: string) => string,
): Promise<"same" | "changed" | { readonly missing: string } | null> {
  if (!git.since || repos.length === 0) return null;
  let changed = false;
  for (const repo of repos) {
    const dir = here(repo.name, repo.repo);
    const inRepo = evidence.files.filter((file) => file.startsWith(`${repo.repo}/`));
    const since = await git.since(dir, repo.head, inRepo.length > 0 ? inRepo : evidence.files);
    if (since === null) return null;
    if (since === "unreachable") return { missing: repo.name };
    if (since === "changed") changed = true;
  }
  return changed ? "changed" : "same";
}

/**
 * `here` maps a repo's name to its folder in the workspace asking, which may be another copy
 * than the one the task was finished in.
 */
export async function verifyDone(
  git: BoardGit,
  task: Task,
  here: (repoName: string, recordedPath: string) => string,
): Promise<DoneCheck> {
  const evidence = task.doneEvidence;
  const review = evidence?.review;
  if (review && !review.ok)
    return {
      state: "unverified",
      text: `done, but a review found it does not hold (${review.note}): reassess its code in full before relying on it, and track the fix as a bug task.`,
    };
  if (evidence && review && (await sameSince(git, evidence, review.repos, here)) === "same")
    return {
      state: "verified",
      text: `done, reviewed at ${review.repos.map((r) => r.head).join(", ")} and files unchanged since: ${review.note}`,
    };
  if (!evidence || evidence.repos.length === 0) return unverified("no evidence recorded");
  if (evidence.repos.some((r) => r.dirty > 0)) return unverified("finished with uncommitted work");
  if (evidence.files.length === 0) return unverified("no files recorded");
  if (!evidence.check || evidence.check.exitCode !== 0) return unverified("no passing check");
  const since = await sameSince(git, evidence, evidence.repos, here);
  if (since === null) return unverified("git state unavailable");
  if (typeof since === "object") {
    const repo = evidence.repos.find((r) => r.name === since.missing);
    return {
      state: "not-merged",
      text: `done elsewhere, not merged here: ${since.missing} commit ${repo?.head} (${repo?.branch}) is not in this branch. Merge it before work that depends on it.`,
    };
  }
  const commits = evidence.repos.map((r) => r.head).join(", ");
  return since === "changed"
    ? {
        state: "recheck",
        text: `done at ${commits}, but its files changed since: re-run \`${evidence.check.command}\` before building on it.`,
      }
    : {
        state: "verified",
        text: `done at ${commits}, files unchanged since; ${evidence.check.command} passed.`,
      };
}
