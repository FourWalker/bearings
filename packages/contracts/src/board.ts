import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, ThreadId } from "./baseSchemas.ts";

/**
 * The Project Board (`~/.claude-board`), shared with the Claude Code mod and the board app: its
 * boards, their tasks and the chats on them. Ids are the board's own slugs and session ids.
 */
export const BoardSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  taskCount: NonNegativeInt,
});
export type BoardSummary = typeof BoardSummary.Type;

/** `offline`: a Claude Code chat whose window stopped reporting. T3 threads are never offline. */
export const BoardChatLive = Schema.Literals(["working", "idle", "ended", "offline"]);
export type BoardChatLive = typeof BoardChatLive.Type;

export const BoardChat = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.String,
  live: BoardChatLive,
  workspaceLabel: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  updatedAt: Schema.Number,
  /** A thread on this server to open; null for Claude Code chats and threads it doesn't hold. */
  threadId: Schema.NullOr(ThreadId),
  provider: Schema.NullOr(Schema.String),
  /** When the chat's current (or last) turn started; 0 before its first. */
  turnStartedAt: Schema.Number,
});
export type BoardChat = typeof BoardChat.Type;

export const BoardItem = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["mandatory", "decision", "todo"]),
  text: Schema.String,
  done: Schema.Boolean,
});
export type BoardItem = typeof BoardItem.Type;

/** A decision as the board screen lists it; its full text is read with the task. */
export const BoardDecision = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["open", "decided", "dropped"]),
  level: Schema.Literals([1, 2, 3]),
  raisedFrom: Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String })),
  /** The recommendation's R#, when the decision is one. */
  r: Schema.NullOr(Schema.String),
  recommendation: Schema.optional(
    Schema.Struct({
      description: Schema.String,
      area: Schema.String,
      verdict: Schema.String,
      register: Schema.NullOr(Schema.String),
      implemented: Schema.Boolean,
    }),
  ),
});
export type BoardDecision = typeof BoardDecision.Type;

export const BoardTaskLink = Schema.Struct({
  to: Schema.String,
  type: Schema.Literals(["blocked_by", "found_during", "related", "fixes", "superseded_by"]),
  note: Schema.String,
});
export type BoardTaskLink = typeof BoardTaskLink.Type;

export const BoardTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  status: Schema.Literals(["active", "paused", "done"]),
  /** 1 = master task, 2 = module, 3 = task. */
  level: Schema.Literals([1, 2, 3]),
  parentId: Schema.NullOr(Schema.String),
  /** Level 1 only: a feature or a service backlog. */
  kind: Schema.NullOr(Schema.Literals(["feature", "backlog"])),
  bug: Schema.Boolean,
  mainService: Schema.NullOr(Schema.String),
  services: Schema.Array(Schema.String),
  lastAction: Schema.NullOr(
    Schema.Struct({
      text: Schema.String,
      at: Schema.Number,
      workspaceLabel: Schema.String,
      sessionId: Schema.String,
    }),
  ),
  lastActionAt: Schema.Number,
  doneAt: Schema.NullOr(Schema.Number),
  starredAt: Schema.NullOr(Schema.Number),
  next: Schema.NullOr(Schema.Struct({ id: Schema.String, text: Schema.String })),
  steps: Schema.Struct({ done: NonNegativeInt, total: NonNegativeInt }),
  chats: Schema.Array(BoardChat),
  items: Schema.Array(BoardItem),
  decisions: Schema.Array(BoardDecision),
  links: Schema.Array(BoardTaskLink),
  /** Set on the module or master task itself; tasks inherit it (see `ownerRoot`). */
  owner: Schema.NullOr(
    Schema.Struct({
      root: Schema.String,
      label: Schema.String,
      state: Schema.Literals(["owned", "soft"]),
    }),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  /** The root of the workspace copy that owns the task's module or master task, if one does. */
  ownerRoot: Schema.NullOr(Schema.String),
  /** The open Goal that holds the task: one thread is finishing it with the Goal's other tasks. */
  goal: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      status: Schema.Literals(["running", "paused"]),
    }),
  ),
  /** What a finished task left behind (commit, files, check), in one line; null when not recorded. */
  evidence: Schema.NullOr(Schema.String),
  /** What the Goal's thread reported when it finished the task, in full. */
  doneNote: Schema.NullOr(Schema.String),
});
export type BoardTask = typeof BoardTask.Type;

