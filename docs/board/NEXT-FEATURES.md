# Project Board — next features (design brief)

Status: design agreed in discussion (2026-11-23). Built so far: protocol profiles for plain and
task threads (§9.1–9.3), ranked search with the duplicate check (§2.3, §2.5 in part), done evidence
with verification levels 0–1 (§7.3–7.4), and Goal Mode's inline strategy (§5–§7, §9.4). See
[PROGRESS.md](PROGRESS.md) for what is and is not verified. Goal Mode (§5–§8)
replaces the earlier Dispatch, Batch and Orchestra sections.
Scope: the finished product, not the current repo state. Read alongside
[INTEGRATION.md](INTEGRATION.md), [RECONCILIATION.md](RECONCILIATION.md) and [PROGRESS.md](PROGRESS.md).

Legend: **[Decided]** = the owner's call · **[Proposed]** = suggestion to confirm while implementing.

---

## 0. Guiding principles

1. **The task is the source of truth.** Threads and Goals are execution records that
   point at tasks; they never own them. Living handoffs, decisions and plans stay on the task.
2. **Reconcile through artifacts, not transcripts.** Any agent above another reads the handoff,
   diff and test results — never the child's chat history.
3. **Enforce in code what can be enforced in code.** Checkpoints, ownership/leases, repo-state
   checks and confirmations should not depend on a model obeying prompt text.
4. **One command layer.** UI buttons, CLI, scripts and AI tools all call the same named commands.
5. **Two lanes.** Plain chat for quick work, Board Mode for work that needs memory. A thread can
   move from plain to board at any time.

---

## 1. Plain threads (no Board Mode) — [Decided]

- A **New thread** button starts the standard T3 chat flow with Board Mode **off**.
- Use: clarification questions about code, debugging, quick chats without a task.
- It _can_ still create tasks when asked; the protocol itself stays disabled unless the thread
  starts executing a task.

[Proposed]

- Board tools available **read-only** by default (search/preview); writes only on explicit request.
- **Link to task** action mid-thread: links (or creates) a task, turns Board Mode on from then on,
  and writes the first living handoff from what the chat already found.
- One soft hint, once, if a plain thread starts editing several files or runs long:
  "This looks like real work — link it to a task?" Never repeat.
- Optional **light trace**: when a plain thread commits a small fix, offer a one-line entry on a
  related task/backlog ("fixed X in abc123") — no plan, no checkpoint.
- Visible mode badge on every thread: `Plain` vs `Board: M-12`.
- Plain threads are excluded from task search/relevancy unless linked.

---

## 2. Search + relevancy — [Decided]

Goal: let a model find the existing work it needs, and stop new tasks being created with no
mapping to existing work, without adding prompt overhead.

State today (2026-11-23): no tags exist. `board_find` matches words against title, purpose and id
only, requires every word to match, has no ranking, and returns up to 25 lines.

### 2.1 Derived terms and aliases (no authored tags)

- **Nobody authors tags.** Search uses what already exists: titles, purposes, **plan step names**,
  decision titles, doc titles, parent titles, services, and files touched.
- **Aliases only, attached to a real item** (a service, module or feature): `login`, `jwt` → the
  Auth module. No free-floating tags, no inheritance rules.
- **Aliases are learned from misses**: when a search finds nothing and the person points at the
  right item, offer to save that word as an alias. Saved only with the person's confirmation.
- Matching is deterministic and runs on the server. The alias list is never put in a prompt.

### 2.2 Relevancy states

Used as a mapping/linking filter (e.g. old tasks still usable as reference).

| State      | Meaning                                                            | Search behaviour                                |
| ---------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| active     | being worked on                                                    | full weight                                     |
| stale      | files its handoff covers changed after the handoff's commit (§7.4) | returned, flagged "don't trust handoff blindly" |
| done       | finished, still valid                                              | returned as a **reference card** only           |
| superseded | replaced by another task (`superseded_by` link)                    | skipped; points to its replacement              |

### 2.3 Search behaviour (extend `board_find`, no new tool)

