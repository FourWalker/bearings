import type { BoardTask } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatElapsedDurationLabel, formatRelativeTimeLabel } from "~/timestampFormat";

import {
  type BoardDot,
  type BoardIndex,
  ancestorsOf,
  chatStatusOf,
  dotOf,
  flagsOf,
  levelKindOf,
  ownerHolderOf,
  tagsOf,
} from "./board.logic";

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

const colourOf = (id: string) => NOTE_COLOURS[hash(id) % NOTE_COLOURS.length];
const iso = (ms: number) => new Date(ms).toISOString();

export interface BoardNoteActions {
  readonly onOpenTask: (task: BoardTask) => void;
  /** Opens the thread a chat (by board session id) is, when this server holds it. */
  readonly onOpenChat: (sessionId: string) => void;
  readonly canOpenChat: (sessionId: string) => boolean;
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
        props.dot === "working"
          ? "bg-success"
          : props.dot === "idle"
            ? "bg-warning"
            : "bg-muted-foreground/40",
        props.className,
      )}
    />
  );
}

function NoteFlags(props: { readonly index: BoardIndex; readonly task: BoardTask }) {
  const gt = useGT();
  const flags = flagsOf(props.index, props.task);
  const [firstBlocker, ...moreBlockers] = flags.blockedBy;
  return (
    <>
      {firstBlocker !== undefined ? (
        <div className="font-medium text-destructive text-xs">
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
      <div className="h-1 overflow-hidden rounded-full bg-foreground/15">
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
  const text =
    status.kind === "working"
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
      className={cn(
        "-mx-3 -mb-3 mt-1 flex h-7 items-center gap-2 rounded-b-lg bg-foreground/8 px-3 text-xs",
        status.kind === "working" && "bg-success/25 font-medium",
      )}
    >
      <BoardDotMark
        dot={status.kind === "working" ? "working" : status.kind === "idle" ? "idle" : "offline"}
      />
      <span className="truncate">{text}</span>
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
      <div className="line-clamp-3 text-start text-sm">
        {last !== null ? last.text : <span className="opacity-60">{gt("Nothing yet")}</span>}
      </div>
    </>
  );
  const frame =
    "-mx-3 block w-[calc(100%+1.5rem)] border-foreground/20 border-t border-dashed px-3 py-2";
  return canOpen ? (
    <button
      type="button"
      className={cn(frame, "bg-foreground/4 hover:bg-foreground/10")}
      onClick={(event) => {
        event.stopPropagation();
        props.actions.onOpenChat(last.sessionId);
      }}
    >
      {body}
    </button>
  ) : (
    <div className={cn(frame, "bg-foreground/4")}>{body}</div>
  );
}

/** Shared frame: a clickable note that opens its task. */
function NoteFrame(props: {
  readonly task: BoardTask;
  readonly onOpen: () => void;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className={cn(
        "grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)] gap-1.5 rounded-lg p-3 text-board-note-ink shadow-sm outline-none ring-ring wrap-anywhere focus-visible:ring-2 focus-visible:ring-inset",
        colourOf(props.task.id),
        props.task.status === "done" && "opacity-60",
        props.className,
      )}
    >
      {props.children}
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
    <NoteFrame task={task} onOpen={() => props.actions.onOpenTask(task)}>
      <div className="text-3xs uppercase tracking-wide opacity-70">
        {levelLabel(task)}
        {task.kind === "backlog" && task.mainService !== null
          ? ` · ${props.serviceName(task.mainService)}`
          : ""}
        {kidsLabel}
        {task.status !== "active" ? ` · ${statusLabel(task.status)}` : ""}
      </div>
      <NoteFlags index={index} task={task} />
      <h3 className="font-semibold text-base leading-tight">{task.title}</h3>
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
          <span key={label} className="rounded-full bg-foreground/10 px-2 py-px">
            {label}
          </span>
        ))}
      </div>
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
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded px-1 py-0.5 text-start text-sm hover:bg-foreground/10",
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
  );
}

/** A module (or backlog item) in its master task's column, listing its tasks. */
export function BoardModuleNote(props: {
  readonly index: BoardIndex;
  readonly task: BoardTask;
  readonly actions: BoardNoteActions;
}) {
  const { index, task } = props;
  const levelLabel = useLevelLabel(index);
  const statusLabel = useStatusLabel();
  const kids = index.kidsOf(task.id);
  return (
    <NoteFrame task={task} onOpen={() => props.actions.onOpenTask(task)}>
      <div className="text-3xs uppercase tracking-wide opacity-70">
        {levelLabel(task)}
        {task.status !== "active" ? ` · ${statusLabel(task.status)}` : ""}
      </div>
      <NoteFlags index={index} task={task} />
      <div className="flex flex-wrap">
        <OwnerChip index={index} task={task} />
      </div>
      <h3 className="font-semibold leading-tight">{task.title}</h3>
      <PlanLine task={task} showEmpty={false} />
      {kids.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {kids.map((kid) => (
            <BoardTaskRow key={kid.id} index={index} task={kid} actions={props.actions} />
          ))}
        </div>
      ) : null}
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
