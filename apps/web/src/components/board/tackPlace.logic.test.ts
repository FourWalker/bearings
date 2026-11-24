import { describe, expect, it } from "vite-plus/test";

import { latestTackText, tackFocusTask, tackHopMs, tackReplyNote } from "./tackPlace.logic";

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

describe("tackReplyNote", () => {
  const asked = { id: "m1", role: "user", text: "What is blocked?" } as const;
  const reply = { id: "m2", role: "assistant", text: "Seller fee table is blocked." } as const;

  it("ignores the reply that was already there when Tack woke", () => {
    expect(tackReplyNote([asked, reply], "m2", tasks)).toBeNull();
  });

  it("follows a reply that came after Tack woke, once per reply and note", () => {
    expect(tackReplyNote([asked, reply], "m1", tasks)).toEqual({ key: "m2:fees", taskId: "fees" });
    expect(tackReplyNote([asked, reply], null, tasks)?.taskId).toBe("fees");
  });

  it("stays put while the person's message is the newest, or the reply names no note", () => {
    expect(tackReplyNote([reply, asked], null, tasks)).toBeNull();
    expect(tackReplyNote([asked, { ...reply, text: "Nothing is." }], "m1", tasks)).toBeNull();
  });
});

describe("tackHopMs", () => {
  it("keeps short hops quick and long ones bounded", () => {
    expect(tackHopMs(0)).toBe(320);
    expect(tackHopMs(400)).toBe(540);
    expect(tackHopMs(5000)).toBe(1100);
  });
});