export const BoardGoal = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["running", "paused", "done"]),
  mode: Schema.Literals(["auto", "ask"]),
  pausedReason: Schema.NullOr(Schema.String),
  /** The session running it now. */
  executor: Schema.NullOr(Schema.String),
  taskIds: Schema.Array(Schema.String),
  decisions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      /** "" while it waits for the person. */
      settled: Schema.String,
      by: Schema.Literals(["model", "person"]),
    }),
  ),
  /** The Goal's order of work: a group starts once the groups it depends on are finished. */
  groups: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      taskIds: Schema.Array(Schema.String),
      dependsOn: Schema.Array(Schema.String),
      delegated: Schema.Boolean,
      /** The session of the child thread working the group. */
      worker: Schema.NullOr(Schema.String),
      report: Schema.NullOr(Schema.String),
    }),
  ),
  /** Every chat that has run the Goal or one of its groups, the current executor included. */
  chats: Schema.Array(BoardChat),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type BoardGoal = typeof BoardGoal.Type;

export const BoardView = Schema.Struct({
  hasArchivedThreads: Schema.optional(Schema.Boolean),
  id: Schema.String,
  name: Schema.String,
  boardMode: Schema.Boolean,
  registers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        topic: Schema.String,
        url: Schema.String,
      }),
    ),
  ),
  services: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, match: Schema.Array(Schema.String) }),
  ),
  /** Each copy of the project the board spans, with this server's project at that folder. */
  workspaces: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      root: Schema.String,
      projectId: Schema.NullOr(ProjectId),
    }),
  ),
  tasks: Schema.Array(BoardTask),
  unlinked: Schema.Array(BoardChat),
  /** Goals not finished yet. Progress is read from their tasks. */
  goals: Schema.Array(BoardGoal),
  /** The latest finished Goals, newest first. */
  finishedGoals: Schema.Array(BoardGoal),
});
export type BoardView = typeof BoardView.Type;

export const BoardTaskDetailInput = Schema.Struct({
  boardId: Schema.String,
  taskId: Schema.String,
});
export type BoardTaskDetailInput = typeof BoardTaskDetailInput.Type;