1. Optional `level` hint from the caller ("module", "plan", "task"); the server rolls up by default.
2. Search in one call: aliases, titles, purposes, plan step names, decisions, docs, services.
3. **Rank, don't require every word**: title or alias hit > step name > purpose text.
4. **Roll matches up** the hierarchy: five matching tasks → return their module/feature.
5. Apply relevancy (above).
6. **Search by file path**: "which task touched `refund.ts`?", from checkpoints and done evidence (§7.3).
7. Return in **tiers**: match → summary card (title, status, decisions, how implemented) →
   full handoff only through `board_read`.

Plan steps are searched, so "planned but not yet broken into tasks" is found
(e.g. "covered by steps B2–B4 inside Catalog module M-08").

### 2.4 Answer shapes

- Exact: "Yes — Marketplace module (M-12) has a plan: 4 phases, 2 done." + preview.
- Partial: "No dedicated task, but it's covered as steps B2–B4 in M-08."
- Several: grouped by level, ask which.
- None: "Nothing yet. Closest is Inventory (M-05). Draft a task?" (confirm card).

### 2.5 Search protocol (keeping overhead down)

- **Reply budget**: up to 5 cards of one or two lines each, then "N more".
- **Duplicate check in code**: `board_create_task` runs the search itself and answers
  "similar: M-12, B2–B4 in M-08; create anyway?". No "search before creating" rule in any prompt.
- **A new task needs a parent** or an explicit top-level flag, and inherits its parent's services.
- **First-turn hint**: on the first turn of a plain thread only, and only for a strong match
  (title or alias), the server adds one line: "Possibly related: M-12 Marketplace". Never again in
  that thread, and no per-turn keyword matching.

| Profile (§9)    | Searches when                                                                |
| --------------- | ---------------------------------------------------------------------------- |
| Plain           | the person asks about existing work, or it is about to create a task         |
| Task            | it finds out-of-scope work; never at start (its context is already injected) |
| Goal executor   | once, at planning, to map scope                                              |
| Board Assistant | on most requests; it is its main tool                                        |

---

## 3. Command layer + CLI — [Decided concept]

Board navigation, preview and UI control must be controllable via CLI / script calls / AI.

[Proposed] Named commands, e.g.:

```
board.open(boardId)            view.filter(...)
task.find(query, level?)       task.preview(taskId)
task.createDraft(...)          thread.draftPrompt(threadId, text)
task.execute(taskId, mode?)    view.back()
```

- Buttons, CLI (`t3 board preview T-123`) and AI tools call the same commands.
- Server emits a **UI intent** over the websocket; the open client performs it.
  The AI never manipulates the DOM directly.
- Build this first: Board Assistant, scripting and end-to-end tests all depend on it.

### 3.1 UI intent channel — [Proposed]

Gap (2026-11-23): no server-to-client UI channel exists. The web client has command palette
commands, and composer drafts live in the client. Resolution:

- **No shared command registry** (dropped by the owner, 2026-11-25). An intent is a command name plus
  arguments, nothing else.
- **Addressed to one client.** Every Assistant request carries the id of the client that sent it;
  the server delivers the intent only to that client. Other connected devices do not navigate.
- **Intents never write board data.** They navigate, filter, preview and pre-fill a composer.
  Writes go through the confirmed tools (§4.4).
- **Acknowledged.** The client answers done or failed, so the Assistant can say "→ opened M-12"
  truthfully. An intent expires after a few seconds.
- **No client, no intent.** A call from the CLI, a script or a scheduled run gets a link back.
- `thread.draftPrompt` is an intent: it fills the composer of the target thread on the requesting
  client and never sends.
- Surfaces: web and desktop share the intents. Mobile implements the same intent names, or shows
  the link until it does.

---

## 4. Board Assistant — [Decided concept]

The AI for the whole board: navigation, search, previews, drafting tasks, dispatching execution.
It is **its own thread**, separate from task threads, and never linked to a task.

### 4.1 Input

- **Voice**: mic on, real-time transcription; when the user pauses (expecting a response), the
  transcript is sent as a prompt under the Board Assistant protocol.
  - Live transcript on screen + "→ will do: …" line.
- **Typed**: same thread, opened from the card or a shortcut (e.g. `Ctrl+K`).

[Proposed] Voice reuses T3's existing voice input (see `docs/internals/voice-input.md`); no new
speech engine or capture code.

Exists today (2026-11-23):

