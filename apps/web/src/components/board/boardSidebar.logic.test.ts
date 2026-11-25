import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { boardSidebarScope } from "./boardSidebar.logic";

type Groups = Parameters<typeof boardSidebarScope>[0];

it("scopes the sidebar to the projects in a board's workspace folders", () => {
  const here = EnvironmentId.make("env:here");
  const group = (projectKey: string, ...members: ReadonlyArray<readonly [string, string]>) => ({
    projectKey,
    memberProjects: members.map(([environmentId, workspaceRoot]) => ({
      environmentId,
      workspaceRoot,
    })),
  });
  const groups = [
    group("nfx", ["env:here", "C:\\nfx"]),
    group("service", ["env:here", "c:/nfx/BE/invoice"]),
    // Grouped with a copy on another machine: the local member puts the group on the board.
    group("copy", ["env:other", "/srv/else"], ["env:here", "C:/nfx-workspaces/demo/"]),
    group("sibling", ["env:here", "C:/nfx-other"]),
    group("remote", ["env:other", "C:/nfx"]),
  ] as unknown as Groups;
  expect(boardSidebarScope(groups, here, ["C:/nfx", "C:/nfx-workspaces/demo"])).toEqual([
    "nfx",
    "service",
    "copy",
  ]);
  expect(boardSidebarScope(groups, here, [])).toEqual([]);
});
