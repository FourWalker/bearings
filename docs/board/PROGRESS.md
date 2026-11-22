# Board integration: where it stands (2026-11-22)

Resume from here. The design is in [INTEGRATION.md](INTEGRATION.md) and the concept and protocol
mapping in [RECONCILIATION.md](RECONCILIATION.md).

## Repos and folders

- **Fork:** `C:\Claude Works\t3code-board`. Continuation is on `board/continue-integration`, based on Claude's `board/integration` at `b4fbdfc`.
  - `origin` = github.com/FourWalker/t3code-board (public fork)
  - `upstream` = pingdotgg/t3code
- **Board project:** `C:\Claude Works\Claude Project Board`. The matching standalone changes are on `board/shared-app-edits`, based on `main` at `3380791`.
  - The Claude mod is in `mod/project-board/`; the board app is `mod/project-board/app/server.js`.
  - Its previous `register.ts` is kept in `backup/`.
- **Board data:** `%USERPROFILE%\.claude-board`. Boards today: NEFX (3 workspaces) and Claude Project Board.
- **Tools:** gh, glab, vp and Codex CLI (signed in with ChatGPT) are installed; no Claude CLI on PATH.
  In PowerShell, reload PATH from the User and Machine environment first.

## Done

| Step   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Commit                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Design | INTEGRATION.md, RECONCILIATION.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `1434c5f`               |
| 1      | `packages/board-core`: the board's rules, storage, context and 16 tools, ported from the mod's `register.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `4b42195`               |
| 2      | `packages/issue-tracker-board` + `LocalIssueTrackerApi`: board tasks appear as issues for projects inside a board root                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `0616d5e`               |
| 3      | `apps/server/src/mcp/toolkits/board` + `board/BoardChats.ts`: board tools for every provider's threads; `T3_BOARD_HOST=t3` for Claude threads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `239f5b8`               |
| 4      | `board/BoardTurnContext.ts`: the board's context (placement, linked task's plan and handoff, Board Mode, project rules) goes inline ahead of the user's message for every provider, only when it changed, and again for a new native thread or after compaction                                                                                                                                                                                                                                                                                                                                                                                                                   | `81aa292`               |
| 5      | `board/BoardReactor.ts`: from committed events, a run sets the thread working, its answer becomes the task's last action, checkpoint files tag services, archive/delete ends the chat; a 60 s heartbeat keeps open threads online                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `e20a6e1`               |
| Fixes  | First dev run: Windows-safe record names, board context on plain turns, prompts of CLI/agent-started threads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `0b1005d`               |
| 6a     | Board view, first slice: `board.list` / `board.view` RPCs and `projectBoard` capability; `board/BoardService.ts` (T3 threads take status and title from T3, so they are never "offline"); web `/board` page with the task tree, threads per task, threads not on a task, sidebar entry                                                                                                                                                                                                                                                                                                                                                                                            | see `git log`           |
| 6b     | "Continue in new thread" on a task card: opens a local draft in the task's workspace project (the owning copy only, when its module is owned) with a "continue from its handoff" prompt; `board.linkThread` (guarded, operate scope) links the draft's thread id to the task before the first turn. Unsent drafts stay off the board view                                                                                                                                                                                                                                                                                                                                         | see `git log`           |
| P1     | Board screen (read-only): a column per master task with sticky notes, Level 1-3 and By service views, status filters, workspace chips and collision warning, right panel, board picker, Board row at the top of the sidebar                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `e03ae94`               |
| Review | Fixes from the outside review (Astra): a finished subtask ticks the parent step it took over; `board_handoff` saves step note, living handoff and tick in one call; binding decisions lead the resume context                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `6f12834`               |
| Port   | From Codex's `codex/project-board-handoff` (`fd25e89`), rebuilt: T3 threads get a short resume summary; unlinked threads see 8 recent tasks plus board_find; worktree threads fall back to their project's board; `board.taskDetail` RPC; the board task shows on the thread as a T3 issue link, mirrored both ways by BoardReactor                                                                                                                                                                                                                                                                                                                                               | see `git log`           |
| P2     | Task views (read-only), as the board app's: a master task opens as a page (Overview: modules and tasks, threads, must-dos and to-dos), modules and tasks open beside the board; tabs Threads, Plan & Docs (master plan, phases with delegated steps and notes, docs incl. parents'), Handoff (living handoff, repo state, step notes), Tasks, Decisions (own / raised here / from parents); side column (last action, workspace, blockers, bugs, services, linked tasks, parent context, items). The open task is in the URL (`task=`). `board.taskDetail` carries plan phases, step notes, docs, grouped decisions, repo state, parent objectives, chats' last prompt and answer | see `git log`           |
| P3a    | Editing from T3, first slice: `board-core/edit.ts` is the one implementation of task edits (agents' board tools now share its create, decision, link and delegated-step code); guarded `board.editTask` (one typed op per change) and `board.createTask` RPCs, serialized per board; in the task views: title, purpose, status, must-dos and to-dos, phase plan (edit, tick steps, step → module/task), living handoff, master plan, docs, links, service tags, new module/task, decisions (file, decide, drop, reopen, recommendations with R#); "+ New task" on the board                                                                                                       | see `git log`           |
| P3b    | Editing, rest: move and promote (agents' tools share the code), ownership (assign a workspace copy, soft release with the push/clean/checkpoint checks, reclaim, release), editing a decision's text and its "How implemented" record, board settings ⚙ (`board.settings` / `board.editBoard`, settings-write scope: name, workspaces, services, project rules, Board Mode, registers). Fixes from the owner's review: tree columns no longer overlap (pinned grid tracks, long words wrap); modules and tasks open in one big modal (`open=`) over the board or a master task's page (`task=`), and a task that becomes a master task moves to its page                          | see `git log`           |
| Mod    | Claude mod switched to board-core (vendored by `tools/sync-board-core.mjs`; thin `register.ts`; stands down under `T3_BOARD_HOST`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | board project `e4dbb9d` |

Each step passed `vp run check:changed`, apart from the Windows-only failures listed below.

## Next

**Goal (from the owner, 2026-11-22):** the whole board app's UI flow, built into T3 Code itself, with
linked chats opening as T3 threads in the same app: no jumping to Claude Desktop or VS Code. The board
app (`mod/project-board/app`, screenshots in the board project's `docs/preview/`) is the reference
for layout and behaviour; it keeps working alongside on the same `~/.claude-board`.

**Rule (from the review):** T3 records facts (which thread is on which task, its workspace, checks
and their exit codes, step completion); the model records judgments (why, what a check proves,
what's still unverified).

**Acceptance test:** hand step A1 to another workspace, finish it there, interrupt the thread
mid-completion, then open the parent and resume in a fresh thread with another provider. Board and
thread must agree on what's done, blocked and verified, and on the next action.

### Continuation on `board/continue-integration`

- **Phase 3.** The standalone app uses board-core for board and task edits, including delegated
  completion, ownership, decisions and chat links. T3 shows the plan, current activity, and recorded
  results in separate sections. For recognized standalone check commands reported by a provider,
  T3 records the command name and exit code. The parent includes the results of delegated steps
  marked complete. Raw arguments and output stay in the thread.
- **Phase 4.** The Recommendations register lists and filters board-wide R#s, links to external
  registers, and opens the task's Decisions tab. The board picker lists recent chats without a
  board. Users can create service backlogs and report a bug against a finished task. By service,
  the Blocked panel, Move, and settings are part of the same flow.
- **Phase 5.** Board links open against the correct T3 environment. The command palette opens the
  board. Task views offer Copy task link and Copy handoff. Continue in new thread links a fresh
  draft before it opens; choosing a different workspace can override once or take over. A soft
  release's pickup instructions persist into the first turn.
- **Review follow-up.** The agent protocol calls for recording a blocker when it is found.
  Compatible hosts serialize decision filing and reserve R#s with exclusive file creation. A T3
  handoff records the matching checkpoint ref when the run's checkpoint is captured, even if the
  original board chat has been reopened since the handoff was written.

### Next verification

- Run the acceptance sequence above end to end with real T3 providers. The isolated fixtures
  exercise a second workspace, a fresh provider session, delegated completion, the parent's
  next action and recorded checks, and attachment of the interrupted run?s checkpoint.
- Verify the integrated web and desktop UI with T3's Browser panel, including register navigation
  and saving a board setting, a decision and its implementation record. The standalone HTTP smoke
  covers those edits against a temporary board and confirms that simultaneous writes from two
  processes preserve both recommendations on one task.
- **Phase 6 remains deferred.** Mobile and Board Mode with T3-created worktrees.

## How to run it (dev, isolated)

`.t3/` in the clone is gitignored and holds the dev state:

- `.t3/claude-board`: a copy of `~/.claude-board` plus a throwaway "Dev Board" rooted at
  `.t3/board-ws` (a small git repo with a linked task `refund-api` from a Codex run).
- Start: in PowerShell, `$env:T3_BOARD_HOME = "<clone>\.t3\claude-board"`, then
  `vp run dev --home-dir <clone>\.t3`. Open the `pairingUrl` from the log, then `/board`.
- Free turns: `node apps/server/src/bin.ts thread start --base-dir .t3 --provider devReplay
  --model showcase <folder> "go"`. Real cheap turns: `--provider codex --model gpt-6-luna`.
- Board app on the copy: `BOARD_ROOT=<copy> BOARD_PORT=4318 node server.js` in the mod's `app/`.
- This machine has no `~/.t3`, so there is no live T3 database to protect.

## Verified

- First dev run fixed three bugs: T3 thread ids hold colons (Windows NTFS streams), so board-core
  names records with the board app's `safe()` rule; plain turns now carry the board context; CLI- and
  agent-started threads' prompts are recorded (only server wakes are skipped).
- Codex `gpt-6-luna` read the board context (named the board, workspace and project rule) and used
  the board tools: created and linked a task, saved a plan, ticked a step, wrote handoffs. The board
  app showed it.
- `/board` in the dev web app: shows the Dev Board and the copied NEFX board (tree, steps, services,
  paused module, offline Claude Code chat not clickable); the Codex thread shows idle after a restart;
  clicking it opens the T3 thread; the sidebar Board entry opens the page.
- "Continue in new thread" on the Dev Board: the draft opened in board-ws with the prompt, its board
  record was linked to `refund-api` before sending, and after a Replay turn the thread showed on the
  task with its answer as the last action. NEFX (no T3 project in its folders) shows no button.
- One `BoardChats` is shared by every user of `BoardChats.layer` in a build (checked against Effect).

## Not verified yet / known gaps

- The board app still shows T3 threads unused since a restart as "offline", and its jump link
  (`claude://…`) is wrong for T3 threads. T3's own Board page has neither problem.
