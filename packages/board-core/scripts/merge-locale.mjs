// Git merge driver for the locale catalogs: a three-way merge by key, so the board's keys and
// upstream's never conflict as text. Set up once per clone (see docs/board/HANDOFF.md).
import * as NodeFS from "node:fs";

const [basePath, oursPath, theirsPath] = process.argv.slice(2);
const read = (path) => JSON.parse(NodeFS.readFileSync(path, "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const base = read(basePath);
const ours = read(oursPath);
const theirs = read(theirsPath);
const merged = { ...ours };
const clashes = [];

for (const key of new Set([...Object.keys(base), ...Object.keys(theirs)])) {
  if (same(base[key], theirs[key])) continue;
  if (!same(base[key], ours[key]) && !same(ours[key], theirs[key])) clashes.push(key);
  if (key in theirs) merged[key] = theirs[key];
  else delete merged[key];
}

NodeFS.writeFileSync(oursPath, `${JSON.stringify(merged, null, 2)}\n`);
// A string both sides translated is upstream's string too, so upstream's wording wins.
if (clashes.length > 0) console.error(`Took upstream's text for ${clashes.join(", ")}.`);
