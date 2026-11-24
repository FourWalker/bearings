import type { TackClip } from "./tackAvatar.logic";

/**
 * Project Board fork: Plotter, the Tack skin drawn by a pen. Each clip is a small line drawing on a
 * 200×200 sheet; when the drawing changes, a pen dot draws the new one stroke by stroke. Timing is
 * computed here and played by CSS, so no script runs per frame.
 */

export const PLOTTER_SPEEDS = ["slow", "app", "fast"] as const;
export type PlotterSpeed = (typeof PLOTTER_SPEEDS)[number];
export const PLOTTER_INKS = ["chase", "retrace"] as const;
export type PlotterInk = (typeof PLOTTER_INKS)[number];

export interface PlotterPen {
  readonly speed: PlotterSpeed;
  /** How the old drawing leaves: its tail chases it off, or the pen eats it back. */
  readonly ink: PlotterInk;
  /** Show the pen travelling between strokes, as a real plotter's pen-up moves. */
  readonly hops: boolean;
  /** A hand-inked wobble baked into the paths. */
  readonly wobble: boolean;
}
export const DEFAULT_PLOTTER_PEN: PlotterPen = {
  speed: "app",
  ink: "chase",
  hops: true,
  wobble: true,
};

export interface PlotterStroke {
  readonly d: string;
  readonly tone?: "rust" | "fill-ink" | "fill-rust" | "fill-paper";
  /** A part the drawing's own motion moves or swaps. */
  readonly part?: string;
  /** Shown by the drawing's motion rather than drawn by the pen. */
  readonly drawn?: false;
}

const circ = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const oval = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;

function gear(cx: number, cy: number, r: number, teeth: number, depth: number, offDeg: number) {
  let d = "";
  const pitch = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * pitch + (offDeg * Math.PI) / 180;
    const points: ReadonlyArray<readonly [number, number]> = [
      [a, r - depth],
      [a + pitch * 0.18, r],
      [a + pitch * 0.48, r],
      [a + pitch * 0.66, r - depth],
    ];
    for (const [angle, radius] of points)
      d += `${d === "" ? "M" : "L"}${(cx + Math.cos(angle) * radius).toFixed(1)} ${(cy + Math.sin(angle) * radius).toFixed(1)}`;
  }
  return `${d}Z`;
}

