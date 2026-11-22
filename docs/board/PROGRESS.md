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
| 4      | `board/BoardTurnContext.ts`: the board's context (placement, linked task's plan and handoff, Board Mode, project rules) goes inline ahead of the user's message for every provider, only when it changed, and again for a new native thread or after compaction | `81aa292`              |
| 5      | `board/BoardReactor.ts`: from committed events, a run sets the thread working, its answer becomes the task's last action, checkpoint files tag services, archive/delete ends the chat; a 60 s heartbeat keeps open threads online                               | see `git log`          |
| Mod    | Claude mod switched to board-core (vendored by `tools/sync-board-core.mjs`; thin `register.ts`; stands down under `T3_BOARD_HOST`)                                                                                                                              | board project, not git |

Each step passed `vp run check:changed`.

## Next

1. **Board view** in the web UI: port the board app's screens. `t3board://<board>/<task>` links
   open it. Add "Continue in new thread" on a task, with a provider and model picker.
2. Later: Board Mode details (ownership with T3 worktrees, the R# register UI), mobile.

## First dev run (2026-11-22)

How: `.t3/claude-board` is a copy of `~/.claude-board` plus a throwaway "Dev Board" rooted at
`.t3/board-ws` (a small git repo). With `T3_BOARD_HOME` set to it, `vp run dev --home-dir .t3`, then
`t3 project add` that folder and `t3 thread start --provider devReplay --model showcase` (free).
This machine has no `~/.t3`, so there was no live database to migrate or protect.

It found and fixed three bugs:

- T3 thread ids hold colons; on Windows the record went into an NTFS stream (`sessions/mcp`).
  board-core now names records with the board app's `safe()` rule.
- A plain turn (no handoff) never went through the inline-context path, so the board context was
  never sent. Turn start now uses that path whenever the board is present.
- The reactor dropped the prompt of CLI- and agent-started threads (`createdBy: "agent"`), so their
  records were never written. It now skips only server wakes (`creationSource: "server"`).

Verified: the thread's record lands on the right board with title, prompt, idle status and answer;
the turn context is built for the turn. One `BoardChats` is shared by every user of
`BoardChats.layer` in a build (checked against Effect directly).

### Real provider: Codex `gpt-6-luna` (two turns)

- Asked only "which board and workspace, and what does the project rule say", Codex answered
  "Dev Board", "main" and the rule's BOARD-DEV-OK: the board context reaches a non-Claude provider.
- Asked to track the work, it called the board tools: created and linked `refund-api`, saved a
  two-step plan, ticked A1 after creating `api/refunds.ts`, wrote the living handoff and `A1.md`.
  The last action it set was kept; the checkpoint tagged the task `api`; the thread's record is idle
  and linked.
- The board app (`BOARD_ROOT=<copy> BOARD_PORT=4318 node server.js`) shows the task card with next
  step, 1/2 progress, the API tag, the last action and "Idle · 1 chat open".

## Not verified yet

- After a server restart, a T3 thread nobody has used since shows "offline" in the board app: only
  chats opened in this process get the heartbeat, but a T3 thread is available whenever the server
  runs. Decide in the Board view step what "live" means for T3 threads.
- Clicking a T3 thread in the board app uses `jumpUrl` (`claude://…`), which is wrong for T3
  threads; the `t3board://` links of the Board view step replace it.
- Claude threads in T3 (`T3_BOARD_HOST=t3`): this machine has no Claude CLI on PATH, so untested.
- On this Windows machine, 4 `ProviderTurnStartService.test.ts` cases (worktree recovery, startup
  coordination) fail with and without the board changes. They're Git worktree failures on Windows, not the board.
- Step 5: service tags arrive with the turn's checkpoint, after the turn, so the "outside this task's
  services" note that `fileChanged` returns isn't shown to the agent (the mod shows it mid-turn).
  A thread left working when the server stops stays working until its heartbeat goes stale.
- Threads in folders on no board also get the short "not on a board yet" note, as the mod does.
- The switched Claude mod has been smoke-tested with a fake host, not yet in a real new Claude chat.

## After editing board-core

Run `node tools/sync-board-core.mjs` in the board project to refresh the mod's copy.
