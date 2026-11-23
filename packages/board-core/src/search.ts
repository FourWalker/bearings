/**
 * Finding existing work on a board from a question's words: titles, plan step names, decisions,
 * docs and purposes, ranked, so a question needn't use a task's exact wording.
 *
 * @module board-core/search
 */
import { planPhases } from "./plan.ts";
import type { Task } from "./types.ts";

// Words of the question itself, not of what it asks about.
const STOP = new Set(
  "a an and any are do does for have in is it of on our plan plans task tasks the there to we with".split(
    " ",
  ),
);

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

/** Ranked matches: most words matched first, then open before done, then where they matched. */
export function searchTasks(docs: ReadonlyArray<SearchDoc>, query: string): SearchHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const need = Math.ceil(words.length / 2);
  const hits: SearchHit[] = [];
  for (const { task, plan } of docs) {
    const title = `${task.title} ${task.id}`.toLowerCase();
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
    if (matched >= need) hits.push({ task, score, matched, steps: [...stepHits.values()] });
  }
  const open = (hit: SearchHit) => (hit.task.status === "done" ? 1 : 0);
  return hits.toSorted(
    (a, b) =>
      b.matched - a.matched ||
      open(a) - open(b) ||
      b.score - a.score ||
      b.task.updatedAt - a.task.updatedAt,
  );
}