/** One task's documents, read when its task view opens: the texts the board screen leaves out. */
const Level = Schema.Literals([1, 2, 3]);
const TaskRef = Schema.Struct({ id: Schema.String, title: Schema.String });
export const BoardTaskDetail = Schema.Struct({
  /** The master implementation plan of the task's master task (its own, for a master task). */
  masterPlan: Schema.String,
  masterTaskId: Schema.String,
  plan: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      steps: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          text: Schema.String,
          done: Schema.Boolean,
          /** The subtask that took the step over. */
          childId: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  ),
  /** plan.md as written, for editing. */
  planMarkdown: Schema.String,
  handoff: Schema.String,
  handoffCheckpoint: Schema.optional(Schema.NullOr(Schema.String)),
  /** Other names search finds the task by; absent from servers made before they were listed. */
  aliases: Schema.optional(Schema.Array(Schema.String)),
  checks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        command: Schema.String,
        exitCode: Schema.Int,
        at: Schema.Number,
        taskTitle: Schema.String,
      }),
    ),
  ),
  /** Newest first. */
  stepNotes: Schema.Array(
    Schema.Struct({
      step: Schema.String,
      at: Schema.Number,
      text: Schema.String,
      checkpointRef: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  /** This task's documents (`from` null), then its parents'. */
  docs: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      title: Schema.String,
      ref: Schema.String,
      note: Schema.String,
      from: Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String, level: Level })),
    }),
  ),
  /** `own`: filed here; `up`: raised here, filed on a parent; `inherited`: a parent's own. */
  decisions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      description: Schema.String,
      options: Schema.String,
      verdict: Schema.String,
      status: Schema.Literals(["open", "decided", "dropped"]),
      level: Level,
      refs: Schema.Array(Schema.String),
      at: Schema.Number,
      group: Schema.Literals(["own", "up", "inherited"]),
      r: Schema.NullOr(Schema.String),
      area: Schema.String,
      /** A decided recommendation's record of how it was built. */
      implemented: Schema.NullOr(
        Schema.Struct({
          problem: Schema.String,
          approach: Schema.String,
          api: Schema.String,
          code: Schema.String,
          tests: Schema.String,
        }),
      ),
      decidedAt: Schema.NullOr(Schema.Number),
      raisedFrom: Schema.NullOr(TaskRef),
      filedOn: TaskRef,
    }),
  ),
  repoState: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      branch: Schema.String,
      head: Schema.String,
      upstream: Schema.NullOr(Schema.String),
      ahead: Schema.NullOr(Schema.Number),
      behind: Schema.NullOr(Schema.Number),
      dirty: Schema.Number,
      at: Schema.Number,
    }),
  ),
  /** Root first, with each parent's objective line. */
  parents: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      level: Level,
      objective: Schema.String,
    }),
  ),
  /** What each chat on the task (on a master task, in its tree) last asked and answered. */
  chats: Schema.Array(
    Schema.Struct({
      sessionId: Schema.String,
      lastPrompt: Schema.String,
      lastAnswer: Schema.String,
      branch: Schema.String,
      subfolder: Schema.String,
    }),
  ),
});
export type BoardTaskDetail = typeof BoardTaskDetail.Type;

const LinkKind = Schema.Literals([
  "blocked_by",
  "blocks",
  "found_during",
  "led_to",
  "related",
  "fixes",
  "superseded_by",
]);

