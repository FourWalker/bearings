import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  BoardChat,
  BoardGoal,
  BoardTask,
  BoardView,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn, newMessageId, newThreadId } from "~/lib/utils";
import { readThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  type BoardGoalLane,
  type BoardIndex,
  goalAnswerPrompt,
  goalLanes,
  goalLaunchPreview,
  goalPausePrompt,
  goalResumePrompt,
  goalScopeRows,
  goalStartPrompt,
  goalThreadOf,
} from "./board.logic";
import { boardThreadModelSelection } from "./boardThread";

const iso = (ms: number) => new Date(ms).toISOString();
const nowIso = () => new Date().toISOString();

/**
 * Project Board fork: the Goals screen. A Goal is driven only by its own thread, so the screen
 * starts that thread and talks to it; everything it shows is read from the board.
 */
export function BoardGoals(props: {
  readonly environmentId: EnvironmentId;
  readonly board: BoardView;
  readonly index: BoardIndex;
  /** Re-reads the board after the screen asked a thread to change a Goal. */
  readonly onChanged: () => void;
  readonly onOpenTask: (task: BoardTask) => void;
  readonly onOpenThread: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const { board, index, environmentId } = props;
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const failed = (description: string) =>
    toastManager.add({
      type: "error",
      title: gt("The Goal's thread was not reached"),
      description,
    });

  /** Says something to a Goal's thread, as the person would in that thread. */
  const tell = async (goal: BoardGoal, text: string) => {
    const threadId = goalThreadOf(goal)?.threadId ?? null;
    const shell =
      threadId === null ? null : readThreadShell(scopeThreadRef(environmentId, threadId));
    if (threadId === null || shell === null) {
      failed(gt("No thread on this server has run this Goal. Resume it from a thread."));
      return false;
    }
    const createdAt = nowIso();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      failed(gt("The message could not be sent."));
      return false;
    }
    props.onChanged();
    return true;
  };

  const launch = async (input: {
    readonly projectId: ProjectId;
    readonly scope: ReadonlyArray<string>;
    readonly mode: BoardGoal["mode"];
    readonly title: string;
  }) => {
    const modelSelection = boardThreadModelSelection(environmentId, input.projectId);
    if (modelSelection === null) {
      failed(gt("No model is set up for this project."));
      return false;
    }
    const createdAt = nowIso();
    // A Goal runs unattended, so its thread is not held up by an approval for every command.
    const modes = { runtimeMode: "full-access", interactionMode: "default" } as const;
    const threadId = newThreadId();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: goalStartPrompt(input.scope, input.mode),
          attachments: [],
        },
        modelSelection,
        ...modes,
        bootstrap: {
          createThread: {
            projectId: input.projectId,
            title: gt("Goal · {title}", { title: input.title }),
            modelSelection,
            ...modes,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      failed(gt("The message could not be sent."));
      return false;
    }
    toastManager.add({ type: "success", title: gt("Goal thread started") });
    props.onChanged();
    return true;
  };

  return (
    <div data-board-goals className="grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6">
      <GoalLaunch board={board} index={index} onLaunch={launch} />
      <section className="grid gap-3">
        <SectionHeading title={gt("Running and paused")} count={board.goals.length} />
        {board.goals.length === 0 ? (
          <p className="text-muted-foreground text-sm">{gt("No Goal is open on this board.")}</p>
        ) : (
          board.goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              lanes={goalLanes(index, goal)}
              onTell={(text) => tell(goal, text)}
              onOpenTask={props.onOpenTask}
              onOpenThread={props.onOpenThread}
            />
          ))
        )}
      </section>
      <section className="grid gap-3">
        <SectionHeading title={gt("Finished")} count={board.finishedGoals.length} />
        {board.finishedGoals.length === 0 ? (
          <p className="text-muted-foreground text-sm">{gt("No Goal has finished yet.")}</p>
        ) : (
          board.finishedGoals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              lanes={goalLanes(index, goal)}
              onTell={(text) => tell(goal, text)}
              onOpenTask={props.onOpenTask}
              onOpenThread={props.onOpenThread}
            />
          ))
        )}
      </section>
    </div>
  );
}

