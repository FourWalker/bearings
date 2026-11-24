/**
 * Project Board fork: Tack's pixel avatar. Each skin draws the same clips on a 26×20 cell; the
 * component turns a clip into one image strip that CSS steps through, so no timer runs.
 */

export const TACK_CELL = { width: 26, height: 20 } as const;

export const TACK_SKINS = ["claude", "ivory", "mint", "night", "pin", "plotter", "emoji"] as const;
export type TackSkin = (typeof TACK_SKINS)[number];
/** Skins drawn as pixel strips; Plotter is drawn by a pen, and the emoji is just text. */
export type TackPixelSkin = Exclude<TackSkin, "emoji" | "plotter">;
export const TACK_MOTIONS = ["full", "calm", "still"] as const;
export type TackMotion = (typeof TACK_MOTIONS)[number];

/** What Tack is doing, as the chat knows it. */
export type TackMood = "rest" | "idle" | "listen" | "think" | "alert" | "oops";
export type TackClip =
  | "sleep"
  | "idle"
  | "wake"
  | "listen"
  | "think"
  | "write"
  | "alert"
  | "done"
  | "oops";

export function tackMood(input: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly waiting: boolean;
  readonly typing: boolean;
  readonly failed: boolean;
}): TackMood {
  if (input.waiting) return "alert";
  if (input.busy) return "think";
  if (input.failed) return "oops";
  if (input.typing) return "listen";
  return input.open ? "idle" : "rest";
}

const LOOP_OF: Record<TackMood, TackClip> = {
  rest: "idle",
  idle: "idle",
  listen: "listen",
  think: "think",
  alert: "alert",
  oops: "oops",
};

/** The clip to start when the mood changes: some changes get a one-shot reaction first. */
export function clipOnMoodChange(previous: TackMood, next: TackMood): TackClip {
  if (next === "idle" || next === "rest") {
    if (previous === "think" || previous === "alert") return "done";
    if (previous === "rest" && next === "idle") return "wake";
  }
  return LOOP_OF[next];
}

/** The clip that follows a finished one. Tack dozes off once it has rested through its idle clip. */
export function clipAfter(finished: TackClip, mood: TackMood): TackClip {
  if (mood === "rest" && (finished === "idle" || finished === "sleep")) return "sleep";
  if (mood === "oops" && finished === "oops") return "idle";
  return LOOP_OF[mood];
}

/** How many times the alert clip plays for a notice that just arrived. */
const ARRIVAL_RINGS = 6;

/** How often a clip plays before `clipAfter` is asked; `null` loops until the mood changes. */
export function clipRuns(clip: TackClip, mood: TackMood): number | null {
  if (clip === "wake" || clip === "done" || clip === "write") return 1;
  // Rung for a notice, not for Tack's own wait: it rings and goes back to what it was doing.
  if (clip === "alert" && mood !== "alert") return ARRIVAL_RINGS;
  if (clip === "oops") return 3;
  if (mood === "rest") return clip === "sleep" ? 30 : 4;
  return null;
}

/** Calm keeps the one-shot reactions and holds a pose otherwise; still never moves. */
export function clipMoves(clip: TackClip, motion: TackMotion): boolean {
  if (motion === "still") return false;
  if (motion === "calm") return clip === "wake" || clip === "done" || clip === "write";
  return true;
}

/** How many notes Tack has started writing: each `board_create_task` call in its thread. */
export function tackNoteCount(
  items: ReadonlyArray<{ readonly type: string; readonly toolName?: string | null }>,
): number {
  return items.filter(
    (item) => item.type === "dynamic_tool" && item.toolName?.endsWith("board_create_task") === true,
  ).length;
}

