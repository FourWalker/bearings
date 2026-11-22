# Project Board in T3 Code (fork design)

This fork builds the Claude Project Board (`C:\Claude Works\Claude Project Board`) into T3 Code.
The aim: board tasks work with **any provider** (Claude, Codex, Cursor, OpenCode, …), and the chats
behind them are **T3 threads inside this app**. Clicking a board note opens its thread here. There's
no jumping to VS Code, the Claude app or another platform.

## What T3 Code already gives us

| Need                                                        | Existing T3 piece                                                   | Where                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A list of tasks in the UI, open one, start a thread from it | Issue trackers (GitHub, GitLab, Linear, …)                          | `apps/server/src/issue/`, `packages/issue-tracker-linear` (template)                               |
| A thread linked to a task, and a task's list of threads     | Thread ↔ issue links (`payload.issues`), `listLinkedIssueThreads`   | `apps/server/src/orchestration-v2/ThreadIssueService.ts`, `apps/server/src/issue/linkedThreads.ts` |
| Board tools for every model                                 | T3's own MCP session, injected into every provider thread; toolkits | `apps/server/src/mcp/McpHttpServer.ts`, `apps/server/src/mcp/toolkits/*`                           |
| Working / idle / branch / last action, for every model      | Orchestration events (turn start/complete, checkpoints, diffs)      | `apps/server/src/orchestration-v2/`                                                                |
| Typed wire contracts for web, desktop and mobile            | Effect Schema RPC                                                   | `packages/contracts`                                                                               |

So the board doesn't need per-agent hooks. The Claude Code mod (`hooks/register.ts`) did four jobs
through Claude-only APIs. Here, each job maps onto a T3 piece that already serves every provider:

| Mod today (Claude only)                                                                           | In the fork (every provider)                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `session.start` / `turn.start` / `turn.complete` / `session.end` hooks write `sessions/<id>.json` | A **BoardReactor** service subscribes to orchestration events and records thread status per task                 |
| `prompt.compose` injects task plan + handoff                                                      | Context for a thread started from (or linked to) a board task: purpose, plan, latest handoff, parents' summaries |
| 16 `board_*` tools via `$.tool.register`                                                          | A **`board` MCP toolkit** (`mcp/toolkits/board`): the same tools, keyed by the calling T3 thread                 |
| `tool.call` on Edit/Write for service tagging                                                     | The turn's checkpoint diff (changed paths) matched against the board's service patterns                          |
| `/board`, `/task` commands; VS Code bridge for opening chats                                      | Board view and task actions in the web/desktop/mobile UI; chats are T3 threads                                   |

## Pieces

### 1. `packages/board-core` (shared data layer)

