import { Tabs } from "@base-ui/react/tabs";
import type {
  BoardChat,
  BoardTask,
  BoardTaskDetail,
  BoardView,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { promptLinkDeepLink } from "@t3tools/shared/promptLinks";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, MessageSquarePlusIcon, XIcon } from "lucide-react";

import { BoardPinToggle } from "./BoardPinBar";
import { useState, type ReactNode } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { boardEnvironment } from "~/state/board";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  type BoardContinueTarget,
  type BoardChatAttention,
  type BoardIndex,
  type BoardLinkGroup,
  type BoardTaskTab,
  LINK_GROUP_ORDER,
  ancestorsOf,
  chatsForView,
  dotOf,
  externalLinksOf,
  flagsOf,
  handoffBrief,
  levelKindOf,
  openDecisionCount,
  openFixesOf,
  ownerHolderOf,
  subtreeOf,
  tagsOf,
} from "./board.logic";
import {
  attentionDot,
  BoardDotMark,
  BoardModuleNote,
  type BoardNoteActions,
  BoardStar,
} from "./BoardNotes";
import {
  AddRow,
  BoardEditProvider,
  ChoiceSelect,
  DecisionAdder,
  DecisionTypeSelect,
  DecisionTextEditor,
  DocAdder,
  EditableText,
  ItemAdder,
  ImplementedForm,
  ItemRow,
  LinkAdder,
  MarkdownEditor,
  MergeModeForm,
  MoveMenu,
  VerdictControls,
  WorkspaceControls,
  useBoardEdit,
} from "./BoardTaskEditors";
import { BoardTaskTack } from "./BoardTaskTack";
import { PlotterCardDraw } from "./PlotterCardDraw";
import { useTaskTackSize } from "./useTaskChat";
import { useMediaQuery } from "~/hooks/useMediaQuery";

/**
 * Project Board fork: the board app's task views. A master task opens as a page with its
 * Overview; modules and tasks open beside the board. Same tabs and side column as the board app;
 * editing them comes with the board's write actions.
 */
type Tab = BoardTaskTab;