/** One change a person makes to a task in its views; agents make the same through board tools. */
export const BoardTaskEdit = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("update"),
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Literals(["active", "paused", "done"])),
    kind: Schema.optional(Schema.Literals(["feature", "backlog"])),
    mainService: Schema.optional(Schema.NullOr(Schema.String)),
    services: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    op: Schema.Literal("addItem"),
    kind: Schema.Literals(["mandatory", "todo"]),
    text: Schema.String,
  }),
  Schema.Struct({ op: Schema.Literal("toggleItem"), itemId: Schema.String }),
  Schema.Struct({ op: Schema.Literal("deleteItem"), itemId: Schema.String }),
  Schema.Struct({ op: Schema.Literal("savePlan"), markdown: Schema.String }),
  Schema.Struct({ op: Schema.Literal("toggleStep"), step: Schema.String }),
  Schema.Struct({ op: Schema.Literal("star"), on: Schema.Boolean }),
  Schema.Struct({ op: Schema.Literal("saveHandoff"), markdown: Schema.String }),
  Schema.Struct({ op: Schema.Literal("saveMasterPlan"), markdown: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("addDoc"),
    kind: Schema.String,
    title: Schema.String,
    ref: Schema.String,
    note: Schema.String,
  }),
  Schema.Struct({ op: Schema.Literal("removeDoc"), docId: Schema.String }),
  Schema.Struct({ op: Schema.Literal("removeAlias"), alias: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("addLink"),
    to: Schema.String,
    type: LinkKind,
    note: Schema.String,
  }),
  Schema.Struct({ op: Schema.Literal("removeLink"), to: Schema.String, type: LinkKind }),
  Schema.Struct({
    op: Schema.Literal("createChild"),
    title: Schema.String,
    fromStep: Schema.optional(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("reportBug"), title: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("addDecision"),
    title: Schema.String,
    description: Schema.String,
    options: Schema.String,
    refs: Schema.Array(Schema.String),
    level: Schema.Literals([1, 2, 3]),
    recommendation: Schema.optional(
      Schema.Struct({
        area: Schema.String,
        lldCheck: Schema.optional(Schema.String),
        register: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  }),
  Schema.Struct({
    op: Schema.Literal("setDecision"),
    decisionId: Schema.String,
    action: Schema.Literals(["decide", "drop", "reopen"]),
    verdict: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literal("updateDecision"),
    decisionId: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    options: Schema.optional(Schema.String),
    refs: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    op: Schema.Literal("implemented"),
    decisionId: Schema.String,
    problem: Schema.String,
    approach: Schema.String,
    api: Schema.String,
    code: Schema.String,
    tests: Schema.String,
  }),
  /** Re-parents the task (null: a master task); its subtasks move with it. */
  Schema.Struct({ op: Schema.Literal("move"), parentId: Schema.NullOr(Schema.String) }),
  Schema.Struct({ op: Schema.Literal("promote") }),
  /** Gives the task's module or master task to a workspace copy (by root), or releases it. */
  Schema.Struct({ op: Schema.Literal("setOwner"), root: Schema.NullOr(Schema.String) }),
  Schema.Struct({ op: Schema.Literal("softRelease") }),
  Schema.Struct({ op: Schema.Literal("reclaim") }),
]);
export type BoardTaskEdit = typeof BoardTaskEdit.Type;

export const BoardEditTaskInput = Schema.Struct({
  boardId: Schema.String,
  taskId: Schema.String,
  edit: BoardTaskEdit,
});
export type BoardEditTaskInput = typeof BoardEditTaskInput.Type;

/** A change to a board's own settings (⚙). */
export const BoardSettingsEdit = Schema.Union([
  Schema.Struct({ op: Schema.Literal("rename"), name: Schema.String }),
  Schema.Struct({ op: Schema.Literal("addRoot"), path: Schema.String, label: Schema.String }),
  Schema.Struct({ op: Schema.Literal("removeRoot"), path: Schema.String }),
  Schema.Struct({ op: Schema.Literal("labelRoot"), path: Schema.String, label: Schema.String }),
  /** Makes the workspace a T3 project on this server, so threads can start there. */
  Schema.Struct({ op: Schema.Literal("addProject"), path: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("saveServices"),
    services: Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        name: Schema.String,
        match: Schema.Array(Schema.String),
      }),
    ),
  }),
  Schema.Struct({ op: Schema.Literal("saveRules"), rules: Schema.String }),
  Schema.Struct({ op: Schema.Literal("setBoardMode"), on: Schema.Boolean }),
  Schema.Struct({
    op: Schema.Literal("saveRegisters"),
    registers: Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        topic: Schema.String,
        url: Schema.String,
      }),
    ),
  }),
]);
export type BoardSettingsEdit = typeof BoardSettingsEdit.Type;

export const BoardEditBoardInput = Schema.Struct({
  boardId: Schema.String,
  edit: BoardSettingsEdit,
});
export type BoardEditBoardInput = typeof BoardEditBoardInput.Type;

/** A board's settings as ⚙ edits them: the parts the board screen leaves out. */
export const BoardSettings = Schema.Struct({
  name: Schema.String,
  roots: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      label: Schema.String,
      /** The T3 project a thread in this workspace starts in; null when the server has none. */
      projectId: Schema.NullOr(ProjectId),
    }),
  ),
  services: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, match: Schema.Array(Schema.String) }),
  ),
  rules: Schema.String,
  boardMode: Schema.Boolean,
  registers: Schema.Array(
    Schema.Struct({ id: Schema.String, topic: Schema.String, url: Schema.String }),
  ),
});
export type BoardSettings = typeof BoardSettings.Type;