- Claude threads in T3 (`T3_BOARD_HOST=t3`): untested here (no Claude CLI).
- Service tags arrive with the turn's checkpoint, after the turn, so the "outside this task's
  services" note isn't shown to the agent (the mod shows it mid-turn).
- Threads in folders on no board get the short "not on a board yet" note, as the mod does.
- "Continue in new thread" picks the model in the composer, not on the button (the draft uses the
  project's defaults like any new thread). It always starts a local draft: a T3 worktree sits outside
  the board's roots, so the thread would land off the board.
- The switched Claude mod has been smoke-tested with a fake host, not yet in a real new Claude chat.
- Windows-only test failures, with and without the board changes: 4 `ProviderTurnStartService.test.ts`
  cases (Git worktrees) and one `ServerEnvironment.test.ts` case (symlink EPERM). The mobile
  `i18n:check` step can't spawn `gt` on Windows; web catalogs pass.

## Codex's branch

`refs/remotes/codex/project-board-handoff` (fetched from its bundle) is kept for reference. Not
taken: board file reads inside the Orchestrator, plan repair on every save and read, handoff parsing
by heading patterns, its task-detail tabs (phase 2 rebuilds them to match the board app).

## After editing board-core

Run `node tools/sync-board-core.mjs` in the board project to refresh the mod's copy.