export interface BoardTaskViewProps {
  readonly index: BoardIndex;
  readonly board: BoardView;
  readonly task: BoardTask;
  readonly environmentId: EnvironmentId;
  readonly actions: BoardNoteActions;
  readonly serviceName: (id: string) => string;
  readonly continueTargets: ReadonlyArray<BoardContinueTarget>;
  readonly onContinue: (target: BoardContinueTarget) => void;
  readonly onOpenThread: (chat: BoardChat) => void;
  readonly onClose: () => void;
  /** Re-reads the board after an edit. */
  readonly onChanged: () => void;
  readonly tab?: Tab | undefined;
  readonly onTabChange?: ((tab: Tab) => void) | undefined;
  readonly onOpenCreated: (taskId: string) => void;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function BoardTaskView(props: BoardTaskViewProps) {
  const gt = useGT();
  const { index, task } = props;
  const master = task.level === 1;
  const [localTab, setLocalTab] = useState<Tab>(master ? "overview" : "threads");
  const setTab = (next: Tab) => {
    setLocalTab(next);
    props.onTabChange?.(next);
  };
  const detail = useEnvironmentQuery(
    boardEnvironment.taskDetail({
      environmentId: props.environmentId,
      input: { boardId: props.board.id, taskId: task.id },
    }),
  );
  const kids = index.kidsOf(task.id);
  const openDecisions = openDecisionCount(index, task);
  // Tack in the task: the threads it can load, and the one it shows. A thread that waits for an
  // answer or is working is shown when the task opens; after that the person chooses.
  const [storedTackSize, setTackSize] = useTaskTackSize();
  // A phone or an upright tablet has no room for a column beside the task: Tack is a row at its foot.
  const tackSize = useMediaQuery("max-lg") ? "line" : storedTackSize;
  const tackChats = chatsForView(index, task, master)
    .filter((entry) => entry.worked === undefined)
    .map(({ chat }) => chat)
    .filter((chat) => chat.threadId !== null);
  const [tackThread, setTackThread] = useState<ThreadId | null>(
    () =>
      (
        tackChats.find((chat) => index.attention.get(chat.sessionId)?.kind === "needs") ??
        tackChats.find((chat) => chat.live === "working")
      )?.threadId ?? null,
  );
  const openHere = (chat: BoardChat) => {
    setTackThread(chat.threadId);
    setTackSize("panel");
  };
  const tabs: ReadonlyArray<readonly [Tab, string]> = [
    ...(master
      ? [["overview", gt("Overview")] as const]
      : [
          [
            "threads",
            gt("Threads ({count})", { count: chatsForView(index, task, false).length }),
          ] as const,
        ]),
    ["plan", gt("Plan & Docs")],
    ["handoff", gt("Handoff")],
    ...(!master && (task.level < 3 || kids.length > 0)
      ? [["subtasks", gt("Tasks ({count})", { count: kids.length })] as const]
      : []),
    ["decisions", gt("Decisions ({count})", { count: openDecisions })],
    ...(master
      ? [
          [
            "threads",
            gt("Threads ({count})", { count: chatsForView(index, task, true).length }),
          ] as const,
        ]
      : []),
  ];
  const requestedTab = props.tab ?? localTab;
  const tab = tabs.some(([value]) => value === requestedTab)
    ? requestedTab
    : master
      ? "overview"
      : "threads";
  const data = detail.data;
  const body = (which: Tab) => {
    if (which === "overview") return <OverviewTab {...props} onTab={setTab} />;
    if (which === "threads")
      return <ThreadsTab {...props} detail={data} rollUp={master} onOpenHere={openHere} />;
    if (which === "subtasks") return <SubtasksTab {...props} />;
    if (data === null)
      return detail.error !== null ? (
        <p className="text-destructive text-sm">{detail.error}</p>
      ) : (
        <Skeleton className="h-40" />
      );
    if (which === "plan") return <PlanTab {...props} detail={data} onTab={setTab} />;
    if (which === "handoff") return <HandoffTab {...props} detail={data} />;
    return <DecisionsTab {...props} detail={data} />;
  };
  return (
    <BoardEditProvider
      environmentId={props.environmentId}
      boardId={props.board.id}
      taskId={task.id}
      onSaved={(createdId, change) => {
        detail.refresh();
        props.onChanged();
        if (createdId && change.op === "reportBug") props.onOpenCreated(createdId);
      }}
    >
      <div data-board-task-view className="relative flex h-full min-h-0 flex-col">
        <PlotterCardDraw />
        <TaskHeader {...props} detail={data} tab={tab} />
        {/* One Tack in both sizes, so switching keeps what was typed: a row under, or a column beside. */}
        <div className={cn("flex min-h-0 flex-1", tackSize === "panel" ? "flex-row" : "flex-col")}>
          <Tabs.Root
            value={tab}
            onValueChange={(next) => setTab(next as Tab)}
            className="@container/task flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <Tabs.List
              data-board-task-tabs
              className="flex shrink-0 gap-1 overflow-x-auto border-b px-4"
            >
              {tabs.map(([value, label]) => (
                <Tabs.Tab
                  key={value}
                  value={value}
                  className="shrink-0 border-transparent border-b-2 px-2 py-2 text-muted-foreground text-sm data-active:border-primary data-active:text-foreground"
                >
                  {label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 wrap-anywhere">
              {tab === "overview" ? (
                body("overview")
              ) : (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl/task:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
                    {body(tab)}
                  </div>
                  <SideColumn {...props} detail={data} onTab={setTab} />
                </div>
              )}
            </div>
          </Tabs.Root>
          <BoardTaskTack
            environmentId={props.environmentId}
            boardId={props.board.id}
            task={task}
            chats={tackChats}
            attention={index.attention}
            targets={props.continueTargets}
            threadId={tackThread}
            onThread={setTackThread}
            size={tackSize}
            onSize={setTackSize}
          />
        </div>
      </div>
    </BoardEditProvider>
  );
}

function TaskHeader(props: BoardTaskViewProps & { readonly detail: BoardTaskDetail | null }) {
  const gt = useGT();
  const { index, task } = props;
  const { canEdit, edit } = useBoardEdit();
  const levelLabel = useLevelLabel(index);
  const parents = ancestorsOf(index, task);
  const clipboard = useCopyToClipboard();
  const copyLink = () => {
    const url = new URL("/board", window.location.href);
    url.search = new URLSearchParams({
      env: props.environmentId,
      board: props.board.id,
      [task.level === 1 ? "task" : "open"]: task.id,
      ...(props.tab ? { tab: props.tab } : {}),
    }).toString();
    const link = isElectron
      ? promptLinkDeepLink(`${url.pathname}${url.search}`, window.location.protocol.slice(0, -1))
      : url.href;
    clipboard.copyToClipboard(link, undefined);
  };
  return (
    <header data-board-task-header className="grid shrink-0 gap-1.5 border-b px-4 pt-3 pb-3">
      <div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
        {task.level === 1 ? (
          <Button variant="ghost-muted" size="xs" onClick={props.onClose}>
            <ArrowLeftIcon />
            <T>Board</T>
          </Button>
        ) : (
          parents.map((parent) => (
            <span key={parent.id} className="flex items-center gap-1">
              <button
                type="button"
                className="hover:underline"
                onClick={() => props.actions.onOpenTask(parent)}
              >
                {parent.title}
              </button>
              <span>›</span>
            </span>
          ))
        )}
        <Badge variant="outline">{levelLabel(task)}</Badge>
        {task.goal !== null ? (
          <Badge variant={task.goal.status === "paused" ? "warning" : "info"}>
            {task.goal.status === "paused"
              ? gt("🎯 Goal paused · {goal}", { goal: task.goal.title })
              : gt("🎯 Goal · {goal}", { goal: task.goal.title })}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-start gap-2 max-md:flex-wrap">
        <div className="min-w-0 flex-1 max-md:basis-full">
          <EditableText
            value={task.title}
            label={gt("Title")}
            onSave={(title) => void edit({ op: "update", title })}
          >
            <h2 data-board-task-title className="font-semibold text-lg leading-tight">
              {task.title}
            </h2>
          </EditableText>
        </div>
        {canEdit && task.level > 1 ? (
          <Button variant="outline" size="xs" onClick={() => void edit({ op: "promote" })}>
            {task.level === 3 ? gt("Promote to module") : gt("Promote to master task")}
          </Button>
        ) : null}
        <MoveMenu canBeTopLevel={task.parentId !== null} targets={moveTargets(index, task)} />
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="xs" />}>
            {clipboard.isCopied ? gt("Copied") : gt("Share")}
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={copyLink}>
              <T>Copy task link</T>
            </MenuItem>
            {props.detail !== null ? (
              <MenuItem
                onClick={() => {
                  if (props.detail)
                    clipboard.copyToClipboard(handoffBrief(props, props.detail), undefined);
                }}
              >
                <T>Copy handoff</T>
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
        {canEdit ? (
          <ChoiceSelect
            value={task.status}
            width="sm"
            label={gt("Status")}
            choices={[
              ["active", gt("active")],
              ["paused", gt("paused")],
              ["done", gt("done")],
            ]}
            onChange={(status) => void edit({ op: "update", status })}
          />
        ) : (
          <Badge variant={task.status === "done" ? "secondary" : "outline"}>
            {task.status === "active"
              ? gt("active")
              : task.status === "paused"
                ? gt("paused")
                : gt("done")}
          </Badge>
        )}
        <BoardStar
          task={task}
          onStar={canEdit ? (_, on) => void edit({ op: "star", on }) : undefined}
        />
        <BoardPinToggle boardId={props.board.id} taskId={task.id} />
        {task.level > 1 ? (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Close")}
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      <EditableText
        value={task.description}
        label={gt("Description")}
        multiline
        placeholder={gt("What is this for?")}
        onSave={(description) => void edit({ op: "update", description })}
      >
        {task.description ? (
          <p className="text-muted-foreground text-sm">{task.description}</p>
        ) : canEdit ? (
          <p className="text-muted-foreground text-sm italic">{gt("Add a purpose…")}</p>
        ) : null}
      </EditableText>
    </header>
  );
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

function Card(props: {
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      data-board-card
      className={cn("grid gap-2 rounded-lg border bg-card p-3", props.className)}
    >
      {props.title !== undefined ? (
        <h3
          data-board-card-title
          className="flex items-center justify-between gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide"
        >
          <span>{props.title}</span>
          {props.actions}
        </h3>
      ) : null}
      {props.children}
    </section>
  );
}

function Muted(props: { readonly children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{props.children}</p>;
}

function Markdown(props: { readonly text: string; readonly environmentId: EnvironmentId }) {
  return (
    <ChatMarkdown
      text={props.text}
      cwd={undefined}
      environmentId={props.environmentId}
      isStreaming={false}
      headingLevelOffset={3}
    />
  );
}

function ContinueButton(props: {
  readonly targets: ReadonlyArray<BoardContinueTarget>;
  readonly onContinue: (target: BoardContinueTarget) => void;
}) {
  const gt = useGT();
  const [only, ...rest] = props.targets;
  if (only === undefined) return null;
  const label = (
    <>
      <MessageSquarePlusIcon />
      <T>Continue in new thread</T>
    </>
  );
  if (rest.length === 0 && !only.override)
    return (
      <Button size="sm" onClick={() => props.onContinue(only)}>
        {label}
      </Button>
    );
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" />}>{label}</MenuTrigger>
      <MenuPopup align="start">
        {props.targets.map((target) => (
          <MenuItem
            key={`${target.projectId}:${target.override ?? ""}`}
            onClick={() => props.onContinue(target)}
          >
            {target.override === "once"
              ? gt("Continue once in {workspace}", { workspace: target.label })
              : target.override === "takeover"
                ? gt("Take over in {workspace}", { workspace: target.label })
                : target.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** Master task overview: modules and their tasks · threads · must-dos and to-dos. */
function OverviewTab(props: BoardTaskViewProps & { readonly onTab: (tab: Tab) => void }) {
  const gt = useGT();
  const { index, task } = props;
  const modules = index.kidsOf(task.id);
  const tree = subtreeOf(index, task);
  const chats = chatsForView(index, task, true);
  const openDecisions = openDecisionCount(index, task);
  const items = (kind: "mandatory" | "todo") =>
    tree.flatMap((owner) =>
      owner.items.filter((item) => item.kind === kind).map((item) => ({ item, owner })),
    );
  const { edit } = useBoardEdit();
  const itemList = (kind: "mandatory" | "todo") => {
    // Ticked items stay listed after the open ones: ticking is not removing.
    const list = items(kind).toSorted((a, b) => Number(a.item.done) - Number(b.item.done));
    return list.length === 0 ? (
      <Muted>
        <T>None</T>
      </Muted>
    ) : (
      list.map(({ item, owner }) => (
        <ItemRow key={`${owner.id}:${item.id}`} item={item} taskId={owner.id}>
          {owner.id !== task.id ? (
            <button
              type="button"
              className="block text-muted-foreground text-xs hover:underline"
              onClick={() => props.actions.onOpenTask(owner)}
            >
              {owner.title}
            </button>
          ) : null}
        </ItemRow>
      ))
    );
  };
  const working = chats.filter(({ chat }) => chat.live === "working").length;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 @2xl/task:grid-cols-3">
        <Card title={gt("Planned work")}>
          <button
            type="button"
            className="text-start text-sm hover:underline"
            onClick={() => props.onTab("plan")}
          >
            {task.next ? `${task.next.id} ${task.next.text}` : gt("Open plan")}
          </button>
        </Card>
        <Card title={gt("Current activity")}>
          <p className="text-sm">{gt("{count} working threads", { count: working })}</p>
          {task.lastAction ? <Muted>{task.lastAction.text}</Muted> : null}
        </Card>
        <Card title={gt("Recorded results")}>
          <button
            type="button"
            className="text-start text-sm hover:underline"
            onClick={() => props.onTab("handoff")}
          >
            {gt("{done} of {total} plan steps complete", task.steps)}
          </button>
        </Card>
      </div>
      <div className="grid gap-4 @4xl/task:grid-cols-[3fr_1fr_1fr]">
        <section className="grid content-start gap-3">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {gt("Modules and tasks ({count})", { count: modules.length })}
          </h3>
          {modules.length === 0 ? (
            <Card>
              <Muted>
                <T>No modules yet. Ask the planning thread to break the master plan down.</T>
              </Muted>
            </Card>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] items-start gap-3">
              {modules.map((module) => (
                <BoardModuleNote
                  key={module.id}
                  index={index}
                  task={module}
                  actions={props.actions}
                />
              ))}
            </div>
          )}
          <AddRow
            placeholder={gt("New module…")}
            button={gt("Add module")}
            onAdd={(title) => edit({ op: "createChild", title })}
          />
          <Card
            title={gt("Linked tasks ({count})", { count: externalLinksOf(index, task).length })}
          >
            <LinkedTasks {...props} />
          </Card>
          <BugsCard {...props} />
        </section>
        <section className="grid content-start gap-2">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {gt("Threads ({count})", { count: chats.length })}
          </h3>
          <ContinueButton targets={props.continueTargets} onContinue={props.onContinue} />
          {chats.length === 0 ? (
            <Muted>
              <T>No threads on this task yet.</T>
            </Muted>
          ) : (
            chats.map(({ chat, task: owner }) => (
              <MiniChat
                key={chat.sessionId}
                chat={chat}
                attention={index.attention.get(chat.sessionId)}
                owner={owner}
                here={task}
                onOpenThread={props.onOpenThread}
                onOpenTask={props.actions.onOpenTask}
              />
            ))
          )}
        </section>
        <section className="grid content-start gap-2">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            <T>Mandatory</T>
          </h3>
          {itemList("mandatory")}
          <h3 className="mt-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            <T>To do</T>
          </h3>
          {itemList("todo")}
          <ItemAdder taskId={task.id} />
          {openDecisions > 0 ? (
            <button
              type="button"
              className="mt-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-start"
              onClick={() => props.onTab("decisions")}
            >
              <span className="font-medium text-sm">
                {gt("{count} open decisions", { count: openDecisions })}
              </span>
              <span className="block text-muted-foreground text-xs">
                <T>Decisions tab</T>
              </span>
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function liveLabel(gt: ReturnType<typeof useGT>, live: BoardChat["live"]) {
  return live === "working"
    ? gt("working")
    : live === "idle"
      ? gt("idle")
      : live === "ended"
        ? gt("ended")
        : gt("offline");
}

function MiniChat(props: {
  readonly chat: BoardChat;
  readonly attention: BoardChatAttention | undefined;
  readonly owner: BoardTask;
  readonly here: BoardTask;
  readonly onOpenThread: (chat: BoardChat) => void;
  readonly onOpenTask: (task: BoardTask) => void;
}) {
  const gt = useGT();
  const { chat } = props;
  return (
    <div className="flex items-start gap-2 rounded-md border p-2">
      <BoardDotMark className="mt-1.5" dot={attentionDot(props.attention, chat.live)} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        {chat.threadId !== null ? (
          <button
            type="button"
            className="truncate text-start font-medium text-sm hover:underline"
            onClick={() => props.onOpenThread(chat)}
          >
            {chat.title || gt("Thread")}
          </button>
        ) : (
          <span className="truncate font-medium text-sm">{chat.title || gt("Chat")}</span>
        )}
        <span className="truncate text-muted-foreground text-xs">
          {props.owner.id === props.here.id ? null : (
            <button
              type="button"
              className="hover:underline"
              onClick={() => props.onOpenTask(props.owner)}
            >
              {props.owner.title}
            </button>
          )}
          {props.owner.id === props.here.id ? "" : " · "}
          {chat.workspaceLabel} · {liveLabel(gt, chat.live)}
          {chat.provider !== null ? ` · ${chat.provider}` : ""}
        </span>
      </div>
    </div>
  );
}

function ThreadsTab(
  props: BoardTaskViewProps & {
    readonly detail: BoardTaskDetail | null;
    readonly rollUp: boolean;
    /** Loads the thread into Tack, beside the task. */
    readonly onOpenHere: (chat: BoardChat) => void;
  },
) {
  const gt = useGT();
  const { index, task } = props;
  const chats = chatsForView(index, task, props.rollUp);
  const extra = new Map((props.detail?.chats ?? []).map((c) => [c.sessionId, c]));
  return (
    <>
      <div>
        <ContinueButton targets={props.continueTargets} onContinue={props.onContinue} />
      </div>
      {chats.length === 0 ? (
        <Card>
          <Muted>
            <T>No threads on this task yet.</T>
          </Muted>
        </Card>
      ) : (
        chats.map(({ chat, task: owner, worked }) => {
          const more = extra.get(chat.sessionId);
          const wants = index.attention.get(chat.sessionId);
          return (
            <Card key={chat.sessionId}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-sm">
                  {chat.title || gt("Thread")}
                  {owner.id !== task.id ? (
                    <button
                      type="button"
                      className="ms-2 text-muted-foreground text-xs hover:underline"
                      onClick={() => props.actions.onOpenTask(owner)}
                    >
                      {owner.title}
                    </button>
                  ) : null}
                </span>
                {worked !== undefined ? (
                  <Badge variant="outline">
                    {gt("Worked on it · ticked {step}", { step: worked.step })}
                  </Badge>
                ) : null}
                <Badge
                  variant={
                    wants?.kind === "needs"
                      ? "warning"
                      : wants?.kind === "stopped"
                        ? "error"
                        : chat.live === "working" || wants?.kind === "finished"
                          ? "success"
                          : "outline"
                  }
                >
                  {wants?.kind === "needs"
                    ? wants.why === "approval"
                      ? gt("Needs you · approval")
                      : gt("Needs you · a question")
                    : wants?.kind === "stopped"
                      ? gt("Stopped on an error")
                      : wants?.kind === "finished"
                        ? gt("Finished · not seen")
                        : liveLabel(gt, chat.live)}
                </Badge>
                {chat.threadId !== null ? (
                  <>
                    <Button size="xs" onClick={() => props.onOpenHere(chat)}>
                      <T>Open here</T>
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => props.onOpenThread(chat)}>
                      <T>Full thread</T>
                    </Button>
                  </>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                {chat.workspaceLabel}
                {more?.subfolder ? ` / ${more.subfolder}` : ""}
                {more?.branch ? ` · ${more.branch}` : ""}
                {chat.provider !== null ? ` · ${chat.provider}` : ""} ·{" "}
                {formatRelativeTimeLabel(iso(chat.updatedAt))}
                {task.lastAction?.sessionId === chat.sessionId ? (
                  <b className="ms-1">{gt("· did the last action")}</b>
                ) : null}
              </p>
              {more?.lastPrompt ? (
                <p className="line-clamp-3 text-sm">
                  <b>{gt("Asked:")}</b> {more.lastPrompt}
                </p>
              ) : null}
              {more?.lastAnswer ? (
                <p className="line-clamp-4 text-sm">
                  <b>{gt("Answered:")}</b> {more.lastAnswer}
                </p>
              ) : null}
            </Card>
          );
        })
      )}
    </>
  );
}

function SubtasksTab(props: BoardTaskViewProps) {
  const gt = useGT();
  const { index, task } = props;
  const { edit } = useBoardEdit();
  const kids = index.kidsOf(task.id);
  const adder =
    task.level < 3 ? (
      <AddRow
        placeholder={gt("New task title…")}
        button={gt("Add task")}
        onAdd={(title) => edit({ op: "createChild", title })}
      />
    ) : null;
  if (kids.length === 0)
    return (
      <>
        {adder}
        <Card>
          <Muted>
            {task.level === 3 ? (
              <T>Tasks are the lowest level. Promote this task to break it down further.</T>
            ) : (
              <T>Nothing broken down here yet.</T>
            )}
          </Muted>
        </Card>
      </>
    );
  return (
    <>
      {adder}
      {kids.map((kid) => (
        <button
          key={kid.id}
          type="button"
          className="grid gap-1 rounded-lg border bg-card p-3 text-start hover:bg-accent"
          onClick={() => props.actions.onOpenTask(kid)}
        >
          <span className="flex items-center gap-2">
            <BoardDotMark dot={dotOf(index, kid)} />
            <span className="min-w-0 flex-1 truncate font-medium text-sm">{kid.title}</span>
            <Badge variant="outline">
              {kid.status === "active"
                ? gt("active")
                : kid.status === "paused"
                  ? gt("paused")
                  : gt("done")}
            </Badge>
          </span>
          {kid.description ? (
            <span className="text-muted-foreground text-sm">{kid.description}</span>
          ) : null}
          <span className="text-muted-foreground text-xs">
            {kid.next !== null
              ? gt("Next: {id} – {text}", { id: kid.next.id, text: kid.next.text })
              : kid.steps.total > 0
                ? gt("All steps done")
                : gt("No plan yet")}
          </span>
        </button>
      ))}
    </>
  );
}

function PlanTab(
  props: BoardTaskViewProps & {
    readonly detail: BoardTaskDetail;
    readonly onTab: (tab: Tab) => void;
  },
) {
  const gt = useGT();
  const { index, task, detail } = props;
  const [showMaster, setShowMaster] = useState(task.level === 1);
  const { canEdit, edit } = useBoardEdit();
  const master = index.byId.get(detail.masterTaskId);
  const notes = new Set(detail.stepNotes.map((note) => note.step.toLowerCase()));
  const steps = detail.plan.flatMap((phase) => phase.steps);
  const next = steps.find((step) => !step.done) ?? null;
  return (
    <>
      <Card
        title={
          task.level === 1
            ? gt("Master plan")
            : gt("Master plan · {task}", { task: master?.title ?? detail.masterTaskId })
        }
        actions={
          task.level === 1 ? undefined : (
            <Button variant="ghost-muted" size="xs" onClick={() => setShowMaster(!showMaster)}>
              {showMaster ? gt("Hide") : gt("Show")}
            </Button>
          )
        }
      >
        {!showMaster ? (
          <Muted>
            {gt("This task is part of the master plan of {task}.", { task: master?.title ?? "" })}
          </Muted>
        ) : (
          <MarkdownEditor
            value={detail.masterPlan}
            label={gt("Master plan")}
            placeholder={gt(
              "Goal · scope · architecture · modules and their tasks · sequencing · risks",
            )}
            onSave={(markdown) => edit({ op: "saveMasterPlan", markdown })}
          >
            {detail.masterPlan ? (
              <Markdown text={detail.masterPlan} environmentId={props.environmentId} />
            ) : (
              <Muted>
                <T>
                  No master plan yet. The planning thread drafts it first with board_master_plan.
                </T>
              </Muted>
            )}
          </MarkdownEditor>
        )}
      </Card>
      <Card title={gt("Plan · phases")}>
        <MarkdownEditor
          value={detail.planMarkdown}
          label={gt("Plan · phases")}
          placeholder={gt("## Phase A: Name\n- [ ] A1 First step\n- [ ] A2 Second step")}
          onSave={(markdown) => edit({ op: "savePlan", markdown })}
        >
          {steps.length === 0 ? (
            <Muted>
              <T>No phase checklist yet.</T>
            </Muted>
          ) : (
            <>
              <p className="text-sm">
                {next !== null
                  ? gt("Next: {id} – {text}", { id: next.id, text: next.text })
                  : gt("Every step is done.")}
              </p>
              {detail.plan.map((phase) => (
                <div key={phase.steps[0]?.id ?? phase.title} className="grid gap-1">
                  <h4 className="font-medium text-sm">{phase.title}</h4>
                  {phase.steps.map((step) => {
                    const child = step.childId === null ? undefined : index.byId.get(step.childId);
                    return (
                      <div
                        key={step.id}
                        className={cn(
                          "flex items-center gap-2 rounded px-1 py-0.5 text-sm",
                          step.done && "text-muted-foreground line-through",
                          next?.id === step.id && "bg-accent",
                        )}
                      >
                        {canEdit ? (
                          <Checkbox
                            checked={step.done}
                            aria-label={gt("Step {id} done", { id: step.id })}
                            onCheckedChange={() => void edit({ op: "toggleStep", step: step.id })}
                          />
                        ) : (
                          <span aria-hidden>{step.done ? "☑" : "☐"}</span>
                        )}
                        <span className="font-mono text-xs">{step.id}</span>
                        <span className="min-w-0 flex-1">{step.text}</span>
                        {child !== undefined ? (
                          <Button
                            variant="ghost-muted"
                            size="xs"
                            onClick={() => props.actions.onOpenTask(child)}
                          >
                            → {child.title}
                          </Button>
                        ) : canEdit && task.level < 3 && !step.done ? (
                          <Button
                            variant="ghost-muted"
                            size="xs"
                            onClick={() =>
                              void edit({ op: "createChild", title: step.text, fromStep: step.id })
                            }
                          >
                            {task.level === 1 ? gt("→ module") : gt("→ task")}
                          </Button>
                        ) : null}
                        {notes.has(step.id.toLowerCase()) ? (
                          <Button
                            variant="ghost-muted"
                            size="xs"
                            onClick={() => props.onTab("handoff")}
                          >
                            <T>note</T>
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </MarkdownEditor>
      </Card>
      <Card title={gt("Docs & references")}>
        <Muted>
          <T>
            Specs and designs this task relies on. Threads see the list and read a document only
            when the step needs it.
          </T>
        </Muted>
        {detail.docs.length === 0 ? (
          <Muted>
            <T>None mapped yet.</T>
          </Muted>
        ) : (
          detail.docs.map((doc) => <DocRow key={`${doc.from?.id ?? ""}:${doc.id}`} doc={doc} />)
        )}
        <DocAdder />
      </Card>
    </>
  );
}

function DocRow(props: { readonly doc: BoardTaskDetail["docs"][number] }) {
  const gt = useGT();
  const { doc } = props;
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const { canEdit, edit } = useBoardEdit();
  const url = /^https?:\/\//i.test(doc.ref);
  return (
    <div className="flex items-start gap-2">
      <Badge variant="outline">{doc.kind}</Badge>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium text-sm">
          {doc.title || doc.ref}
          {doc.from !== null ? (
            <span className="ms-1 text-muted-foreground text-xs">
              {gt("· from {task}", { task: doc.from.title })}
            </span>
          ) : null}
        </span>
        <span className="truncate font-mono text-muted-foreground text-xs">{doc.ref}</span>
        {doc.note ? <span className="text-muted-foreground text-xs">{doc.note}</span> : null}
      </div>
      {url ? (
        <Button
          variant="ghost-muted"
          size="xs"
          render={<a href={doc.ref} target="_blank" rel="noopener noreferrer" />}
        >
          <T>Open ↗</T>
        </Button>
      ) : null}
      <Button variant="ghost-muted" size="xs" onClick={() => copyToClipboard(doc.ref, undefined)}>
        {isCopied ? gt("Copied") : gt("Copy")}
      </Button>
      {canEdit && doc.from === null ? (
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label={gt("Remove")}
          onClick={() => void edit({ op: "removeDoc", docId: doc.id })}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}

function RepoBadges(props: {
  readonly repo: {
    readonly upstream: string | null;
    readonly ahead: number | null;
    readonly dirty: number;
    readonly target?: string | null | undefined;
    readonly aheadOfTarget?: number | null | undefined;
  };
}) {
  const gt = useGT();
  const { repo } = props;
  return (
    <>
      <Badge variant={!repo.upstream || repo.ahead ? "warning" : "success"}>
        {!repo.upstream
          ? gt("not pushed")
          : repo.ahead
            ? gt("{count} not pushed", { count: repo.ahead })
            : gt("pushed")}
      </Badge>
      <Badge variant={repo.dirty ? "warning" : "success"}>
        {repo.dirty ? gt("{count} uncommitted", { count: repo.dirty }) : gt("clean")}
      </Badge>
      {repo.target ? (
        <Badge
          variant={
            repo.aheadOfTarget === 0
              ? "success"
              : typeof repo.aheadOfTarget === "number"
                ? "warning"
                : "outline"
          }
        >
          {repo.aheadOfTarget === 0
            ? gt("merged into {branch}", { branch: repo.target })
            : typeof repo.aheadOfTarget === "number"
              ? gt("{count} not in {branch}", { count: repo.aheadOfTarget, branch: repo.target })
              : gt("no branch {branch} here", { branch: repo.target })}
        </Badge>
      ) : null}
    </>
  );
}

function HandoffTab(props: BoardTaskViewProps & { readonly detail: BoardTaskDetail }) {
  const gt = useGT();
  const { detail } = props;
  const { edit } = useBoardEdit();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      {detail.checks && detail.checks.length > 0 ? (
        <Card title={gt("Recorded results")}>
          {detail.checks.map((check) => (
            <div key={check.id} className="flex flex-wrap items-center gap-2 text-sm">
              <code>{check.command}</code>
              <Badge variant={check.exitCode === 0 ? "success" : "warning"}>
                {gt("Exit code {code}", { code: check.exitCode })}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {check.taskTitle} · {formatRelativeTimeLabel(iso(check.at))}
              </span>
            </div>
          ))}
        </Card>
      ) : null}
      <Muted>
        <T>
          The living handoff is what a new thread resumes from; step notes record each finished
          step.
        </T>
      </Muted>
      <Card title={gt("Living handoff")}>
        {detail.handoffCheckpoint ? (
          <p className="wrap-anywhere font-mono text-muted-foreground text-xs">
            {gt("T3 checkpoint {ref}", { ref: detail.handoffCheckpoint })}
          </p>
        ) : null}
        <MarkdownEditor
          value={detail.handoff}
          label={gt("Living handoff")}
          onSave={(markdown) => edit({ op: "saveHandoff", markdown })}
        >
          {detail.handoff ? (
            <Markdown text={detail.handoff} environmentId={props.environmentId} />
          ) : (
            <Muted>
              <T>Not written yet. Agents rewrite it when a step finishes or at a checkpoint.</T>
            </Muted>
          )}
        </MarkdownEditor>
      </Card>
      {detail.repoState.length > 0 ? (
        <Card
          title={gt("Repo state at the last checkpoint · {when}", {
            when: formatRelativeTimeLabel(iso(Math.max(...detail.repoState.map((r) => r.at)))),
          })}
        >
          {detail.repoState.map((repo) => (
            <div key={repo.name} className="flex flex-wrap items-center gap-2 text-sm">
              <b>{repo.name}</b>
              <span className="font-mono text-muted-foreground text-xs">
                {repo.branch} @ {repo.head}
              </span>
              <RepoBadges repo={repo} />
            </div>
          ))}
        </Card>
      ) : null}
      {detail.repoTree && detail.repoTree.length > 0 ? (
        <Card title={gt("Repo state of its tasks")}>
          {detail.repoTree.map((group) => (
            <div key={`${group.name}:${group.branch}`} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>{group.name}</b>
                <span className="font-mono text-muted-foreground text-xs">
                  {group.branch} @ {group.head}
                </span>
                {group.state ? <RepoBadges repo={group.state} /> : null}
                <span className="text-muted-foreground text-xs">
                  {formatRelativeTimeLabel(iso(group.at))}
                </span>
              </div>
              <ul className="grid gap-0.5 ps-3">
                {group.tasks.map((entry) => {
                  const target = props.index.byId.get(entry.id);
                  return (
                    <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <button
                        type="button"
                        className={cn(
                          "wrap-anywhere text-start hover:underline",
                          entry.done && "text-muted-foreground",
                        )}
                        disabled={!target}
                        onClick={() => target && props.actions.onOpenTask(target)}
                      >
                        {entry.title}
                      </button>
                      {entry.head !== group.head ? (
                        <span className="font-mono text-muted-foreground text-xs">
                          {gt("recorded at {head}", { head: entry.head })}
                        </span>
                      ) : null}
                      {(props.board.slots ?? [])
                        .filter((slot) => entry.inSlots?.includes(slot.id))
                        .map((slot) => (
                          <Badge key={slot.id} variant="success">
                            {gt("in {slot}", { slot: slot.name })}
                          </Badge>
                        ))}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </Card>
      ) : null}
      <Card title={gt("Step notes")}>
        {detail.stepNotes.length === 0 ? (
          <Muted>
            <T>None yet.</T>
          </Muted>
        ) : (
          detail.stepNotes.map((note) => (
            <div key={note.step} className="grid gap-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono">{note.step}</span>
                <span className="flex-1 text-muted-foreground text-xs">
                  {formatRelativeTimeLabel(iso(note.at))}
                </span>
                <Button
                  variant="ghost-muted"
                  size="xs"
                  onClick={() => {
                    const next = new Set(open);
                    if (next.has(note.step)) next.delete(note.step);
                    else next.add(note.step);
                    setOpen(next);
                  }}
                >
                  {open.has(note.step) ? gt("Hide") : gt("Open")}
                </Button>
              </div>
              {open.has(note.step) ? (
                <div className="rounded-md bg-muted/40 p-2">
                  {note.checkpointRef ? (
                    <p className="wrap-anywhere font-mono text-muted-foreground text-xs">
                      {gt("T3 checkpoint {ref}", { ref: note.checkpointRef })}
                    </p>
                  ) : null}
                  <Markdown text={note.text} environmentId={props.environmentId} />
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>
    </>
  );
}

function DecisionsTab(props: BoardTaskViewProps & { readonly detail: BoardTaskDetail }) {
  const gt = useGT();
  const { task, detail } = props;
  const byGroup = (group: BoardTaskDetail["decisions"][number]["group"]) =>
    detail.decisions
      .filter((d) => d.group === group)
      .toSorted(
        (a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.at - a.at,
      );
  const own = byGroup("own");
  const up = byGroup("up");
  const inherited = byGroup("inherited");
  const legacy = task.items.filter((item) => item.kind === "decision");
  return (
    <>
      <Muted>
        <T>
          Agents file each decision at the level it affects; a broad question raised in a task is
          filed on its module or master task and stays mapped to the task where it came up.
        </T>
      </Muted>
      <h3 className="font-medium text-sm">{gt("On this task ({count})", { count: own.length })}</h3>
      {own.length === 0 ? (
        <Muted>
          <T>None.</T>
        </Muted>
      ) : (
        own.map((d) => <DecisionCard key={d.id} {...props} decision={d} />)
      )}
      {up.length > 0 ? (
        <>
          <h3 className="font-medium text-sm">
            {gt("Raised here, filed higher up ({count})", { count: up.length })}
          </h3>
          {up.map((d) => (
            <DecisionCard key={d.id} {...props} decision={d} />
          ))}
        </>
      ) : null}
      {inherited.length > 0 ? (
        <>
          <h3 className="font-medium text-sm">
            {gt("From parent levels ({count})", { count: inherited.length })}
          </h3>
          {inherited.map((d) => (
            <DecisionCard key={d.id} {...props} decision={d} />
          ))}
        </>
      ) : null}
      <DecisionAdder
        registers={props.board.registers ?? []}
        levels={[task, ...ancestorsOf(props.index, task).toReversed()].map(
          (owner) =>
            [
              owner.level,
              owner.id === task.id
                ? gt("this task (L{level})", { level: owner.level })
                : gt("{task} (L{level})", { task: owner.title, level: owner.level }),
            ] as const,
        )}
      />
      {legacy.length > 0 ? (
        <>
          <h3 className="font-medium text-sm">
            <T>Quick decision notes</T>
          </h3>
          {legacy.map((item) => (
            <p key={item.id} className={cn("text-sm", item.done && "line-through opacity-60")}>
              {item.text}
            </p>
          ))}
        </>
      ) : null}
    </>
  );
}

function DecisionCard(
  props: BoardTaskViewProps & { readonly decision: BoardTaskDetail["decisions"][number] },
) {
  const gt = useGT();
  const { decision: d, task, index } = props;
  const openTask = (id: string) => {
    const target = index.byId.get(id);
    if (target !== undefined) props.actions.onOpenTask(target);
  };
  return (
    <Card
      className={cn(
        d.status === "open" && "border-warning/50",
        d.status === "dropped" && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {d.r !== null ? (
          <span className="font-semibold text-destructive text-sm">{d.r}</span>
        ) : null}
        <Badge variant="outline">
          {d.r !== null
            ? gt("L{level} recommendation", { level: d.level })
            : gt("L{level} decision", { level: d.level })}
        </Badge>
        <b className="min-w-48 flex-1 text-sm">{d.title}</b>
        <DecisionTypeSelect decisionId={d.id} type={d.type} />
        <Badge variant={d.status === "decided" ? "success" : "outline"}>
          {d.status === "open"
            ? gt("open")
            : d.status === "decided"
              ? gt("decided")
              : gt("dropped")}
        </Badge>
      </div>
      <p className="text-muted-foreground text-xs">
        {d.filedOn.id !== task.id ? (
          <>
            {gt("Filed on")}{" "}
            <button
              type="button"
              className="hover:underline"
              onClick={() => openTask(d.filedOn.id)}
            >
              {d.filedOn.title}
            </button>
          </>
        ) : null}
        {d.raisedFrom !== null && d.raisedFrom.id !== d.filedOn.id ? (
          <>
            {d.filedOn.id !== task.id ? " · " : ""}
            {gt("raised in")}{" "}
            <button
              type="button"
              className="hover:underline"
              onClick={() => openTask(d.raisedFrom!.id)}
            >
              {d.raisedFrom.title}
            </button>
          </>
        ) : null}
        {" · "}
        {formatRelativeTimeLabel(iso(d.at))}
      </p>
      {d.area ? <p className="text-xs">{gt("Area: {area}", { area: d.area })}</p> : null}
      {d.description ? <Markdown text={d.description} environmentId={props.environmentId} /> : null}
      {d.options ? (
        <>
          <p className="font-medium text-xs">{gt("Options / recommendation:")}</p>
          <Markdown text={d.options} environmentId={props.environmentId} />
        </>
      ) : null}
      {d.refs.length > 0 ? (
        <ul className="list-disc ps-5 text-xs">
          {d.refs.map((ref) => (
            <li key={ref} className="font-mono">
              {ref}
            </li>
          ))}
        </ul>
      ) : null}
      {d.status !== "open" ? (
        <p className="rounded-md bg-muted/50 p-2 text-sm">
          <b>{d.status === "decided" ? gt("Verdict") : gt("Dropped")}</b>
          {d.decidedAt !== null ? ` · ${formatRelativeTimeLabel(iso(d.decidedAt))}` : ""}:{" "}
          {d.verdict || gt("no verdict recorded")}
        </p>
      ) : null}
      {d.implemented !== null ? (
        <div className="grid gap-0.5 rounded-md border p-2 text-xs">
          <b>{gt("How implemented")}</b>
          {d.implemented.problem ? (
            <span>{gt("Problem: {text}", { text: d.implemented.problem })}</span>
          ) : null}
          {d.implemented.approach ? (
            <span>{gt("Approach: {text}", { text: d.implemented.approach })}</span>
          ) : null}
          {d.implemented.api ? (
            <span>{gt("New API: {text}", { text: d.implemented.api })}</span>
          ) : null}
          {d.implemented.code ? (
            <span>{gt("Code: {text}", { text: d.implemented.code })}</span>
          ) : null}
          {d.implemented.tests ? (
            <span>{gt("Tests: {text}", { text: d.implemented.tests })}</span>
          ) : null}
        </div>
      ) : d.r !== null && d.status === "decided" ? (
        <ImplementedForm decisionId={d.id} />
      ) : null}
      <VerdictControls decisionId={d.id} status={d.status} type={d.type} />
      <DecisionTextEditor decision={d} />
    </Card>
  );
}

const LINK_LABELS = (gt: ReturnType<typeof useGT>): Record<BoardLinkGroup, string> => ({
  blockingUs: gt("Blocking us"),
  weBlock: gt("We block"),
  fixedBy: gt("Fixed by"),
  fixes: gt("Fixes"),
  cameFrom: gt("Came from"),
  spunOff: gt("Spun off from our work"),
  replacedBy: gt("Replaced by"),
  replaces: gt("Replaces"),
  related: gt("Related"),
});

function LinkedTasks(props: BoardTaskViewProps) {
  const gt = useGT();
  const { index, task } = props;
  const { canEdit, edit } = useBoardEdit();
  const links = externalLinksOf(index, task);
  const labels = LINK_LABELS(gt);
  const inside = new Set(subtreeOf(index, task).map((t) => t.id));
  const adder = (
    <LinkAdder
      targets={index.tasks
        .filter((t) => !inside.has(t.id))
        .map((t) => ({
          id: t.id,
          label: [...ancestorsOf(index, t), t].map((a) => a.title).join(" › "),
        }))
        .toSorted((a, b) => a.label.localeCompare(b.label))}
    />
  );
  if (links.length === 0)
    return (
      <>
        <Muted>
          <T>No links to work outside this task yet.</T>
        </Muted>
        {adder}
      </>
    );
  return (
    <>
      {LINK_GROUP_ORDER.filter((group) => links.some((link) => link.group === group)).map(
        (group) => (
          <div key={group} className="grid gap-1">
            <h4
              className={cn(
                "font-medium text-xs uppercase",
                group === "blockingUs" && "text-destructive",
              )}
            >
              {labels[group]}
            </h4>
            {links
              .filter((link) => link.group === group)
              .map((link) => (
                <div key={`${link.ours?.id ?? ""}:${link.otherId}`} className="grid gap-0.5">
                  {link.other === null ? (
                    <span className="text-muted-foreground text-sm">
                      {gt("{task} (archived or missing)", { task: link.otherId })}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-2 text-start text-sm hover:underline"
                      onClick={() => link.other !== null && props.actions.onOpenTask(link.other)}
                    >
                      <BoardDotMark dot={dotOf(index, link.other)} />
                      <span className="min-w-0 flex-1 truncate">{link.other.title}</span>
                    </button>
                  )}
                  {link.other !== null ? (
                    <span className="text-muted-foreground text-xs">
                      {ancestorsOf(index, link.other)
                        .map((a) => a.title)
                        .join(" › ")}
                      {link.ours !== null && link.ours.id !== task.id
                        ? ` · ↔ ${link.ours.title}`
                        : ""}
                      {link.note ? ` · ${link.note}` : ""}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <div>
                      <Button
                        variant="ghost-muted"
                        size="xs"
                        onClick={() =>
                          void edit({ op: "removeLink", to: link.to, type: link.type }, link.owner)
                        }
                      >
                        <T>Remove link</T>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
          </div>
        ),
      )}
      {adder}
    </>
  );
}

function SideColumn(
  props: BoardTaskViewProps & {
    readonly detail: BoardTaskDetail | null;
    readonly onTab: (tab: Tab) => void;
  },
) {
  const gt = useGT();
  const { index, task } = props;
  const holder = ownerHolderOf(index, task);
  const openDecisions = openDecisionCount(index, task);
  const last = task.lastAction;
  const flags = flagsOf(index, task);
  return (
    <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
      <Card title={gt("Last action")}>
        {last === null ? (
          <Muted>
            <T>Nothing yet</T>
          </Muted>
        ) : (
          <>
            <p className="text-sm">{last.text}</p>
            <p className="text-muted-foreground text-xs">
              {last.workspaceLabel} · {formatRelativeTimeLabel(iso(last.at))}
            </p>
            {props.actions.canOpenChat(last.sessionId) ? (
              <div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => props.actions.onOpenChat(last.sessionId)}
                >
                  <T>Open that thread</T>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
      <Card title={gt("Workspace")}>
        {task.level < 3 ? (
          <WorkspaceControls workspaces={props.board.workspaces} owner={task.owner} />
        ) : null}
        {holder?.owner == null ? (
          <Muted>
            <T>No owner yet: the first thread that links to its module claims it.</T>
          </Muted>
        ) : (
          <p className="text-sm">
            {holder.owner.state === "soft"
              ? gt("🤝 ready to pick up · {workspace}", { workspace: holder.owner.label })
              : gt("🏠 {workspace}", { workspace: holder.owner.label })}
            {holder.id !== task.id ? (
              <span className="block text-muted-foreground text-xs">
                {gt("via {task}", { task: holder.title })}
              </span>
            ) : null}
          </p>
        )}
      </Card>
      {flags.blockedBy.length > 0 ? (
        <Card title={gt("Blocked by")} className="border-destructive/50">
          {flags.blockedBy.map((blocker) => (
            <button
              key={blocker.id}
              type="button"
              className="text-start text-sm hover:underline"
              onClick={() => props.actions.onOpenTask(blocker)}
            >
              ⛔ {blocker.title}
            </button>
          ))}
        </Card>
      ) : null}
      <BugsCard {...props} />
      <ServicesCard {...props} />
      <MergeCard {...props} />
      <BuildCard {...props} />
      <OtherNamesCard names={props.detail?.aliases ?? []} />
      <Card title={gt("Linked tasks")}>
        <LinkedTasks {...props} />
      </Card>
      {props.detail !== null && props.detail.parents.length > 0 ? (
        <Card title={gt("Parent context")}>
          {props.detail.parents.map((parent) => (
            <div key={parent.id} className="grid gap-0.5">
              <button
                type="button"
                className="text-start text-sm hover:underline"
                onClick={() => {
                  const target = index.byId.get(parent.id);
                  if (target !== undefined) props.actions.onOpenTask(target);
                }}
              >
                {parent.title}
              </button>
              <span className="text-muted-foreground text-xs">
                {parent.objective || gt("No handoff yet")}
              </span>
            </div>
          ))}
        </Card>
      ) : null}
      {openDecisions > 0 ? (
        <button
          type="button"
          className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-start text-sm"
          onClick={() => props.onTab("decisions")}
        >
          <b>{gt("{count} open decisions", { count: openDecisions })}</b>
          <span className="ms-1 text-muted-foreground text-xs">
            <T>(see the Decisions tab)</T>
          </span>
        </button>
      ) : null}
      <Card title={gt("Important")}>
        <ItemList task={task} kind="mandatory" label={gt("Mandatory")} />
        <ItemList task={task} kind="todo" label={gt("To do")} />
        <ItemAdder taskId={task.id} />
      </Card>
    </aside>
  );
}

function BugsCard(props: BoardTaskViewProps) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  const fixes = openFixesOf(props.index, props.task);
  if (props.task.status !== "done" && fixes.length === 0) return null;
  return (
    <Card title={gt("Bugs")}>
      {fixes.length === 0 ? (
        <Muted>
          <T>No open fixes.</T>
        </Muted>
      ) : (
        fixes.map((fix) => (
          <button
            key={fix.id}
            type="button"
            className="text-start text-sm hover:underline"
            onClick={() => props.actions.onOpenTask(fix)}
          >
            {fix.title}
          </button>
        ))
      )}
      {canEdit && props.task.status === "done" ? (
        <AddRow
          button={gt("Report a bug")}
          placeholder={gt("Fix task title")}
          onAdd={(title) => edit({ op: "reportBug", title })}
        />
      ) : null}
    </Card>
  );
}

function ItemList(props: {
  readonly task: BoardTask;
  readonly kind: "mandatory" | "todo";
  readonly label: string;
}) {
  const items = props.task.items.filter((item) => item.kind === props.kind);
  return (
    <div className="grid gap-0.5">
      <h4
        className={cn(
          "font-medium text-xs",
          props.kind === "mandatory" ? "text-destructive" : "text-info-foreground",
        )}
      >
        {props.label}
      </h4>
      {items.length === 0 ? (
        <Muted>
          <T>None</T>
        </Muted>
      ) : (
        items.map((item) => <ItemRow key={item.id} item={item} taskId={props.task.id} />)
      )}
    </div>
  );
}

/** The board's slots with the build in each, and the build this item landed in or was found in. */
function BuildCard(props: BoardTaskViewProps) {
  const gt = useGT();
  const { task, board } = props;
  const { canEdit, edit } = useBoardEdit();
  const slots = board.slots ?? [];
  const landedIn = task.landedIn ?? null;
  const foundIn = task.foundIn ?? null;
  if (slots.length === 0 && landedIn === null && foundIn === null && !(task.bug && canEdit))
    return null;
  return (
    <Card title={gt("Builds")}>
      {landedIn !== null ? (
        <p className="text-sm">{gt("Landed in {version}", { version: landedIn })}</p>
      ) : null}
      {foundIn !== null ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1">{gt("Found in {version}", { version: foundIn })}</span>
          {canEdit ? (
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Remove")}
              onClick={() => void edit({ op: "setBuild", foundIn: "" })}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ) : task.bug ? (
        <AddRow
          button={gt("Add")}
          placeholder={gt("Build the bug was found in")}
          onAdd={(version) => edit({ op: "setBuild", foundIn: version })}
        />
      ) : null}
      {slots.map((slot) => (
        <div key={slot.id} className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={task.inSlots?.includes(slot.id) ? "success" : "outline"}>
            {slot.name}
          </Badge>
          <span className="wrap-anywhere min-w-0">
            {slot.version || gt("empty")}
            {slot.ref ? (
              <span className="ms-1 font-mono text-muted-foreground text-xs">@ {slot.ref}</span>
            ) : null}
          </span>
        </div>
      ))}
      {slots.length > 0 && task.status === "done" ? (
        <Muted>
          {task.inSlots?.length ? (
            <T>Green slots hold this work.</T>
          ) : (
            <T>No slot's build is known to hold this work.</T>
          )}
        </Muted>
      ) : null}
    </Card>
  );
}

/** How the item's finished work reaches its target branch, and the merge request carrying it. */
function MergeCard(props: BoardTaskViewProps) {
  const gt = useGT();
  const { task, board } = props;
  const { canEdit, edit } = useBoardEdit();
  const merge = task.merge ?? null;
  const own = merge?.from?.id === task.id;
  // A task has no mode or request of its own: both belong to its module or feature.
  const holder =
    task.level === 3 && task.parentId !== null ? props.index.byId.get(task.parentId) : task;
  const request = holder?.mergeRequest ?? null;
  if (merge === null && request === null && (!canEdit || task.level === 3)) return null;
  // What the item would follow without a mode of its own.
  const parent = task.parentId === null ? undefined : props.index.byId.get(task.parentId);
  const inherited = parent?.merge ?? board.merge ?? null;
  const said = (value: NonNullable<typeof inherited>) =>
    value.mode === "request"
      ? gt("Review first, into {branch}", { branch: value.target })
      : gt("Merge directly to {branch}", { branch: value.target });
  return (
    <Card title={gt("Merging")}>
      {merge === null ? (
        <Muted>
          <T>No merge mode set on the board.</T>
        </Muted>
      ) : (
        <p className="text-sm">
          {said(merge)}
          <span className="ms-1 text-muted-foreground text-xs">
            {own
              ? gt("· set here")
              : merge.from
                ? gt("· from {task}", { task: merge.from.title })
                : gt("· the board's mode")}
          </span>
        </p>
      )}
      {canEdit && task.level !== 3 ? (
        <MergeModeForm
          key={`${merge?.mode}:${merge?.target}:${own}`}
          value={own && merge ? { mode: merge.mode, target: merge.target } : null}
          unset={
            inherited ? gt("Follow: {mode}", { mode: said(inherited) }) : gt("Follow the board")
          }
          suggested={inherited?.target ?? "main"}
          onSave={(next) => edit({ op: "setMerge", merge: next })}
        />
      ) : null}
      {request !== null ? (
        <div className="flex items-center gap-2 text-sm">
          <a
            className="wrap-anywhere min-w-0 flex-1 hover:underline"
            href={request}
            target="_blank"
            rel="noopener noreferrer"
          >
            {gt("Merge request ↗")}
          </a>
          {canEdit && holder ? (
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Remove")}
              onClick={() => void edit({ op: "setMergeRequest", url: "" }, holder.id)}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ) : merge?.mode === "request" && holder ? (
        <AddRow
          button={gt("Add")}
          placeholder={gt("Merge request link")}
          onAdd={(url) => edit({ op: "setMergeRequest", url }, holder.id)}
        />
      ) : null}
    </Card>
  );
}

function ServicesCard(props: BoardTaskViewProps) {
  const gt = useGT();
  const { task, board } = props;
  const { canEdit, edit } = useBoardEdit();
  const untagged = board.services.filter((service) => !task.services.includes(service.id));
  return (
    <Card title={gt("Services")}>
      {tagsOf(task).length === 0 ? (
        <Muted>
          <T>No service tags yet: added when a thread edits files in a service's folder.</T>
        </Muted>
      ) : (
        <div className="flex flex-wrap gap-1">
          {tagsOf(task).map((id) => (
            <Badge key={id} variant="info">
              {props.serviceName(id)}
              {canEdit && task.services.includes(id) ? (
                <button
                  type="button"
                  aria-label={gt("Remove tag {service}", { service: props.serviceName(id) })}
                  onClick={() =>
                    void edit({ op: "update", services: task.services.filter((s) => s !== id) })
                  }
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      )}
      {canEdit && untagged.length > 0 ? (
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="xs" />}>
            <T>Tag a service</T>
          </MenuTrigger>
          <MenuPopup align="start">
            {untagged.map((service) => (
              <MenuItem
                key={service.id}
                onClick={() =>
                  void edit({ op: "update", services: [...task.services, service.id] })
                }
              >
                {service.name}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : null}
    </Card>
  );
}

/** Other names are learned from missed searches; here they can be seen and dropped. */
function OtherNamesCard(props: { readonly names: ReadonlyArray<string> }) {
  const gt = useGT();
  const { canEdit, edit } = useBoardEdit();
  if (props.names.length === 0) return null;
  return (
    <Card title={gt("Other names")}>
      <div className="flex flex-wrap gap-1">
        {props.names.map((name) => (
          <Badge key={name} variant="outline">
            {name}
            {canEdit ? (
              <button
                type="button"
                aria-label={gt("Remove other name {name}", { name })}
                onClick={() => void edit({ op: "removeAlias", alias: name })}
              >
                <XIcon className="size-3" />
              </button>
            ) : null}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

/** Where a task can move: master tasks and modules outside its own subtree. */
function moveTargets(
  index: BoardIndex,
  task: BoardTask,
): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const inside = new Set(subtreeOf(index, task).map((t) => t.id));
  return index.tasks
    .filter((t) => t.level < 3 && !inside.has(t.id) && t.id !== task.parentId)
    .map((t) => ({
      id: t.id,
      label: [...ancestorsOf(index, t), t].map((a) => a.title).join(" › "),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}
