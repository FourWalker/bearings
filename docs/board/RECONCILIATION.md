# Claude Project Board ↔ T3 Code: what's the same, what maps, what's board-only

**Goal:** keep the Claude Board's UI flow and Board Mode protocol. Use T3 Code's machinery wherever
it already does the same job, and avoid two systems doing one thing.

**Short version:**

- T3 Code already covers the **execution layer** the board had to build on hooks: chats, their status,
  repo state, links between chats and tasks, starting and delegating chats, and context carry-over.
- T3 has **nothing** for the **planning layer**: levels, plans, living handoffs, decisions, the
  register, services, ownership. That's most of the board, and it has no rival to reconcile with.
  It moves over unchanged.

Verdicts: **Same** = one concept, use T3's. **Map** = close; join them with a small rule.
**Board** = board-only, keep as is. **Replace** = the board's workaround is no longer needed.

## Concepts

| Claude Board                                                                     | T3 Code                                                                                                    | Verdict                  | Reconciled as                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat (Claude session)                                                            | Thread                                                                                                     | **Same**                 | A board chat _is_ a T3 thread. Any provider and model; a thread can switch provider mid-way.                                                                                                                                            |
| Chat ↔ task link (`sessions/*.json` + `task.sessions[]`)                         | Thread ↔ issue link (`payload.issues`, `listLinkedIssueThreads`)                                           | **Same**                 | The board registers as a tracker, so a link is a T3 issue link. Many threads per task, as today.                                                                                                                                        |
| Chat status working / idle / ended, heartbeat, "offline"                         | Thread running / idle; settled; archived; T3 knows live state                                              | **Replace**              | Status comes from the orchestrator. Heartbeat files and the 2-minute offline guess go.                                                                                                                                                  |
| Last action strip, last prompt/answer                                            | Thread's latest turn and activity                                                                          | **Map**                  | `board_update` still writes the human-readable last action. Clicking it opens the thread at that turn.                                                                                                                                  |
| Opening a chat (VS Code bridge, sidebar/tab links)                               | In-app navigation to a thread                                                                              | **Replace**              | Notes and the last action strip navigate inside T3, the same on web, desktop and mobile.                                                                                                                                                |
| Repo state on checkpoint (branch, HEAD, pushed, clean)                           | Per-turn **git checkpoint** refs, diffs, branch toolbar                                                    | **Replace**              | Read from T3's checkpoint and git services, not collected by the mod.                                                                                                                                                                   |
| Service tagging from Edit/Write hooks                                            | Turn file changes / checkpoint diff                                                                        | **Map**                  | Changed paths are matched against the board's service patterns, for every provider.                                                                                                                                                     |
| Board (name + workspace roots)                                                   | Project (a root folder, can span repos) on an environment (machine)                                        | **Map**                  | A board groups several T3 projects: each workspace copy is a project whose root sits inside a board root. The deepest root wins, as today.                                                                                              |
| Workspace copies (`D:\nfx`, `D:\nfx-workspaces\claude-code`)                     | Worktrees, created per thread (**New worktree**, `delegate_task isolation:"worktree"`)                     | **Map**                  | Both count as workspaces. A long-lived clone is a project; a T3 worktree shows as a workspace labelled with its branch. Ownership rules apply to both.                                                                                  |
| "Two chats in the same workspace" warning                                        | Worktrees avoid it; threads in the main checkout still share it                                            | **Map**                  | Keep the warning, only for threads that aren't in their own worktree.                                                                                                                                                                   |
| Unassigned chat → "create a board or add to one?"                                | Thread with no project (scratch folder)                                                                    | **Map**                  | Scratch threads aren't on a board. The same one-question setup flow runs when the user wants a task tracked.                                                                                                                            |
| `board_create_task` "to be worked in another chat"                               | `delegate_task` / `t3_thread_launch` (child thread, can be a worktree, can wait)                           | **Map**                  | After the person says yes, a task can be **started**, not just created: launch a thread linked to it, seeded with its plan stub and handoff.                                                                                            |
| Living handoff (agent-written, one per task, rewritten in place)                 | Portable handoff (automatic, budgeted transcript selection when switching provider or overflowing context) | **Different, both kept** | T3's handoff keeps **one thread** going across providers and context limits. The board's handoff carries a **task across threads**. Starting a thread from a task injects the living handoff; T3's own handoff runs inside that thread. |
| `board_checkpoint` / `/checkpoint` (rewrite the handoff)                         | "Checkpoint" = git snapshot of a turn                                                                      | **Name clash**           | The board's tool keeps its name (`board_checkpoint`), but the UI calls it **Save handoff**. Each one records the T3 checkpoint ref of the turn it was written in, so the handoff points at exact code.                                  |
| Done task                                                                        | Settled thread                                                                                             | **Different**            | Settling a thread doesn't finish a task, and finishing a task doesn't settle its threads. The note shows both.                                                                                                                          |
| Board ⚙ Project rules + Board Mode protocol (via `prompt.compose`)               | Provider instruction files (AGENTS.md / CLAUDE.md in the repo); T3-added context                           | **Map**                  | Injected by T3 into threads linked to a board task. The repo's own AGENTS.md / CLAUDE.md still apply on top.                                                                                                                            |
| Levels: master task › module › task; promote; move                               | —                                                                                                          | **Board**                | Unchanged.                                                                                                                                                                                                                              |
| Phase plan (`plan.md`), step handoffs, master plan, docs & refs                  | — (T3's plan _mode_ is per turn, not a stored plan)                                                        | **Board**                | Unchanged.                                                                                                                                                                                                                              |
| Decisions per level, Recommendations register (R#), external registers           | —                                                                                                          | **Board**                | Unchanged.                                                                                                                                                                                                                              |
| Must-dos / to-dos / right panel                                                  | —                                                                                                          | **Board**                | Unchanged.                                                                                                                                                                                                                              |
| Services, By-service view, service backlogs                                      | —                                                                                                          | **Board**                | Unchanged.                                                                                                                                                                                                                              |
| Linked tasks (blocked by / blocks / found during / led to / related), ⛔ roll-up | —                                                                                                          | **Board**                | Unchanged.                                                                                                                                                                                                                              |
| Ownership, soft release, takeover                                                | —                                                                                                          | **Board**                | Unchanged; works with workspaces as mapped above.                                                                                                                                                                                       |
| 🐞 fix tasks for finished work                                                   | —                                                                                                          | **Board**                | Unchanged.                                                                                                                                                                                                                              |
| —                                                                                | Multi-machine environments, remote/mobile clients                                                          | **T3-only**              | The board store lives on the environment that owns the projects and reaches other devices through T3's RPC, so the phone sees the same board.                                                                                           |
| —                                                                                | Provider switching mid-thread, forks, side chats                                                           | **T3-only**              | A fork or side chat of a linked thread inherits the task link (opt out per fork).                                                                                                                                                       |

**Count:**

- About **8 concepts are the same or replaced** by T3 (execution layer).
- About **8 map** with a small rule.
- About **12 are board-only** and move unchanged.
- **One clash**: the word "checkpoint".

## The UI flow: keep the board's, frame it in T3

T3's own issue panel would flatten the board (no levels, plan, handoff or decisions). So:

- The board's screens are **ported as they are** into a Board view in T3:
  - picker page
  - Tree / level-at-a-time views
  - notes
  - Last action strip
  - right panel
  - master task page (Overview 60/20/20, Plan & Docs, Handoff, Decisions)
  - By service and Register views
  - ⚙ settings
- T3's tracker plumbing is used **under** that UI (links, linked threads, MCP issue tools), not instead of it.

The only flow changes are where a step used to leave the app:

| Today                                                  | In the fork                                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click a note → pick a chat → VS Code / Claude opens it | Click a note → pick a thread → it opens beside the board                                                                                                                    |
| "Resume: run `/task <id>` in a new chat"               | **Continue in new thread** on the task, with a provider/model picker. The thread opens linked and seeded with the living handoff. `/task <id>` still works in the composer. |
| Out-of-scope choice (a) "new task in another chat"     | Same question; on yes the new task's thread can be launched right away                                                                                                      |
| `/board`, `/task`, `/checkpoint` in Claude             | The same words as T3 composer commands, plus a command palette entry and the task's buttons ("hit every surface" in AGENTS.md)                                              |
| Board in its own Edge window                           | Board view inside T3 (web, desktop, and mobile through the same RPC)                                                                                                        |

## Board Mode protocol, rule by rule

| #   | Rule                                                                       | In the fork                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Resume from the task, living handoff and parents; verify branch/HEAD first | **Keep.** The verification gets easier: T3 hands over the current branch, HEAD and dirty state, and the handoff's recorded checkpoint ref shows what changed since.                                                                   |
| 2   | One living handoff per task, rewritten in place, fixed shape               | **Keep**, word for word.                                                                                                                                                                                                              |
| 3   | Checkpoint at step end, after decisions, before suggesting a new thread    | **Keep.** The UI label is "Save handoff". The T3 checkpoint ref and repo state are attached automatically.                                                                                                                            |
| 4   | Suggest a fresh chat at boundaries; never start chats yourself             | **Keep, adjusted.** T3 already rescues a thread that overflows its context, so suggest a new thread at **phase** boundaries, not because the chat is long. "Never start threads yourself" stays: the agent offers, the person clicks. |
| 5   | Planning chats: master plan → docs → plan → create modules/tasks           | **Keep.**                                                                                                                                                                                                                             |
| 6   | Decisions at the right level; no verdicts without the person               | **Keep.**                                                                                                                                                                                                                             |
| 7   | Out-of-scope: `board_find`, propose owner, ask a/b/c                       | **Keep.** For option (a), once the person says yes the new task's thread can be launched linked (`t3_thread_launch`), optionally in a worktree.                                                                                       |
| 8   | Recommendations register (R#)                                              | **Keep.**                                                                                                                                                                                                                             |
| 9   | Bugs in finished work → 🐞 fix task                                        | **Keep.**                                                                                                                                                                                                                             |
| 10  | Ownership, soft release, takeover                                          | **Keep.** A "workspace" is a project root or a T3 worktree. A worktree thread on an owned module branches from the module's recorded branch.                                                                                          |
| 11  | Every checkpoint records repo state                                        | **Replace.** It comes from T3's checkpoint and git services. The rule text shrinks to "mention anything not pushed".                                                                                                                  |
| 12  | Token hygiene (logs to `.local-run/logs/<task>/`, tail/grep, file:line)    | **Keep.** It applies to every provider, not just Claude.                                                                                                                                                                              |

The Board Mode text stays **one block**, injected by T3 for linked threads in boards with Board Mode
on, followed by the board's ⚙ Project rules and registers, exactly as `rebuildContext` builds it
today. Wording changes only for rules 3, 4, 7, 10 and 11, plus "chat" → "thread".

## One conflict to handle up front

The `project-board` Claude Code plugin is turned on globally through `CLAUDE_CODE_PLUGIN_DIRS`. Claude
threads that T3 runs would also load it, so they would get the `board_*` tools twice (plugin + T3 MCP)
and report twice. The fork must start Claude threads **without** that plugin, or the plugin must
stand down when it detects it runs under T3. Plain Claude Code chats outside T3 keep the plugin, and
both write the same `board-core` data.
