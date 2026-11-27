import type { BoardTask } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { ArrowDownIcon, ArrowUpIcon, StarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Toggle } from "~/components/ui/toggle";
import { useLocalStorage } from "~/hooks/useLocalStorage";

import type { BoardIndex } from "./board.logic";
import { type BoardNoteActions, BoardModuleNote, BoardNote } from "./BoardNotes";
import { ChoiceSelect } from "./BoardTaskEditors";
import {
  type TreeColumn,
  type TreeOptions,
  type TreeOrder,
  TREE_ORDERS,
  starredForReview,
} from "./boardTree.logic";

/**
 * Project Board fork: the Tree view as a deck. Module cards are shut to one line until opened and
 * feature cards are open until shut; a bar orders them, hides done work, filters by name and by
 * star. Kept per board on this device.
 */
const PrefsSchema = Schema.Record(
  Schema.String,
  Schema.Struct({
    order: Schema.Literals(TREE_ORDERS),
    reversed: Schema.Boolean,
    showDone: Schema.Boolean,
    open: Schema.Array(Schema.String),
    /** Feature cards the person shut: they are open otherwise. */
    shut: Schema.optional(Schema.Array(Schema.String)),
  }),
);
type TreePrefs = (typeof PrefsSchema.Type)[string];
const NO_PREFS: typeof PrefsSchema.Type = {};
const DEFAULT_PREFS: TreePrefs = { order: "last", reversed: false, showDone: false, open: [] };

export interface BoardTree {
  readonly options: TreeOptions;
  /** Module cards the person opened. */
  readonly open: ReadonlySet<string>;
  /** Feature cards the person shut. */
  readonly shut: ReadonlySet<string>;
  readonly set: (patch: Partial<Omit<TreeOptions, "query" | "starredOnly">>) => void;
  /** The name filter and the star filter last only while the board is open. */
  readonly setQuery: (query: string) => void;
  readonly setStarredOnly: (on: boolean) => void;
  readonly toggle: (taskId: string) => void;
  readonly toggleFeature: (taskId: string) => void;
  /** Opens exactly these modules; opening any also reopens every feature card. */
  readonly setOpen: (taskIds: ReadonlyArray<string>) => void;
}

export function useBoardTree(boardId: string): BoardTree {
  const [all, setAll] = useLocalStorage("t3.board.tree", NO_PREFS, PrefsSchema);
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const prefs = all[boardId] ?? DEFAULT_PREFS;
  const update = (change: (prefs: TreePrefs) => TreePrefs) =>
    setAll((previous) => ({ ...previous, [boardId]: change(previous[boardId] ?? DEFAULT_PREFS) }));
  return {
    options: {
      order: prefs.order,
      reversed: prefs.reversed,
      showDone: prefs.showDone,
      starredOnly,
      query,
    },
    open: new Set(prefs.open),
    shut: new Set(prefs.shut ?? []),
    set: (patch) => update((previous) => ({ ...previous, ...patch })),
    setQuery,
    setStarredOnly,
    toggle: (taskId) =>
      update((previous) => ({
        ...previous,
        open: previous.open.includes(taskId)
          ? previous.open.filter((id) => id !== taskId)
          : [...previous.open, taskId],
      })),
    toggleFeature: (taskId) =>
      update((previous) => {
        const shut = previous.shut ?? [];
        return {
          ...previous,
          shut: shut.includes(taskId) ? shut.filter((id) => id !== taskId) : [...shut, taskId],
        };
      }),
    setOpen: (taskIds) =>
      update((previous) => ({
        ...previous,
        open: [...taskIds],
        shut: taskIds.length > 0 ? [] : (previous.shut ?? []),
      })),
  };
}

