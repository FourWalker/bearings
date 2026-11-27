/**
 * The Project Board's data model, as stored under `~/.claude-board`. Boards there were first
 * written by the old Claude Code mod, so a field added here must stay optional and old files
 * must keep loading.
 *
 * @module board-core/types
 */

export type ItemKind = "decision" | "todo" | "mandatory";
export type Level = 1 | 2 | 3;
export type TaskStatus = "active" | "paused" | "done";
export type LinkType = "blocked_by" | "found_during" | "related" | "fixes" | "superseded_by";

export interface Implemented {
  problem?: string | undefined;
  approach?: string | undefined;
  api?: string | undefined;
  code?: string | undefined;
  tests?: string | undefined;
  at?: number | undefined;
}

/**
 * What an open decision holds up. blocker: work stops until the person decides. mandatory: settle
 * or skip it before the task is done. optional: nothing. feature: product direction, filed at
 * Level 1, never holds a task. A decision without a type reads as mandatory (a recommendation as
 * optional).
 */
export type DecisionType = "blocker" | "mandatory" | "optional" | "feature";

export interface Decision {
  id: string;
  type?: DecisionType | undefined;
  title: string;
  description: string;
  level: Level;
  raisedFrom: { id: string; title: string } | null;
  refs: string[];
  options: string;
  verdict: string;
  status: "open" | "decided" | "dropped";
  at: number;
  decidedAt?: number | undefined;
  by?: string | undefined;
  /** Recommendations carry a board-wide R# (or the R# of an external register they mirror). */
  rec?:
    | {
        r: string;
        area: string;
        lldCheck: string;
        register: string | null;
        implemented: Implemented | null;
      }
    | undefined;
}

export interface Item {
  id: string;
  kind: ItemKind;
  text: string;
  done: boolean;
  at: number;
  by?: string | undefined;
}

export interface RepoState {
  repo: string;
  name: string;
  branch: string;
  head: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: number;
  lastCommitAt: number;
  at: number;
  service?: string | undefined;
  /** The merge target at that checkpoint, and HEAD's commits not in it; null: no such branch here. */
  target?: string | undefined;
  aheadOfTarget?: number | null | undefined;
}

/** How finished work reaches `target`: through a merge request first, or merged straight in. */
export interface MergeMode {
  mode: "request" | "direct";
  target: string;
}

/** A named place a build lives (frozen, next, demo) and the build in it now. */
export interface Slot {
  id: string;
  name: string;
  /** "" while the slot holds no build. */
  version: string;
  /** The repo (by name) and commit the build was made from, when known. */
  repo?: string | undefined;
  ref?: string | undefined;
  note: string;
  at: number;
  by?: string | undefined;
}

export interface Owner {
  root: string;
  label: string;
  state: "owned" | "soft";
  since: number;
  softAt?: number | undefined;
  pickup?: RepoState[] | undefined;
}

export interface TaskDoc {
  id: string;
  kind: string;
  title: string;
  ref: string;
  note: string;
  at: number;
  by?: string | undefined;
}

export interface TaskLink {
  to: string;
  type: LinkType;
  note: string;
  at: number;
  by?: string | undefined;
}

export interface TaskSessionRef {
  sessionId: string;
  linkedAt: number;
  workspaceLabel: string;
  /** The chat ticked a plan step here: it stays listed on the task after it links elsewhere. */
  ticked?: { step: string; at: number } | undefined;
}

export interface CheckResult {
  id: string;
  command: string;
  exitCode: number;
  at: number;
}

