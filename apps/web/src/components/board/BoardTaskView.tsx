import { Tabs } from "@base-ui/react/tabs";
import type {
  BoardChat,
  BoardTask,
  BoardTaskDetail,
  BoardView,
  EnvironmentId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, MessageSquarePlusIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { boardEnvironment } from "~/state/board";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  type BoardContinueTarget,
  type BoardIndex,
  type BoardLinkGroup,
  LINK_GROUP_ORDER,
  ancestorsOf,
  chatsForView,
  dotOf,
  externalLinksOf,
  flagsOf,
  levelKindOf,
  openDecisionCount,
  openFixesOf,
  ownerHolderOf,
  subtreeOf,
  tagsOf,
} from "./board.logic";
import { BoardDotMark, BoardModuleNote, type BoardNoteActions } from "./BoardNotes";

/**
 * Project Board fork: the board app's task views. A master task opens as a page with its
 * Overview; modules and tasks open beside the board. Same tabs and side column as the board app;
 * editing them comes with the board's write actions.
 */
type Tab = "overview" | "threads" | "plan" | "handoff" | "subtasks" | "decisions";

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
}

const iso = (ms: number) => new Date(ms).toISOString();

export function BoardTaskView(props: BoardTaskViewProps) {
  const gt = useGT();
  const { index, task } = props;
  const master = task.level === 1;
  const [tab, setTab] = useState<Tab>(master ? "overview" : "threads");
  const detail = useEnvironmentQuery(
    boardEnvironment.taskDetail({
      environmentId: props.environmentId,
      input: { boardId: props.board.id, taskId: task.id },
    }),
  );
  const kids = index.kidsOf(task.id);
  const openDecisions = openDecisionCount(index, task);
  const tabs: ReadonlyArray<readonly [Tab, string]> = [
    ...(master
      ? [["overview", gt("Overview")] as const]
      : [["threads", gt("Threads ({count})", { count: task.chats.length })] as const]),
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
  const data = detail.data;
  const body = (which: Tab) => {
    if (which === "overview") return <OverviewTab {...props} onTab={setTab} />;
    if (which === "threads") return <ThreadsTab {...props} detail={data} rollUp={master} />;
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
    <div className="flex h-full min-h-0 flex-col">
      <TaskHeader {...props} />
      <Tabs.Root
        value={tab}
        onValueChange={(next) => setTab(next as Tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List className="flex shrink-0 gap-1 overflow-x-auto border-b px-4">
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
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "overview" ? (
            body("overview")
          ) : (
            <div className="grid gap-4 @3xl/task:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="grid min-w-0 content-start gap-4">{body(tab)}</div>
              <SideColumn {...props} detail={data} onTab={setTab} />
            </div>
          )}
        </div>
      </Tabs.Root>
    </div>
  );
}

function TaskHeader(props: BoardTaskViewProps) {
  const gt = useGT();
  const { index, task } = props;
  const levelLabel = useLevelLabel(index);
  const parents = ancestorsOf(index, task);
  return (
    <header className="grid shrink-0 gap-1.5 border-b px-4 pt-3 pb-3">
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
      </div>
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 font-semibold text-lg leading-tight">{task.title}</h2>
        <Badge variant={task.status === "done" ? "secondary" : "outline"}>
          {task.status === "active"
            ? gt("active")
            : task.status === "paused"
              ? gt("paused")
              : gt("done")}
        </Badge>
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
      {task.description ? (
        <p className="text-muted-foreground text-sm">{task.description}</p>
      ) : null}
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
    <section className={cn("grid gap-2 rounded-lg border bg-card p-3", props.className)}>
      {props.title !== undefined ? (
        <h3 className="flex items-center justify-between gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
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
  const [only, ...rest] = props.targets;
  if (only === undefined) return null;
  const label = (
    <>
      <MessageSquarePlusIcon />
      <T>Continue in new thread</T>
    </>
  );
  if (rest.length === 0)
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
          <MenuItem key={target.projectId} onClick={() => props.onContinue(target)}>
            {target.label}
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
      owner.items
        .filter((item) => item.kind === kind && !item.done)
        .map((item) => ({ item, owner })),
    );
  const itemList = (kind: "mandatory" | "todo") => {
    const list = items(kind);
    return list.length === 0 ? (
      <Muted>
        <T>None</T>
      </Muted>
    ) : (
      list.map(({ item, owner }) => (
        <div key={`${owner.id}:${item.id}`} className="text-sm">
          {item.text}
          {owner.id !== task.id ? (
            <button
              type="button"
              className="block text-muted-foreground text-xs hover:underline"
              onClick={() => props.actions.onOpenTask(owner)}
            >
              {owner.title}
            </button>
          ) : null}
        </div>
      ))
    );
  };
  return (
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
        <Card title={gt("Linked tasks ({count})", { count: externalLinksOf(index, task).length })}>
          <LinkedTasks {...props} />
        </Card>
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
  readonly owner: BoardTask;
  readonly here: BoardTask;
  readonly onOpenThread: (chat: BoardChat) => void;
  readonly onOpenTask: (task: BoardTask) => void;
}) {
  const gt = useGT();
  const { chat } = props;
  return (
    <div className="flex items-start gap-2 rounded-md border p-2">
      <BoardDotMark
        className="mt-1.5"
        dot={chat.live === "working" ? "working" : chat.live === "idle" ? "idle" : "offline"}
      />
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
        chats.map(({ chat, task: owner }) => {
          const more = extra.get(chat.sessionId);
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
                <Badge variant={chat.live === "working" ? "success" : "outline"}>
                  {liveLabel(gt, chat.live)}
                </Badge>
                {chat.threadId !== null ? (
                  <Button size="xs" onClick={() => props.onOpenThread(chat)}>
                    <T>Open thread</T>
                  </Button>
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
  const kids = index.kidsOf(task.id);
  if (kids.length === 0)
    return (
      <Card>
        <Muted>
          {task.level === 3 ? (
            <T>Tasks are the lowest level. Promote this task to break it down further.</T>
          ) : (
            <T>Nothing broken down here yet.</T>
          )}
        </Muted>
      </Card>
    );
  return kids.map((kid) => (
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
  ));
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
        ) : detail.masterPlan ? (
          <Markdown text={detail.masterPlan} environmentId={props.environmentId} />
        ) : (
          <Muted>
            <T>No master plan yet. The planning thread drafts it first with board_master_plan.</T>
          </Muted>
        )}
      </Card>
      <Card title={gt("Plan · phases")}>
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
                      <span aria-hidden>{step.done ? "☑" : "☐"}</span>
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
      </Card>
    </>
  );
}

function DocRow(props: { readonly doc: BoardTaskDetail["docs"][number] }) {
  const gt = useGT();
  const { doc } = props;
  const { copyToClipboard, isCopied } = useCopyToClipboard();
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
    </div>
  );
}

function HandoffTab(props: BoardTaskViewProps & { readonly detail: BoardTaskDetail }) {
  const gt = useGT();
  const { detail } = props;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <Muted>
        <T>
          The living handoff is what a new thread resumes from; step notes record each finished
          step.
        </T>
      </Muted>
      <Card title={gt("Living handoff")}>
        {detail.handoff ? (
          <Markdown text={detail.handoff} environmentId={props.environmentId} />
        ) : (
          <Muted>
            <T>Not written yet. Agents rewrite it when a step finishes or at a checkpoint.</T>
          </Muted>
        )}
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
        <b className="min-w-0 flex-1 text-sm">{d.title}</b>
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
  related: gt("Related"),
});

function LinkedTasks(props: BoardTaskViewProps) {
  const gt = useGT();
  const { index, task } = props;
  const links = externalLinksOf(index, task);
  const labels = LINK_LABELS(gt);
  if (links.length === 0)
    return (
      <Muted>
        <T>No links to work outside this task yet.</T>
      </Muted>
    );
  return LINK_GROUP_ORDER.filter((group) => links.some((link) => link.group === group)).map(
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
                  {link.ours !== null && link.ours.id !== task.id ? ` · ↔ ${link.ours.title}` : ""}
                  {link.note ? ` · ${link.note}` : ""}
                </span>
              ) : null}
            </div>
          ))}
      </div>
    ),
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
  const fixes = openFixesOf(index, task);
  const openDecisions = openDecisionCount(index, task);
  const last = task.lastAction;
  const flags = flagsOf(index, task);
  return (
    <aside className="grid content-start gap-3">
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
      {task.status === "done" || fixes.length > 0 ? (
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
                🐞 {fix.title}
              </button>
            ))
          )}
        </Card>
      ) : null}
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
              </Badge>
            ))}
          </div>
        )}
      </Card>
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
      </Card>
    </aside>
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
        items.map((item) => (
          <p key={item.id} className={cn("text-sm", item.done && "line-through opacity-60")}>
            {item.done ? "☑ " : "☐ "}
            {item.text}
          </p>
        ))
      )}
    </div>
  );
}