interface SkinPalette {
  readonly kind: "claude" | "pin";
  readonly body: string;
  readonly eye: string;
}
const PALETTES: Record<TackPixelSkin, SkinPalette> = {
  claude: { kind: "claude", body: "#D97757", eye: "#1B1A18" },
  ivory: { kind: "claude", body: "#E9DFCB", eye: "#2A2722" },
  mint: { kind: "claude", body: "#6CC3A4", eye: "#10201A" },
  night: { kind: "claude", body: "#9095E0", eye: "#0F1020" },
  pin: { kind: "pin", body: "#E5484D", eye: "#1B1A18" },
};
const FX = {
  paper: "#F4EEDC",
  ink: "#8E8670",
  pencil: "#F2C14E",
  graphite: "#3A3A3A",
  zed: "#B8B2A4",
  amber: "#F5A524",
  red: "#E5484D",
  redLight: "#F28A8D",
  drop: "#7CC4F2",
  white: "#FFFFFF",
  spark: "#D97757",
  pillow: "#F1EAD8",
  pillowShade: "#CFC4AA",
  blanket: "#C8363D",
  blanketDark: "#A42B32",
  blanketEdge: "#8C2329",
  pinCollar: "#A8323A",
  pinNeedle: "#A3A3A3",
} as const;

type Paint = (x: number, y: number, color: string) => void;
interface Grid {
  readonly px: Paint;
  readonly skin: SkinPalette;
}
type Frame = (grid: Grid) => void;
type Eyes =
  | "open"
  | "blink"
  | "closed"
  | "down"
  | "downL"
  | "downR"
  | "up"
  | "upL"
  | "left"
  | "right"
  | "happy"
  | "wide"
  | "x";
type Arm = "out" | "down" | "up" | "wave" | "hold";
interface Pose {
  readonly x?: number;
  readonly y?: number;
  readonly squash?: boolean;
  readonly eyes?: Eyes;
  readonly armL?: Arm;
  readonly armR?: Arm;
  readonly legs?: "stand" | "tuck" | "stepA" | "stepB";
}
interface Drawn {
  readonly bx: number;
  readonly top: number;
}

function glyph(grid: Grid, rows: ReadonlyArray<string>, x: number, y: number, color: string) {
  rows.forEach((row, j) =>
    [...row].forEach((cell, i) => {
      if (cell === "1") grid.px(x + i, y + j, color);
    }),
  );
}
const Z_SMALL = ["111", "..1", "1..", "111"];
const Z_BIG = ["11111", "...1.", "..1..", ".1...", "11111"];
const SPARK = [
  ["..1..", "..1..", "11111", "..1..", "..1.."],
  ["1...1", ".1.1.", "..1..", ".1.1.", "1...1"],
  ["1.1.1", ".111.", "11111", ".111.", "1.1.1"],
] as const;
const TWINKLE = [".1.", "111", ".1."];

function eye(
  grid: Grid,
  mode: Eyes,
  ex: number,
  ey: number,
  side: number,
  top: number,
  color: string,
) {
  const p = (x: number, y: number) => grid.px(x, y, color);
  const cells: Record<Eyes, ReadonlyArray<readonly [number, number]>> = {
    open: [
      [ex, ey],
      [ex, ey + 1],
    ],
    blink: [[ex, ey + 1]],
    closed: [
      [ex, ey + 1],
      [ex - side, ey + 1],
    ],
    down: [
      [ex, ey + 1],
      [ex, ey + 2],
    ],
    downL: [
      [ex - 1, ey + 1],
      [ex - 1, ey + 2],
    ],
    downR: [
      [ex + 1, ey + 1],
      [ex + 1, ey + 2],
    ],
    up: [
      [ex, top],
      [ex, top + 1],
    ],
    upL: [
      [ex - 1, top],
      [ex - 1, top + 1],
    ],
    left: [
      [ex - 1, ey],
      [ex - 1, ey + 1],
    ],
    right: [
      [ex + 1, ey],
      [ex + 1, ey + 1],
    ],
    happy: [
      [ex - 1, ey + 1],
      [ex, ey],
      [ex + 1, ey + 1],
    ],
    wide: [
      [ex, ey],
      [ex, ey + 1],
      [ex - side, ey],
      [ex - side, ey + 1],
    ],
    x: [
      [ex - 1, ey],
      [ex + 1, ey],
      [ex, ey + 1],
      [ex - 1, ey + 2],
      [ex + 1, ey + 2],
    ],
  };
  for (const [x, y] of cells[mode]) p(x, y);
}