export const BoardCreateBoardInput = Schema.Struct({
  name: Schema.String,
  roots: Schema.Array(Schema.Struct({ path: Schema.String, label: Schema.String })),
  boardMode: Schema.Boolean,
});
export type BoardCreateBoardInput = typeof BoardCreateBoardInput.Type;

export const BoardCreateBoardResult = Schema.Struct({ boardId: Schema.String });
export type BoardCreateBoardResult = typeof BoardCreateBoardResult.Type;

/** A T3 project offered as a board workspace, and the board its folder is already on. */
export const BoardWorkspaceCandidate = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  path: Schema.String,
  board: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export type BoardWorkspaceCandidate = typeof BoardWorkspaceCandidate.Type;

export const BoardCreateTaskInput = Schema.Struct({
  boardId: Schema.String,
  title: Schema.String,
  kind: Schema.optional(Schema.Literals(["feature", "backlog"])),
});
export type BoardCreateTaskInput = typeof BoardCreateTaskInput.Type;

export const BoardEditResult = Schema.Struct({
  message: Schema.String,
  /** The task the edit created, if it made one. */
  createdId: Schema.NullOr(Schema.String),
});
export type BoardEditResult = typeof BoardEditResult.Type;

export class BoardEditFailure extends Schema.TaggedError<BoardEditFailure>()(
  "BoardEditFailure",
  {
    /** `invalid`: the board refused the change; `detail` says why. */
    reason: Schema.Literals(["not-found", "invalid", "failed"]),
    detail: Schema.String,
  },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * What a T3 window is asked to show. Commands navigate or pre-fill a composer; none writes board
 * data, so a wrong one costs a click.
 */
export const BoardIntentCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("board.open"),
    boardId: Schema.String,
    /** A task to open on that board. */
    taskId: Schema.optional(Schema.String),
    view: Schema.optional(Schema.Literals(["tree", "1", "2", "3", "svc", "register"])),
    filter: Schema.optional(Schema.Literals(["active", "paused", "done", "all"])),
  }),
  Schema.Struct({ type: Schema.Literal("view.back") }),
  Schema.Struct({
    type: Schema.Literal("thread.draftPrompt"),
    threadId: Schema.String,
    /** Put in that thread's composer for the person to send; never sent for them. */
    text: Schema.String,
  }),
]);
export type BoardIntentCommand = typeof BoardIntentCommand.Type;

export const BoardIntent = Schema.Struct({
  id: Schema.String,
  /** The one window this is for; a person's other devices don't navigate. */
  clientId: Schema.String,
  command: BoardIntentCommand,
});
export type BoardIntent = typeof BoardIntent.Type;

export const BoardIntentAck = Schema.Struct({
  id: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.optional(Schema.String),
});
export type BoardIntentAck = typeof BoardIntentAck.Type;

export const BoardViewInput = Schema.Struct({ boardId: Schema.String });
export type BoardViewInput = typeof BoardViewInput.Type;

export class BoardReadError extends Schema.TaggedError<BoardReadError>()(
  "BoardReadError",
  {
    reason: Schema.Literals(["not-found", "failed"]),
    detail: Schema.String,
  },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Links a new thread (a draft with no turn yet) to a task, so its first turn carries the task. */
export const BoardLinkThreadInput = Schema.Struct({
  boardId: Schema.String,
  /** The task the thread works on; null makes it the board's Assistant, which is on no task. */
  taskId: Schema.NullOr(Schema.String),
  threadId: ThreadId,
  projectId: ProjectId,
  override: Schema.optional(Schema.Literals(["once", "takeover"])),
});
export type BoardLinkThreadInput = typeof BoardLinkThreadInput.Type;

export class BoardLinkError extends Schema.TaggedError<BoardLinkError>()(
  "BoardLinkError",
  {
    /** `blocked`: another workspace copy owns the task's module; `started`: the thread exists. */
    reason: Schema.Literals(["not-found", "not-on-board", "blocked", "started", "failed"]),
    detail: Schema.String,
  },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return this.detail;
  }
}
