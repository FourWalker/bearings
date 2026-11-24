import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  BoardChat,
  BoardSummary,
  BoardTask,
  BoardView,
  EnvironmentId,
  ProjectId,
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
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useAcknowledgeThreadWoke } from "~/hooks/useThreadActions";
import { boardEnvironment } from "~/state/board";
import { useQuietThreadShells } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useUiStateStore } from "~/uiStateStore";
import { buildThreadRouteParams } from "~/threadRoutes";

import {
  type BoardContinueTarget,
  type BoardFilter,
  type BoardIndex,
  type BoardTaskTab,
  type BoardViewMode,
  type RecommendationFilter,
  boardPickupTargets,
  collisionsOf,
  indexBoard,
  goalsOf,
  panelOf,
  serviceColumns,
  statusMatches,
  subtreeOf,
  treeRoots,
} from "./board.logic";
import { type BoardNoteActions, BoardModuleNote, BoardNote, BoardServiceRow } from "./BoardNotes";
import { BoardAssistant } from "./BoardAssistant";
import {
  TackBoardProvider,
  TackCorner,
  TackDropSurface,
  TackHost,
  TackOffBoard,
  TackPanelTabs,
  useTackPlace,
} from "./BoardTack";
import { BoardPanel } from "./BoardPanel";
import { BoardFileActions } from "./BoardFileActions";
import { boardAttentionOf } from "./boardAttention.logic";
import { BoardSettingsButton } from "./BoardSettingsDialog";
import { BoardGoals } from "./BoardGoals";
import { BoardTaskView } from "./BoardTaskView";
import { ChoiceSelect } from "./BoardTaskEditors";
import { BoardRecommendations } from "./BoardRecommendations";

