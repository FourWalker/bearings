import type { EnvironmentId } from "@t3tools/contracts";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

// The board's own path rule: slashes and case don't tell two Windows paths apart.
const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Project Board fork: the sidebar scope that lists a board's threads, as the keys of every
 * project group holding a project in one of the board's workspace folders.
 */
export function boardSidebarScope(
  groups: ReadonlyArray<Pick<SidebarProjectSnapshot, "projectKey" | "memberProjects">>,
  environmentId: EnvironmentId,
  roots: ReadonlyArray<string>,
): Array<string> {
  const folders = roots.map(norm);
  return groups
    .filter((group) =>
      group.memberProjects.some((project) => {
        const at = norm(project.workspaceRoot);
        return (
          project.environmentId === environmentId &&
          folders.some((root) => at === root || at.startsWith(`${root}/`))
        );
      }),
    )
    .map((group) => group.projectKey);
}
