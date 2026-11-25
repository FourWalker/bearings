import type { BoardTask } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ChevronRightIcon, StarIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatElapsedDurationLabel, formatRelativeTimeLabel } from "~/timestampFormat";

import {
  type BoardChatAttention,
  type BoardDot,
  type BoardGoalStanding,
  type BoardIndex,
  ancestorsOf,
  chatStatusOf,
  dotOf,
  flagsOf,
  levelKindOf,
  ownerHolderOf,
  tagsOf,
} from "./board.logic";
import { TackPerch } from "./BoardTack";
import { type TreeStamp, stampOf } from "./boardTree.logic";

/**
 * Project Board fork: the board app's sticky notes. Each task keeps one colour across visits
 * (picked from its id, as the board app does), tuned for both themes.
 */
const NOTE_COLOURS = [
  "bg-board-note-1",
  "bg-board-note-2",
  "bg-board-note-3",
  "bg-board-note-4",
  "bg-board-note-5",
  "bg-board-note-6",
] as const;

function hash(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const colourIndexOf = (id: string) => hash(id) % NOTE_COLOURS.length;
const iso = (ms: number) => new Date(ms).toISOString();

export interface BoardNoteActions {
  readonly onOpenTask: (task: BoardTask) => void;
  /** Opens the thread a chat (by board session id) is, when this server holds it. */
  readonly onOpenChat: (sessionId: string) => void;
  readonly canOpenChat: (sessionId: string) => boolean;
  /** Stars a task or takes its star off; missing when the person may not edit the board. */
  readonly onStar?: ((task: BoardTask, on: boolean) => void) | undefined;
}

/** A note in the Tree view's deck: shut, it shows one line; the rest opens in place. */
export interface BoardDeck {
  readonly open: boolean;
  readonly onToggle: () => void;
}

function useLevelLabel(index: BoardIndex) {
  const gt = useGT();
  return (task: BoardTask) => {
    switch (levelKindOf(index, task)) {
      case "master":
        return gt("Master task");
      case "backlog":
        return gt("Service backlog");
      case "module":
        return gt("Module");
      case "backlogItem":
        return gt("Backlog item");
      case "task":
        return gt("Task");
    }
  };
}

function useStatusLabel() {
  const gt = useGT();
  return (status: BoardTask["status"]) =>
    status === "active" ? gt("active") : status === "paused" ? gt("paused") : gt("done");
}

export function BoardDotMark(props: {
  readonly dot: BoardDot | "ended";
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        props.dot === "needs"
          ? "rotate-45 rounded-none bg-board-attention"
          : props.dot === "stopped"
            ? "rounded-none bg-destructive"
            : props.dot === "working"
              ? "bg-success"
              : props.dot === "finished"
                ? "bg-success ring-2 ring-success/35"
                : props.dot === "idle"
                  ? "bg-warning"
                  : "bg-muted-foreground/40",
        props.className,
      )}
    />
  );
}

/** The mark a chat's attention gets wherever a single chat is listed. */
export function attentionDot(
  attention: BoardChatAttention | undefined,
  live: BoardDot | "ended",
): BoardDot {
  if (attention !== undefined) return attention.kind;
  return live === "ended" ? "offline" : live;
}

/** How a Goal's standing reads in a line; null for a finished Goal, which says when instead. */
export function useGoalStandingLabel() {
  const gt = useGT();
  return (standing: BoardGoalStanding): string | null => {
    switch (standing.kind) {
      case "running":
        return gt("running");
      case "needs":
        return standing.why === "approval"
          ? gt("halted, needs you: an approval is waiting")
          : gt("halted, needs you: it asked a question");
      case "stopped":
        return gt("stopped on an error");
      case "stalled":
        return gt("stalled: its thread stopped with {count} tasks open", { count: standing.open });
      case "paused":
        return standing.waiting > 0
          ? gt("paused: {reason} · {count} decisions wait for you", {
              reason: standing.reason,
              count: standing.waiting,
            })
          : gt("paused: {reason}", { reason: standing.reason });
      case "done":
        return null;
    }
  };
}