function claude(grid: Grid, pose: Pose): Drawn {
  const color = grid.skin.body;
  const squash = pose.squash === true ? 1 : 0;
  const ground = 17 + (pose.y ?? 0);
  const bx = 8 + (pose.x ?? 0);
  const bottom = ground - 2;
  const top = ground - 7 + squash;
  const legs = pose.legs ?? "stand";
  for (const [lx, group] of [
    [bx, 0],
    [bx + 2, 1],
    [bx + 7, 0],
    [bx + 9, 1],
  ] as const) {
    const lifted =
      legs === "tuck" || (legs === "stepA" && group === 0) || (legs === "stepB" && group === 1);
    for (let i = 0; i < (lifted ? 1 : 2); i++) grid.px(lx, bottom + 1 + i, color);
  }
  for (let y = top; y <= bottom; y++) for (let x = bx; x < bx + 10; x++) grid.px(x, y, color);
  const ar = top + 3;
  const arm = (mode: Arm, side: 1 | -1) => {
    const s = side < 0 ? bx - 1 : bx + 10;
    const cells: Record<Arm, ReadonlyArray<readonly [number, number]>> = {
      out: [
        [s, ar],
        [s + side, ar],
      ],
      down: [[s, ar + 1]],
      up: [
        [s, ar - 1],
        [s + side, ar - 2],
        [s + side, ar - 3],
      ],
      wave: [
        [s, ar - 1],
        [s + side, ar - 2],
        [s + 2 * side, ar - 2],
      ],
      hold: [
        [s, ar + 1],
        [s + side, ar + 1],
      ],
    };
    for (const [x, y] of cells[mode]) grid.px(x, y, color);
  };
  arm(pose.armL ?? "out", -1);
  arm(pose.armR ?? "out", 1);
  eye(grid, pose.eyes ?? "open", bx + 2, top + 1, -1, top, grid.skin.eye);
  eye(grid, pose.eyes ?? "open", bx + 7, top + 1, 1, top, grid.skin.eye);
  return { bx, top };
}

function pin(grid: Grid, pose: Pose): Drawn {
  const oy = (pose.y ?? 0) + (pose.squash === true ? 1 : 0);
  const ox = pose.x ?? 0;
  const head = [
    [10, 15],
    [9, 16],
    [9, 16],
    [9, 16],
    [10, 15],
  ] as const;
  head.forEach(([from, to], j) => {
    for (let x = from; x <= to; x++) grid.px(x + ox, 4 + j + oy, grid.skin.body);
  });
  for (let x = 11; x <= 14; x++) {
    grid.px(x + ox, 9 + oy, FX.pinCollar);
    grid.px(x + ox, 10 + oy, FX.pinCollar);
  }
  for (let y = 11 + oy; y <= 17; y++) {
    grid.px(12 + ox, y, FX.pinNeedle);
    grid.px(13 + ox, y, FX.pinNeedle);
  }
  grid.px(10 + ox, 5 + oy, FX.redLight);
  const top = 4 + oy;
  eye(grid, pose.eyes ?? "open", 11 + ox, 5 + oy, -1, top, grid.skin.eye);
  eye(grid, pose.eyes ?? "open", 14 + ox, 5 + oy, 1, top, grid.skin.eye);
  return { bx: 8 + ox, top };
}

const body = (grid: Grid, pose: Pose = {}): Drawn =>
  grid.skin.kind === "pin" ? pin(grid, pose) : claude(grid, pose);

/** Asleep in bed: the pillow flattens as Tack breathes out, the blanket moves with it. */
function tucked(grid: Grid, squash: boolean) {
  const [x0, x1, y0, y1] = squash ? [3, 14, 9, 14] : [4, 13, 8, 14];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if ((y === y0 || y === y1) && (x === x0 || x === x1)) continue;
      grid.px(x, y, y === y1 || x === x0 ? FX.pillowShade : FX.pillow);
    }
  grid.px(x0 + 2, y0 + 2, FX.pillowShade);
  grid.px(x0 + 2, y0 + 3, FX.pillowShade);
  const drawn = body(grid, {
    x: 1,
    eyes: "closed",
    squash,
    armL: "down",
    armR: "down",
    legs: "tuck",
  });
  const fold = drawn.top + 4;
  for (let y = fold; y <= 18; y++)
    for (let x = drawn.bx - 2; x <= drawn.bx + 11; x++) {
      if (y === fold && (x === drawn.bx - 2 || x === drawn.bx + 11)) continue;
      const pattern = (x + y) % 4 === 0 ? FX.blanketDark : FX.blanket;
      grid.px(x, y, y === fold ? FX.paper : y === 18 ? FX.blanketEdge : pattern);
    }
}