- A local speech model on the T3 server (transcribe-cpp, Windows x64 supported), with live
  committed/tentative text over the `/ws/voice` stream on web and desktop.
- Cloud transcription through the server, after recording stops only (no live text).
- Server-side pause detection (Silero), used only to cut audio into chunks.
- Microphone capture with a level meter, consent flow, settings screens, microphone test.
- A voice session whose transcript goes to a **target** (read draft / commit draft), and a
  "send once the transcript lands" path.

To build:

- **Assistant as a voice target**: the transcript goes to the Assistant thread, not a composer.
- **"Speech ended" event** on the stream, from the existing pause detection (~0.8–1.2s of
  silence). The client stops and sends on it. Server-side, because a loudness threshold in the
  client misfires on background noise.
- **Conversation over the stream**: today it is one utterance per socket and recordings cap at 5
  minutes. Reopen the socket per utterance first; extend the protocol only if that is too slow.

Decisions:

- **Engine**: the environment's local model by default; cloud is the push-to-talk fallback.
- **Order**: push-to-talk → auto-send on pause → always-on while in Assistant mode. Wake word
  only if always-on proves useful.
- **Surfaces**: web and desktop first. Mobile and cloud have no live text today, so they start
  as push-to-talk.
- **Spoken replies**: nothing in T3 speaks today. The card is the output; a spoken reply is a
  separate, later feature.

### 4.2 Output — the Assistant card — [Decided]

- A dedicated card shows the response, e.g. "Yes, the task is **Marketplace plan**" while the
  matched task/feature modal opens; or "No task/feature for that yet — create a draft?".
- Works without a voice reader. Can be **expanded into a full chat thread**.

[Proposed] Card states: collapsed (latest reply, auto-fades) · action (buttons, stays until
answered) · expanded (history + text box). Input and output are independent settings
(voice/typed × card-only now, spoken later; see §4.1). Card links are live; show a "→ opened M-12" trace line;
Undo on navigation and drafts. Expanded thread doubles as the debug view (transcript, search, command).

### 4.3 Routing

- [Proposed] Deterministic matcher for simple phrases ("open X", "go back", "next task") — no model.
- Everything else → a fast, cheap model with the Assistant protocol and a small toolset
  (search, preview, navigate, filter, draft task, draft prompt, execute).
- Send **screen state** with every utterance (board, selected task, visible list) so
  "this one" / "the second one" resolve. About ten lines; reuse the composer-context contract if
  it fits.
- Keep the thread short: a fresh Assistant thread per session, since its state lives on the board.
- The matcher resolves to a UI intent (§3.1) and must match the **whole
  utterance**, so a sentence that merely starts with "open" goes to the model.

[Proposed] How the Assistant runs. T3 has no direct model call, so the Assistant is a real thread
on a provider. Consequences and resolution:

- **Model**: the thread's normal model picker, defaulting to the provider's cheapest model.
- **Small toolset**: over 100 server tools are exposed to threads today. The Assistant thread gets
  an **allowlist** (search, read, the intents, draft task, start thread or Goal). First check
  whether a thread can already be limited to named tools; if not, add an "Assistant thread"
  condition to the server's existing per-caller tool enabling.
- **Provider's own tools** (file edits, shell): the Assistant thread runs in plan interaction mode
  with the approval-required runtime mode, so it cannot change code.
- **Speed**: a provider turn takes seconds. The matcher covers the instant cases. Measure the turn
  time before building voice; if it is too slow for conversation, add a direct model call later.

### 4.4 Safety

- Read/navigate: run immediately.
- Write (create task, start thread, send prompt): **confirm card**.
- Writing into another thread = fill its composer, never send.
- Multiple matches → ask, never guess.

[Proposed] Enforced in code:

- **The write tool itself asks.** A write from the Assistant thread creates a pending confirm and
  does nothing until the person answers. It does not rely on the provider's approval behaviour,
  which differs per provider.
- **Send and interrupt are not on the allowlist.** This is what enforces "fill, never send" and
  "starts and reports, never steers" (§5).
- **Open and preview take an id only.** A vague query cannot navigate; search answers "several"
  and the Assistant asks.
- **Voice writes show what was heard.** The confirm card carries the transcript, to catch
  misrecognition.