function NoteFlags(props: { readonly index: BoardIndex; readonly task: BoardTask }) {
  const gt = useGT();
  const flags = flagsOf(props.index, props.task);
  const goalStanding =
    props.task.goal === null ? undefined : props.index.goalStanding.get(props.task.goal.id)?.kind;
  const [firstBlocker, ...moreBlockers] = flags.blockedBy;
  return (
    <>
      {firstBlocker !== undefined ? (
        <div data-board-stamp="blocked" className="font-medium text-destructive text-xs">
          {moreBlockers.length > 0
            ? gt("⛔ Blocked by {task} +{more}", {
                task: firstBlocker.title,
                more: moreBlockers.length,
              })
            : gt("⛔ Blocked by {task}", { task: firstBlocker.title })}
        </div>
      ) : flags.blockedBelow > 0 ? (
        <div className="text-destructive/80 text-xs">
          {gt("⛔ {count} blocked below", { count: flags.blockedBelow })}
        </div>
      ) : null}
      {props.task.goal !== null ? (
        <div
          data-board-stamp="goal"
          className={cn(
            "text-xs",
            (goalStanding === "needs" ||
              goalStanding === "stopped" ||
              goalStanding === "stalled") &&
              "font-semibold",
          )}
        >
          {goalStanding === "needs"
            ? gt("🎯 Goal halted, needs you · {goal}", { goal: props.task.goal.title })
            : goalStanding === "stopped"
              ? gt("🎯 Goal stopped on an error · {goal}", { goal: props.task.goal.title })
              : goalStanding === "stalled"
                ? gt("🎯 Goal stalled · {goal}", { goal: props.task.goal.title })
                : props.task.goal.status === "paused"
                  ? gt("🎯 Goal paused · {goal}", { goal: props.task.goal.title })
                  : gt("🎯 Goal · {goal}", { goal: props.task.goal.title })}
        </div>
      ) : null}
      {props.task.bug ? (
        <div className="text-xs">
          {flags.fixes !== null
            ? gt("🐞 Bug fix · {task}", { task: flags.fixes.title })
            : gt("🐞 Bug fix")}
        </div>
      ) : null}
      {flags.openFixes > 0 ? (
        <div className="font-medium text-xs">
          {gt("🐞 {count} open fixes", { count: flags.openFixes })}
        </div>
      ) : flags.openFixesBelow > 0 ? (
        <div className="text-xs opacity-80">
          {gt("🐞 {count} open fixes below", { count: flags.openFixesBelow })}
        </div>
      ) : null}
    </>
  );
}