const repeat = (times: number, frame: Frame): ReadonlyArray<Frame> => Array(times).fill(frame);
const range = (length: number) => Array.from({ length }, (_, i) => i);

const WAVE: ReadonlyArray<Frame> = [
  ...repeat(2, (g) => body(g, { eyes: "happy", armR: "up" })),
  ...repeat(2, (g) => body(g, { eyes: "happy", armR: "wave" })),
];

function writeFrame(i: number): Frame {
  return (g) => {
    if (g.skin.kind === "pin") {
      body(g, { eyes: i > 13 ? "happy" : "down", y: i % 2 ? 0 : -1 });
      return;
    }
    const happy = i >= 14;
    const drawn = body(g, {
      x: -3,
      eyes: happy ? "happy" : "downR",
      armR: "hold",
      armL: happy && i % 2 ? "up" : "out",
      squash: i === 14,
    });
    const px = drawn.bx + 12;
    const py = drawn.top - 1;
    for (let y = py; y < py + 7; y++) for (let x = px; x < px + 6; x++) g.px(x, y, FX.paper);
    const lines = [py + 2, py + 4, py + 5];
    const written = Math.min(i, 12);
    lines.forEach((line, k) => {
      const length = Math.max(0, Math.min(4, written - k * 4));
      for (let x = 0; x < length; x++) g.px(px + 1 + x, line, FX.ink);
    });
    if (i < 12) {
      const tx = px + 1 + (i % 4);
      const ty = lines[Math.floor(i / 4)]! + (i % 2 ? 0 : -1);
      g.px(tx, ty, FX.graphite);
      for (let k = 1; k <= 3; k++) g.px(tx + k, ty - k, FX.pencil);
    } else {
      const pinY = py + ([-6, -3][i - 12] ?? 0);
      for (let x = px + 1; x <= px + 3; x++) {
        g.px(x, pinY - 2, FX.red);
        g.px(x, pinY - 1, FX.red);
      }
      g.px(px + 1, pinY - 2, FX.redLight);
      g.px(px + 2, pinY, FX.graphite);
    }
    if (i >= 15 && i % 2) glyph(g, TWINKLE, px + 5, py - 4, FX.pencil);
  };
}

interface ClipSpec {
  readonly fps: number;
  readonly frames: ReadonlyArray<Frame>;
}

