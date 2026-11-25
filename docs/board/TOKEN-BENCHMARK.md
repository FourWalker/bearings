# Token benchmark: Goal Mode runs

Living file: one row per measured run, rewrite the analysis in place. Not committed.

**How to measure.** A Claude thread started by T3 writes a Claude Code transcript under
`~/.claude/projects/<folder-slug>/<session>.jsonl` (for `C:\nfx`: `C--nfx`). Run
`python .t3/token-benchmark/usage.py <transcript.jsonl> <out.json>`. It sums each model call's usage
once (cache write, cache read, output), prints context growth, a per-tool table with result sizes,
the board calls in order and the largest tool results. "Input-equivalent" = cache write × 1.25 +
cache read × 0.1 + output × 5 (list-price ratios), so runs can be compared without a price list.

## Runs

| Run | Model | Tasks | Wall time | Model calls | Tool calls (errors) | Cache write | Cache read | Output | Input-equiv. | Context start → end |
|---|---|---|---|---|---|---|---|---|---|---|
| NEFX "AP Testbed demo ready", 2026-11-24, whole run: CP6 done, release task done as far as allowed, Goal paused | claude-opus-5-5 | 1 done, 1 left open for the owner | 77 min | 92 | 109 (3) | 176 K | 11.54 M | 53.7 K | 1.64 M | 54 K → 176 K |

Phases of that run:

| Phase | Calls | Cache read | Output | Input-equiv. |
|---|---|---|---|---|
| Orient: Goal start, task, 2 board reads, handoff + README (80 s) | 9 | 0.54 M | 2.6 K | 0.17 M |
| CP6 task: stack up, 3 certification tests, 7 regression cases, reset (33 min) | 65 | 8.08 M | 34.6 K | 1.07 M |
| Release task: checks, one 33-minute wait on test suites, 11 pushes, handoff rewrite, pause (43 min) | 18 | 2.92 M | 16.5 K | 0.40 M |

## What the numbers say

**The board protocol is cheap.** Thirteen board calls in 77 minutes (start, two tasks, two reads, five
decides, done, checkpoint, pause): about 5.8 K characters sent and 18.2 K received, roughly 6 K
tokens once. Carried in context for the rest of the run that is about 0.4 M of the 11.5 M
cache-read tokens, 3 %.
Goal Mode did what it was built for: no per-task link, checkpoint or handoff ceremony between tasks.

**The cost is context size × number of calls, and the harness sets the floor.** The thread starts at
54 K tokens before it has read anything. Almost none of that is the board:
- tool definitions, about 81 K characters, of which the `Artifact` tool alone is 37 K;
- the skill listing, 32 K characters (Postman, engineering and document skills from the owner's
  global Claude Code setup);
- deferred-tool lists 24 K, environment text 9 K, connector instructions 2 K.
Those 54 K are re-read on every one of the 92 calls: 5.0 M cache-read tokens, 43 % of the total. A
Goal thread never uses artifacts, document skills or Postman.

**The agent's own hygiene was good.** 109 tool calls returned 133 K characters in total (about
33 K tokens). Long output went to log files under `C:\nfx\.local-run\logs\` and was read with `-Tail` or
`Select-String`, as the owner's token rules ask. The 33-minute wait for the test suites cost no
model calls: it used `t3_background_wait` and was woken once.

## Wasteful or odd moves seen

- **Read a 16 K-character generator script whole** (`build-collection.py`) to learn the regression
  cases; a search had already listed them. The largest single result of the run.
- **Re-proved a baseline the handoff already states.** It ran the console's test suite, then built a
  temporary worktree of clean `origin/demo` and ran it again to confirm the same 21 failures. About
  8 minutes and 8 calls, plus an `npm install` that forced a console restart. Cause: the handoff
  lists known failures by count only, so the agent could not match them by name.
- **Four small probing queries** to find the invoice table and column in the local database. Cause:
  the kit has no "count invoice rows" helper.
- **Two extra calls to load tools.** Board tools and `t3_background_wait` are deferred in a Claude
  thread, so each needs a search call first.
- **Foreground sleeps** (60 s, 30 s, a few seconds) instead of the kit's watch script. Cheap here.
- **Work outside the task in hand.** While the stack started it rebased the partner-integration
  branches and renumbered their migrations (decision G1), which belongs to the second task. It used
  idle time well and made backup branches first, but it is a history rewrite decided unattended.
- **Done note cut short on the board.** The CP6 result was recorded as one long `done` note; the
  board keeps only its first ~300 characters as the task's last action, so the per-test results are
  readable only in the thread.

## What was fixed after this run (2026-11-24)

**Starting context: 52.5 K → 23.1 K tokens (−56 %), by one provider setting.** Measured with the
same one-turn thread before and after (`.t3/token-benchmark/start-context.py`). The Claude
provider's "Launch arguments" setting (Settings → Providers → Claude) set to:

`--disallowedTools Artifact,ScheduleWakeup,ReportFindings,ListAgents --disable-slash-commands --strict-mcp-config`

| | Before | After |
|---|---|---|
| First-call context | 52,539 tokens | 23,101 tokens |
| Tool definitions | 19 tools, 81 K chars | 14 tools, 32 K chars |
| Skill listing | 32 K chars | gone |
| Deferred-tool lists | 15.6 K chars | 7.3 K chars |

Still present after: T3's own tools (board tools, `t3_background_wait`, `delegate_task`) and the
owner's `CLAUDE.md` rules. Given up: slash-command skills and claude.ai connectors inside T3 Claude
threads. Applied in the dev T3 home only; the owner's installed app keeps its own settings. On a run
like the NEFX Goal (92 calls) this would save about 2.7 M of the 11.5 M cache-read tokens.

**Odd moves.**
- Plan steps and the parent's plan: Goal mode now has a `step` action; `done` leaves named steps
  open and names the parent steps that point at the task (`fd7f86b`).
- Decisions: filed in the board's register as well as on the Goal (`fd7f86b`).
- Done note: kept whole and shown in the Goals view (`fd7f86b`).
- Baseline re-run: `C:\nfx\NEFX\Reference\handoffs\known-failures-origin-demo.md` names the tests
  that fail on clean demo.
- Probing and many small calls: the run's helper scripts are now in the kit
  (`cp6-local\Run-Cp6Postman.ps1`, `Run-Cp6Suites.ps1`, `prep-collection.py`), with the API calls
  and the invoice-row query in the kit README.
- Not changed: deferred tool loading (two search calls cost less than loading every T3 tool up
  front); the unattended rebase (a matter for the Goal's instructions, now possible from the
  Goals screen's instructions box).

## Levers, biggest first

1. Trim what a T3 Claude thread inherits: no `Artifact` tool, no skill listing, fewer plugins for
   provider threads. Worth up to 43 % of cache-read tokens on a run like this.
2. Fewer, larger steps: a kit script that runs a whole certification test would replace about 20 of
   the 65 CP6 calls, each of which re-reads 100 K+ tokens of context.
3. Handoffs that name known failures (file or test names), so a baseline is not re-run.
4. Keep the full done note (or point the task at a results file) so evidence is not lost.
5. Load the board tools up front in Goal threads: saves a call, and the search result text.

## To compare next

Measure the same script against: a finished Goal (both tasks), a Codex Goal run, and a run of the
same tasks without Goal Mode (one thread per task with link, checkpoint and handoff). Dev Board
Goals from 2026-11-23 were Codex threads; their usage is not in a Claude transcript.