- **Starting a thread or a Goal is always confirmed**, even when that Goal runs in Auto mode.
- Task text and handoffs the Assistant reads are data, not instructions; with every write
  confirmed, text inside a task cannot trigger one.

---

## 5. Goal Mode — [Decided]

One mode for finishing more than one task: several tasks, a module, or a whole feature. It
replaces the earlier Dispatch, Batch and Orchestra designs, to avoid repeating the per-task
ceremony. "Orchestra" is now just Goal Mode with parallel groups switched on.

- A **Goal** is a board entity. It owns only what is its own: the grouping and order of the work,
  cross-task decisions, and contracts between groups.
- A Goal **points at tasks, it never owns them** (principle 1). Scope is a list of feature, module
  or task ids and may cut across levels. Group progress is derived from the tasks; the Goal keeps
  no copy of task status.
- One **Executor** thread runs the Goal. It is the runner, not the home: if it dies or fills up, a
  fresh thread resumes from the Goal record.
- Plan steps are **grouped**, not one linear list (unless a linear plan fits). The Executor picks a
  strategy per group:

| Strategy  | What happens                                                                                                       | When                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| inline    | The Executor does the work in its own thread                                                                       | small tasks sharing a module/files, no human decision in between        |
| delegated | The Executor starts one child thread through T3's thread control, is woken when it finishes, and reads its handoff | a group that needs its own context, another provider or a cheaper model |
| parallel  | Several child threads or sub-conductors at once                                                                    | independent groups; build last, after measuring the need                |

- The Board Assistant (§4) starts a Goal the same way it starts a single task: find, readiness
  check, confirm card with provider/model picker, launch. It keeps only a pointer + status and
  **starts and reports, never steers**.

[Proposed] for the parallel strategy (from the earlier Orchestra design):

- Group by **dependency cluster**, not by count. Fix **contracts between clusters** up front.
- **One branch/worktree per level**: agent → cluster branch → Goal branch. **Max depth 2.**
- Sub-conductors reconcile their agents and **escalate** cross-cluster decisions; they never decide them.

---

## 6. Running a Goal — [Decided]

- The Executor **runs unattended until blocked**.
- **Auto mode**: where a decision is needed, the Executor proceeds with the model's recommended
  option and writes a **decision row** recording how the model settled it. Rows are marked as
  settled by the model, so they can be reviewed and reversed.
- **Human decisions outrank Auto ones.** If the owner's update contradicts an Auto row, the owner's
  wins and the affected group is re-planned. Auto never overrides a human decision; it blocks.
- Outside Auto mode the Executor queues the question, carries on with groups that are not
  blocked, and never decides for the owner.

[Proposed]

- Existing pieces to reuse (2026-11-23): tools to launch a thread, send to it, wait on it and
  delegate a task exist, and a child's mode is never broader than its parent's. Trace how the
  wait works before building a new wake-up.
- **Server wake-up**: when a child thread's turn settles, or a lease the Goal is waiting on is
  released, the server sends the Executor a short message ("group B done, handoff here"). The
  Executor never polls. Depends on the command layer (§3).
- **Paused is a real state with a reason**: permission prompt in a child thread, rate limit,
  usage cap, open decision, repo state off, "done elsewhere, not merged here".
- A group is marked done **in code**, not by the Executor's say-so: checks pass, handoff written,
  repo clean.
- Inline and delegated groups work on **one branch, one commit per group**. Worktrees and merges
  arrive only with the parallel strategy.

---

## 7. Goal + direct execution (reconcile) — [Decided]

Work done outside the Goal (another team fixes a bug, the owner pulls a task forward and runs a
thread on it directly) must not need manual reconciling. Because the task is the truth, direct
work is already recorded where the Goal reads.

### 7.1 Leases

- A Goal **locks only the group it is executing**. The rest of its scope carries a soft
  "part of Goal G-3" badge. A paused Goal holds nothing.
- Direct run on a Goal's task: if the group is idle, it just runs and logs to `runs[]`. If the Goal
  is running that group, offer "open it" or "take over" (take over pauses that group).
- Priority pull while the Goal runs: the direct thread takes the task's lease; the Goal treats the
  task as blocked on external work, continues with other groups, and is woken on release.
