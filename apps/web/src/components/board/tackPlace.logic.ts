/**
 * Project Board fork: where Tack lives on the board. The Roamer sleeps in a corner of the panel
 * and walks to the note it talks about; the Panel host sits at the top of the panel, says where
 * things stand, and walks the same way; Floating is the original chat over the board.
 */
export const TACK_PLACES = ["roam", "host", "float"] as const;
export type TackPlace = (typeof TACK_PLACES)[number];

/** Notes shorter than this are too likely to match ordinary words in a reply. */
const MIN_TITLE_LENGTH = 4;

/** The note a reply is about: the task title it names first, the longer title on a tie. */
export function tackFocusTask(
  text: string,
  tasks: ReadonlyArray<{ readonly id: string; readonly title: string }>,
): string | null {
  const haystack = text.toLowerCase();
  let best: { readonly id: string; readonly at: number; readonly length: number } | null = null;
  for (const task of tasks) {
    const title = task.title.trim().toLowerCase();
    if (title.length < MIN_TITLE_LENGTH) continue;
    const at = haystack.indexOf(title);
    if (at < 0) continue;
    if (best === null || at < best.at || (at === best.at && title.length > best.length))
      best = { id: task.id, at, length: title.length };
  }
  return best?.id ?? null;
}

/** The newest thing Tack said, or nothing while it hasn't answered yet. */
export function latestTackText(
  bubbles: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>,
): string {
  const last = bubbles.at(-1);
  return last?.role === "assistant" ? last.text : "";
}

/** How long Tack's hop between two places takes: quick across a note, never a slow crawl. */
export function tackHopMs(distance: number): number {
  return Math.round(Math.min(1100, Math.max(320, 260 + distance * 0.7)));
}
