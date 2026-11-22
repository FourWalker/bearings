import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  BoardChat,
  BoardSummary,
  BoardTask,
  BoardView,
  EnvironmentId,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon, SquareKanbanIcon, TriangleAlertIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
import { toastManager } from "~/components/ui/toast";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "~/components/ui/sheet";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { boardEnvironment } from "~/state/board";
import { useEnvironments } from "~/state/environments";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import {
  type BoardContinueTarget,
  type BoardFilter,
  type BoardIndex,
  type BoardViewMode,
  boardContinueTargets,
  collisionsOf,
  indexBoard,
  panelOf,
  serviceColumns,
  statusMatches,
  treeRoots,
} from "./board.logic";
import { type BoardNoteActions, BoardModuleNote, BoardNote, BoardServiceRow } from "./BoardNotes";
import { BoardPanel } from "./BoardPanel";
import { BoardTaskView } from "./BoardTaskView";

/**
 * Project Board fork: the board app's main screen inside T3. One board of the machine a connected
 * server runs on: a column per master task with its modules and tasks as notes, the level and
 * service views, and the right panel. Chats on the board are T3 threads and open here.
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
  // With one board there's nothing to pick; with several, the picker comes first.
  const boardId =
    search.board ?? (boards.data !== null && boards.data.length === 1 ? boards.data[0]!.id : null);
  const view = useEnvironmentQuery(
    environmentId === null || boardId === null
      ? null
      : boardEnvironment.view({ environmentId, input: { boardId } }),
  );
  const board = view.data;
  const selectBoard = (next: string | undefined) =>
    void navigate({ search: (previous) => ({ ...previous, board: next }) });

  const newThread = useNewThreadHandler();
  const linkThread = useAtomCommand(boardEnvironment.linkThread, { reportFailure: false });
  // A draft thread in the task's workspace, put on the task before its first turn so that turn
  // carries the plan and handoff. Local, not a worktree: the board places a thread by its folder.
  const continueTask = async (task: BoardTask, target: BoardContinueTarget) => {
    if (environmentId === null || board === null) return;
    const draft = await newThread(scopeProjectRef(environmentId, target.projectId), {
      envMode: "local",
      prompt: gt("Continue this task from its handoff."),
    });
    if (draft === null) return;
    const result = await linkThread({
      environmentId,
      input: {
        boardId: board.id,
        taskId: task.id,
        threadId: draft.threadId,
        projectId: target.projectId,
      },
    });
    if (result._tag === "Failure")
      toastManager.add({
        type: "error",
        title: gt("Could not put the thread on {task}", { task: task.title }),
        description: formatEnvironmentQueryError(result.cause),
      });
  };
  const openThread = (chat: BoardChat) => {
    if (chat.threadId === null || environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams({ environmentId, threadId: chat.threadId }),
    });
  };

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
    ) : boardId === null && boards.data !== null ? (
      <BoardPicker boards={boards.data} onPick={selectBoard} />
    ) : board === null && view.error !== null ? (
      <BoardEmpty
        title={gt("Could not load the board")}
        detail={view.error}
        onRetry={view.refresh}
      />
    ) : board === null ? (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4 p-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    ) : (
      <BoardScreen
        board={board}
        environmentId={environmentId}
        mode={search.view ?? "tree"}
        filter={search.filter ?? "active"}
        taskId={search.task ?? null}
        onChanged={view.refresh}
        onOpenThread={openThread}
        onContinue={(task, target) => void continueTask(task, target)}
      />
    );

  const boardName =
    board?.name ?? boards.data?.find((candidate) => candidate.id === boardId)?.name ?? null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader
          electron={isElectron}
          reserveNativeControls
          className="relative bg-background"
        >
          <WorkspaceBreadcrumb ariaLabel={gt("Board breadcrumb")}>
            <WorkspaceBreadcrumbItem current={boardName === null}>
              {boardName === null ? (
                <h1 className="truncate">
                  <T context="page title, the Project Board">Board</T>
                </h1>
              ) : (
                <button
                  type="button"
                  className="truncate hover:underline"
                  onClick={() => selectBoard(undefined)}
                >
                  <T context="page title, the Project Board">Board</T>
                </button>
              )}
            </WorkspaceBreadcrumbItem>
            {boardName !== null ? (
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">{boardName}</h1>
              </WorkspaceBreadcrumbItem>
            ) : null}
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {boards.data !== null && boards.data.length > 1 && boardId !== null ? (
            <div className="[-webkit-app-region:no-drag]" data-workspace-titlebar-controls>
              <Menu>
                <MenuTrigger
                  aria-label={gt("Switch board")}
                  render={<Button variant="outline" size="sm" />}
                >
                  <span className="truncate">{boardName ?? boardId}</span>
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
        <div className="min-h-0 flex-1">{body}</div>
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

function BoardPicker(props: {
  readonly boards: ReadonlyArray<BoardSummary>;
  readonly onPick: (boardId: string) => void;
}) {
  const gt = useGT();
  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="mb-4 font-medium text-lg">
        <T>Boards on this machine</T>
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
        {props.boards.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className="grid gap-1 rounded-lg border bg-card p-4 text-start hover:bg-accent"
            onClick={() => props.onPick(candidate.id)}
          >
            <span className="font-medium">{candidate.name}</span>
            <span className="text-muted-foreground text-sm">
              {gt("{count} tasks", { count: candidate.taskCount })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BoardScreen(props: {
  readonly board: BoardView;
  readonly environmentId: EnvironmentId;
  readonly mode: BoardViewMode;
  readonly filter: BoardFilter;
  readonly taskId: string | null;
  /** Re-reads the board after an edit. */
  readonly onChanged: () => void;
  readonly onOpenThread: (chat: BoardChat) => void;
  readonly onContinue: (task: BoardTask, target: BoardContinueTarget) => void;
}) {
  const gt = useGT();
  const navigate = useNavigate({ from: "/board" });
  const { board } = props;
  const index = indexBoard(board.tasks);
  const canLink = useAtomValue(boardEnvironment.linkThread.permissionAtom(props.environmentId));
  const openTask = props.taskId === null ? null : (index.byId.get(props.taskId) ?? null);
  // In the URL, so the back button and a shared link reopen the same task.
  const setOpenTask = (taskId: string | undefined) =>
    void navigate({ search: (previous) => ({ ...previous, task: taskId }) });
  const chatsById = new Map(
    [...board.tasks.flatMap((task) => task.chats), ...board.unlinked].map((chat) => [
      chat.sessionId,
      chat,
    ]),
  );
  const serviceName = (id: string) =>
    board.services.find((service) => service.id === id)?.name ?? id;
  const actions: BoardNoteActions = {
    onOpenTask: (task) => setOpenTask(task.id),
    canOpenChat: (sessionId) => (chatsById.get(sessionId)?.threadId ?? null) !== null,
    onOpenChat: (sessionId) => {
      const chat = chatsById.get(sessionId);
      if (chat !== undefined) props.onOpenThread(chat);
    },
  };
  const working = new Set(
    [...chatsById.values()].filter((chat) => chat.live === "working").map((c) => c.workspaceLabel),
  );
  const collisions = collisionsOf(board.tasks, board.unlinked);
  const setSearch = (patch: { view?: BoardViewMode; filter?: BoardFilter }) =>
    void navigate({
      search: (previous) => ({
        ...previous,
        ...("view" in patch ? { view: patch.view === "tree" ? undefined : patch.view } : {}),
        ...("filter" in patch
          ? { filter: patch.filter === "active" ? undefined : patch.filter }
          : {}),
      }),
    });

  const taskView = (task: BoardTask) => (
    <BoardTaskView
      key={task.id}
      index={index}
      board={board}
      task={task}
      environmentId={props.environmentId}
      actions={actions}
      serviceName={serviceName}
      continueTargets={
        canLink && task.status !== "done" ? boardContinueTargets(board.workspaces, task) : []
      }
      onContinue={(target) => props.onContinue(task, target)}
      onOpenThread={props.onOpenThread}
      onClose={() => setOpenTask(undefined)}
      onChanged={props.onChanged}
    />
  );

  // A master task replaces the board with its own page, as in the board app.
  if (openTask !== null && openTask.level === 1)
    return <div className="@container/task h-full min-h-0">{taskView(openTask)}</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {board.workspaces.map((workspace) => (
            <Tooltip key={workspace.root}>
              <TooltipTrigger
                render={
                  <span
                    className={
                      working.has(workspace.label)
                        ? "rounded-full border border-success/50 bg-success/15 px-2 py-0.5 text-xs"
                        : "rounded-full border px-2 py-0.5 text-muted-foreground text-xs"
                    }
                  />
                }
              >
                {workspace.label}
                {working.has(workspace.label) ? " ●" : ""}
              </TooltipTrigger>
              <TooltipPopup>{workspace.root}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
        {collisions.length > 0 ? (
          <span className="flex items-center gap-1 text-warning-foreground text-xs">
            <TriangleAlertIcon className="size-3.5" />
            {collisions
              .map((collision) =>
                gt("{count} chats working in {workspace}", {
                  count: collision.count,
                  workspace: collision.workspace,
                }),
              )
              .join(" · ")}
          </span>
        ) : null}
        <div className="min-w-0 flex-1" />
        <NewTaskButton
          environmentId={props.environmentId}
          boardId={board.id}
          onCreated={(taskId) => {
            props.onChanged();
            setOpenTask(taskId);
          }}
        />
        <ToggleGroup
          aria-label={gt("Board view")}
          value={[props.mode]}
          onValueChange={(next) => {
            const value = next[0];
            if (
              value === "tree" ||
              value === "1" ||
              value === "2" ||
              value === "3" ||
              value === "svc"
            )
              setSearch({ view: value });
          }}
        >
          <Toggle value="tree">{gt("Tree")}</Toggle>
          <Toggle value="1">{gt("Level 1")}</Toggle>
          <Toggle value="2">{gt("Level 2")}</Toggle>
          <Toggle value="3">{gt("Level 3")}</Toggle>
          <Toggle value="svc">{gt("By service")}</Toggle>
        </ToggleGroup>
        <ToggleGroup
          aria-label={gt("Task status")}
          value={[props.filter]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "active" || value === "paused" || value === "done" || value === "all")
              setSearch({ filter: value });
          }}
        >
          <Toggle value="active">{gt("Active")}</Toggle>
          <Toggle value="paused">{gt("Paused")}</Toggle>
          <Toggle value="done">{gt("Done")}</Toggle>
          <Toggle value="all">{gt("All")}</Toggle>
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 flex-1 flex-col @container/board lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
          <BoardArea
            index={index}
            board={board}
            mode={props.mode}
            filter={props.filter}
            serviceName={serviceName}
            actions={actions}
          />
        </div>
        <aside
          aria-label={gt("Board panel")}
          className="shrink-0 overflow-y-auto border-t bg-card/40 p-4 lg:w-80 lg:border-t-0 lg:border-l"
        >
          <BoardPanel
            panel={panelOf(index, board.unlinked)}
            onOpenTask={actions.onOpenTask}
            onOpenChat={props.onOpenThread}
          />
        </aside>
      </div>
      <Sheet
        open={openTask !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTask(undefined);
        }}
      >
        <SheetPopup side="right" showCloseButton={false} className="w-[min(96vw,64rem)]">
          <SheetHeader className="sr-only">
            <SheetTitle>{openTask?.title ?? ""}</SheetTitle>
          </SheetHeader>
          <div className="@container/task h-full min-h-0">
            {openTask !== null ? taskView(openTask) : null}
          </div>
        </SheetPopup>
      </Sheet>
    </div>
  );
}

