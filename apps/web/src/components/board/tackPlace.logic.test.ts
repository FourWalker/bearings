import { describe, expect, it } from "vite-plus/test";

import { latestTackText, tackFocusTask, tackHopMs } from "./tackPlace.logic";

const tasks = [
  { id: "refund", title: "Refund flow edge cases" },
  { id: "refund-short", title: "Refund flow" },
  { id: "fees", title: "Seller fee table" },
  { id: "tiny", title: "API" },
];

describe("tackFocusTask", () => {
  it.each([
    ["Seller fee table is next, then Refund flow edge cases.", "fees"],
    ["refund flow edge cases is waiting on a key.", "refund"],
    ["The refund flow is fine.", "refund-short"],
    ["Nothing on the API side.", null],
    ["", null],
  ])("%s", (text, expected) => {
    expect(tackFocusTask(text, tasks)).toBe(expected);
  });
});

describe("latestTackText", () => {
  it("is empty while the last message is the person's", () => {
    expect(
      latestTackText([
        { role: "assistant", text: "Hi" },
        { role: "user", text: "What is blocked?" },
      ]),
    ).toBe("");
    expect(latestTackText([{ role: "assistant", text: "Hi" }])).toBe("Hi");
  });
});

describe("tackHopMs", () => {
  it("keeps short hops quick and long ones bounded", () => {
    expect(tackHopMs(0)).toBe(320);
    expect(tackHopMs(400)).toBe(540);
    expect(tackHopMs(5000)).toBe(1100);
  });
});