- **One active Goal per task.** A second Goal may reference it once the first is done or releases it.

### 7.2 Drift check (code, no model)

Each group records a baseline when planned: task status, handoff revision, git commit. On resume
and before each group starts, the server compares baseline to now:

| What changed                                       | The Goal does                                          |
| -------------------------------------------------- | ------------------------------------------------------ |
| Task finished elsewhere                            | Marks it done (external), verifies it (§7.4), skips it |
| Handoff or decisions updated                       | Re-reads and re-plans that group only                  |
| Task superseded or removed                         | Drops it and notes it                                  |
| New task under a module in scope                   | Asks "include?"                                        |
| Files touched with no task update                  | Flags the group, re-verifies before building on it     |
| Done on a branch not merged into the Goal's branch | Blocks the group: "done elsewhere, not merged here"    |

Result is one **resume summary** card ("3 done elsewhere, 1 changed, re-planning group C"). In
Auto mode the Goal proceeds and writes the decision row.

### 7.3 "Done" carries evidence

When a task is marked done the server records: the commit, the files touched, and the check that
passed (command + exit code; T3 already records recognized check commands). A task closed by hand
without these is **done, unverified**.

### 7.4 Verification levels — cheapest first

| Level | What runs                                                               | Cost           | When                                               |
| ----- | ----------------------------------------------------------------------- | -------------- | -------------------------------------------------- |
| 0     | Git: commit is on the Goal's branch and those files are unchanged since | none           | always                                             |
| 1     | Re-run the task's recorded check                                        | test time only | files changed since, or the commit is newly merged |
| 2     | A cheap model reads the handoff + the diff of those files only          | small          | no recorded check, or "done, unverified"           |
| 3     | Full reassessment of the code                                           | high           | level 1 or 2 fails, or the owner asks              |

- **Lazy**: on resume, verify only the done tasks the next group depends on or shares files with.
  The rest are covered by the full check run at the end of the Goal.
- **Stale by evidence, not age**: a handoff stores "as of commit X, files A, B, C" and is stale
  when git shows those files changed after X. Refresh = the model reads only the diff since X and
  patches the handoff. This replaces a days-based stale threshold (§2.2).
- Known cost: work done outside the board arrives "done, unverified" and costs one level 2 check
  the first time a Goal depends on it. Tasks with no re-runnable check stay at level 2 whenever
  their files change.

---

## 8. Data model — [Proposed]

```ts
// on Task
runs?: {
  goalId?: string;
  threadId: string;
  role: "thread" | "executor" | "worker" | "sub-conductor";
  attempt: number;
  result?: "done" | "failed" | "stopped";
  at: number;
}[];
doneEvidence?: { commit: string; files: string[]; check?: { command: string; exitCode: number } };

// new entity
interface Goal {
  id: string;
  scope: string[];            // feature / module / task ids
  groups: {
    id: string;
    taskIds: string[];
    dependsOn: string[];
    strategy: "inline" | "delegated" | "parallel";
    baseline: { commit: string; tasks: Record<string, { status: string; handoffRev: string }> };
  }[];
  decisions: Decision[];      // cross-task only; each row says who settled it (person | model)
  executorThreadId: string | null;
  mode: "auto" | "ask";
  status: "planning" | "running" | "paused" | "done" | "failed";
  pausedReason?: string;
}
```

- Leases reuse the existing owner mechanism, per group, released on finish/fail/pause.
- One history across modes: `runs[]` answers "which thread/Goal touched this?"
- New fields optional so old board files keep loading.

---

## 9. Protocol profiles — [Decided: split per thread type]

One protocol for every thread adds overhead where it isn't needed. Each thread type gets its own
profile; a thread changes profile when it is linked to a task or started by a Goal.

State today (2026-11-23): plain threads are already light. Linked threads get the resume summary,
10 tool rules and the full 12-rule Board Mode block, whatever the task's level, and the whole
block is re-sent whenever any part changes. The task's last action changes on almost every turn,
so that is close to every turn (roughly 2,500–3,000 tokens, estimated).