function spokes(cx: number, cy: number, r0: number, r1: number, count: number, off = 0) {
  return Array.from({ length: count }, (_, i) => {
    const a = off + (i / count) * Math.PI * 2;
    const at = (r: number) =>
      `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
    return `M${at(r0)}L${at(r1)}`;
  }).join("");
}

export const PLOTTER_GEAR_A = { cx: 70, cy: 124, teeth: 12 } as const;
export const PLOTTER_GEAR_B = { cx: 114, cy: 87, teeth: 7 } as const;

/** A scholar in a soft cap, reading the card in his hand. */
const FACE: ReadonlyArray<PlotterStroke> = [
  {
    d: "M44 86C30 70 40 42 76 32C106 24 150 26 168 44C180 56 174 74 158 78C142 82 124 74 102 76C80 78 60 82 44 86",
  },
  { d: "M66 52C92 40 130 40 154 52" },
  { d: "M54 88C76 80 124 80 150 86" },
  { d: "M52 90C42 112 54 130 44 152C36 170 46 184 34 198" },
  { d: "M60 94C54 116 62 134 56 158C52 174 58 186 52 198" },
  { d: "M150 88C160 110 148 128 158 150C166 170 156 184 168 198" },
  { d: "M142 94C148 116 140 134 146 158C150 174 144 186 150 198" },
  { d: "M70 94C67 106 68 118 73 128" },
  { d: "M132 94C135 106 134 118 129 128" },
  { d: "M76 104C83 98 91 98 97 102", part: "brow" },
  { d: "M105 102C111 97 120 97 127 103", part: "brow" },
  { d: "M100 99C101 102 101 105 100 107", part: "brow" },
  { d: "M79 113C84 108 92 108 96 112" },
  { d: "M80 114C85 117 91 117 95 114" },
  { d: circ(88, 112.6, 2.1), tone: "fill-ink", part: "pupil" },
  { d: "M106 112C110 108 118 108 123 113" },
  { d: "M107 114C112 117 118 117 122 114" },
  { d: circ(114.5, 112.6, 2.1), tone: "fill-ink", part: "pupil" },
  { d: "M82 120C86 122 91 122 94 120" },
  { d: "M108 120C112 122 117 122 120 120" },
  { d: "M101 108C102 118 99 126 96 132C99 136 105 137 109 133" },
  { d: "M84 144C92 139 98 140 101 143C104 140 110 139 118 144" },
  { d: "M93 148C98 149.5 104 149.5 109 148" },
  { d: "M73 128C78 136 84 142 84 148" },
  { d: "M129 128C124 136 118 142 119 148" },
  { d: "M73 128C68 142 78 154 72 168C66 182 76 190 70 200" },
  { d: "M84 148C80 160 88 172 83 184C79 192 86 196 84 200" },
  { d: "M97 153C93 165 101 175 96 187C93 193 97 197 96 200" },
  { d: "M106 153C110 165 102 175 107 187C110 193 106 197 107 200" },
  { d: "M119 148C123 160 115 172 120 184C124 192 117 196 119 200" },
  { d: "M129 128C134 142 124 154 130 168C136 182 126 190 132 200" },
  { d: "M16 152L66 143L73 186L23 195Z", tone: "fill-paper" },
  { d: "M24 159C32 157 44 155 59 152", part: "line" },
  { d: "M25 166C36 164 48 162 60 160", part: "line" },
  { d: "M26 173C34 172 44 170 54 168", part: "line" },
  { d: "M27 180C38 178 50 176 63 174", part: "line" },
  { d: "M64 177C71 174 76 179 73 184" },
];

/**
 * The scholar with a notice in hand: the card's lines give way to a rust stamp, and the card and
 * the thumb on it move as one, so he can lift it toward the person.
 */
const STAMP: ReadonlyArray<PlotterStroke> = [
  { d: "M27 158L61 152L64.5 172.5L30.5 178.5Z", tone: "rust", part: "card" },
  { d: "M43.2 157.4L45 167", tone: "rust", part: "card" },
  { d: circ(45.7, 171.3, 1.4), tone: "fill-rust", part: "card" },
];
const ATTENTION: ReadonlyArray<PlotterStroke> = FACE.flatMap((stroke, i) =>
  stroke.part === "line"
    ? []
    : stroke.tone === "fill-paper"
      ? [{ ...stroke, part: "card" }, ...STAMP]
      : i === FACE.length - 1
        ? [{ ...stroke, part: "card" }]
        : [stroke],
);

const CANDLE: ReadonlyArray<PlotterStroke> = [
  { d: "M58 172C76 182 124 182 142 172C124 164 76 164 58 172" },
  { d: "M142 172C156 170 158 182 146 184" },
  { d: "M90 170L90 118" },
  { d: "M110 170L110 118" },
  { d: "M90 118C94 114 106 114 110 118C106 121 94 121 90 118" },
  { d: "M93 119C93 126 95 128 95 133" },
  { d: "M100 116L101 108" },
  { d: "M101 106C94 96 108 88 100 78C94 70 104 62 99 54", part: "smoke-1" },
  { d: "M101 106C96 97 106 90 101 80C96 72 106 64 102 56", part: "smoke-2", drawn: false },
  { d: "M101 106C93 98 106 89 98 79C93 71 102 63 97 54", part: "smoke-3", drawn: false },
  {
    d: "M150 38C136 42 134 64 150 70C134 74 122 60 126 46C130 36 142 32 150 38",
    tone: "rust",
  },
  { d: "M162 88L170 88L162 96L170 96", part: "z-1" },
  { d: "M174 72L180 72L174 78L180 78", part: "z-2" },
];

const TRUMPET: ReadonlyArray<PlotterStroke> = [
  { d: oval(38, 112, 3, 5) },
  { d: "M41 108C80 106 110 96 140 70" },
  { d: "M41 116C80 118 112 118 140 122" },
  { d: "M74 105C76 109 76 113 74 117" },
  { d: oval(140, 96, 8, 26) },
  { d: "M158 84C163 92 163 100 158 108", tone: "rust", part: "arc-1", drawn: false },
  { d: "M168 76C176 88 176 104 168 116", tone: "rust", part: "arc-2", drawn: false },
  { d: "M178 68C189 84 189 108 178 124", tone: "rust", part: "arc-3", drawn: false },
];

const A = PLOTTER_GEAR_A;
const B = PLOTTER_GEAR_B;
const GEARS: ReadonlyArray<PlotterStroke> = [
  { d: gear(A.cx, A.cy, 40, A.teeth, 7, 10), part: "gear-a" },
  { d: circ(A.cx, A.cy, 7), part: "gear-a" },
  { d: spokes(A.cx, A.cy, 7, 29, 4, 0.4), part: "gear-a" },
  { d: gear(B.cx, B.cy, 24, B.teeth, 6.5, -5.5), part: "gear-b" },
  { d: circ(B.cx, B.cy, 4.5), tone: "fill-rust", part: "gear-b" },
  { d: spokes(B.cx, B.cy, 4.5, 15, 3), part: "gear-b" },
  { d: "M150 48C156 44 162 46 164 52M158 34C168 28 180 32 182 44", tone: "rust" },
];

const QUILL: ReadonlyArray<PlotterStroke> = [
  { d: "M40 96L122 88L130 170L48 178Z", tone: "fill-paper" },
  { d: circ(81, 98, 4), tone: "fill-rust" },
  { d: "M178 22L124 132", part: "quill" },
  { d: "M176 26C156 32 142 58 146 86", part: "quill" },
  { d: "M178 24C194 42 178 72 150 86", part: "quill" },
  { d: "M162 40L154 48M168 52L158 60", part: "quill" },
  { d: "M128 124L124 132L130 128", part: "quill" },
  { d: "M54 112c5-3 8 3 13 0s8 3 13 0s8 3 13 0s8 3 12 0", part: "script", drawn: false },
  { d: "M55 126c5-3 8 3 13 0s8 3 13 0s8 3 12 0", part: "script", drawn: false },
  { d: "M56 140c5-3 8 3 13 0s8 3 13 0s8 3 13 0s7 3 10 0", part: "script", drawn: false },
  { d: "M57 154c5-3 8 3 13 0s8 3 11 0", part: "script", drawn: false },
];

const BELL: ReadonlyArray<PlotterStroke> = [
  { d: "M100 76L100 58", part: "bell" },
  { d: circ(100, 52, 6), part: "bell" },
  { d: "M72 134C84 128 84 88 100 80C116 88 116 128 128 134Z", part: "bell" },
  { d: "M72 134C84 141 116 141 128 134", part: "bell" },
  { d: "M100 138L100 142", part: "bell" },
  { d: circ(100, 146, 4), tone: "fill-ink", part: "bell" },
  { d: "M62 108L52 100M60 124L48 126", tone: "rust", part: "ring-l", drawn: false },
  { d: "M138 108L148 100M140 124L152 126", tone: "rust", part: "ring-r", drawn: false },
];

const BIRD: ReadonlyArray<PlotterStroke> = [
  {
    d: "M56 112C72 104 104 102 128 104C138 105 146 102 152 98L161 100L152 104C146 110 138 114 126 116C100 120 72 118 56 112Z",
    part: "bird",
  },
  { d: "M56 112L36 101L41 112L35 123Z", part: "bird" },
  {
    d: "M110 104C116 82 128 64 150 52C140 68 128 86 122 104",
    part: "wing-up",
  },
  { d: "M100 106C94 82 80 62 56 48C82 54 104 74 116 104", part: "wing-up" },
  {
    d: "M112 105C126 98 142 94 162 92C146 100 130 104 122 106M100 108C86 98 70 94 46 96C70 104 92 108 116 106",
    part: "wing-mid",
    drawn: false,
  },
  {
    d: "M110 112C118 126 130 136 148 144C136 132 126 122 122 112M100 112C92 128 80 142 58 152C82 146 104 130 116 114",
    part: "wing-down",
    drawn: false,
  },
  { d: circ(144, 103.5, 1.6), tone: "fill-ink", part: "bird" },
  { d: "M26 96L12 94M28 112L10 112M26 128L12 131", tone: "rust" },
];

const INKWELL: ReadonlyArray<PlotterStroke> = [
  {
    d: "M44 124C44 112 52 106 64 106L104 110C112 112 116 118 116 126C116 134 112 140 104 142L64 146C52 146 44 138 44 124Z",
  },
  { d: "M116 118L128 119L128 133L116 134" },
  { d: "M70 107C66 118 66 134 70 145" },
  {
    d: "M128 126C140 120 156 124 160 134C172 136 172 150 160 152C156 164 136 164 132 154C122 154 120 140 128 126Z",
    tone: "fill-ink",
  },
  { d: circ(172, 120, 3), tone: "fill-ink", part: "drop-1", drawn: false },
  { d: circ(178, 162, 2), tone: "fill-ink", part: "drop-2", drawn: false },
  { d: circ(148, 172, 2.5), tone: "fill-ink", part: "drop-3", drawn: false },
  { d: "M30 160L120 168", tone: "rust" },
];

/**
 * The Plotter's Sub Tack: a small bird in a 60-unit box, drawn to read at the size it has on the
 * Pin bar. The Plotter sketches it in its note before it flies off.
 */
export const PLOTTER_SUB_BIRD: ReadonlyArray<PlotterStroke> = [
  { d: "M14 39C14 29 24 25 33 28C42 31 43 41 35 45C26 49 14 47 14 39Z" },
  { d: circ(40, 24, 6.2) },
  { d: circ(41.5, 23, 1), tone: "fill-ink" },
  { d: "M46 22L54 25L46 27.5Z", tone: "fill-rust" },
  { d: "M15 38L5 33" },
  { d: "M15 41L4 42" },
  { d: "M25 46L25 56L21 57" },
  { d: "M31 46L31 56L35 57" },
  { d: "M22 34C28 27 37 31 35 40C31 38 26 37 22 34Z", part: "wing" },
  { d: "M26 34L32 37", tone: "rust", part: "wing" },
];

export const PLOTTER_DRAWINGS = {
  face: FACE,
  attention: ATTENTION,
  candle: CANDLE,
  trumpet: TRUMPET,
  gears: GEARS,
  quill: QUILL,
  bell: BELL,
  bird: BIRD,
  inkwell: INKWELL,
} as const;
export type PlotterDrawing = keyof typeof PLOTTER_DRAWINGS;

/** Waking and reading share the scholar: only a change of drawing brings out the pen. */
export const PLOTTER_DRAWING_OF: Record<TackClip, PlotterDrawing> = {
  idle: "face",
  wake: "face",
  sleep: "candle",
  listen: "trumpet",
  think: "gears",
  write: "quill",
  alert: "bell",
  done: "bird",
  oops: "inkwell",
};

/** One play of each clip's own motion, in seconds; a clip's runs are counted in these. */
export const PLOTTER_CLIP_SECONDS: Record<TackClip, number> = {
  idle: 2,
  wake: 1.8,
  sleep: 2,
  listen: 0.9,
  think: 2,
  write: 3.2,
  alert: 0.6,
  done: 2,
  oops: 1,
};

/** Pen speed in sheet units a second; "app" fits any drawing in 0.9 s, but never crawls. */
export function plotterSpeed(speed: PlotterSpeed, distance: number): number {
  if (speed === "slow") return 520;
  if (speed === "fast") return 3600;
  return Math.max(700, distance / 0.9);
}

export interface PlotterStep {
  readonly delay: number;
  readonly duration: number;
}

/**
 * When each stroke is drawn, in ms. Strokes follow one another at one pen speed; with hops the pen
 * also travels between them at that speed, so a dot riding the joined path stays on the tip.
 */
export function plotterTimeline(
  strokes: ReadonlyArray<{ readonly length: number; readonly hop: number }>,
  speed: PlotterSpeed,
  hops: boolean,
): { readonly total: number; readonly steps: ReadonlyArray<PlotterStep> } {
  const distance = strokes.reduce((sum, s) => sum + s.length + (hops ? s.hop : 0), 0);
  const perMs = plotterSpeed(speed, distance) / 1000;
  let at = 0;
  const steps = strokes.map((stroke) => {
    at += hops ? stroke.hop / perMs : 0;
    const step = { delay: at, duration: stroke.length / perMs };
    at += step.duration;
    return step;
  });
  return { total: at, steps };
}

/** The retrace erase: the pen eats strokes back, last first, faster than it drew them. */
export function plotterRetrace(
  lengths: ReadonlyArray<number>,
  speed: PlotterSpeed,
): { readonly total: number; readonly steps: ReadonlyArray<PlotterStep> } {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const perMs = (plotterSpeed(speed, total) * 2.4) / 1000;
  let at = 0;
  const steps: Array<PlotterStep> = Array.from({ length: lengths.length });
  for (let i = lengths.length - 1; i >= 0; i--) {
    const duration = (lengths[i] ?? 0) / perMs;
    steps[i] = { delay: at, duration };
    at += duration;
  }
  return { total: at, steps };
}

export const PLOTTER_CHASE_MS = 300;

/**
 * The path a pen dot rides through every stroke: jumps between them, or pen-up lines with hops.
 * A closed stroke returns to its own start: joined after others, "Z" would close onto the very
 * first stroke's start and carry the dot off the line it is drawing.
 */
export function plotterPenPath(paths: ReadonlyArray<string>, hops: boolean): string {
  return paths
    .map((d, i) => {
      const start = /^\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(d);
      const open = start === null ? d : d.replace(/Z\s*$/i, `L${start[1]} ${start[2]}`);
      return i > 0 && hops ? open.replace(/^\s*M/, "L") : open;
    })
    .join("");
}

/**
 * A deterministic hand wobble: each coordinate nudged by under a unit. Paths with arcs are left
 * alone, since an arc's flags must stay exactly 0 or 1.
 */
export function wobblePath(d: string, seed: number): string {
  if (/[aA]/.test(d)) return d;
  let n = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (value) => {
    n++;
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    const nudge = (x - Math.floor(x) - 0.5) * 1.2;
    return (Number(value) + nudge).toFixed(1);
  });
}
