import type { ClientSettings, SidebarRowDetailPlacement } from "@t3tools/contracts/settings";
import { msg } from "gt-react";

/**
 * Project Board fork: the details a compact chat row can show in the row, on its hover card, or
 * not at all. Ids are stored in client settings, so never rename one.
 */
export const SIDEBAR_ROW_DETAILS = [
  { id: "time", label: msg("Time and working duration"), defaultPlacement: "row" },
  { id: "project", label: msg("Project"), defaultPlacement: "allBoards" },
  { id: "environment", label: msg("Machine"), defaultPlacement: "card" },
  { id: "provider", label: msg("Provider and model"), defaultPlacement: "card" },
  { id: "pullRequest", label: msg("Pull request"), defaultPlacement: "card" },
  { id: "issue", label: msg("Linked issues"), defaultPlacement: "card" },
  { id: "diff", label: msg("Changed lines"), defaultPlacement: "card" },
  { id: "terminal", label: msg("Running terminals"), defaultPlacement: "card" },
  { id: "branch", label: msg("Branch and worktree"), defaultPlacement: "card" },
  { id: "board", label: msg("Board tasks"), defaultPlacement: "card" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: unknown;
  defaultPlacement: SidebarRowDetailPlacement;
}>;

export type SidebarRowDetailId = (typeof SIDEBAR_ROW_DETAILS)[number]["id"];
export type SidebarRowPlacements = Readonly<Record<SidebarRowDetailId, SidebarRowDetailPlacement>>;
type SidebarRowDetail = (typeof SIDEBAR_ROW_DETAILS)[number];

export function resolveSidebarRowPlacements(
  settings: Pick<ClientSettings, "sidebarRowDetails">,
): SidebarRowPlacements {
  return Object.fromEntries(
    SIDEBAR_ROW_DETAILS.map((detail) => [
      detail.id,
      settings.sidebarRowDetails[detail.id] ?? detail.defaultPlacement,
    ]),
  ) as Record<SidebarRowDetailId, SidebarRowDetailPlacement>;
}

/** Stores only choices that differ from the default, so a later default change reaches everyone else. */
export function setSidebarRowDetail(
  settings: Pick<ClientSettings, "sidebarRowDetails">,
  detail: SidebarRowDetail,
  placement: SidebarRowDetailPlacement,
): ClientSettings["sidebarRowDetails"] {
  const { [detail.id]: _previous, ...rest } = settings.sidebarRowDetails;
  return placement === detail.defaultPlacement ? rest : { ...rest, [detail.id]: placement };
}

/** Only the project can follow the All boards switch: it says which board a chat is on. */
export function sidebarRowPlacementChoices(
  id: SidebarRowDetailId,
): ReadonlyArray<SidebarRowDetailPlacement> {
  return id === "project" ? ["row", "allBoards", "card", "hidden"] : ["row", "card", "hidden"];
}

export function shownInRow(placement: SidebarRowDetailPlacement, allBoards: boolean): boolean {
  return placement === "row" || (placement === "allBoards" && allBoards);
}

export function isDefaultSidebarRowPlacements(placements: SidebarRowPlacements) {
  return SIDEBAR_ROW_DETAILS.every((detail) => placements[detail.id] === detail.defaultPlacement);
}

/** What a compact row's status says about the chat, for its look and its motion. */
export type SidebarRowTone = "working" | "waiting" | "needs" | "done" | "stopped" | "idle";

export function sidebarRowToneOf(status: string | null, unread: boolean): SidebarRowTone {
  switch (status) {
    case "preparing":
    case "working":
      return "working";
    case "waiting":
      return "waiting";
    case "approval":
    case "input":
    case "request":
      return "needs";
    case "failed":
    case "limited":
      return "stopped";
    default:
      return unread ? "done" : "idle";
  }
}

export type SidebarRowEvent = "arrive" | "needs" | "done" | "stopped";

/** The one-shot motion a change of tone plays, if any. Waiting is a quiet working. */
export function sidebarRowEventOf(
  previous: SidebarRowTone,
  next: SidebarRowTone,
): SidebarRowEvent | null {
  if (previous === next) return null;
  if (next === "needs") return "needs";
  if (next === "stopped") return "stopped";
  if (next === "working") return previous === "waiting" ? null : "arrive";
  if (next === "done") return previous === "working" || previous === "waiting" ? "done" : null;
  return null;
}
