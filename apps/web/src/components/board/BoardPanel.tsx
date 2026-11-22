import type { BoardChat, BoardTask } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import type { BoardPanel as BoardPanelData, BoardPanelEntry } from "./board.logic";
import { BoardDotMark } from "./BoardNotes";

/**
 * Project Board fork: the board app's right panel. Every open must-do, decision and to-do across
 * the board's unfinished tasks, what's blocked, and open chats not on a task.
 */
export function BoardPanel(props: {
  readonly panel: BoardPanelData;
  readonly onOpenTask: (task: BoardTask) => void;
  readonly onOpenChat: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const { panel } = props;
  return (
    <div className="grid content-start gap-5">
      {panel.blocked.length > 0 ? (
        <PanelSection title={gt("Blocked")} count={panel.blocked.length}>
          {panel.blocked.map(({ task, by }) => (
            <PanelRow
              key={task.id}
              tone="mandatory"
              onClick={() => props.onOpenTask(task)}
              text={`⛔ ${task.title}`}
              detail={gt("by {tasks}", { tasks: by })}
            />
          ))}
        </PanelSection>
      ) : null}
      <EntrySection
        title={gt("Mandatory")}
        tone="mandatory"
        entries={panel.mandatory}
        onOpenTask={props.onOpenTask}
      />
      <EntrySection
        title={gt("Open decisions")}
        tone="decision"
        entries={panel.decisions}
        onOpenTask={props.onOpenTask}
      />
      <EntrySection
        title={gt("To do")}
        tone="todo"
        entries={panel.todo}
        onOpenTask={props.onOpenTask}
      />
      <PanelSection title={gt("Unlinked chats")} count={panel.unlinked.length}>
        {panel.unlinked.length === 0 ? (
          <PanelNone>
            <T>Every open chat is on a task.</T>
          </PanelNone>
        ) : (
          panel.unlinked.map((chat) => (
            <button
              key={chat.sessionId}
              type="button"
              disabled={chat.threadId === null}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm enabled:hover:bg-accent disabled:cursor-default"
              onClick={() => props.onOpenChat(chat)}
            >
              <BoardDotMark dot={chat.live === "working" ? "working" : "idle"} />
              <span className="min-w-0 flex-1 truncate">{chat.title || gt("New chat")}</span>
              <span className="text-muted-foreground text-xs">
                {chat.provider ?? chat.workspaceLabel}
              </span>
            </button>
          ))
        )}
      </PanelSection>
    </div>
  );
}

type Tone = "mandatory" | "decision" | "todo";

function EntrySection(props: {
  readonly title: string;
  readonly tone: Tone;
  readonly entries: ReadonlyArray<BoardPanelEntry>;
  readonly onOpenTask: (task: BoardTask) => void;
}) {
  const gt = useGT();
  return (
    <PanelSection title={props.title} count={props.entries.length}>
      {props.entries.length === 0 ? (
        <PanelNone>
          <T>None</T>
        </PanelNone>
      ) : (
        props.entries.map((entry) => (
          <PanelRow
            key={entry.key}
            tone={props.tone}
            onClick={() => props.onOpenTask(entry.task)}
            badge={entry.level === undefined ? undefined : `L${entry.level}`}
            text={entry.text}
            detail={
              entry.raisedIn !== undefined && entry.raisedIn !== entry.task.title
                ? gt("{task} · raised in {where}", {
                    task: entry.task.title,
                    where: entry.raisedIn,
                  })
                : entry.task.title
            }
          />
        ))
      )}
    </PanelSection>
  );
}

function PanelSection(props: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-1">
      <h2 className="flex items-center justify-between font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {props.title}
        <span className="rounded-full bg-muted px-2 text-2xs">{props.count}</span>
      </h2>
      {props.children}
    </section>
  );
}

function PanelNone(props: { readonly children: ReactNode }) {
  return <p className="px-2 text-muted-foreground text-sm">{props.children}</p>;
}

function PanelRow(props: {
  readonly tone: Tone;
  readonly text: string;
  readonly detail: string;
  readonly badge?: string | undefined;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent"
    >
      <span
        aria-hidden
        className={cn(
          "w-0.5 shrink-0 rounded-full",
          props.tone === "mandatory"
            ? "bg-destructive"
            : props.tone === "decision"
              ? "bg-warning"
              : "bg-info",
        )}
      />
      <span className="grid min-w-0 gap-0.5">
        <span>
          {props.badge !== undefined ? (
            <span className="me-1 rounded bg-muted px-1 text-3xs">{props.badge}</span>
          ) : null}
          {props.text}
        </span>
        <span className="truncate text-muted-foreground text-xs">{props.detail}</span>
      </span>
    </button>
  );
}