export const TACK_CLIPS: Record<TackClip, ClipSpec> = {
  sleep: {
    fps: 2,
    frames: [
      (g) => {
        tucked(g, true);
        glyph(g, Z_SMALL, 20, 8, FX.zed);
      },
      (g) => {
        tucked(g, false);
        glyph(g, Z_SMALL, 21, 6, FX.zed);
      },
      (g) => {
        tucked(g, true);
        glyph(g, Z_SMALL, 22, 4, FX.zed);
      },
      (g) => {
        tucked(g, false);
        glyph(g, Z_BIG, 21, 1, FX.zed);
      },
    ],
  },
  idle: {
    fps: 4,
    frames: [
      ...repeat(10, (g) => body(g)),
      (g) => body(g, { eyes: "blink" }),
      ...repeat(6, (g) => body(g)),
      ...repeat(3, (g) => body(g, { eyes: "left" })),
      (g) => body(g),
      ...repeat(3, (g) => body(g, { eyes: "right" })),
      ...repeat(4, (g) => body(g)),
      (g) => body(g, { eyes: "blink" }),
      ...repeat(3, (g) => body(g)),
    ],
  },
  wake: {
    fps: 8,
    frames: [
      ...repeat(2, (g) => body(g, { eyes: "closed", armL: "down", armR: "down" })),
      (g) => body(g, { eyes: "wide" }),
      (g) => body(g, { eyes: "wide", squash: true, armL: "down", armR: "down" }),
      (g) => body(g, { eyes: "wide", y: -2, armL: "up", armR: "up", legs: "tuck" }),
      (g) => body(g, { eyes: "happy", y: -3, armL: "up", armR: "up", legs: "tuck" }),
      (g) => body(g, { eyes: "happy", y: -1, armL: "up", armR: "up" }),
      (g) => body(g, { eyes: "happy", squash: true }),
      (g) => body(g),
      ...WAVE,
      ...WAVE,
      (g) => body(g),
    ],
  },
  listen: {
    fps: 8,
    frames: range(8).map((i) => (g) => {
      const drawn = body(g, {
        eyes: (["downL", "downL", "down", "down", "downR", "downR", "down", "down"] as const)[i]!,
        squash: i % 4 === 3,
        legs: i % 2 ? "stepA" : "stepB",
        armL: i % 4 < 2 ? "out" : "down",
        armR: i % 4 < 2 ? "down" : "out",
      });
      for (let dot = 0; dot <= Math.floor(i / 2) && dot < 3; dot++)
        g.px(drawn.bx + 12 + dot * 2, drawn.top - 2, FX.zed);
    }),
  },
  think: {
    fps: 6,
    frames: range(6).map((i) => (g) => {
      const drawn = body(g, {
        eyes: i < 3 ? "up" : "upL",
        legs: i % 2 ? "stepA" : "stand",
        squash: i === 5,
      });
      const spark = SPARK[[0, 1, 0, 1, 2, 1][i]!]!;
      glyph(g, spark, drawn.bx + 2, drawn.top - 7, g.skin.kind === "pin" ? FX.spark : g.skin.body);
    }),
  },
  write: { fps: 6, frames: range(20).map(writeFrame) },
  alert: {
    fps: 4,
    frames: range(4).map((i) => (g) => {
      const drawn = body(g, {
        eyes: "wide",
        armL: i % 2 ? "up" : "wave",
        legs: i % 2 ? "stepA" : "stand",
      });
      const y = drawn.top - 7 + (i % 2);
      for (const row of [0, 1, 2, 4]) {
        g.px(drawn.bx + 4, y + row, FX.amber);
        g.px(drawn.bx + 5, y + row, FX.amber);
      }
    }),
  },
  done: {
    fps: 8,
    frames: [
      (g) => body(g, { squash: true }),
      (g) => body(g, { eyes: "happy", y: -2, armL: "up", armR: "up", legs: "tuck" }),
      (g) => {
        const drawn = body(g, { eyes: "happy", y: -3, armL: "up", armR: "up", legs: "tuck" });
        glyph(g, TWINKLE, drawn.bx - 4, drawn.top - 2, FX.pencil);
        glyph(g, TWINKLE, drawn.bx + 12, drawn.top - 3, FX.white);
      },
      (g) => {
        const drawn = body(g, { eyes: "happy", y: -1, armL: "up", armR: "up" });
        glyph(g, TWINKLE, drawn.bx - 4, drawn.top - 4, FX.white);
        glyph(g, TWINKLE, drawn.bx + 12, drawn.top - 1, FX.pencil);
      },
      (g) => body(g, { eyes: "happy", squash: true }),
      ...repeat(2, (g) => body(g, { eyes: "happy" })),
      (g) => body(g),
    ],
  },
  oops: {
    fps: 3,
    frames: range(4).map((i) => (g) => {
      const drawn = body(g, {
        eyes: i === 3 ? "blink" : "x",
        squash: true,
        armL: "down",
        armR: "down",
      });
      const sx = drawn.bx + 10;
      const sy = drawn.top - 1 + i;
      g.px(sx, sy, FX.drop);
      g.px(sx, sy + 1, FX.drop);
      g.px(sx + 1, sy + 1, FX.drop);
    }),
  },
};

/** Paints a clip as one strip, a cell per frame from left to right. */
export function paintTackStrip(skin: TackPixelSkin, clip: TackClip, paint: Paint) {
  TACK_CLIPS[clip].frames.forEach((frame, index) => {
    const offset = index * TACK_CELL.width;
    frame({
      skin: PALETTES[skin],
      px: (x, y, color) => {
        if (x >= 0 && x < TACK_CELL.width && y >= 0 && y < TACK_CELL.height)
          paint(offset + x, y, color);
      },
    });
  });
}

export interface TackPlayback {
  readonly mood: TackMood;
  readonly notes: number;
  readonly clip: TackClip;
  /** Counts restarts, so the same clip can play again. */
  readonly run: number;
  /** The clip has played out and holds its first frame. */
  readonly held: boolean;
}

/** A clip that will not move never ends, so its follow-up is taken at once. */
function settle(clip: TackClip, mood: TackMood, motion: TackMotion): TackClip {
  let current = clip;
  while (!clipMoves(current, motion) && clipRuns(current, mood) !== null) {
    const next = clipAfter(current, mood);
    if (next === current) break;
    current = next;
  }
  return current;
}

