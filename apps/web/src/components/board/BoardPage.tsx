import type { BoardChat, BoardTask, BoardView, EnvironmentId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { SquareKanbanIcon } from "lucide-react";
import { T, useGT } from "gt-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { SidebarInset } from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { boardEnvironment } from "~/state/board";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { boardTaskTree } from "./board.logic";

/**
 * Project Board fork: the board of the machine a connected server runs on, as the board app shows
 * it: master task › module › task, each with its plan's next step and the threads on it. Opening a
 * thread goes to that thread here.
 */
export function BoardPage() {
  const gt = useGT();
  const navigate = useNavigate({ from: "/board" });
  const search = useSearch({ from: "/_chat/board" });
  const { environments } = useEnvironments();
  const capable = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.projectBoard === true,
  );
  const environment =
    capable.find((candidate) => candidate.environmentId === search.env) ?? capable[0];
  const environmentId = environment?.environmentId ?? null;
  const boards = useEnvironmentQuery(
    environmentId === null ? null : boardEnvironment.boards({ environmentId, input: {} }),
  );
  const boardId = search.board ?? boards.data?.[0]?.id ?? null;
  const view = useEnvironmentQuery(
    environmentId === null || boardId === null
      ? null
      : boardEnvironment.view({ environmentId, input: { boardId } }),
  );
  const board = view.data;
  const selectBoard = (next: string) =>
    void navigate({ search: (previous) => ({ ...previous, board: next }) });

  const body =
    environmentId === null ? (
      <BoardEmpty title={gt("No server here serves the board")} />
    ) : boards.data === null && boards.error !== null ? (
      <BoardEmpty
        title={gt("Could not load the boards")}
        detail={boards.error}
        onRetry={boards.refresh}
      />
    ) : boards.data !== null && boards.data.length === 0 ? (
      <BoardEmpty
        title={gt("No boards on this machine")}
        detail={gt("Ask an agent in any thread to set up a board for its project.")}
      />
    ) : board === null && view.error !== null ? (
      <BoardEmpty
        title={gt("Could not load the board")}
        detail={view.error}
        onRetry={view.refresh}
      />
    ) : board === null ? (
      <div className="grid gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    ) : (
      <BoardBody
        board={board}
        environmentId={environment!.environmentId}
        showDone={search.done === true}
        onToggleDone={() =>
          void navigate({
            search: (previous) => ({
              ...previous,
              done: previous.done === true ? undefined : true,
            }),
          })
        }
        onOpenThread={(chat) => {
          if (chat.threadId === null) return;
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams({
              environmentId: environment!.environmentId,
              threadId: chat.threadId,
            }),
          });
        }}
      />
    );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader
          electron={isElectron}
          reserveNativeControls
          className="relative bg-background"
        >
          <WorkspaceBreadcrumb ariaLabel={gt("Board breadcrumb")}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">
                <T context="page title, the Project Board">Board</T>
              </h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {boards.data !== null && boards.data.length > 1 && boardId !== null ? (
            <div className="[-webkit-app-region:no-drag]" data-workspace-titlebar-controls>
              <Menu>
                <MenuTrigger
                  aria-label={gt("Switch board")}
                  render={<Button variant="outline" size="sm" />}
                >
                  <span className="truncate">
                    {boards.data.find((candidate) => candidate.id === boardId)?.name ?? boardId}
                  </span>
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuRadioGroup
                    value={boardId}
                    onValueChange={(next) => selectBoard(String(next))}
                  >
                    {boards.data.map((candidate) => (
                      <MenuRadioItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
            </div>
          ) : null}
        </WorkspacePageHeader>
        <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="expanded" className="min-h-full gap-4">
            {body}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function BoardEmpty(props: {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <SquareKanbanIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.detail ? <EmptyDescription>{props.detail}</EmptyDescription> : null}
      </EmptyHeader>
      {props.onRetry ? (
        <EmptyContent>
          <Button variant="outline" onClick={props.onRetry}>
            <T>Retry</T>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function BoardBody(props: {
  readonly board: BoardView;
  readonly environmentId: EnvironmentId;
  readonly showDone: boolean;
  readonly onToggleDone: () => void;
  readonly onOpenThread: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const rows = boardTaskTree(props.board.tasks, props.showDone);
  const serviceName = new Map(props.board.services.map((service) => [service.id, service.name]));
  const doneCount = props.board.tasks.filter((task) => task.status === "done").length;
  return (
    <div className="@container/board">
      <div className="grid gap-6 @3xl/board:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="grid content-start gap-3" aria-label={gt("Tasks")}>
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-sm">{props.board.name}</h2>
            <div className="flex-1" />
            {doneCount > 0 ? (
              <Button variant="ghost-muted" size="sm" onClick={props.onToggleDone}>
                {props.showDone ? gt("Hide done") : gt("Show done ({count})", { count: doneCount })}
              </Button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <BoardEmpty
              title={gt("No tasks yet")}
              detail={gt("Agents add tasks when you ask them to track work.")}
            />
          ) : (
            rows.map(({ task, depth }) => (
              <div key={task.id} style={{ marginInlineStart: `${depth * 1.5}rem` }}>
                <BoardTaskCard
                  task={task}
                  serviceName={serviceName}
                  onOpenThread={props.onOpenThread}
                />
              </div>
            ))
          )}
        </section>
        <aside className="grid content-start gap-2" aria-label={gt("Threads not on a task")}>
          <h2 className="font-medium text-muted-foreground text-xs uppercase">
            <T>Threads not on a task</T>
          </h2>
          {props.board.unlinked.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <T>Every open thread is on a task.</T>
            </p>
          ) : (
            props.board.unlinked.map((chat) => (
              <BoardChatRow key={chat.sessionId} chat={chat} onOpenThread={props.onOpenThread} />
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

function BoardTaskCard(props: {
  readonly task: BoardTask;
  readonly serviceName: ReadonlyMap<string, string>;
  readonly onOpenThread: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const { task } = props;
  const level = task.level === 1 ? gt("Master task") : task.level === 2 ? gt("Module") : gt("Task");
  return (
    <article className="grid gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-xs uppercase">{level}</span>
        {task.status === "paused" ? <Badge variant="outline">{gt("Paused")}</Badge> : null}
        {task.status === "done" ? <Badge variant="secondary">{gt("Done")}</Badge> : null}
      </div>
      <h3 className="font-medium">{task.title}</h3>
      {task.description ? (
        <p className="text-muted-foreground text-sm">{task.description}</p>
      ) : null}
      {task.next !== null ? (
        <p className="text-sm">
          {gt("Next: {id} – {text}", { id: task.next.id, text: task.next.text })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {task.steps.total > 0 ? (
          <Badge variant="outline">
            {gt("{done}/{total} steps", { done: task.steps.done, total: task.steps.total })}
          </Badge>
        ) : null}
        {task.services.map((id) => (
          <Badge key={id} variant="info">
            {props.serviceName.get(id) ?? id}
          </Badge>
        ))}
      </div>
      {task.lastAction !== null ? (
        <p className="text-muted-foreground text-xs">
          {gt("Last action · {workspace} · {when}", {
            workspace: task.lastAction.workspaceLabel,
            when: formatRelativeTimeLabel(new Date(task.lastAction.at).toISOString()),
          })}
          <span className="block text-foreground text-sm">{task.lastAction.text}</span>
        </p>
      ) : null}
      {task.chats.length > 0 ? (
        <div className="grid gap-1">
          {task.chats.map((chat) => (
            <BoardChatRow key={chat.sessionId} chat={chat} onOpenThread={props.onOpenThread} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function BoardChatRow(props: {
  readonly chat: BoardChat;
  readonly onOpenThread: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const { chat } = props;
  const live =
    chat.live === "working"
      ? gt("Working")
      : chat.live === "idle"
        ? gt("Idle")
        : chat.live === "ended"
          ? gt("Ended")
          : gt("Offline");
  const label = (
    <span className="flex w-full min-w-0 items-center gap-2 text-start">
      <span className="text-muted-foreground text-xs">{live}</span>
      <span className="min-w-0 flex-1 truncate">{chat.title || chat.sessionId}</span>
      <span className="text-muted-foreground text-xs">{chat.provider ?? chat.workspaceLabel}</span>
    </span>
  );
  // Claude Code chats and threads of another install can't open here.
  return chat.threadId !== null ? (
    <Button variant="ghost" size="sm" className="w-full" onClick={() => props.onOpenThread(chat)}>
      {label}
    </Button>
  ) : (
    <div className="px-2 text-sm">{label}</div>
  );
}