function OwnerChip(props: { readonly index: BoardIndex; readonly task: BoardTask }) {
  const gt = useGT();
  const holder = ownerHolderOf(props.index, props.task);
  if (holder?.owner == null) return null;
  const { owner } = holder;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="rounded-full bg-foreground/10 px-2 py-px text-xs" />}
      >
        {owner.state === "soft"
          ? gt("🤝 ready · {workspace}", { workspace: owner.label })
          : gt("🏠 {workspace}", { workspace: owner.label })}
      </TooltipTrigger>
      <TooltipPopup>
        {owner.state === "soft"
          ? gt("Soft-released: another workspace can take over")
          : gt("Owned by this workspace copy")}
        {holder.id !== props.task.id ? ` (${holder.title})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function PlanLine(props: { readonly task: BoardTask; readonly showEmpty: boolean }) {
  const gt = useGT();
  const { steps, next } = props.task;
  if (steps.total === 0)
    return props.showEmpty ? <div className="text-xs opacity-60">{gt("No plan yet")}</div> : null;
  return (
    <>
      <div className="text-xs">
        {next !== null
          ? gt("Next: {id} – {text}", { id: next.id, text: next.text })
          : gt("All steps done")}
      </div>
      <div data-board-progress className="h-1 overflow-hidden rounded-full bg-foreground/15">
        <div
          className="h-full rounded-full bg-foreground/60"
          style={{ width: `${Math.round((steps.done / steps.total) * 100)}%` }}
        />
      </div>
    </>
  );
}

function StatusStrip(props: { readonly index: BoardIndex; readonly task: BoardTask }) {
  const gt = useGT();
  // A minute's tick is enough for "Working · 12m".
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const status = chatStatusOf(props.index, props.task, now);
  const wants =
    status.kind === "needs"
      ? status.count > 1
        ? gt("{count} chats need you", { count: status.count })
        : status.why === "approval"
          ? gt("1 chat needs you · approval")
          : gt("1 chat needs you · a question")
      : status.kind === "stopped"
        ? status.count > 1
          ? gt("{count} chats stopped on an error", { count: status.count })
          : gt("Stopped on an error")
        : status.kind === "finished"
          ? status.count > 1
            ? gt("{count} turns finished · not seen", { count: status.count })
            : gt("Turn finished · not seen")
          : null;
  const when =
    status.kind === "needs"
      ? gt("waiting {duration}", {
          duration: formatElapsedDurationLabel(iso(status.since), now),
        })
      : status.kind === "stopped"
        ? formatRelativeTimeLabel(iso(status.since))
        : status.kind === "finished"
          ? formatRelativeTimeLabel(iso(status.at))
          : null;
  const text =
    status.kind === "needs" || status.kind === "stopped" || status.kind === "finished"
      ? status.inSubtasks > 0
        ? gt("{what} · {count} in subtasks", { what: wants ?? "", count: status.inSubtasks })
        : (wants ?? "")
      : status.kind === "working"
        ? status.inSubtasks > 0
          ? gt("Working · {where} · {duration} · {count} in subtasks", {
              where: status.workspaces.join(", "),
              duration: formatElapsedDurationLabel(iso(status.since), now),
              count: status.inSubtasks,
            })
          : gt("Working · {where} · {duration}", {
              where: status.workspaces.join(", "),
              duration: formatElapsedDurationLabel(iso(status.since), now),
            })
        : status.kind === "idle"
          ? gt("Idle · {count} chats open", { count: status.open })
          : status.kind === "offline"
            ? gt("No chat open")
            : gt("No chats linked yet");
  return (
    <div
      data-board-note-strip={status.kind}
      className={cn(
        "-mx-3 -mb-3 mt-1 flex h-7 items-center gap-2 rounded-b-lg bg-foreground/8 px-3 text-xs",
        status.kind === "working" && "bg-success/25 font-medium",
        status.kind === "needs" && "bg-board-attention/25 font-semibold",
        status.kind === "stopped" && "bg-destructive/20 font-semibold",
        status.kind === "finished" && "bg-success/20",
      )}
    >
      <BoardDotMark dot={status.kind === "none" ? "offline" : status.kind} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {when !== null ? <span className="shrink-0 font-normal opacity-70">{when}</span> : null}
    </div>
  );
}

function LastAction(props: { readonly task: BoardTask; readonly actions: BoardNoteActions }) {
  const gt = useGT();
  const last = props.task.lastAction;
  const canOpen = last !== null && props.actions.canOpenChat(last.sessionId);
  const body = (
    <>
      <div className="flex justify-between gap-2 text-3xs uppercase tracking-wide opacity-60">
        <span className="truncate">
          {last !== null
            ? gt("Last action · {workspace} · {when}", {
                workspace: last.workspaceLabel,
                when: formatRelativeTimeLabel(iso(last.at)),
              })
            : gt("Last action")}
        </span>
        {canOpen ? <span>{gt("Open thread ↗")}</span> : null}
      </div>
      <div data-board-note-quote className="line-clamp-3 text-start text-sm">
        {last !== null ? last.text : <span className="opacity-60">{gt("Nothing yet")}</span>}
      </div>
    </>
  );
  const frame =
    "-mx-3 block w-[calc(100%+1.5rem)] border-foreground/20 border-t border-dashed px-3 py-2";
  return canOpen ? (
    <button
      type="button"
      data-board-note-stub
      className={cn(frame, "bg-foreground/4 hover:bg-foreground/10")}
      onClick={(event) => {
        event.stopPropagation();
        props.actions.onOpenChat(last.sessionId);
      }}
    >
      {body}
    </button>
  ) : (
    <div data-board-note-stub className={cn(frame, "bg-foreground/4")}>
      {body}
    </div>
  );
}

/** The star on a note or a task row: filled while the item is starred. */
export function BoardStar(props: {
  readonly task: BoardTask;
  readonly onStar: BoardNoteActions["onStar"];
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const { onStar } = props;
  const on = props.task.starredAt !== null;
  if (onStar === undefined && !on) return null;
  return (
    <button
      type="button"
      data-board-star={on ? "on" : "off"}
      disabled={onStar === undefined}
      aria-pressed={on}
      aria-label={on ? gt("Remove the star") : gt("Star")}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded outline-none ring-ring hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-inset",
        on ? "text-board-attention" : "opacity-40 hover:opacity-100",
        props.className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onStar?.(props.task, !on);
      }}
    >
      <StarIcon className={cn("size-3.5", on && "fill-current")} />
    </button>
  );
}

function useStampLabel() {
  const gt = useGT();
  return (stamp: TreeStamp) => {
    switch (stamp) {
      case "done":
        return gt("Done");
      case "blocked":
        return gt("Blocked");
      case "needs":
        return gt("Needs you");
      case "stopped":
        return gt("Stopped");
      case "working":
        return gt("Working");
      case "paused":
        return gt("Paused");
    }
  };
}

const STAMP_TONE: Record<TreeStamp, string> = {
  done: "bg-foreground/12",
  paused: "bg-foreground/12",
  working: "bg-success text-white",
  needs: "bg-board-attention text-white",
  blocked: "bg-destructive text-white",
  stopped: "bg-destructive text-white",
};

/** A shut deck card: the item's name and where it stands, in one line. */
function NotePeek(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask;
  readonly actions: BoardNoteActions;
}) {
  const { index, task } = props;
  const stampLabel = useStampLabel();
  const stamp = stampOf(index, task);
  const kids = task.level === 2 ? index.kidsOf(task.id) : [];
  const count =
    kids.length > 0
      ? `${kids.filter((kid) => kid.status === "done").length}/${kids.length}`
      : task.steps.total > 0
        ? `${task.steps.done}/${task.steps.total}`
        : "";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <BoardDotMark dot={dotOf(index, task)} />
      <h3
        data-board-note-title
        className={cn(
          "min-w-0 flex-1 truncate font-semibold leading-6",
          task.level === 1 && "text-base",
        )}
      >
        {task.title}
      </h3>
      {stamp !== null ? (
        <span
          data-board-peek-stamp={stamp}
          className={cn(
            "shrink-0 rounded-full px-1.5 py-px font-semibold text-3xs uppercase tracking-wide",
            STAMP_TONE[stamp],
          )}
        >
          {stampLabel(stamp)}
        </span>
      ) : null}
      {count ? <span className="shrink-0 font-mono text-xs opacity-70">{count}</span> : null}
      <BoardStar task={task} onStar={props.actions.onStar} />
      <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
    </div>
  );
}

/** When the item was last acted on and, once it has one, its done time. */
function NoteTimes(props: { readonly task: BoardTask; readonly last: boolean }) {
  const gt = useGT();
  const { task } = props;
  // Re-read each minute, so "2m ago" moves.
  useNowMinute();
  if (!props.last && task.doneAt === null) return null;
  return (
    <div data-board-note-times className="flex flex-wrap gap-x-3 text-xs opacity-70">
      {props.last ? (
        <span>
          {gt("Last action {when}", { when: formatRelativeTimeLabel(iso(task.lastActionAt)) })}
        </span>
      ) : null}
      {task.doneAt !== null ? (
        <span>
          {gt("Done {when}", {
            when: new Date(task.doneAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </span>
      ) : null}
    </div>
  );
}

/** Shared frame: a clickable note that opens its task, or in a deck, a shut card that opens itself. */
function NoteFrame(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask;
  readonly kind: "note" | "module";
  readonly actions: BoardNoteActions;
  readonly deck?: BoardDeck | undefined;
  readonly children: React.ReactNode;
}) {
  const gt = useGT();
  const { deck, task } = props;
  const shut = deck?.open === false;
  const onOpen = shut ? deck.onToggle : () => props.actions.onOpenTask(task);
  return (
    <div
      role="button"
      tabIndex={0}
      data-board-note={props.kind}
      data-board-task={task.id}
      data-note-status={task.status}
      data-note-colour={colourIndexOf(task.id) + 1}
      data-board-deck={deck === undefined ? undefined : shut ? "shut" : "open"}
      aria-expanded={deck === undefined ? undefined : !shut}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "relative grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)] gap-1.5 rounded-lg p-3 text-board-note-ink shadow-sm outline-none ring-ring wrap-anywhere focus-visible:ring-2 focus-visible:ring-inset",
        NOTE_COLOURS[colourIndexOf(task.id)],
        task.status === "done" && "opacity-60",
        // A shut module leaves a strip under its line for the next card to sit on.
        shut && (props.kind === "module" ? "pt-2 pb-4" : "py-2"),
      )}
    >
      {shut ? (
        <NotePeek index={props.index} task={task} actions={props.actions} />
      ) : (
        <>
          {props.children}
          <div className="absolute end-1.5 top-1.5 flex items-center gap-0.5">
            <BoardStar task={task} onStar={props.actions.onStar} />
            {deck !== undefined ? (
              <button
                type="button"
                aria-label={gt("Shut the card")}
                className="grid size-5 place-items-center rounded opacity-60 outline-none ring-ring hover:bg-foreground/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-inset"
                onClick={(event) => {
                  event.stopPropagation();
                  deck.onToggle();
                }}
              >
                <ChevronRightIcon className="size-3.5 rotate-90" />
              </button>
            ) : null}
          </div>
        </>
      )}
      <TackPerch taskId={task.id} />
    </div>
  );
}

/** A master task, or any task shown on its own (the level views): the full note. */
export function BoardNote(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask;
  readonly serviceName: (id: string) => string;
  readonly actions: BoardNoteActions;
  /** The level views show a note's parents at its foot. */
  readonly showParents?: boolean;
  readonly deck?: BoardDeck | undefined;
}) {
  const gt = useGT();
  const { index, task } = props;
  const levelLabel = useLevelLabel(index);
  const statusLabel = useStatusLabel();
  const kids = index.kidsOf(task.id);
  const taskCount = task.level === 1 ? kids.reduce((n, m) => n + index.kidsOf(m.id).length, 0) : 0;
  const openItems = task.items.filter((item) => !item.done);
  const mustDo = openItems.filter((item) => item.kind === "mandatory").length;
  const decisions =
    task.decisions.filter((decision) => decision.status === "open").length +
    openItems.filter((item) => item.kind === "decision").length;
  const workspaces = [
    ...new Set(task.chats.filter((chat) => chat.live !== "ended").map((c) => c.workspaceLabel)),
  ];
  const kidsLabel =
    kids.length === 0
      ? ""
      : task.level === 1
        ? gt(" · {modules} modules · {tasks} tasks", { modules: kids.length, tasks: taskCount })
        : gt(" · {tasks} tasks", { tasks: kids.length });
  const parents = props.showParents === true ? ancestorsOf(index, task) : [];
  return (
    <NoteFrame kind="note" index={index} task={task} actions={props.actions} deck={props.deck}>
      <div data-board-note-label className="pe-12 text-3xs uppercase tracking-wide opacity-70">
        {levelLabel(task)}
        {task.kind === "backlog" && task.mainService !== null
          ? ` · ${props.serviceName(task.mainService)}`
          : ""}
        {kidsLabel}
        {task.status !== "active" ? ` · ${statusLabel(task.status)}` : ""}
      </div>
      <NoteFlags index={index} task={task} />
      <h3 data-board-note-title className="font-semibold text-base leading-tight">
        {task.title}
      </h3>
      {task.description ? (
        <p className="line-clamp-2 text-xs opacity-80">{task.description}</p>
      ) : null}
      <PlanLine task={task} showEmpty />
      <div className="flex flex-wrap gap-1.5 text-xs">
        {task.steps.total > 0 ? (
          <span className="rounded-full bg-foreground/10 px-2 py-px">
            {gt("{done}/{total} steps", { done: task.steps.done, total: task.steps.total })}
          </span>
        ) : null}
        {mustDo > 0 ? (
          <span className="rounded-full bg-destructive/25 px-2 py-px">
            {gt("{count} must-do", { count: mustDo })}
          </span>
        ) : null}
        {decisions > 0 ? (
          <span className="rounded-full bg-foreground/10 px-2 py-px">
            {gt("{count} decisions", { count: decisions })}
          </span>
        ) : null}
        <OwnerChip index={index} task={task} />
        {tagsOf(task)
          .slice(0, 4)
          .map((id) => (
            <span key={id} className="rounded-full bg-info/25 px-2 py-px">
              {props.serviceName(id)}
            </span>
          ))}
        {workspaces.map((label) => (
          <span key={label} data-board-tag className="rounded-full bg-foreground/10 px-2 py-px">
            {label}
          </span>
        ))}
      </div>
      <NoteTimes task={task} last={false} />
      <LastAction task={task} actions={props.actions} />
      <StatusStrip index={index} task={task} />
      {parents.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1 text-xs opacity-80">
          <span>↑</span>
          {parents.map((parent, i) => (
            <span key={parent.id} className="flex gap-1">
              {i > 0 ? <span>›</span> : null}
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  props.actions.onOpenTask(parent);
                }}
              >
                {parent.title}
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </NoteFrame>
  );
}

/** A Level 3 task as a row inside its module's note. */
function BoardTaskRow(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask;
  readonly actions: BoardNoteActions;
}) {
  const gt = useGT();
  const { index, task } = props;
  const flags = flagsOf(index, task);
  return (
    <div className="group/row flex items-center rounded hover:bg-foreground/10">
      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-start text-sm",
          task.status === "done" && "line-through opacity-60",
        )}
        onClick={(event) => {
          event.stopPropagation();
          props.actions.onOpenTask(task);
        }}
      >
        <BoardDotMark dot={dotOf(index, task)} />
        <span className="min-w-0 flex-1 truncate">
          {flags.blockedBy.length > 0 ? "⛔ " : ""}
          {task.goal !== null ? "🎯 " : ""}
          {task.bug || flags.openFixes > 0 ? "🐞 " : ""}
          {task.title}
        </span>
        <span className="text-xs opacity-70">
          {task.status === "done"
            ? gt("done")
            : task.next !== null
              ? task.next.id
              : task.steps.total > 0
                ? "✓"
                : ""}
        </span>
      </button>
      <BoardStar
        task={task}
        onStar={props.actions.onStar}
        className={
          task.starredAt === null
            ? "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-60"
            : undefined
        }
      />
    </div>
  );
}

/** A module (or backlog item) in its master task's column, listing its tasks. */
export function BoardModuleNote(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask;
  readonly actions: BoardNoteActions;
  readonly deck?: BoardDeck | undefined;
  /** The tasks to list, when a filter or an order picked them; all of them otherwise. */
  readonly tasks?: ReadonlyArray<BoardTask> | undefined;
}) {
  const { index, task } = props;
  const levelLabel = useLevelLabel(index);
  const statusLabel = useStatusLabel();
  const kids = props.tasks ?? index.kidsOf(task.id);
  return (
    <NoteFrame kind="module" index={index} task={task} actions={props.actions} deck={props.deck}>
      <div data-board-note-label className="pe-12 text-3xs uppercase tracking-wide opacity-70">
        {levelLabel(task)}
        {task.status !== "active" ? ` · ${statusLabel(task.status)}` : ""}
      </div>
      <NoteFlags index={index} task={task} />
      <div className="flex flex-wrap">
        <OwnerChip index={index} task={task} />
      </div>
      <h3 data-board-note-title className="font-semibold leading-tight">
        {task.title}
      </h3>
      <PlanLine task={task} showEmpty={false} />
      {kids.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {kids.map((kid) => (
            <BoardTaskRow key={kid.id} index={index} task={kid} actions={props.actions} />
          ))}
        </div>
      ) : null}
      <NoteTimes task={task} last />
      <StatusStrip index={index} task={task} />
    </NoteFrame>
  );
}

/** A task in the By service view. */
export function BoardServiceRow(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask;
  readonly actions: BoardNoteActions;
}) {
  const gt = useGT();
  const { index, task } = props;
  const levelLabel = useLevelLabel(index);
  const parents = ancestorsOf(index, task);
  return (
    <button
      type="button"
      className={cn(
        "grid w-full gap-0.5 rounded-md border bg-card p-2 text-start hover:bg-accent",
        task.status === "done" && "opacity-60",
      )}
      onClick={() => props.actions.onOpenTask(task)}
    >
      <span className="flex items-center gap-2">
        <BoardDotMark dot={dotOf(index, task)} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {flagsOf(index, task).blockedBy.length > 0 ? "⛔ " : ""}
          {task.goal !== null ? "🎯 " : ""}
          {task.bug ? "🐞 " : ""}
          {task.title}
        </span>
        <span className="text-muted-foreground text-xs">{levelLabel(task)}</span>
      </span>
      {parents.length > 0 ? (
        <span className="truncate text-muted-foreground text-xs">
          {parents.map((parent) => parent.title).join(" › ")}
        </span>
      ) : null}
      {task.next !== null ? (
        <span className="truncate text-xs">
          {gt("Next: {id} – {text}", { id: task.next.id, text: task.next.text })}
        </span>
      ) : null}
    </button>
  );
}