function BoardArea(props: {
  readonly index: BoardIndex;
  readonly board: BoardView;
  readonly mode: BoardViewMode;
  readonly filter: BoardFilter;
  readonly serviceName: (id: string) => string;
  readonly actions: BoardNoteActions;
}) {
  const gt = useGT();
  const { index, filter } = props;
  if (props.mode === "svc") {
    const columns = serviceColumns(index, props.board.services, filter);
    if (columns.length === 0)
      return (
        <BoardEmpty
          title={gt("No tasks are tagged with a service yet")}
          detail={gt(
            "Tags are added when a thread edits files in a service's folder, or set on a task.",
          )}
        />
      );
    return (
      <div className="flex items-start gap-4">
        {columns.map((column) => (
          <section key={column.service?.id ?? ""} className="grid w-72 shrink-0 gap-2">
            <header className="grid gap-0.5">
              <span className="flex items-center justify-between font-medium text-sm">
                {column.service?.name ?? gt("No service yet")}
                <span className="rounded-full bg-muted px-2 text-xs">{column.tasks.length}</span>
              </span>
              {column.service !== null ? (
                <span className="truncate font-mono text-muted-foreground text-xs">
                  {column.service.match.join(" · ")}
                </span>
              ) : null}
            </header>
            {column.tasks.map((task) => (
              <BoardServiceRow key={task.id} index={index} task={task} actions={props.actions} />
            ))}
          </section>
        ))}
      </div>
    );
  }
  if (props.mode === "tree") {
    const roots = treeRoots(index, filter);
    if (roots.length === 0)
      return (
        <BoardEmpty
          title={index.tasks.length === 0 ? gt("No tasks yet") : gt("No tasks here")}
          detail={
            index.tasks.length === 0
              ? gt("Agents add tasks when you ask them to track work.")
              : undefined
          }
        />
      );
    return (
      <div className="flex items-start gap-4">
        {roots.map((root) => (
          <section key={root.id} className="grid w-80 shrink-0 gap-3">
            <BoardNote
              index={index}
              task={root}
              serviceName={props.serviceName}
              actions={props.actions}
            />
            {index.kidsOf(root.id).map((module) => (
              <div key={module.id} className="ms-3">
                <BoardModuleNote index={index} task={module} actions={props.actions} />
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }
  const level = Number(props.mode);
  const list = index.tasks.filter((task) => task.level === level && statusMatches(filter, task));
  if (list.length === 0) return <BoardEmpty title={gt("No tasks here")} />;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] items-start gap-4">
      {list.map((task) => (
        <BoardNote
          key={task.id}
          index={index}
          task={task}
          serviceName={props.serviceName}
          actions={props.actions}
          showParents
        />
      ))}
    </div>
  );
}

/** The board app's "+ New task": a new master task, opened once it's created. */
function NewTaskButton(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly onCreated: (taskId: string) => void;
}) {
  const gt = useGT();
  const allowed = useAtomValue(boardEnvironment.createTask.permissionAtom(props.environmentId));
  const create = useAtomCommand(boardEnvironment.createTask, { reportFailure: false });
  const [title, setTitle] = useState<string | null>(null);
  if (!allowed) return null;
  if (title === null)
    return (
      <Button size="sm" onClick={() => setTitle("")}>
        <PlusIcon />
        <T>New task</T>
      </Button>
    );
  const submit = async () => {
    if (!title.trim()) return;
    const result = await create({
      environmentId: props.environmentId,
      input: { boardId: props.boardId, title },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: gt("Could not create the task"),
        description: formatEnvironmentQueryError(result.cause),
      });
      return;
    }
    setTitle(null);
    if (result.value.createdId !== null) props.onCreated(result.value.createdId);
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        size="sm"
        placeholder={gt("New master task title…")}
        aria-label={gt("New master task title")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setTitle(null);
        }}
      />
      <Button type="submit" size="sm" disabled={!title.trim()}>
        <T>Create</T>
      </Button>
    </form>
  );
}
