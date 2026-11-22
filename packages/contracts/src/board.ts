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
});
export type BoardChat = typeof BoardChat.Type;

export const BoardTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  status: Schema.Literals(["active", "paused", "done"]),
  /** 1 = master task, 2 = module, 3 = task. */
  level: Schema.Literals([1, 2, 3]),
  parentId: Schema.NullOr(Schema.String),
  services: Schema.Array(Schema.String),
  lastAction: Schema.NullOr(
    Schema.Struct({ text: Schema.String, at: Schema.Number, workspaceLabel: Schema.String }),
  ),
  next: Schema.NullOr(Schema.Struct({ id: Schema.String, text: Schema.String })),
  steps: Schema.Struct({ done: NonNegativeInt, total: NonNegativeInt }),
  chats: Schema.Array(BoardChat),
  updatedAt: Schema.Number,
  /** The root of the workspace copy that owns the task's module or master task, if one does. */
  ownerRoot: Schema.NullOr(Schema.String),
});
export type BoardTask = typeof BoardTask.Type;

export const BoardView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  services: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
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
});
export type BoardView = typeof BoardView.Type;

export const BoardViewInput = Schema.Struct({ boardId: Schema.String });
export type BoardViewInput = typeof BoardViewInput.Type;

export class BoardReadError extends Schema.TaggedError<BoardReadError>()(
  "BoardReadError",
  {
    reason: Schema.Literals(["not-found", "failed"]),
    detail: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

/** Links a new thread (a draft with no turn yet) to a task, so its first turn carries the task. */
export const BoardLinkThreadInput = Schema.Struct({
  boardId: Schema.String,
  taskId: Schema.String,
  threadId: ThreadId,
  projectId: ProjectId,
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
) {}
