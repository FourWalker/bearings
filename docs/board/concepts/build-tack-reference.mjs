// Fills the Tack reference pages with the app's real avatar art, so the pages cannot drift from it.
// Run from the repo root:  node docs/board/concepts/build-tack-reference.mjs
// It rewrites the text between the "TACK-ART" markers in the pages listed in PAGES.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const board = resolve(here, "../../../apps/web/src/components/board");
const load = (file) => import(pathToFileURL(resolve(board, file)).href);
const avatar = await load("tackAvatar.logic.ts");
const plotter = await load("tackPlotter.logic.ts");
const PAGES = ["tack-notifications-concept.html", "pin-attention-concept.html"];

// Plotter drawings, with the default pen's wobble baked in exactly as TackPlotter measures them.
const drawings = {};
for (const [name, strokes] of Object.entries(plotter.PLOTTER_DRAWINGS))
  drawings[name] = strokes.map((stroke, i) => ({
    d: plotter.wobblePath(stroke.d, i + 1),
    ...(stroke.tone ? { tone: stroke.tone } : {}),
    ...(stroke.part ? { part: stroke.part } : {}),
    ...(stroke.drawn === false ? { drawn: false } : {}),
  }));

// Pixel clips as strips: one palette, one string per pixel row, a cell per frame.
const { width, height } = avatar.TACK_CELL;
const strips = {};
for (const skin of ["claude", "ivory", "mint", "night", "pin"]) {
  strips[skin] = {};
  for (const clip of ["sleep", "idle", "wake", "alert", "done", "oops"]) {
    const frames = avatar.TACK_CLIPS[clip].frames.length;
    const palette = [];
    const rows = Array.from({ length: height }, () => Array(frames * width).fill("."));
    avatar.paintTackStrip(skin, clip, (x, y, color) => {
      let at = palette.indexOf(color);
      if (at < 0) at = palette.push(color) - 1;
      rows[y][x] = String.fromCharCode(97 + at);
    });
    strips[skin][clip] = { fps: avatar.TACK_CLIPS[clip].fps, frames, palette, rows: rows.map((row) => row.join("")) };
  }
}

const data = {
  cell: avatar.TACK_CELL,
  drawings,
  drawingOf: plotter.PLOTTER_DRAWING_OF,
  clipSeconds: plotter.PLOTTER_CLIP_SECONDS,
  chaseMs: plotter.PLOTTER_CHASE_MS,
  strips,
};
const css = readFileSync(resolve(board, "../../tack-plotter.css"), "utf8");
const block = (name) =>
  new RegExp(String.raw`(/\*TACK-ART:${name}\*/)[\s\S]*?(/\*END:${name}\*/)`);
for (const page of PAGES) {
  const file = resolve(here, page);
  let html = readFileSync(file, "utf8");
  for (const [name, body] of [["css", css], ["data", `window.TACK_ART = ${JSON.stringify(data)};`]]) {
    if (!block(name).test(html)) throw new Error(`${page}: no TACK-ART:${name} markers`);
    html = html.replace(block(name), (_, open, close) => `${open}\n${body}\n${close}`);
  }
  writeFileSync(file, html);
  console.log(page, Math.round(html.length / 1024) + " KB");
}
