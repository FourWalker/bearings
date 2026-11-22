# Board integration: where it stands (2026-11-22)

Resume from here. The design is in [INTEGRATION.md](INTEGRATION.md) and the concept and protocol
mapping in [RECONCILIATION.md](RECONCILIATION.md).

## Repos and folders

- **Fork:** `C:\Claude Works\t3code-board`, branch `board/integration`.
  - `origin` = github.com/FourWalker/t3code-board (public fork)
  - `upstream` = pingdotgg/t3code
- **Board project (not a git repo):** `C:\Claude Works\Claude Project Board`.
  - The Claude mod is in `mod/project-board/`.
  - Its previous `register.ts` is kept in `backup/`.
- **Board data:** `%USERPROFILE%\.claude-board`. Boards today: NEFX (3 workspaces) and Claude Project Board.
- **Tools:** gh, glab and vp are installed. In PowerShell, reload PATH from the User and Machine environment first.

## Done

| Step   | What                                                                                                                                                                                                                                                            | Commit                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Design | INTEGRATION.md, RECONCILIATION.md                                                                                                                                                                                                                               | `1434c5f`              |
| 1      | `packages/board-core`: the board's rules, storage, context and 16 tools, ported from the mod's `register.ts`                                                                                                                                                    | `4b42195`              |
| 2      | `packages/issue-tracker-board` + `LocalIssueTrackerApi`: board tasks appear as issues for projects inside a board root                                                                                                                                          | `0616d5e`              |
| 3      | `apps/server/src/mcp/toolkits/board` + `board/BoardChats.ts`: board tools for every provider's threads; `T3_BOARD_HOST=t3` for Claude threads                                                                                                                   | `239f5b8`              |
| 4      | `board/BoardTurnContext.ts`: the board's context (placement, linked task's plan and handoff, Board Mode, project rules) goes inline ahead of the user's message for every provider, only when it changed, and again for a new native thread or after compaction | see `git log`          |
| Mod    | Claude mod switched to board-core (vendored by `tools/sync-board-core.mjs`; thin `register.ts`; stands down under `T3_BOARD_HOST`)                                                                                                                              | board project, not git |

Each step passed `vp run check:changed`.

## Next

1. **BoardReactor.** Status (working, idle, ended), the automatic last action and service tags come from
   orchestration events and turn file changes, not only from tool calls.
   It can also call `BoardChat.turnStart` / `turnComplete`, which step 4 doesn't (it only rebuilds context).
2. **Board view** in the web UI: port the board app's screens. `t3board://<board>/<task>` links
   open it. Add "Continue in new thread" on a task, with a provider and model picker.
3. Later: Board Mode details (ownership with T3 worktrees, the R# register UI), mobile.

## Not verified yet

- The fork has never been run in dev mode. Everything is covered by unit and integration tests only.
  Before running, isolate its state:
  `vp run migrate-dev-db --base-dir <clone>/.t3`, then `vp run dev --home-dir <clone>/.t3`.
  Point `T3_BOARD_HOME` at a copy of `.claude-board`, so tests and dev runs never touch the live board.
- Step 4 relies on Effect memoizing `BoardChats.layer` so the MCP tools and the turn context share one
  set of chats (a `board_link` shows in the next turn). Check this in the first dev run.
- On this Windows machine, 4 `ProviderTurnStartService.test.ts` cases (worktree recovery, startup
  coordination) fail with and without the board changes. They're Git worktree failures on Windows, not the board.
- Threads in folders on no board also get the short "not on a board yet" note, as the mod does.
- The switched Claude mod has been smoke-tested with a fake host, not yet in a real new Claude chat.

## After editing board-core

Run `node tools/sync-board-core.mjs` in the board project to refresh the mod's copy.