function SectionHeading(props: { readonly title: string; readonly count?: number }) {
  return (
    <h2 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
      {props.title}
      {props.count === undefined ? null : (
        <span className="rounded-full bg-muted px-2 text-2xs">{props.count}</span>
      )}
    </h2>
  );
}

function GoalLaunch(props: {
  readonly board: BoardView;
  readonly index: BoardIndex;
  readonly onLaunch: (input: {
    readonly projectId: ProjectId;
    readonly scope: ReadonlyArray<string>;
    readonly mode: BoardGoal["mode"];
    readonly title: string;
  }) => Promise<boolean>;
}) {
  const gt = useGT();
  const { index } = props;
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const [mode, setMode] = useState<BoardGoal["mode"]>("auto");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const rows = goalScopeRows(index);
  const workspaces = props.board.workspaces.flatMap((entry) =>
    entry.projectId === null ? [] : [{ label: entry.label, projectId: entry.projectId }],
  );
  const target = workspaces.find((entry) => entry.label === workspace) ?? workspaces[0] ?? null;
  // A picked feature covers its modules: they show as covered and cannot be picked on their own.
  const covered = (task: BoardTask) => task.parentId !== null && picked.includes(task.parentId);
  const scope = picked.filter((id) => {
    const task = index.byId.get(id);
    return task !== undefined && !covered(task);
  });
  const preview = goalLaunchPreview(index, scope);
  const taskCount = preview.reduce((count, group) => count + group.tasks.length, 0);
  const title = scope.flatMap((id) => index.byId.get(id)?.title ?? []).join(", ");

  return (
    <section data-board-goal-launch className="grid gap-3 rounded-xl border bg-card/40 p-4">
      <SectionHeading title={gt("Start a Goal")} />
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {gt("Every open task is done or already in a Goal.")}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid max-h-72 content-start gap-0.5 overflow-y-auto">
            {rows.map(({ task, open }) => (
              <label
                key={task.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent",
                  task.level === 2 && "ps-7",
                )}
              >
                <Checkbox
                  checked={picked.includes(task.id) || covered(task)}
                  disabled={covered(task)}
                  onCheckedChange={(checked) =>
                    setPicked((previous) =>
                      checked ? [...previous, task.id] : previous.filter((id) => id !== task.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                <span className="text-muted-foreground text-xs">
                  {gt("{count} open", { count: open })}
                </span>
              </label>
            ))}
          </div>
          <div className="grid content-start gap-3">
            {preview.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {gt("Pick a feature or modules to see the order of work.")}
              </p>
            ) : (
              <ol className="grid max-h-56 gap-2 overflow-y-auto text-sm">
                {preview.map((group, position) => (
                  <li key={group.parent?.id ?? group.tasks[0]?.id} className="grid gap-0.5">
                    <span className="font-medium">
                      {position + 1}. {group.parent?.title ?? group.tasks[0]?.title}
                    </span>
                    {group.tasks.map((task) => (
                      <span key={task.id} className="truncate ps-4 text-muted-foreground text-xs">
                        {task.title}
                      </span>
                    ))}
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                aria-label={gt("Goal mode")}
                value={[mode]}
                onValueChange={(next) => {
                  if (next[0] === "auto" || next[0] === "ask") setMode(next[0]);
                }}
              >
                <Toggle value="auto">{gt("Auto")}</Toggle>
                <Toggle value="ask">{gt("Ask")}</Toggle>
              </ToggleGroup>
              {workspaces.length > 1 ? (
                <ToggleGroup
                  aria-label={gt("Workspace")}
                  value={target === null ? [] : [target.label]}
                  onValueChange={(next) => {
                    if (next[0] !== undefined) setWorkspace(String(next[0]));
                  }}
                >
                  {workspaces.map((entry) => (
                    <Toggle key={entry.label} value={entry.label}>
                      {entry.label}
                    </Toggle>
                  ))}
                </ToggleGroup>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {mode === "auto"
                ? gt(
                    "Auto: the thread settles decisions itself and records how, for you to review.",
                  )
                : gt(
                    "Ask: the thread queues decisions for you and carries on with what they don't block.",
                  )}{" "}
              {gt("The thread runs with full access on the project's default model.")}
            </p>
            <div>
              <Button
                disabled={starting || taskCount === 0 || target === null}
                onClick={async () => {
                  if (target === null) return;
                  setStarting(true);
                  const started = await props.onLaunch({
                    projectId: target.projectId,
                    scope,
                    mode,
                    title,
                  });
                  setStarting(false);
                  if (started) setPicked([]);
                }}
              >
                {gt("Start Goal · {count} tasks", { count: taskCount })}
              </Button>
              {target === null ? (
                <span className="ms-2 text-muted-foreground text-xs">
                  {gt("No workspace of this board is a project on this server.")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function GoalCard(props: {
  readonly goal: BoardGoal;
  readonly lanes: ReadonlyArray<BoardGoalLane>;
  readonly onTell: (text: string) => Promise<boolean>;
  readonly onOpenTask: (task: BoardTask) => void;
  readonly onOpenThread: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const { goal, lanes } = props;
  const [asked, setAsked] = useState<"pause" | "resume" | null>(null);
  const thread = goalThreadOf(goal);
  const total = lanes.reduce((count, lane) => count + lane.tasks.length, 0);
  const done = lanes.reduce((count, lane) => count + lane.done, 0);
  const waiting = goal.decisions.filter((decision) => decision.settled === "");
  const settled = goal.decisions.filter((decision) => decision.settled !== "");
  const status =
    goal.status === "running"
      ? thread?.live === "working"
        ? gt("running")
        : gt("running · thread idle")
      : goal.status === "paused"
        ? gt("paused: {reason}", { reason: goal.pausedReason ?? "" })
        : gt("finished {when}", { when: formatRelativeTimeLabel(iso(goal.updatedAt)) });
  const ask = async (kind: "pause" | "resume") => {
    setAsked(kind);
    const sent = await props.onTell(
      kind === "pause" ? goalPausePrompt(goal.id) : goalResumePrompt(goal.id),
    );
    if (!sent) setAsked(null);
  };

  return (
    <article data-board-goal={goal.status} className="grid gap-3 rounded-xl border bg-card/40 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium">🎯 {goal.title}</span>
          <span className="block text-muted-foreground text-xs">
            {gt("{done}/{total} done", { done, total })}
            {" · "}
            {goal.mode === "auto" ? gt("Auto mode") : gt("Ask mode")}
            {" · "}
            {status}
          </span>
        </span>
        {thread !== null ? (
          <Button size="sm" variant="outline" onClick={() => props.onOpenThread(thread)}>
            {gt("Open thread")}
          </Button>
        ) : null}
        {goal.status === "running" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={asked === "pause" || thread === null}
            onClick={() => void ask("pause")}
          >
            {asked === "pause" ? gt("Pause asked") : gt("Pause")}
          </Button>
        ) : goal.status === "paused" ? (
          <Button
            size="sm"
            disabled={asked === "resume" || thread === null}
            onClick={() => void ask("resume")}
          >
            {asked === "resume" ? gt("Resume asked") : gt("Resume")}
          </Button>
        ) : null}
      </header>
      {waiting.map((decision) => (
        <GoalQuestion
          key={decision.id}
          decision={decision}
          onAnswer={(answer) => props.onTell(goalAnswerPrompt(goal.id, decision, answer))}
        />
      ))}
      <div className="flex items-start gap-3 overflow-x-auto pb-1">
        {lanes.map((lane) => (
          <GoalLane
            key={lane.group.id}
            lane={lane}
            finished={goal.status === "done"}
            onOpenTask={props.onOpenTask}
            onOpenThread={props.onOpenThread}
          />
        ))}
      </div>
      {settled.length > 0 ? (
        <div className="grid gap-1">
          <SectionHeading title={gt("Decisions")} count={settled.length} />
          {settled.map((decision) => (
            <p key={decision.id} className="text-sm">
              <span className="me-1 rounded bg-muted px-1 text-3xs">{decision.id}</span>
              {decision.title}
              <span className="block text-muted-foreground text-xs">
                {decision.by === "model"
                  ? gt("{settled} · settled by the model", { settled: decision.settled })
                  : decision.settled}
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function GoalLane(props: {
  readonly lane: BoardGoalLane;
  readonly finished: boolean;
  readonly onOpenTask: (task: BoardTask) => void;
  readonly onOpenThread: (chat: BoardChat) => void;
}) {
  const gt = useGT();
  const { lane } = props;
  const { worker } = lane;
  const state = {
    done: gt("done"),
    working: lane.group.delegated ? gt("with a child thread") : gt("in hand"),
    ready: gt("next"),
    waiting: gt("waits for {groups}", { groups: lane.group.dependsOn.join(", ") }),
  }[lane.state];
  return (
    <section
      data-board-goal-lane={lane.state}
      className={cn(
        "grid w-64 shrink-0 grid-cols-[minmax(0,1fr)] content-start gap-1.5 rounded-lg border p-2",
        lane.state === "working" && "border-info/60",
        lane.state === "waiting" && "opacity-70",
      )}
    >
      <header className="grid gap-0.5">
        <span className="flex items-center gap-1.5 text-sm">
          <span className="rounded bg-muted px-1 font-mono text-3xs">{lane.group.id}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{lane.group.title}</span>
          <span className="text-muted-foreground text-xs">
            {lane.done}/{lane.tasks.length}
          </span>
        </span>
        <span className="text-muted-foreground text-xs">{state}</span>
      </header>
      {lane.tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          data-board-goal-task={task.status}
          className="grid gap-0.5 rounded-md px-2 py-1 text-start text-sm hover:bg-accent"
          onClick={() => props.onOpenTask(task)}
        >
          <span className={cn("truncate", task.status === "done" && "text-muted-foreground")}>
            {task.status === "done" ? "✓ " : ""}
            {task.title}
          </span>
          <span className="line-clamp-2 text-muted-foreground text-xs">
            {task.status === "done"
              ? (task.evidence ?? gt("No done evidence recorded"))
              : (task.lastAction?.text ?? gt("Not started"))}
          </span>
        </button>
      ))}
      {worker !== null && worker.threadId !== null ? (
        <button
          type="button"
          className="truncate rounded-md px-2 py-1 text-start text-info text-xs hover:bg-accent"
          onClick={() => props.onOpenThread(worker)}
        >
          {gt("Child thread: {title}", { title: worker.title })}
        </button>
      ) : null}
      {lane.group.report !== null ? (
        <p className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1 text-xs">
          {lane.group.report}
        </p>
      ) : null}
    </section>
  );
}

function GoalQuestion(props: {
  readonly decision: BoardGoal["decisions"][number];
  readonly onAnswer: (answer: string) => Promise<boolean>;
}) {
  const gt = useGT();
  const [answer, setAnswer] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <form
      data-board-goal-question
      className="grid gap-1.5 rounded-lg border border-warning/50 p-2 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        const text = answer.trim();
        if (text === "") return;
        if (await props.onAnswer(text)) setSent(true);
      }}
    >
      <span>
        <span className="me-1 rounded bg-muted px-1 text-3xs">{props.decision.id}</span>
        {props.decision.title}
      </span>
      {sent ? (
        <span className="text-muted-foreground text-xs">
          {gt("Your answer was sent to the Goal's thread.")}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <Input
              size="sm"
              value={answer}
              aria-label={gt("Your answer")}
              placeholder={gt("Waiting for your answer")}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </span>
          <Button type="submit" size="sm" disabled={answer.trim() === ""}>
            {gt("Answer")}
          </Button>
        </span>
      )}
    </form>
  );
}
