import { describe, expect, it } from "@effect/vitest";

import type { RepoState, Task } from "./types.ts";
import { repoTreeOf } from "./view.ts";

const task = (id: string, extra: Partial<Task>): Task => ({
  id,
  title: id,
  description: "",
  status: "active",
  createdAt: 0,
  updatedAt: 0,
  lastAction: null,
  items: [],
  sessions: [],
  ...extra,
});

const repo = (extra: Partial<RepoState>): RepoState => ({
  repo: "C:/work/app",
  name: "app",
  branch: "feature/a",
  head: "aaa1111",
  upstream: "origin/feature/a",
  ahead: 0,
  behind: 0,
  dirty: 0,
  lastCommitAt: 0,
  at: 100,
  ...extra,
});

describe("repoTreeOf", () => {
  it("groups tasks by repo and branch and takes the newest record as the branch's state", () => {
    const groups = repoTreeOf([
      task("old", { repoState: [repo({ at: 100, ahead: 0 })] }),
      task("new", { repoState: [repo({ at: 300, head: "ccc3333", ahead: 2, dirty: 1 })] }),
      task("other", { repoState: [repo({ branch: "main", at: 200 })] }),
      // A finished task with no checkpoint is placed by its done evidence; it knows no push state.
      task("finished", {
        status: "done",
        doneEvidence: {
          repos: [{ repo: "C:/work/app", name: "app", branch: "main", head: "ddd4444", dirty: 0 }],
          files: [],
          at: 400,
        },
      }),
      task("untouched", {}),
    ]);
    expect(groups.map((g) => [g.branch, g.head, g.tasks.map((t) => t.id)])).toEqual([
      ["main", "ddd4444", ["finished", "other"]],
      ["feature/a", "ccc3333", ["new", "old"]],
    ]);
    expect(groups[0]?.state).toEqual({ upstream: "origin/feature/a", ahead: 0, behind: 0, dirty: 0 });
    expect(groups[1]?.state).toEqual({ upstream: "origin/feature/a", ahead: 2, behind: 0, dirty: 1 });
    expect(groups[0]?.tasks[0]?.done).toBe(true);
  });
});