const nowIso = () => new Date().toISOString();

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
    search.env === undefined
      ? capable[0]
      : capable.find((candidate) => candidate.environmentId === search.env);
  const environmentId = environment?.environmentId ?? null;
  const boards = useEnvironmentQuery(
    environmentId === null ? null : boardEnvironment.boards({ environmentId, input: {} }),
  );
  // With one board there's nothing to pick; with several, the picker comes first.
  const boardId =
    search.board ?? (!search.picker && boards.data?.length === 1 ? boards.data[0]!.id : null);
  const view = useEnvironmentQuery(
    environmentId === null || boardId === null
      ? null
      : boardEnvironment.view({ environmentId, input: { boardId } }),
  );
  const unassigned = useEnvironmentQuery(
    environmentId === null || (boardId !== null && !search.picker)
      ? null
      : boardEnvironment.unassigned({ environmentId, input: {} }),
  );
  const board = view.data;
  const selectBoard = (next: string | undefined) =>
    void navigate({
      search: {
        env: environmentId ?? undefined,
        board: next,
        picker: next === undefined || undefined,
      },
    });

  const newThread = useNewThreadHandler();
  const linkThread = useAtomCommand(boardEnvironment.linkThread, { reportFailure: false });
  // A draft thread in the task's workspace, put on the task before its first turn so that turn
  // carries the plan and handoff. Local, not a worktree: the board places a thread by its folder.
  const continueTask = async (task: BoardTask, target: BoardContinueTarget) => {
    if (environmentId === null || board === null) return;
    await newThread(scopeProjectRef(environmentId, target.projectId), {
      envMode: "local",
      prompt: gt("Continue this task from its handoff."),
      prepareNewDraft: async (threadId) => {
        const result = await linkThread({
          environmentId,
          input: {
            boardId: board.id,
            taskId: task.id,
            threadId,
            projectId: target.projectId,
            override: target.override,
          },
        });
        if (result._tag !== "Failure") return true;
        toastManager.add({
          type: "error",
          title: gt("Could not put the thread on {task}", { task: task.title }),
          description: formatEnvironmentQueryError(result.cause),
        });
        return false;
      },
    });
  };
  // Where the Assistant's thread lives: a T3 project in one of the board's workspaces.
  const assistantProjectId =
    board?.workspaces.find((workspace) => workspace.projectId !== null)?.projectId ?? null;
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
    ) : boardId === null && boards.data !== null ? (
      <BoardPicker
        boards={boards.data}
        chats={unassigned.data ?? []}
        onPick={selectBoard}
        onOpenThread={openThread}
      />
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
        key={`${environmentId}:${board.id}`}
        board={board}
        environmentId={environmentId}
        mode={search.view ?? "tree"}
        filter={search.filter ?? "active"}
        pageId={search.task ?? null}
        modalId={search.open ?? null}
        tab={search.tab}
        recommendationFilter={search.recommendationFilter ?? "open"}
        onChanged={view.refresh}
        onOpenThread={openThread}
        onContinue={(task, target) => void continueTask(task, target)}
        assistantProjectId={assistantProjectId}
      />
    );

  const boardName =
    board?.name ?? boards.data?.find((candidate) => candidate.id === boardId)?.name ?? null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div
        data-board-page
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background"
      >
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
          {environmentId !== null && (
            <BoardFileActions
              key={JSON.stringify([environmentId, boardId])}
              environmentId={environmentId}
              boardId={boardId}
              hasArchivedThreads={board?.hasArchivedThreads ?? false}
              onOpened={(id) => {
                boards.refresh();
                selectBoard(id);
              }}
            />
          )}
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
  readonly chats: ReadonlyArray<BoardChat>;
  readonly onPick: (boardId: string) => void;
  readonly onOpenThread: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="mb-4 font-medium text-lg">
        <T>Boards on this machine</T>
      </h2>
      {props.boards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <T>No boards on this machine</T>
        </p>
      ) : null}
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
      {props.chats.length > 0 ? (
        <section className="mt-6 grid gap-2">
          <h2 className="font-medium text-lg">
            <T>Chats with no board</T>
          </h2>
          <ul className="divide-y rounded-lg border">
            {props.chats.map((chat) => (
              <li key={chat.sessionId} className="grid gap-1 px-4 py-2">
                {chat.threadId ? (
                  <button
                    type="button"
                    className="text-start font-medium text-sm hover:underline"
                    onClick={() => props.onOpenThread(chat)}
                  >
                    {chat.title}
                  </button>
                ) : (
                  <span className="font-medium text-sm">{chat.title}</span>
                )}
                {chat.workspaceLabel && (
                  <span className="text-muted-foreground text-xs">{chat.workspaceLabel}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BoardScreen(props: {
  readonly board: BoardView;
  readonly environmentId: EnvironmentId;
  readonly mode: BoardViewMode;
  readonly filter: BoardFilter;
  readonly pageId: string | null;
  readonly modalId: string | null;
  readonly tab?: BoardTaskTab | undefined;
  readonly recommendationFilter: RecommendationFilter;
  /** Re-reads the board after an edit. */
  readonly onChanged: () => void;
  readonly onOpenThread: (chat: BoardChat) => void;
  readonly onContinue: (task: BoardTask, target: BoardContinueTarget) => void;
  /** Where the Assistant's thread lives; null when no workspace of the board is a T3 project. */
  readonly assistantProjectId: ProjectId | null;
}) {
  const gt = useGT();
  const navigate = useNavigate({ from: "/board" });
  const { board } = props;
  // What each chat wants from the person, as the sidebar reads its thread.
  const threads = useQuietThreadShells();
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const index = indexBoard(board.tasks, {
    attention: boardAttentionOf(
      props.environmentId,
      [
        ...board.tasks.flatMap((task) => task.chats),
        ...board.unlinked,
        ...board.goals.flatMap((goal) => goal.chats),
      ],
      threads,
      localVisits,
    ),
    goals: board.goals,
  });
  const canLink = useAtomValue(boardEnvironment.linkThread.permissionAtom(props.environmentId));
  const [tackPlace, setTackPlace] = useTackPlace();
  // Tack sleeps whenever the board opens, even if its chat was left open last time. Held here,
  // because opening a task from the board sends it home.
  const [tackAwake, setTackAwake] = useState(false);
  // As in the board app: a master task opens as a page in place of the board; a module or task
  // opens in a modal over whatever is showing. Both are in the URL, so back and shared links work.
  const byId = (id: string | null) => (id === null ? null : (index.byId.get(id) ?? null));
  // A task that becomes a master task (promoted, moved to the top) moves to its own page.
  const linked = byId(props.pageId);
  const opened = byId(props.modalId);
  const pageTask = opened?.level === 1 ? opened : linked?.level === 1 ? linked : null;
  const modalTask =
    opened !== null && opened.level > 1
      ? opened
      : linked !== null && linked.level > 1
        ? linked
        : null;
  const acknowledge = useAcknowledgeThreadWoke();
  // A result or a failure the person has now looked at stops being news, here and in the sidebar.
  const markSeen = (chats: ReadonlyArray<BoardChat>) => {
    const visitedAt = nowIso();
    for (const chat of chats) {
      const kind = index.attention.get(chat.sessionId)?.kind;
      if (chat.threadId !== null && (kind === "finished" || kind === "stopped"))
        acknowledge(scopeThreadRef(props.environmentId, chat.threadId), visitedAt);
    }
  };
  const openTask = (task: BoardTask, tab?: BoardTaskTab) => {
    // Opening a task from the board is turning away from Tack, like any press beside its bubble.
    if (pageTask === null) setTackAwake(false);
    // Everything its strip counted: the task's own chats and those of the tasks under it.
    markSeen(subtreeOf(index, task).flatMap((under) => under.chats));
    void navigate({
      search: (previous) =>
        task.level === 1
          ? { ...previous, task: task.id, open: undefined, tab }
          : { ...previous, open: task.id, tab },
    });
  };
  const closePage = () =>
    void navigate({
      search: (previous) => ({ ...previous, task: undefined, open: undefined, tab: undefined }),
    });
  const closeModal = () =>
    void navigate({
      search: (previous) => ({
        ...previous,
        open: undefined,
        tab: undefined,
        task: pageTask === null ? undefined : previous.task,
      }),
    });
  const chatsById = new Map(
    [...board.tasks.flatMap((task) => task.chats), ...board.unlinked].map((chat) => [
      chat.sessionId,
      chat,
    ]),
  );
  const serviceName = (id: string) =>
    board.services.find((service) => service.id === id)?.name ?? id;
  const actions: BoardNoteActions = {
    onOpenTask: openTask,
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

  const taskView = (task: BoardTask, onClose: () => void) => (
    <BoardTaskView
      key={task.id}
      index={index}
      board={board}
      task={task}
      environmentId={props.environmentId}
      actions={actions}
      serviceName={serviceName}
      continueTargets={
        canLink && task.status !== "done" ? boardPickupTargets(index, board.workspaces, task) : []
      }
      onContinue={(target) => props.onContinue(task, target)}
      onOpenThread={props.onOpenThread}
      onClose={onClose}
      onChanged={props.onChanged}
      tab={task.id === (modalTask ?? pageTask)?.id ? props.tab : undefined}
      onTabChange={
        task.id === (modalTask ?? pageTask)?.id
          ? (tab) => void navigate({ search: (previous) => ({ ...previous, tab }), replace: true })
          : undefined
      }
      onOpenCreated={(id) =>
        void navigate({
          search: (previous) => ({ ...previous, open: id, tab: "threads" }),
        })
      }
    />
  );

  const modal = (
    <Dialog
      open={modalTask !== null}
      onOpenChange={(open) => {
        if (!open) closeModal();
      }}
    >
      <DialogPopup showCloseButton={false} className="h-[90dvh] w-[min(96vw,72rem)] sm:max-w-none">
        <DialogTitle className="sr-only">{modalTask?.title ?? ""}</DialogTitle>
        <div className="@container/task h-full min-h-0 overflow-hidden">
          {modalTask !== null ? (
            <TackOffBoard>{taskView(modalTask, closeModal)}</TackOffBoard>
          ) : null}
        </div>
      </DialogPopup>
    </Dialog>
  );

  if (pageTask !== null)
    return (
      <div className="@container/task h-full min-h-0">
        {taskView(pageTask, closePage)}
        {modal}
      </div>
    );

  const panel = panelOf(index, board.unlinked);
  const page = (
    <div className="flex h-full min-h-0 flex-col">
      <header data-board-masthead className="grid gap-2 border-b px-4 py-2">
        <BoardMastheadTitle name={board.name} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {board.workspaces.map((workspace) => (
              <Tooltip key={workspace.root}>
                <TooltipTrigger
                  render={
                    <span
                      data-board-tag
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
          <BoardSettingsButton
            environmentId={props.environmentId}
            boardId={board.id}
            onChanged={props.onChanged}
          />
          <NewTaskButton
            environmentId={props.environmentId}
            boardId={board.id}
            onCreated={(taskId) => {
              props.onChanged();
              void navigate({
                search: (previous) => ({
                  ...previous,
                  task: taskId,
                  open: undefined,
                  tab: undefined,
                }),
              });
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
                value === "svc" ||
                value === "register" ||
                value === "goals"
              )
                setSearch({ view: value });
            }}
          >
            <Toggle value="tree">{gt("Tree")}</Toggle>
            <Toggle value="1">{gt("Level 1")}</Toggle>
            <Toggle value="2">{gt("Level 2")}</Toggle>
            <Toggle value="3">{gt("Level 3")}</Toggle>
            <Toggle value="svc">{gt("By service")}</Toggle>
            <Toggle value="register">{gt("Register")}</Toggle>
            <Toggle value="goals">{gt("Goals")}</Toggle>
          </ToggleGroup>
          {props.mode !== "register" && props.mode !== "goals" ? (
            <ToggleGroup
              data-board-status-filter
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
          ) : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col @container/board lg:flex-row">
        <TackDropSurface tasks={board.tasks} className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
          {props.mode === "register" ? (
            <BoardRecommendations
              key={board.id}
              index={index}
              registers={board.registers ?? []}
              filter={props.recommendationFilter}
              onFilterChange={(recommendationFilter) =>
                void navigate({
                  search: (previous) => ({ ...previous, recommendationFilter }),
                })
              }
              onOpen={(task) => openTask(task, "decisions")}
            />
          ) : props.mode === "goals" ? (
            <BoardGoals
              environmentId={props.environmentId}
              board={board}
              index={index}
              onChanged={props.onChanged}
              onOpenTask={openTask}
              onOpenThread={props.onOpenThread}
            />
          ) : (
            <BoardArea
              index={index}
              board={board}
              mode={props.mode}
              filter={props.filter}
              serviceName={serviceName}
              actions={actions}
            />
          )}
        </TackDropSurface>
        <aside
          data-board-panel
          aria-label={gt("Board panel")}
          // Stacked under the board on a narrow window, it takes at most the lower part and scrolls.
          className="max-h-[45%] shrink-0 overflow-y-auto border-t bg-card/40 p-4 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
        >
          <TackHost
            active={index.tasks.filter((task) => task.status !== "done").length}
            blocked={panel.blocked.length}
            todo={panel.todo.length}
          />
          <TackPanelTabs
            stand={
              <BoardPanel
                panel={panel}
                goals={goalsOf(index, board.goals)}
                onSeenAll={() => markSeen(panel.finished.map(({ chat }) => chat))}
                onOpenTask={actions.onOpenTask}
                onOpenChat={props.onOpenThread}
              />
            }
          />
          <TackCorner
            active={index.tasks.filter((task) => task.status !== "done").length}
            blocked={panel.blocked.length}
          />
        </aside>
      </div>
      {props.assistantProjectId !== null && tackPlace === "float" ? (
        <BoardAssistant
          environmentId={props.environmentId}
          boardId={board.id}
          boardName={board.name}
          projectId={props.assistantProjectId}
          place={tackPlace}
          onPlace={setTackPlace}
          covered={modalTask !== null}
        />
      ) : null}
      {modal}
    </div>
  );
  if (props.assistantProjectId === null || tackPlace === "float") return page;
  return (
    <TackBoardProvider
      environmentId={props.environmentId}
      boardId={board.id}
      boardName={board.name}
      projectId={props.assistantProjectId}
      place={tackPlace}
      setPlace={setTackPlace}
      tasks={board.tasks}
      awake={tackAwake}
      onAwake={setTackAwake}
      covered={modalTask !== null}
    >
      {page}
    </TackBoardProvider>
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
          <section
            key={column.service?.id ?? ""}
            className="grid w-72 shrink-0 grid-cols-[minmax(0,1fr)] gap-2"
          >
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
          <section key={root.id} className="grid w-80 shrink-0 grid-cols-[minmax(0,1fr)] gap-3">
            <BoardNote
              index={index}
              task={root}
              serviceName={props.serviceName}
              actions={props.actions}
            />
            {index.kidsOf(root.id).map((module) => (
              <div key={module.id} data-board-module className="ms-3">
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

/** "Board / name", the name's last word set apart so a theme can accent it. */
function BoardMastheadTitle(props: { readonly name: string }) {
  const name = props.name.trim();
  const split = name.lastIndexOf(" ");
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-2">
      <span className="text-muted-foreground text-sm">
        <T context="page title, the Project Board">Board</T>
      </span>
      <span aria-hidden className="text-muted-foreground/60">
        /
      </span>
      <h2 data-board-masthead-title className="min-w-0 truncate font-semibold text-lg">
        {split > 0 ? `${name.slice(0, split)} ` : null}
        <em data-board-masthead-accent className="not-italic">
          {split > 0 ? name.slice(split + 1) : name}
        </em>
      </h2>
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
  const [kind, setKind] = useState<"feature" | "backlog">("feature");
  if (!allowed) return null;
  if (title === null)
    return (
      <Button data-board-new-task size="sm" onClick={() => setTitle("")}>
        <PlusIcon />
        <T>New task</T>
      </Button>
    );
  const submit = async () => {
    if (!title.trim()) return;
    const result = await create({
      environmentId: props.environmentId,
      input: { boardId: props.boardId, title, kind },
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
    setKind("feature");
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
      <ChoiceSelect
        label={gt("Master task type")}
        value={kind}
        choices={[
          ["feature", gt("Feature")],
          ["backlog", gt("Service backlog")],
        ]}
        onChange={setKind}
      />
      <Button type="submit" size="sm" disabled={!title.trim()}>
        <T>Create</T>
      </Button>
    </form>
  );
}