| Profile       | Thread                         | Gets                                                                                |
| ------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| Plain         | not linked to a task           | placement, a few recent tasks, "stay unlinked unless asked", one-line token hygiene |
| Task          | linked to a task               | core rules + task state; situational rules on demand                                |
| Goal executor | runs a Goal                    | Goal protocol + Goal ledger; no per-task Board Mode                                 |
| Goal worker   | child thread started by a Goal | do the group, report once, questions go up                                          |

### 9.1 Shared by all profiles

- **Token hygiene, one line**: long output to a log file, read with tail/grep, reference
  `file:line`, replies = result, files changed, next step.
- **T3 records facts, the model records judgments** (which thread, checks and exit codes, step
  completion, repo state are never the model's job to write down).
- **Static text is sent once** per native thread and again after compaction. Only task or Goal
  state is re-sent, and only when it changed.

### 9.2 Plain

- As built today, plus the hygiene line. A folder on no board gets one line, not the board list.
- No tool rules, no Board Mode. Board tools read-only by default (§1).

### 9.3 Task

- **Core (about six lines)**: resume from the task and its living handoff, verifying repo state
  first · one living handoff, rewritten in place · checkpoint when a step finishes · name steps by
  id and name · record a blocker when found · hygiene.
- **Situational rules arrive in the tool reply when they apply**, not up front:

| Rule                                           | Delivered by                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Ownership, override, takeover, soft release    | `board_link` when it answers BLOCKED; `board_release`                   |
| Out-of-scope work: the a/b/c choices           | `board_find` / `board_create_task`                                      |
| Decision levels, recommendations register (R#) | `board_decision`                                                        |
| Bugs in finished work                          | `board_create_task` with `bug: true`, or an edit attempt on a done task |
| Planning: master plan → docs → plan → tasks    | sent up front only to Level 1–2 tasks, or when the task has no plan     |

- Rules stated in both the tool rules and Board Mode are kept once.
- Changes to this text are model-facing: run the evals in `evals/`.

### 9.4 Goal executor

- **One Goal ledger** holds group progress, cross-task decisions and the resume line. It is the
  Executor's living handoff.
- **Per task, the server writes the completion record**: step ticked, commit, files, check and
  exit code (§7.3). The model adds one line. No plan stub, no checkpoint reply, no per-task
  "suggest a new thread".
- **A full living handoff is written for a task only when** it is left unfinished or blocked, it is
  handed to a child thread, or the Goal pauses.
- Decisions go to the Goal's log with the task ids they affect. In Auto mode a row is **settled by
  the model**, a status of its own, never recorded as a person's verdict (§6).
- Out-of-scope work: no a/b/c question. In scope of the Goal → add to a group. Outside → create a
  task for later, link it, continue.
- Known trade-off: a task finished inside a Goal has a thinner record (commit, files, check, one
  line) than one done in its own thread.

### 9.5 Goal worker

- Receives the group's brief, the contracts it must respect and the relevant handoffs.
- Does the group, then reports **once** with the handoff tool. Questions and out-of-scope finds go
  up to the Executor.
- Never asks the person, suggests new threads, files register entries or changes ownership.

---

## 10. Suggested build order — [Proposed]

1. Search: extended `board_find` (ranking, plan steps, roll-up, relevancy, aliases) + duplicate check on create
2. Command layer + CLI, with the UI intent channel (§3.1)
3. Board Assistant (typed) + card: toolset allowlist and confirmed writes first, then measure turn time
4. Plain threads polish (link-to-task, badge) — if not already done
5. Protocol profiles for Plain and Task (§9.1–9.3): independent of the rest, saves tokens now
6. Done evidence + verification levels 0–1 (§7.3–7.4)
7. Goal Mode, inline strategy, with drift check, leases and the executor profile (§9.4)
8. Goal Mode, delegated strategy (needs the server wake-up) and the worker profile (§9.5)
9. Voice input on web and desktop: push-to-talk, then the "speech ended" event and auto-send (§4.1)
10. Goal Mode, parallel strategy (after measuring how often parallel runs are actually needed)

## 11. Open questions

- Can a thread already be limited to a named set of tools, or does the allowlist need new code (§4.3)?
- Is a provider turn fast enough for a spoken conversation, or is a direct model call needed (§4.3)?
- Parallel cost limits: max parallel agents per plan/subscription tier?