export function startTackPlayback(mood: TackMood, notes: number, motion: TackMotion): TackPlayback {
  return {
    mood,
    notes,
    clip: settle(clipOnMoodChange(mood, mood), mood, motion),
    run: 0,
    held: false,
  };
}

/** Playback after the chat's state moved. A note being written is left to finish. */
export function advanceTackPlayback(
  playback: TackPlayback,
  mood: TackMood,
  notes: number,
  motion: TackMotion,
): TackPlayback {
  if (playback.mood === mood && playback.notes === notes) return playback;
  const wrote = notes > playback.notes && mood === "think";
  const writing = playback.clip === "write" && !playback.held;
  const clip = wrote
    ? "write"
    : writing || playback.mood === mood
      ? playback.clip
      : clipOnMoodChange(playback.mood, mood);
  const settled = settle(clip, mood, motion);
  const restarted = settled !== playback.clip || wrote;
  return {
    mood,
    notes,
    clip: settled,
    run: restarted ? playback.run + 1 : playback.run,
    held: restarted ? false : playback.held,
  };
}

/** Playback after the clip played out its runs. */
export function finishTackClip(playback: TackPlayback, motion: TackMotion): TackPlayback {
  const next = settle(clipAfter(playback.clip, playback.mood), playback.mood, motion);
  return next === playback.clip
    ? { ...playback, held: true }
    : { ...playback, clip: next, run: playback.run + 1, held: false };
}

/** A notice arrived: Tack rings for it whatever it was doing, then carries on. */
export function ringTack(playback: TackPlayback, motion: TackMotion): TackPlayback {
  if (!clipMoves("alert", motion) || playback.mood === "alert") return playback;
  return { ...playback, clip: "alert", run: playback.run + 1, held: false };
}

/** Fired on the window once Tack's release has played and its Sub Tack may leave. */
export const TACK_RELEASED = "t3:tack-released";

/** Tack sends a Sub Tack off and stays where it is: a pixel Tack jolts, the Plotter takes its quill. */
export function releaseTack(
  playback: TackPlayback,
  motion: TackMotion,
  skin: TackSkin,
): TackPlayback {
  const clip: TackClip = skin === "plotter" ? "write" : "alert";
  if (!clipMoves(clip, motion)) return playback;
  return { ...playback, clip, run: playback.run + 1, held: false };
}

/** Good news, or the last notice dealt with: the "done" flourish, unless Tack is busy. */
export function cheerTack(playback: TackPlayback, motion: TackMotion): TackPlayback {
  if (!clipMoves("done", motion) || (playback.clip !== "idle" && playback.clip !== "sleep"))
    return playback;
  return { ...playback, clip: "done", run: playback.run + 1, held: false };
}

/** The sign a pixel Tack plants beside itself while it holds notices, with their count. */
export const TACK_SIGN = { width: 9, height: 12 } as const;
const DIGITS = [
  "111101101101111",
  "010110010010111",
  "111001111100111",
  "111001111001111",
  "101101111001001",
  "111100111001111",
  "111100111101111",
  "111001010010010",
  "111101111101111",
  "111101111001111",
];

export function paintTackSign(count: number, hot: boolean, paint: Paint) {
  const fill = (x: number, y: number, w: number, h: number, color: string) => {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) paint(x + i, y + j, color);
  };
  fill(1, 0, 7, 9, FX.graphite);
  fill(2, 1, 5, 7, hot ? FX.red : FX.zed);
  fill(4, 9, 1, 3, FX.pinNeedle);
  const digit = DIGITS[Math.max(0, Math.min(9, count))] ?? "";
  for (let i = 0; i < digit.length; i++)
    if (digit[i] === "1") paint(3 + (i % 3), 2 + Math.floor(i / 3), hot ? FX.white : FX.graphite);
}

/** Tack reacts to a click with its wave, unless it is in the middle of something. */
export function pokeTack(playback: TackPlayback, motion: TackMotion): TackPlayback {
  if (!clipMoves("wake", motion) || (playback.clip !== "idle" && playback.clip !== "sleep"))
    return playback;
  return { ...playback, clip: "wake", run: playback.run + 1, held: false };
}