export function BoardTreeBar(props: {
  readonly tree: BoardTree;
  /** Every module card the view shows now, for "Open all". */
  readonly cards: ReadonlyArray<string>;
  readonly starred: number;
  readonly onReview: () => void;
}) {
  const gt = useGT();
  const { tree } = props;
  const { options } = tree;
  const orders: Record<TreeOrder, string> = {
    last: gt("Last action"),
    done: gt("Done date"),
    blocked: gt("Blocked first"),
    name: gt("Name"),
    completion: gt("Completion"),
    deps: gt("Dependencies"),
  };
  const anyOpen = props.cards.some((id) => tree.open.has(id));
  return (
    <div
      data-board-tree-bar
      className="flex flex-wrap items-center gap-2 border-b bg-card/40 px-4 py-1.5"
    >
      <div className="w-56">
        <Input
          size="sm"
          type="search"
          placeholder={gt("Filter by name…")}
          aria-label={gt("Filter by name")}
          value={options.query}
          onChange={(event) => tree.setQuery(event.target.value)}
        />
      </div>
      <ChoiceSelect
        width="sm"
        label={gt("Order")}
        value={options.order}
        choices={TREE_ORDERS.map((order) => [order, orders[order]] as const)}
        onChange={(order) => tree.set({ order, reversed: false })}
      />
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-label={gt("Reverse the order")}
        aria-pressed={options.reversed}
        onClick={() => tree.set({ reversed: !options.reversed })}
      >
        {options.reversed ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </Button>
      <Toggle
        size="xs"
        variant="outline"
        pressed={options.starredOnly}
        onPressedChange={tree.setStarredOnly}
      >
        <StarIcon />
        {gt("Starred")}
      </Toggle>
      <Toggle
        size="xs"
        variant="outline"
        pressed={options.showDone}
        onPressedChange={(showDone) => tree.set({ showDone })}
      >
        {gt("Show done")}
      </Toggle>
      <div className="min-w-0 flex-1" />
      {props.starred > 0 ? (
        <Button variant="ghost-muted" size="xs" onClick={props.onReview}>
          {gt("Review stars")}
        </Button>
      ) : null}
      <Button
        variant="ghost-muted"
        size="xs"
        onClick={() => tree.setOpen(anyOpen ? [] : props.cards)}
      >
        {anyOpen ? gt("Shut all") : gt("Open all")}
      </Button>
    </div>
  );
}

export const treeModuleIds = (columns: ReadonlyArray<TreeColumn>): ReadonlyArray<string> =>
  columns.flatMap((column) => column.modules.map((entry) => entry.task.id));

export function BoardTreeColumns(props: {
  readonly index: BoardIndex;
  readonly columns: ReadonlyArray<TreeColumn>;
  readonly tree: BoardTree;
  readonly serviceName: (id: string) => string;
  readonly actions: BoardNoteActions;
}) {
  const gt = useGT();
  const { index, tree } = props;
  return (
    <div data-board-columns className="flex items-start gap-4">
      {props.columns.map((column) => (
        <section key={column.root.id} className="grid w-80 shrink-0 grid-cols-[minmax(0,1fr)]">
          <BoardNote
            index={index}
            task={column.root}
            serviceName={props.serviceName}
            actions={props.actions}
            deck={{
              open: !tree.shut.has(column.root.id),
              onToggle: () => tree.toggleFeature(column.root.id),
            }}
          />
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)]">
            {column.modules.map((entry) => {
              const open = entry.forcedOpen || tree.open.has(entry.task.id);
              return (
                <div
                  key={entry.task.id}
                  data-board-module
                  // A shut card keeps its line; the next card sits on its lower edge.
                  className={open ? "my-1.5 ms-3" : "-mb-2 ms-3"}
                >
                  <BoardModuleNote
                    index={index}
                    task={entry.task}
                    tasks={entry.tasks}
                    actions={props.actions}
                    deck={{ open, onToggle: () => tree.toggle(entry.task.id) }}
                  />
                </div>
              );
            })}
          </div>
          {column.hiddenDone > 0 ? (
            <button
              type="button"
              className="ms-3 mt-4 justify-self-start text-muted-foreground text-xs underline decoration-dotted underline-offset-4 hover:text-foreground"
              onClick={() => tree.set({ showDone: true })}
            >
              {gt("{count} done hidden", { count: column.hiddenDone })}
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

const ReviewSchema = Schema.Struct({
  off: Schema.Boolean,
  /** The day the review last showed, by board. */
  days: Schema.Record(Schema.String, Schema.String),
});
const NO_REVIEWS: typeof ReviewSchema.Type = { off: false, days: {} };

/** Whether the daily star review is turned off on this device ("Don't ask me again"). */
export function useStarReviewOff(): [boolean, (off: boolean) => void] {
  const [stored, setStored] = useLocalStorage("t3.board.stars.review", NO_REVIEWS, ReviewSchema);
  return [stored.off, (off) => setStored((previous) => ({ ...previous, off }))];
}

const today = () => new Date().toDateString();

/** The star review: open by itself the first time the board opens in a day, or when asked for. */
export function useStarReview(boardId: string, starred: number) {
  const [stored, setStored] = useLocalStorage("t3.board.stars.review", NO_REVIEWS, ReviewSchema);
  // Read once, as the board opens: a star added later in the day does not raise the dialog.
  const [open, setOpen] = useState(
    () => !stored.off && starred > 0 && stored.days[boardId] !== today(),
  );
  return {
    open,
    show: () => setOpen(true),
    close: (off: boolean) => {
      setOpen(false);
      setStored((previous) => ({
        off: off || previous.off,
        days: { ...previous.days, [boardId]: today() },
      }));
    },
  };
}

export function BoardStarReview(props: {
  readonly index: BoardIndex;
  readonly open: boolean;
  readonly onClose: (off: boolean) => void;
  /** Takes the star off these tasks. */
  readonly onUnstar: (tasks: ReadonlyArray<BoardTask>) => void;
}) {
  const gt = useGT();
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose(false);
      }}
    >
      <DialogPopup className="max-h-[90dvh] w-[min(96vw,30rem)]">
        <DialogTitle className="mx-5 mt-5">{gt("Review your stars")}</DialogTitle>
        <DialogDescription className="mx-5">
          {gt("Untick what no longer needs a star. Finished work is suggested first.")}
        </DialogDescription>
        {props.open ? <StarReviewBody {...props} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function StarReviewBody(props: {
  readonly index: BoardIndex;
  readonly onClose: (off: boolean) => void;
  readonly onUnstar: (tasks: ReadonlyArray<BoardTask>) => void;
}) {
  const gt = useGT();
  // The list as it stood when the dialog opened, so unticking never reshuffles it.
  const [entries] = useState(() => starredForReview(props.index));
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [off, setOff] = useState(false);
  const kind = (task: BoardTask) =>
    task.level === 1 ? gt("Feature") : task.level === 2 ? gt("Module") : gt("Task");
  return (
    <>
      <div className="grid max-h-[50dvh] gap-0.5 overflow-y-auto px-3 py-2">
        {entries.length === 0 ? (
          <p className="px-2 py-4 text-muted-foreground text-sm">{gt("Nothing is starred.")}</p>
        ) : null}
        {entries.map(({ task, suggested }) => (
          <label
            key={task.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent"
          >
            <Checkbox
              checked={!unticked.has(task.id)}
              onCheckedChange={(checked) =>
                setUnticked((previous) => {
                  const next = new Set(previous);
                  if (checked === true) next.delete(task.id);
                  else next.add(task.id);
                  return next;
                })
              }
            />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm">{task.title}</span>
              <span className="text-muted-foreground text-xs">
                {kind(task)}
                {task.status === "done" ? ` · ${gt("done")}` : ""}
              </span>
            </span>
            {suggested ? (
              <span
                data-board-star-suggested
                className="shrink-0 rounded-full border border-board-attention px-2 py-px font-semibold text-3xs text-board-attention uppercase tracking-wide"
              >
                {gt("Suggested")}
              </span>
            ) : null}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-muted-foreground text-xs">
          <Checkbox checked={off} onCheckedChange={(checked) => setOff(checked === true)} />
          {gt("Don't ask me again")}
        </label>
        <div className="min-w-0 flex-1" />
        <Button variant="outline" size="sm" onClick={() => props.onClose(off)}>
          {gt("Keep all")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            props.onUnstar(entries.flatMap(({ task }) => (unticked.has(task.id) ? [task] : [])));
            props.onClose(off);
          }}
        >
          {gt("Save")}
        </Button>
      </div>
    </>
  );
}
