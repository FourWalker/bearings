import { describe, expect, it } from "vite-plus/test";

import {
  isDefaultSidebarRowPlacements,
  resolveSidebarRowPlacements,
  setSidebarRowDetail,
  shownInRow,
  SIDEBAR_ROW_DETAILS,
  sidebarRowEventOf,
  sidebarRowToneOf,
} from "./sidebarRowDetails";

const detail = (id: string) => SIDEBAR_ROW_DETAILS.find((entry) => entry.id === id)!;

describe("sidebar row details", () => {
  it("keeps the project on the hover card until All boards is on", () => {
    const placements = resolveSidebarRowPlacements({ sidebarRowDetails: {} });
    expect(placements.project).toBe("allBoards");
    expect(shownInRow(placements.project, false)).toBe(false);
    expect(shownInRow(placements.project, true)).toBe(true);
    expect(shownInRow(placements.time, false)).toBe(true);
    expect(shownInRow(placements.environment, true)).toBe(false);
    expect(isDefaultSidebarRowPlacements(placements)).toBe(true);
  });

  it("stores only the choices that differ from the default", () => {
    const moved = setSidebarRowDetail({ sidebarRowDetails: {} }, detail("project"), "row");
    expect(moved).toEqual({ project: "row" });
    expect(
      setSidebarRowDetail({ sidebarRowDetails: moved }, detail("project"), "allBoards"),
    ).toEqual({});
    expect(resolveSidebarRowPlacements({ sidebarRowDetails: { diff: "hidden" } }).diff).toBe(
      "hidden",
    );
  });

  it("reads a row's tone from its status", () => {
    expect(sidebarRowToneOf("working", false)).toBe("working");
    expect(sidebarRowToneOf("approval", false)).toBe("needs");
    expect(sidebarRowToneOf("limited", false)).toBe("stopped");
    expect(sidebarRowToneOf(null, true)).toBe("done");
    expect(sidebarRowToneOf(null, false)).toBe("idle");
  });

  it("plays motion only on a change of tone that means something", () => {
    expect(sidebarRowEventOf("idle", "working")).toBe("arrive");
    expect(sidebarRowEventOf("waiting", "working")).toBeNull();
    expect(sidebarRowEventOf("working", "needs")).toBe("needs");
    expect(sidebarRowEventOf("working", "done")).toBe("done");
    expect(sidebarRowEventOf("idle", "done")).toBeNull();
    expect(sidebarRowEventOf("working", "stopped")).toBe("stopped");
    expect(sidebarRowEventOf("working", "working")).toBeNull();
  });
});
