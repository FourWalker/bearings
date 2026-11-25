import type { ThreadIssueLink } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { boardLinesOf } from "./boardThreadLinks.logic";

const link = (key: string, url: string, linkedAt: string, tracker = "board") =>
  ({ tracker, host: "local", scope: "nefx", key, url, title: key, linkedAt }) as ThreadIssueLink;

it("lists a thread's board tasks, the one in hand first, then the latest worked on", () => {
  const issues = [
    link("ledger", "t3board://nefx/ledger?level=2", "2026-11-25T10:00:00.000Z"),
    link("GH-12", "https://github.com/o/r/issues/12", "2026-11-25T12:00:00.000Z", "github"),
    link("refunds", "t3board://nefx/refunds?level=1&hand=1", "2026-11-25T09:00:00.000Z"),
    link("post", "t3board://nefx/post?level=3", "2026-11-25T11:00:00.000Z"),
    // Written before links carried a level.
    link("old", "t3board://nefx/old", "2026-11-24T08:00:00.000Z"),
  ];
  expect(boardLinesOf(issues)).toEqual({
    lines: [
      { key: "refunds", title: "refunds", level: 1, inHand: true },
      { key: "post", title: "post", level: 3, inHand: false },
      { key: "ledger", title: "ledger", level: 2, inHand: false },
    ],
    more: 1,
  });
  expect(boardLinesOf(undefined)).toEqual({ lines: [], more: 0 });
});
