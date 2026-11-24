import type { BoardChat, BoardTask, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  PanelBottomIcon,
  PanelRightIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { ThreadVisitWatermark } from "~/components/chat/ThreadVisitWatermark";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { type BoardAttention, type BoardContinueTarget, latestExchange } from "./board.logic";
import { HeaderButton, TackMessages } from "./BoardAssistant";
import { attentionDot, BoardDotMark } from "./BoardNotes";
import { TackAvatar, useTackLook } from "./TackAvatar";
import { type TaskChat, type TaskTackSize, useTaskChat } from "./useTaskChat";

/** Messages a long thread shows at first, and how many more each "Show earlier" adds. */
const PAGE = 12;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Project Board fork: Tack inside an open task. One row at the task's foot for a quick question or
 * "continue", or a column beside it for a conversation. What is said here is a thread on the task.
 */
export function BoardTaskTack(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly task: BoardTask;
  /** The task's threads the app holds: what Tack can load. */
  readonly chats: ReadonlyArray<BoardChat>;
  readonly attention: BoardAttention;
  /** Where a new chat's thread may start; none on a finished task. */
  readonly targets: ReadonlyArray<BoardContinueTarget>;
  readonly threadId: ThreadId | null;
  readonly onThread: (threadId: ThreadId | null) => void;
  readonly size: TaskTackSize;
  readonly onSize: (size: TaskTackSize) => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const [look] = useTackLook();
  const { targets, size } = props;
  const chat = useTaskChat({
    environmentId: props.environmentId,
    boardId: props.boardId,
    task: props.task,
    threadId: props.threadId,
    onThread: props.onThread,
    targets,
  });
  // The reply card over the row; an answer Tack waits for opens it without being asked.
  const [peek, setPeek] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const loaded = props.chats.find((candidate) => candidate.threadId === props.threadId);
  const title =
    props.threadId === null ? gt("New chat") : (chat.title ?? loaded?.title ?? gt("Thread"));
  const canSend = chat.threadRef !== null || chat.target !== null;
  const pick = (threadId: ThreadId | null) => {
    setShown(PAGE);
    setPeek(threadId !== null);
    props.onThread(threadId);
  };
  const say = (text: string) => {
    setPeek(true);
    void chat.send(text);
  };

  const avatar = (
    <TackAvatar skin={look.skin} motion={look.motion} mood={chat.mood} scale={2} from="rest" />
  );
  const threads = (
    <Menu>
      <MenuTrigger
        render={<Button size="compact" variant="outline" data-board-task-tack-threads />}
      >
        <BoardDotMark
          dot={
            loaded === undefined
              ? "offline"
              : attentionDot(props.attention.get(loaded.sessionId), loaded.live)
          }
        />
        <span className="max-w-44 truncate">{title}</span>
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuItem onClick={() => pick(null)}>{gt("New chat")}</MenuItem>
        {props.chats.map((candidate) => (
          <MenuItem key={candidate.sessionId} onClick={() => pick(candidate.threadId)}>
            <BoardDotMark
              dot={attentionDot(props.attention.get(candidate.sessionId), candidate.live)}
            />
            <span className="min-w-0 max-w-64 flex-1 truncate">
              {candidate.title || gt("Thread")}
            </span>
            <span className="text-muted-foreground text-xs">
              {formatRelativeTimeLabel(iso(candidate.updatedAt))}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
  const chips =
    chat.busy && !chat.waiting ? (
      <>
        <span className="text-muted-foreground text-xs">{gt("Working…")}</span>
        <Button size="compact" variant="destructive-outline" onClick={chat.stop}>
          {gt("Stop")}
        </Button>
      </>
    ) : chat.waiting ? null : (
      <>
        <ContinueChip
          chat={chat}
          targets={chat.threadRef === null ? targets : []}
          disabled={!canSend}
          onStart={() => setPeek(true)}
        />
        {chat.bubbles.length === 0 && canSend ? (
          <>
            <Button
              size="compact"
              variant="outline"
              onClick={() => say(gt("What is next on this task?"))}
            >
              {gt("What's next?")}
            </Button>
            <Button
              size="compact"
              variant="outline"
              onClick={() => say(gt("Where does this task stand?"))}
            >
              {gt("Status")}
            </Button>
          </>
        ) : null}
      </>
    );
  const mode = (
    <ToggleGroup
      aria-label={gt("What a message does")}
      value={[chat.how]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "ask" || value === "run") chat.setHow(value);
      }}
    >
      <Toggle value="ask">{gt("Ask")}</Toggle>
      <Toggle value="run">{gt("Run")}</Toggle>
    </ToggleGroup>
  );
  const composer = (
    <form
      className="flex min-w-0 flex-1 items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        say(chat.draft);
      }}
    >
      <div className="min-w-0 flex-1">
        <Textarea
          size="sm"
          rows={1}
          value={chat.draft}
          disabled={!canSend}
          aria-label={gt("Message to Tack about this task")}
          placeholder={
            !canSend
              ? gt("Pick one of this task's threads to talk here…")
              : chat.how === "run"
                ? gt("Tell Tack what to do on this task…")
                : gt("Ask about this task, or tell Tack to continue…")
          }
          onChange={(event) => chat.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            say(chat.draft);
          }}
        />
      </div>
      <Button
        type="submit"
        size="icon-sm"
        aria-label={gt("Send")}
        disabled={chat.sending || chat.draft.trim().length === 0 || !canSend}
      >
        <ArrowUpIcon />
      </Button>
    </form>
  );
  const messages = (bubbles: TaskChat["bubbles"], className: string) => (
    <TackMessages
      chat={{
        threadRef: chat.threadRef,
        waiting: chat.waiting,
        busy: chat.busy,
        send: (text) => chat.send(text),
      }}
      environmentId={props.environmentId}
      bubbles={bubbles}
      className={className}
      working={gt("Working on it…")}
      empty={
        <p className="text-muted-foreground text-sm">
          {chat.threadRef !== null
            ? chat.loaded
              ? gt("Nothing said in this thread yet.")
              : gt("Loading the thread…")
            : gt("Ask a quick question, or press Continue to have the task picked up.")}
        </p>
      }
    />
  );
  const full =
    chat.threadRef !== null ? (
      <HeaderButton
        label={gt("Open as a full thread")}
        onClick={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(chat.threadRef!),
          })
        }
      >
        <ExternalLinkIcon />
      </HeaderButton>
    ) : null;
  // A thread loaded here is being read: its result is not "finished, not seen" on the board.
  const watermark =
    chat.threadRef !== null ? <ThreadVisitWatermark threadRef={chat.threadRef} /> : null;
  const where =
    props.threadId !== null ? null : chat.target === null ? null : targets.length > 1 ? (
      <Menu>
        <MenuTrigger render={<Button size="micro" variant="ghost-muted" />}>
          {gt("New thread in {workspace}", { workspace: targetLabel(gt, chat.target) })}
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          {targets.map((target) => (
            <MenuItem
              key={`${target.projectId}:${target.override ?? ""}`}
              onClick={() => chat.setTarget(target)}
            >
              {targetLabel(gt, target)}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    ) : (
      <span className="px-1 text-muted-foreground text-xs">
        {gt("Sending starts a new thread on this task, in {workspace}.", {
          workspace: chat.target.label,
        })}
      </span>
    );

  if (size === "panel")
    return (
      <aside
        data-board-task-tack="panel"
        className="flex min-h-0 w-88 shrink-0 flex-col border-s bg-card/40"
      >
        {watermark}
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          {avatar}
          {threads}
          <span className="flex-1" />
          {full}
          <HeaderButton label={gt("Shrink Tack to one row")} onClick={() => props.onSize("line")}>
            <PanelBottomIcon />
          </HeaderButton>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {chat.bubbles.length > shown ? (
            <button
              type="button"
              className="mx-auto mt-2 shrink-0 rounded-full border border-dashed px-3 py-0.5 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => setShown(shown + PAGE)}
            >
              {gt("Show earlier ({count})", { count: chat.bubbles.length - shown })}
            </button>
          ) : null}
          {messages(chat.bubbles.slice(-shown), "")}
        </div>
        <div className="grid shrink-0 gap-2 border-t p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {chips}
            <span className="flex-1" />
            {mode}
          </div>
          {composer}
          {where}
        </div>
      </aside>
    );

  const showPeek = chat.threadRef !== null && (peek || chat.waiting);
  return (
    <div
      data-board-task-tack="line"
      className="relative flex shrink-0 flex-wrap items-end gap-2 border-t bg-card/40 px-3 py-2"
    >
      {watermark}
      {showPeek ? (
        <div
          data-board-task-tack-peek
          className="absolute inset-x-3 bottom-full z-10 mb-2 grid gap-1 rounded-xl border bg-popover p-2 shadow-lg"
        >
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate px-1 font-medium text-sm">{title}</span>
            {full}
            <HeaderButton label={gt("Fold the reply")} onClick={() => setPeek(false)}>
              <XIcon />
            </HeaderButton>
          </div>
          {messages(latestExchange(chat.bubbles), "max-h-56 px-1")}
        </div>
      ) : null}
      {avatar}
      {threads}
      <div className={cn("flex items-center gap-1.5", chat.waiting && "hidden")}>{chips}</div>
      {chat.threadRef !== null && !showPeek && chat.bubbles.length > 0 ? (
        <Button size="compact" variant="ghost" onClick={() => setPeek(true)}>
          {gt("Show reply")}
        </Button>
      ) : null}
      {mode}
      {composer}
      <HeaderButton label={gt("Give Tack a column")} onClick={() => props.onSize("panel")}>
        <PanelRightIcon />
      </HeaderButton>
    </div>
  );
}

function targetLabel(gt: ReturnType<typeof useGT>, target: BoardContinueTarget): string {
  return target.override === "once"
    ? gt("Continue once in {workspace}", { workspace: target.label })
    : target.override === "takeover"
      ? gt("Take over in {workspace}", { workspace: target.label })
      : target.label;
}

/** "Continue": one click has the task picked up from its handoff, in the thread loaded or a new one. */
function ContinueChip(props: {
  readonly chat: TaskChat;
  /** Workspaces to choose from for a new thread; empty when a thread is loaded. */
  readonly targets: ReadonlyArray<BoardContinueTarget>;
  readonly disabled: boolean;
  readonly onStart: () => void;
}) {
  const gt = useGT();
  const [only, ...rest] = props.targets;
  const start = (into?: BoardContinueTarget) => {
    props.onStart();
    void props.chat.resume(into);
  };
  if (only === undefined || (rest.length === 0 && !only.override))
    return (
      <Button size="compact" disabled={props.disabled} onClick={() => start()}>
        {gt("Continue ▸")}
      </Button>
    );
  return (
    <Menu>
      <MenuTrigger render={<Button size="compact" />}>{gt("Continue ▸")}</MenuTrigger>
      <MenuPopup align="start">
        {props.targets.map((target) => (
          <MenuItem
            key={`${target.projectId}:${target.override ?? ""}`}
            onClick={() => start(target)}
          >
            {targetLabel(gt, target)}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
