/**
 * Finding existing work on a board from a question's words: titles, aliases, plan step names,
 * decisions, docs, purposes and touched files, ranked, so a question needn't use a task's exact
 * wording.
 *
 * @module board-core/search
 */
import { planPhases } from "./plan.ts";
import { type BoardStore, levelOf } from "./store.ts";
import { base, clip } from "./text.ts";
import type { Level, Task } from "./types.ts";

// Words of the question itself, not of what it asks about.
const STOP = new Set(
  "a an and any are do does for have in is it of on our plan plans task tasks the there to touched we which with".split(
    " ",
  ),
);

/** Matching tasks under one parent, from this many up, come back as the parent. */
const ROLL_UP = 3;

export interface SearchDoc {
  readonly task: Task;
  readonly plan: string;
}

export interface SearchHit {
  readonly task: Task;
  readonly score: number;
  /** How many of the query's words the task matched. */
  readonly matched: number;
  /** Plan steps that matched: work planned here but maybe not yet a task of its own. */
  readonly steps: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  /** Files of the task that matched a path in the query. */
  readonly files: ReadonlyArray<string>;
  /** Superseded tasks that matched; this task replaced them. */
  readonly replaces: ReadonlyArray<string>;
  /** Matching tasks below this one, when they were rolled up into it. */
  readonly below: ReadonlyArray<string>;
}

export function queryWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean);
  const kept = words.filter((word) => !STOP.has(word));
  // "the plan" is still a query: with nothing else to go on, its words count.
  return [...new Set(kept.length > 0 ? kept : words)];
}