- Pure TypeScript with no T3 or Claude imports. It reads and writes the existing layout in
  `%USERPROFILE%\.claude-board\` (see the board repo's `docs/DATA-LAYOUT.md`): `boards.json`, tasks,
  plan.md, handoffs, decisions, links, ownership.
- The logic gets lifted out of the mod's `register.ts`. The Claude mod is then rewritten to import it,
  so existing Claude Code chats keep working during the move.
- **Same data on disk.** Old Claude sessions and new T3 threads appear on one board.
- Session records gain a `source` field: `{ kind: "t3-thread", threadId, environmentId, provider, model }`
  or `{ kind: "claude-code", sessionId }`.

### 2. `packages/issue-tracker-board` (the board as a tracker)

- Implements a new `LocalIssueTrackerApi` (`packages/source-control-core/src/server/IssueTracker.ts`)
  on top of `board-core`. A standalone tracker (Linear) needs a credential and a binding in
  Settings; a local one covers projects by folder with neither.
- Registered in `LOCAL_TRACKERS` (`apps/server/src/issue/IssueTrackerRegistry.ts`).
- Mapping:
  - tracker `board`, host `local`, scope = board id, key = task id
  - title = the task's path (`Payments › Gateway`)
  - states = Active / Paused / Done
  - labels = level (`L2 module`), `backlog`, `bug`, service tags
  - body = purpose (editable)
  - comments (read-only) = plan, living handoff, step handoffs
  - create = a new Level 1 feature
- Scope: a T3 project maps to a board when the project's root is inside one of that board's roots
  (deepest match wins, as today).
- This gives us, almost for free:
  - the task list
  - task detail
  - "start thread from task"
  - link/unlink
  - the task's linked threads, which open in-app

### 3. `apps/server/src/board/BoardReactor.ts`

- An Effect service that reacts to orchestration events for threads linked to a board task. It writes:
  - status (working / idle / ended) and heartbeat
  - workspace and branch
  - last prompt/answer summary
  - the last action
- Service tagging comes from the checkpoint's changed paths.
- Uses the outbox/effect-worker pattern, so its writes happen after the command commits
  (see AGENTS.md: event-sourced, side effects after commit).

### 4. `apps/server/src/mcp/toolkits/board`

- The board tools as an Effect `Toolkit`:
  - `board_link`, `board_read`, `board_update`, `board_plan`, `board_handoff`, `board_checkpoint`
  - `board_create_task`, `board_decision`, `board_master_plan`, `board_doc`, `board_find`
  - `board_link_task`, `board_move`, `board_promote`, `board_release`, `board_setup`
- Each tool runs as the calling thread's own board chat (`apps/server/src/board/BoardChats.ts`).
  The thread's folder (its worktree, else its project's root) picks the board, and the record
  carries `source: { kind: "t3-thread", threadId, provider, model }`.
- Tool inputs stay as JSON Schema in `board-core` (shared with the Claude mod) and are converted to
  Effect Schema in `tools.ts`.
- Registered in `McpHttpServer.ts` beside `IssuesToolkit`. Every provider thread already receives
  T3's MCP session, so every model gets the tools. Outside MCP clients don't see them, since a
  board chat needs a calling thread.
- Claude threads that T3 runs get `T3_BOARD_HOST=t3` (`provider/Drivers/ClaudeHome.ts`), and the
  Claude mod stands down when it sees it, so Claude doesn't get the tools twice.
- The tool list grows by about 11 KB (`agentContextBudget.json`: 59,052 → 70,365 bytes).

### 5. Board protocol in the thread's context

- Board Mode's protocol (resume from the handoff, checkpoint at phase ends, file decisions at the
  right level, out-of-scope handling, no secrets) moves from the mod's prompt into the context that
  T3 adds to threads linked to a board task.
- Plus each board's ⚙ project rules.

### 6. UI (web first, then desktop shell and mobile)

The board's own UI flow is kept and ported as it is. T3's issue panel is plumbing underneath, not the
board's face. See [RECONCILIATION.md](RECONCILIATION.md) for what changes and what doesn't.

- **Board view**: the tree of master task › module › task, notes with linked threads, the right
  panel of must-dos/decisions/to-dos, and the master task page.
  - First pass: port `app/public/app.js` into a React route that reads through a new board RPC in
    `packages/contracts`.
  - Opening a chat navigates to the T3 thread.
- **On a task**: "New thread" with a provider/model picker. One task can carry threads from several
  providers.
- **On a thread**: a chip showing its board task, with link/unlink (reverse states, per AGENTS.md).
- i18n keys in web and mobile translations.

## Order of work

1. **board-core**: extract from `register.ts`, add tests against a temp board folder, and switch the
   Claude mod to it. No behaviour change.
2. **issue-tracker-board**: tasks show up in T3's issue UI, and threads can be started and linked from tasks.
3. **board MCP toolkit**: any model in a linked thread can read and write plan/handoff/decisions.
4. **BoardReactor**: status, last action and service tags for every provider.
5. **Board view** in web; then desktop and mobile checks.
6. Board Mode protocol, ownership/soft release, the register (R#), and decisions UI.

## Keeping the fork rebase-friendly

- Put new code in new packages and dirs (`packages/board-core`, `packages/issue-tracker-board`,
  `apps/server/src/board`, `apps/server/src/mcp/toolkits/board`, `apps/web/src/board`).
- Keep edits to upstream files small, and list them here as they're made:
  - `packages/source-control-core/src/server/IssueTracker.ts`: `LocalIssueTrackerApi` (a tracker
    that covers projects by folder, with no credential) and `isLocalIssueTracker` (done)
  - `apps/server/src/issue/IssueTrackerRegistry.ts`: `local` trackers, with the board driver in
    `LOCAL_TRACKERS` (done)
  - `apps/server/src/issue/IssueService.ts`: `resolveLocalBindings` lists a project's board beside
    its git host's tracker (done)
  - `apps/server/src/mcp/McpHttpServer.ts`: register `BoardToolkit` (done)
  - `apps/server/src/provider/Drivers/ClaudeHome.ts`: `T3_BOARD_HOST` for Claude threads (done)
  - `apps/server/src/provider/agentContextBudget.json`: the larger tool list (done)
  - `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`: the board context joins the inline
    turn context, read with `serviceOption` (done)
  - `apps/server/src/orchestration-v2/runtimeLayer.ts`: provide `BoardTurnContext` to turn start (done)
  - `packages/contracts`: `board` RPC + capability
- Upstream is `upstream` (`https://github.com/pingdotgg/t3code`). Rebase `board/integration` on
  `upstream/main` regularly.

## Dev notes (Windows)

- Clone with `core.longpaths=true` (already done).
- Install Vite+: `irm https://vite.plus/ps1 | iex`, then `vp i` and `vp run dev`.
- This is a plain clone, not a worktree. Isolate its state before running:
  `vp run migrate-dev-db --base-dir <clone>/.t3`, then `vp run dev --home-dir <clone>/.t3`.
- Never run against `~/.t3/userdata`.
- During development, point the board at a copy of `%USERPROFILE%\.claude-board` (via an env var such
  as `T3_BOARD_HOME`), so tests never touch the live board.
