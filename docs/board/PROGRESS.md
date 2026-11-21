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

| Step   | What                                                                                                                                          | Commit                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Design | INTEGRATION.md, RECONCILIATION.md                                                                                                             | `1434c5f`              |
| 1      | `packages/board-core`: the board's rules, storage, context and 16 tools, ported from the mod's `register.ts`                                  | `4b42195`              |
| 2      | `packages/issue-tracker-board` + `LocalIssueTrackerApi`: board tasks appear as issues for projects inside a board root                        | `0616d5e`              |
| 3      | `apps/server/src/mcp/toolkits/board` + `board/BoardChats.ts`: board tools for every provider's threads; `T3_BOARD_HOST=t3` for Claude threads | `239f5b8`              |
| Mod    | Claude mod switched to board-core (vendored by `tools/sync-board-core.mjs`; thin `register.ts`; stands down under `T3_BOARD_HOST`)            | board project, not git |

Each step passed `vp run check:changed`.

## Next

1. **Board context in T3 threads.** Add `BoardChat.context` (board placement, the linked task's plan and handoff,
   Board Mode, project rules) to every thread's instructions, as the mod's `prompt.compose` does.
   Without it, non-Claude threads have the tools but aren't told when to use them.
2. **BoardReactor.** Status (working, idle, ended), the automatic last action and service tags come from
   orchestration events and turn file changes, not only from tool calls.
3. **Board view** in the web UI: port the board app's screens. `t3board://<board>/<task>` links
   open it. Add "Continue in new thread" on a task, with a provider and model picker.
4. Later: Board Mode details (ownership with T3 worktrees, the R# register UI), mobile.

## Not verified yet

- The fork has never been run in dev mode. Everything is covered by unit and integration tests only.
  Before running, isolate its state:
  `vp run migrate-dev-db --base-dir <clone>/.t3`, then `vp run dev --home-dir <clone>/.t3`.
  Point `T3_BOARD_HOME` at a copy of `.claude-board`, so tests and dev runs never touch the live board.
- The switched Claude mod has been smoke-tested with a fake host, not yet in a real new Claude chat.

## After editing board-core

Run `node tools/sync-board-core.mjs` in the board project to refresh the mod's copy.