/** File paths and names in a query ("src/refund.ts", "refund.ts"), lower-cased with forward slashes. */
export function queryPaths(query: string): string[] {
  return [
    ...new Set(
      query
        .split(/\s+/)
        .map((token) =>
          token
            .replace(/^[`'"(]+|[`'"),;:!?]+$/g, "")
            .replace(/\.$/, "")
            .replace(/\\/g, "/")
            .toLowerCase(),
        )
        .filter((token) => /\//.test(token) || /[^./]\.[a-z0-9]{1,5}$/.test(token)),
    ),
  ];
}

const filesOf = (task: Task): string[] => [
  ...new Set([...(task.files ?? []), ...(task.doneEvidence?.files ?? [])]),
];

const replacementOf = (task: Task): string | undefined =>
  task.links?.find((link) => link.type === "superseded_by")?.to;

/**
 * Ranked matches: most words matched first, then open before done, then where they matched. A
 * superseded task is answered with its replacement, and several matches under one parent with the
 * parent, unless `level` asks for one level only. `every` keeps only tasks matching every word:
 * a question may be loose, a duplicate check may not.
 */
export function searchTasks(
  docs: ReadonlyArray<SearchDoc>,
  query: string,
  level?: Level,
  every = false,
): SearchHit[] {
  const paths = queryPaths(query);
  const pathWords = new Set(paths.flatMap((path) => queryWords(path)));
  const all = queryWords(query);
  // A path counts once, as a path, not as the words inside it.
  const words = paths.length > 0 ? all.filter((word) => !pathWords.has(word)) : all;
  const terms = words.length + paths.length;
  if (terms === 0) return [];
  const need = every ? terms : Math.ceil(terms / 2);
  const byId = new Map(docs.map((doc) => [doc.task.id, doc.task]));
  const hits = new Map<string, SearchHit>();
  for (const { task, plan } of docs) {
    if (level !== undefined && levelOf(task) !== level) continue;
    const title = `${task.title} ${task.id} ${(task.aliases ?? []).join(" ")}`.toLowerCase();
    const steps = planPhases(plan).flatMap((phase) => phase.steps);
    const notes = [
      ...(task.decisions ?? []).map((decision) => decision.title),
      ...(task.docs ?? []).map((doc) => doc.title),
      task.description,
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    let matched = 0;
    const stepHits = new Map<string, { readonly id: string; readonly text: string }>();
    for (const word of words) {
      const inSteps = steps.filter((step) => step.text.toLowerCase().includes(word));
      const weight = title.includes(word)
        ? 3
        : inSteps.length > 0
          ? 2
          : notes.includes(word)
            ? 1
            : 0;
      if (weight === 0) continue;
      matched += 1;
      score += weight;
      if (weight === 2) for (const step of inSteps) stepHits.set(step.id, step);
    }
    const files = filesOf(task);
    const fileHits = new Set<string>();
    for (const path of paths) {
      const found = files.filter((file) => {
        const lower = file.toLowerCase();
        return lower === path || lower.endsWith(`/${path}`);
      });
      if (found.length === 0) continue;
      matched += 1;
      score += 3;
      for (const file of found) fileHits.add(file);
    }
    if (matched < need) continue;
    const hit = { task, score, matched, steps: [...stepHits.values()], files: [...fileHits] };
    const replacement = byId.get(replacementOf(task) ?? "");
    if (!replacement) {
      const had = hits.get(task.id);
      hits.set(task.id, { ...hit, replaces: had?.replaces ?? [], below: [] });
      continue;
    }
    const had = hits.get(replacement.id);
    hits.set(replacement.id, {
      ...(had ?? { ...hit, task: replacement, steps: [], files: [] }),
      replaces: [...(had?.replaces ?? []), task.id],
      below: [],
    });
  }
  const rolled = level === undefined ? rollUp([...hits.values()], byId) : [...hits.values()];
  const open = (hit: SearchHit) => (hit.task.status === "done" ? 1 : 0);
  return rolled.toSorted(
    (a, b) =>
      b.matched - a.matched ||
      open(a) - open(b) ||
      b.score - a.score ||
      b.task.updatedAt - a.task.updatedAt,
  );
}

function rollUp(hits: ReadonlyArray<SearchHit>, byId: ReadonlyMap<string, Task>): SearchHit[] {
  const kids = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const parentId = hit.task.parentId;
    if (parentId && byId.has(parentId)) kids.set(parentId, [...(kids.get(parentId) ?? []), hit]);
  }
  const out = new Map(hits.map((hit) => [hit.task.id, hit]));
  for (const [parentId, group] of kids) {
    const parent = byId.get(parentId);
    if (group.length < ROLL_UP || !parent) continue;
    for (const hit of group) out.delete(hit.task.id);
    const own = out.get(parentId);
    out.set(parentId, {
      task: parent,
      score: Math.max(own?.score ?? 0, ...group.map((hit) => hit.score)),
      matched: Math.max(own?.matched ?? 0, ...group.map((hit) => hit.matched)),
      steps: own?.steps ?? [],
      files: own?.files ?? [],
      replaces: own?.replaces ?? [],
      below: group.map((hit) => hit.task.id),
    });
  }
  return [...out.values()];
}

/**
 * The open task a prompt most plainly names: its whole title or one of its aliases appears in
 * the prompt as words. One-word titles are too common to count; aliases are chosen, so they do.
 */
export function namedTask(tasks: ReadonlyArray<Task>, prompt: string): Task | null {
  const text = ` ${prompt
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean)
    .join(" ")} `;
  const phrase = (value: string) =>
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter(Boolean);
  let best: { readonly task: Task; readonly length: number } | null = null;
  for (const task of tasks) {
    if (task.status === "done" || replacementOf(task)) continue;
    const title = phrase(task.title);
    const names = [...(title.length > 1 ? [title] : []), ...(task.aliases ?? []).map(phrase)];
    for (const name of names) {
      if (name.length === 0 || !text.includes(` ${name.join(" ")} `)) continue;
      const length = name.join(" ").length;
      if (!best || length > best.length) best = { task, length };
    }
  }
  return best?.task ?? null;
}

/**
 * A board search as lines for a person or an agent to read: one per match, best first. With no
 * words in the query it lists the board, or one service's tasks.
 */
export async function findOnBoard(
  store: BoardStore,
  boardId: string,
  query: string,
  options: {
    readonly service?: string | undefined;
    readonly level?: Level | undefined;
    readonly every?: boolean | undefined;
  } = {},
): Promise<{ lines: string[]; all: Task[] }> {
  const all = await store.listTasks(boardId);
  const byId = new Map(all.map((x) => [x.id, x]));
  const pathOf = (x: Task) => {
    const p: string[] = [];
    let c: Task | undefined = x;
    for (let i = 0; i < 3 && c; i++) {
      p.unshift(c.title);
      c = c.parentId ? byId.get(c.parentId) : undefined;
    }
    return p.join(" › ");
  };
  const line = (
    x: Task,
    steps: ReadonlyArray<{ id: string; text: string }> = [],
    more: Partial<Pick<SearchHit, "files" | "replaces" | "below">> = {},
  ) =>
    `- ${x.id} [L${levelOf(x)}${levelOf(x) === 1 ? ` ${x.kind ?? "feature"}` : ""}, ${x.status === "done" ? "done: reference only" : x.status}] ${pathOf(x)}${x.services?.length ? ` · services: ${x.services.join(", ")}` : ""}${steps.length ? ` · planned as ${steps.map((step) => `${step.id} – ${clip(step.text, 60)}`).join("; ")}` : ""}${more.files?.length ? ` · touched ${more.files.slice(0, 3).map(base).join(", ")}` : ""}${more.replaces?.length ? ` · replaces ${more.replaces.join(", ")} (superseded)` : ""}${more.below?.length ? ` · ${more.below.length} matching tasks below: ${more.below.slice(0, 5).join(", ")}` : ""}`;
  const service = options.service ?? "";
  const inService = all.filter(
    (x) => !service || (x.services ?? []).includes(service) || x.mainService === service,
  );
  if (queryWords(query).length === 0) return { lines: inService.map((x) => line(x)), all };
  const docs = await Promise.all(
    inService.map(async (task) => ({
      task,
      plan: await store.readText(store.planPath(boardId, task.id)),
    })),
  );
  return {
    lines: searchTasks(docs, query, options.level, options.every).map((hit) =>
      line(hit.task, hit.steps, hit),
    ),
    all,
  };
}
