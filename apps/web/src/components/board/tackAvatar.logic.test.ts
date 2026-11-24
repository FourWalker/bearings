import { expect, it } from "vite-plus/test";

import {
  advanceTackPlayback,
  finishTackClip,
  paintTackStrip,
  pokeTack,
  ringTack,
  cheerTack,
  clipRuns,
  startTackPlayback,
  TACK_CELL,
  TACK_CLIPS,
  tackMood,
  tackNoteCount,
} from "./tackAvatar.logic";

const quiet = { open: true, busy: false, waiting: false, typing: false, failed: false };

it("reads Tack's mood from the chat, with a pending answer above everything", () => {
  expect(tackMood({ ...quiet, open: false })).toBe("rest");
  expect(tackMood(quiet)).toBe("idle");
  expect(tackMood({ ...quiet, typing: true })).toBe("listen");
  expect(tackMood({ ...quiet, typing: true, failed: true })).toBe("oops");
  expect(tackMood({ ...quiet, failed: true, busy: true })).toBe("think");
  expect(tackMood({ ...quiet, busy: true, waiting: true })).toBe("alert");
});

it("plays a reaction between moods and dozes off only while the chat is closed", () => {
  let tack = startTackPlayback("rest", 0, "full");
  expect(tack.clip).toBe("idle");
  tack = finishTackClip(tack, "full");
  expect(tack.clip).toBe("sleep");
  // Sleep plays out, then holds instead of restarting.
  tack = finishTackClip(tack, "full");
  expect(tack).toMatchObject({ clip: "sleep", held: true });

  tack = advanceTackPlayback(tack, "idle", 0, "full");
  expect(tack).toMatchObject({ clip: "wake", held: false });
  tack = finishTackClip(tack, "full");
  expect(tack.clip).toBe("idle");

  tack = advanceTackPlayback(tack, "think", 0, "full");
  expect(tack.clip).toBe("think");
  tack = advanceTackPlayback(tack, "idle", 0, "full");
  expect(tack.clip).toBe("done");
  expect(finishTackClip(tack, "full").clip).toBe("idle");
});

it("writes a note for a task created while working, and lets the note finish", () => {
  const thinking = advanceTackPlayback(startTackPlayback("idle", 0, "full"), "think", 0, "full");
  // History loading into an idle chat is not Tack writing.
  expect(advanceTackPlayback(startTackPlayback("idle", 0, "full"), "idle", 2, "full").clip).toBe(
    "idle",
  );
  const writing = advanceTackPlayback(thinking, "think", 1, "full");
  expect(writing.clip).toBe("write");
  const answered = advanceTackPlayback(writing, "idle", 1, "full");
  expect(answered.clip).toBe("write");
  expect(finishTackClip(answered, "full").clip).toBe("idle");

  expect(
    tackNoteCount([
      { type: "dynamic_tool", toolName: "mcp__t3__board_create_task" },
      { type: "dynamic_tool", toolName: "board_find" },
      { type: "assistant_message" },
      { type: "dynamic_tool", toolName: null },
    ]),
  ).toBe(1);
});

it("skips clips that would never end when motion is reduced", () => {
  // Still: no reaction clips, and a closed chat shows the sleeping pose at once.
  expect(startTackPlayback("rest", 0, "still").clip).toBe("sleep");
  const still = advanceTackPlayback(startTackPlayback("rest", 0, "still"), "idle", 0, "still");
  expect(still.clip).toBe("idle");
  expect(pokeTack(still, "still")).toBe(still);
  // Calm: reactions play, the resting loop does not, so it goes straight to sleep.
  const calm = advanceTackPlayback(startTackPlayback("rest", 0, "calm"), "idle", 0, "calm");
  expect(calm.clip).toBe("wake");
  expect(pokeTack(finishTackClip(calm, "calm"), "calm").clip).toBe("wake");
});

it("rings for a notice and goes back to what it was doing", () => {
  const asleep = finishTackClip(startTackPlayback("rest", 0, "full"), "full");
  const ringing = ringTack(asleep, "full");
  expect(ringing.clip).toBe("alert");
  // The mood is still rest, so the bell is a few rings and not Tack's own wait.
  expect(clipRuns("alert", "rest")).toBe(6);
  expect(clipRuns("alert", "alert")).toBeNull();
  expect(finishTackClip(ringing, "full").clip).toBe("idle");
  // Waiting on its own approval already rings; still motion never does.
  const waiting = advanceTackPlayback(asleep, "alert", 0, "full");
  expect(ringTack(waiting, "full")).toBe(waiting);
  expect(ringTack(asleep, "still")).toBe(asleep);
  // The flourish only when Tack has nothing else on.
  expect(cheerTack(finishTackClip(ringing, "full"), "full").clip).toBe("done");
  expect(cheerTack(ringing, "full")).toBe(ringing);
});

it("paints every clip of every skin inside its cells", () => {
  for (const skin of ["claude", "pin"] as const)
    for (const [clip, spec] of Object.entries(TACK_CLIPS)) {
      const columns = new Set<number>();
      paintTackStrip(skin, clip as keyof typeof TACK_CLIPS, (x, y) => {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(TACK_CELL.height);
        columns.add(Math.floor(x / TACK_CELL.width));
      });
      expect(columns.size).toBe(spec.frames.length);
    }
});
