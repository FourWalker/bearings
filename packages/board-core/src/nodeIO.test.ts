import { expect, it } from "@effect/vitest";

import { dirtyCount } from "./nodeIO.ts";

it("leaves the board's own run logs out of a repo's uncommitted changes", () => {
  expect(dirtyCount("?? .local-run/\n")).toBe(0);
  expect(dirtyCount(" M src/a.ts\n?? .local-run/\n?? api/.local-run/logs/x.log\n")).toBe(1);
  expect(dirtyCount("?? src/.local-runner/a.ts\n")).toBe(1);
});