/** What was on record when a task was finished; a task done without it is "done, unverified". */
export interface DoneEvidence {
  repos: { repo: string; name: string; branch: string; head: string; dirty: number }[];
  files: string[];
  check?: CheckResult | undefined;
  /** What a later reader of its handoff and diff found, at the commits they read it at. */
  review?:
    | {
        ok: boolean;
        note: string;
        repos: { repo: string; name: string; head: string }[];
        at: number;
        by?: string | undefined;
      }
    | undefined;
  at: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  lastAction: { text: string; sessionId: string; workspaceLabel: string; at: number } | null;
  /** The last tick, status change or last-action line; `updatedAt` also moves on bookkeeping. */
  lastActionAt?: number | undefined;
  /** When the last plan step was ticked or the status set to done, whichever came first. */
  doneAt?: number | undefined;
  /** Set while a person keeps the item starred. */
  starredAt?: number | undefined;
  items: Item[];
  sessions: TaskSessionRef[];
  /** 1 = master task, 2 = module, 3 = task. Missing means 1 (tasks made before levels existed). */
  level?: Level | undefined;
  parentId?: string | null | undefined;
  /** Former ancestors kept after a promotion or move, so their handoffs stay reachable. */
  origin?: { id: string; title: string }[] | undefined;
  decisions?: Decision[] | undefined;
  docs?: TaskDoc[] | undefined;
  /** Outputs the person removed: a thread touching the file again does not list it again. */
  outputsDropped?: string[] | undefined;
  /** Level 1 only: a feature (has a master plan) or a service backlog. */
  kind?: "feature" | "backlog" | undefined;
  mainService?: string | null | undefined;
  /** Service ids this task touches. */
  services?: string[] | undefined;
  /** Outgoing links; the board shows the reverse side on the other task. */
  links?: TaskLink[] | undefined;
  /** Modules and master tasks: which workspace copy works on it (tasks inherit). */
  owner?: Owner | null | undefined;
  ownerHistory?:
    | {
        type: string;
        at: number;
        by?: string | undefined;
        from?: string | undefined;
        to?: string | undefined;
      }[]
    | undefined;
  overrides?:
    | { workspace: string; at: number; session: string; said?: string | undefined }[]
    | undefined;
  /** Each repo's branch / HEAD / push / clean state, recorded at every checkpoint. */
  repoState?: RepoState[] | undefined;
  checks?: CheckResult[] | undefined;
  /** Files changed by threads working on this task (most recent kept), for done evidence. */
  files?: string[] | undefined;
  doneEvidence?: DoneEvidence | undefined;
  /** What a Goal's thread reported when it finished the task, in full; the card shows a clip. */
  doneNote?: string | undefined;
  /** A fix for a bug found in finished work (linked with "fixes" to the original task). */
  bug?: boolean | undefined;
  /** Other words people use for this item; search treats them like its title. */
  aliases?: string[] | undefined;
  /** Features and modules: their own merge mode. Missing means the parent's, then the board's. */
  merge?: MergeMode | undefined;
  /** Features and modules: the open merge request for their work. */
  mergeRequest?: string | undefined;
  /** The first build whose commit held this task's finished work. */
  landedIn?: string | undefined;
  /** A bug: the build it was found in. */
  foundIn?: string | undefined;
  /** Slots whose build holds this task's finished work, as of when each slot was last set. */
  inSlots?: string[] | undefined;
}

export interface Service {
  id: string;
  name: string;
  match: string[];
}

export interface Root {
  path: string;
  label: string;
}

export interface Board {
  id: string;
  name: string;
  roots: Root[];
  createdAt: number;
  boardMode?: boolean | undefined;
  services?: Service[] | undefined;
  registers?: { id: string; topic: string; url: string }[] | undefined;
  rules?: string | undefined;
  merge?: MergeMode | undefined;
  slots?: Slot[] | undefined;
}

export interface Registry {
  version: 1;
  boards: Board[];
}

/**
 * Where a chat runs. T3 threads are reported by T3 Code for any provider; `claude-code` (or a
 * missing source) marks a chat recorded by the old Claude Code mod.
 */
export type SessionSource =
  | { kind: "claude-code" }
  | {
      kind: "t3-thread";
      threadId: string;
      projectId?: string | undefined;
      environmentId?: string | undefined;
      provider?: string | undefined;
      model?: string | undefined;
    };

export interface Session {
  sessionId: string;
  projectId: string | null;
  taskId: string | null;
  linkDeclined: boolean;
  cwd: string;
  workspace: string;
  workspaceLabel: string;
  subfolder: string;
  branch: string;
  status: "working" | "idle" | "ended";
  title: string;
  lastPrompt: string;
  lastAnswer: string;
  turnStartedAt: number;
  updatedAt: number;
  heartbeatAt: number;
  resumeId?: string | undefined;
  hostSessionId?: string | undefined;
  surface?: string | undefined;
  supersededBy?: string | undefined;
  movedTo?: string | undefined;
  suggestedRoot?: string | undefined;
  suggestedName?: string | undefined;
  boardModeOff?: boolean | undefined;
  pickupNote?: string | undefined;
  /** The Goal this chat is the executor of. */
  goalId?: string | undefined;
  /** The board's Assistant: answers for the whole board and is never on a task. */
  assistant?: boolean | undefined;
  /** A write the Assistant asked for, waiting for the person's yes in a later message. */
  pendingWrite?: { key: string; turnAt: number } | undefined;
  /** Set with `goalId` on a Goal's worker: the group it was given. */
  goalGroup?: string | undefined;
  /** Linked by creating the item, not at the person's ask: moves to the next item it creates, until work starts. */
  autoLinked?: boolean | undefined;
  source?: SessionSource | undefined;
}
