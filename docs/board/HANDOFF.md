# Handoff: Project Board next features

State (2026-11-26). One living file: rewrite in place, never append.

**Objective.** Finish the features in [NEXT-FEATURES.md](NEXT-FEATURES.md) so the owner has a usable
release for NEFX work. Read that brief and [PROGRESS.md](PROGRESS.md) first.

**Repo.** `C:\Claude-Works\t3code-board`, branch `board/continue-integration`, pushed to `origin`
(github.com/FourWalker/t3code-board) on the owner's say-so for this run. Ask again before the next
push or any PR.

**Board.** This fork has its own board since 2026-11-24: id `t3-board` ("Bearings"), 8 features, 37
items, brought up to date on 2026-11-25 (Focus Mode and Bearings identity added);, bugs under Board core › Storage and ids, the release-slots proposal as recommendation R1.
Read it with `node apps/server/src/bin.ts board find --board t3-board "<words>"`. This file stays
the detail; update the board task after it.

**Built and committed** (tests, typecheck, lint pass per package; PROGRESS says what ran live).

- Core: T3 profiles, ranked search, done evidence, Goal Mode inline (`4746e7a` to `2f5e9f5`).
- Live-run fixes: checks and files recorded in the same turn, small Goal gaps (`9c403c0`, `90c5189`).
- A paused Goal releases its modules; new items need a parent (`72b8081`).
- Search: other names, file paths, level, roll-up, superseded, first-turn line (`3e28b3d`).
- Goal delegation to child threads, several at once in worktrees (`89c5a64`, `cad1e25`).
- `board_show`, an agent shows a task in the person's window (`17d8909`); `t3 board` CLI (`f3c7bf7`).
- Board Assistant thread (`814e96d`), Tack, a chat floating over the board (`4b650c5`).
- **Tack's pixel avatar** (`9f4ee0f`): `TackAvatar.tsx` + `tackAvatar.logic.ts`. Nine clips (sleep
  with blanket and pillow, idle, wake, listen, think, write, alert, done, oops), each one image strip
  stepped by CSS (`tack-strip` in `index.css`), paused off screen. Skins and motion level are picked
  from the palette button in Tack's header and kept in local storage (`t3.board.assistant.look`).
  The note clip plays when a `board_create_task` call appears in Tack's thread during a turn.
- **Tack lives on the board** (`73a3287`): `BoardTack.tsx`, chat in `useTackChat.ts`, placement in
  `t3.board.assistant.place` (look menu, "Where Tack lives"). Roamer (default): sleeps in a corner
  at the foot of the panel; click or T wakes it and its speech bubble (a Popover) is the chat.
  Panel host: top of the panel, "N open · N blocked · N to do" and the message box. Floating: the
  old pill, on the board only. Panel tabs "Where things stand | Tack" (full history).
  State: Tack sleeps at home each time the board opens. `tackAwake` is held by `BoardScreen` in
  `BoardPage.tsx`, because a task opened from the board (`openTask`) sends Tack home. While a
  task's dialog is open (`covered`) the bubble, the banners and the floating chat are hidden and
  come back after; notes inside the dialog are not places Tack stands on (`TackOffBoard`). T
  calls Tack on the board and in Floating mode (`useTackKey`). The rest is in
  `TackBoardProvider`: `stand` is the note it is on: set by a
  drop, by `board_show` (`tackShow.ts`; look menu "When Tack points at a task" switches back to
  opening the task), or by a reply newer than the wake that names a task (`tackReplyNote`); it
  stays until another reply names a note or Tack is sent home (Esc, X, a press elsewhere, the
  faint Tack left at home). Sending from any box wakes Tack. The hello shows once per board per
  app run. The note stood on is outlined, scrolls into view, and an edge pointer shows where Tack
  is when scrolled away.
- **Tack's crossing** (`travelTack` in `BoardTack.tsx`, styles at the end of `tack-plotter.css`):
  plays on a fixed layer; the bubble opens on landing. Pixel skins are carried over as they are
  (no new frames drawn). The Plotter's old ink is chased off, its pen crosses on a dotted arc
  (the trail follows the "pen-up hops" setting) and the figure is drawn on landing (`arrival`
  prop). Still or reduced motion: Tack jumps.
- **"Needs you" states** (`3daf580`): `boardAttention.logic.ts` reads each board chat's thread
  the way the sidebar does (`resolveSidebarRowStatus`, `hasUnseenCompletion`) into
  `index.attention` (needs / stopped / finished, by chat session). The note strip, the panel's
  "Needs you" and "Finished, not seen" lists, the Goal lines (`goalStandingOf`: running, needs,
  stopped, stalled, paused, done) and the task's thread list all read it. Opening a task marks
  its subtree's results seen (`useAcknowledgeThreadWoke`); "Mark all seen" clears the list.
  Colour: `--board-attention` (warning; the Plotter theme's rust).
- **Tack in an open task** (`ecd62fc`): `BoardTaskTack.tsx` + `useTaskChat.ts`, inside
  `BoardTaskView` (dialog and master task page; the page's floating chat is gone). A row at the
  task's foot or a column beside it (`t3.board.task.tack.size`). Every chat is a thread on the
  task: a new chat links a new thread to the task before its first turn. "Continue" sends the
  handoff prompt in Run; Ask sends with `approval-required`, Run with the project's default
  mode (`boardThreadRunMode`). Stop, approvals in place (`AssistantApprovals`), a thread menu,
  "Open here" in the Threads tab, last 12 messages with "Show earlier", and the full thread
  one click away. A loaded thread is marked read (`ThreadVisitWatermark`).
- **Tack holds notices** (`1b8d6a0`): `noticesOf` (board.logic) turns the panel's lists and the
  Goals' standing into notices; `TackBoardProvider` announces arrivals (not what stood when the
  board opened, nothing behind an open task) with at most two banners (`TackBanner.tsx`) and
  holds the rest: a count or sign at home, the list on top of Tack's bubble. Avatar:
  `TackAvatar` takes `hold` and `signal`; `ringTack`/`cheerTack` play the alert and done clips
  once. Plotter: drawing `attention` (the scholar with a stamped card; CSS `tp-hail`,
  `tp-glance`, `tp-lift`) while holding; the banner is drawn by a second pen (`drawSlip`,
  `eraseSlip`). Pixel skins: `TackSign` beside the sprite. The design it follows is
  `concepts/tack-notifications-concept.html` (real art; refresh with
  `node docs/board/concepts/build-tack-reference.mjs`).
- **Chat mapping and liveness** (`d5a44e3`, after the owner's NEFX run on 2026-11-25): a chat on
  no task is linked to the last item it creates (`adopt` in `chat.ts`; session `autoLinked`, which
  lets it follow module then task until it changes a file or writes a handoff; no ownership
  claim; "stay unlinked", Tack and Goal threads excluded; a Goal start drops the link), and to a
  task it writes a handoff or checkpoint on by id. `BoardReactor` asks the thread shell whether
  it is busy (`threadBusy` in `BoardChats.ts`: a live run, or background work that holds
  completion) before marking a chat idle, re-checks on `provider-thread.updated` and
  `run.background-work-cancelled`, and a chat opened mid-turn opens working. Tests only: not
  yet watched live with a real background task. Model-facing text changed, no eval run.
- **Tack settings and placement** (`b6f094f`, seen running): the Roamer's corner is the board's
  bottom right by default (`useTackHome` in `tackSettings.ts`; `TackCorner at="board"|"panel"`), the
  side panel hides from a header button (`useBoardPanelOpen`; Tack then lives on the board
  whatever its place), the bubble's grid no longer widens past its edge, and Settings has a Tack
  section (`TackSettingsPanel.tsx`, route `/settings/tack`) with every Tack option, including the
  AI model for Tack on the board and in an open task (`t3.board.assistant.model`, per
  environment, read by `boardThreadModelSelection(…, role)`; applies to new Tack threads only).
  Not checked: a model pick actually starting a thread on that model; the bubble with a real
  long reply. The owner said "side panel on the left": I hid the board's right panel; ask if
  they meant something else.
- **Open task fixes** (`a9df7e1`): a long unbroken line no longer stretches the left column into
  the side column (`wrap-anywhere`, `minmax(0,1fr)` tracks in `BoardTaskView`); the task dialog
  has CSS `resize` (size not remembered, grows from the centre); Ask/Run carries a "Mode" label;
  a Sub Tack idles with a hop every 3.6s when motion is full (`data-lively`). Seen: wrapping, the
  label. Not seen: dragging the resize corner, the idle motion. Proposed to the owner, not
  built: "Outputs" on a task, listed from files the thread wrote and links in its answers.
- **Outputs** (`ffd3944`): `addOutputs` in `chat.ts` lists document files a thread writes and up to three
  links of its final answer as task docs of kind "Output" (newest 20; a removed one is kept off
  by `outputsDropped`). Tests only; not watched with a real thread.
- **Tree deck, order, filters, stars** (`e6d3fd25da`, seen running on the copied NEFX board): the
  Tree view's cards are shut to one line and open in place (`BoardDeck` in `BoardNotes.tsx`); the bar
  and columns are `BoardTree.tsx`, the rules `boardTree.logic.ts` (+ test). Order, Show done and open
  cards per board in `t3.board.tree`; the name and Starred filters last while the board is open.
  `task.json` gains `lastActionAt`, `doneAt` (`stampProgress` in `edit.ts`: the last tick or status
  done, cleared on untick or reopen; the last tick does not change the status) and `starredAt` (edit
  op `star`, people only: no agent tool). A star goes first and stays in view when done. The star
  review opens the first time a board opens each day (`useStarReview`, `t3.board.stars.review`);
  its switch is Settings, Tack, "Starred items", and "Review stars" in the bar opens it by hand.
  Feature cards are open until shut (`shut` in the same prefs); Shut all and Open all act on
  modules (owner, 2026-11-25). Plotter draws the shut card's stamp itself (`data-board-peek-stamp`).
  Design: `concepts/tree-deck-concept.html`. Not seen: the Clay Post theme with shut
  cards, the star in an open task's header, the Settings switch. Not built: mobile, the other views'
  bar, sorting the columns. Starring bumps `updatedAt`, so the column moves left on its own.
- **Worked-on chats and the thread's board tasks** (seen running on the Dev Board copy): a chat
  keeps one linked task (in hand); a plan step it ticks on any task lists it there too, without
  moving the link (`markWorked` in `edit.ts`, `ticked` on the task's `sessions` ref; a person's tick
  in the app maps nothing). The task's Threads list shows those chats after the linked ones
  (`worked` on the board view, `chatsForView`); status and "needs you" still count a chat on its
  linked task only. `BoardReactor.mirrorToThread` writes the task in hand and up to five worked-on
  tasks as the thread's issue links; the link's URL carries level and in-hand
  (`t3board://b/t?level=2&hand=1`, `boardTaskUrl`), so no contract field was added. The sidebar's
  thread hover card lists up to three (`boardThreadLinks.logic.ts`). Removing a worked-on issue in
  T3 takes the chat off that task. The hover card is a paper card in Plotter and Clay Post
  (`[data-slot="tooltip-popup"].dropdown-glass`). Not seen: Plotter night, mobile, the Threads
  list label with a real tick.
- **Checks, reviews, CLI writes** (`19c9c7a08a`, `27bce128f6`, `4553bf3ba4`): `boardChecks.ts` reads
  check results from Claude commands too (no exit code there; `echo "rc $?"` is read from the
  output); replayed over the owner's stored commands, not yet seen live. `board_update review`
  records a read of finished work. `t3 board add|update`. Other names can be removed in the task's
  side column (not seen in a browser). Not recorded: checks run through Claude's PowerShell tool.
- **New board and workspace binding** (2026-11-25, seen running on the Dev Board): a board binds to
  folders; the T3 project is looked up from the folder and never stored (project ids are per
  install, `boards.json` is shared). `BoardCreateDialog.tsx` (picker card, Switch board menu,
  command palette "New board", URL `create=true`) names the board and ticks T3 projects or types
  folders; `BoardService.createBoard` makes a T3 project for each folder without one, as does
  `addRoot`; `workspaceCandidates` lists the server's projects with the board each is on. Board
  settings rows show the path and "T3 project" or "No project here" with Add project (edit op
  `addProject`, handled in the service, not board-core). Board errors now carry `message`, so a
  refusal shows its reason, not "The environment request failed." CLI: `t3 board create <name>
  [--path] [--label]` (no project made: it runs without a server). Not built: a folder browse
  button, "New board from this project" in the project menu, deleting a board, mobile. Not
  checked: the owner's install (does `C:\Claude-Works\t3code-board` have a T3 project there?).
- **Plotter card draw** (`02f758c`, `PlotterCardDraw.tsx`): with the Plotter theme or avatar, an
  opening task or module is drawn first (pen dot on `offset-path: inset()`), then fades in.
- **Plotter skin** (`3e74c49`): `TackPlotter.tsx`, `tackPlotter.logic.ts`, `tack-plotter.css`.
  Original line drawings per clip (scholar reading, ear trumpet, gears, quill, bell, bird,
  inkwell, candle); a pen dot redraws on a drawing change. Pen settings in the look menu, stored
  in `t3.board.assistant.pen`: speed, old ink (chase or retrace), pen-up hops, wobble.
- **Goals screen** (`03adb2d`, `7d33284`): board view `view=goals`, `BoardGoals.tsx`. Start (scope
  picker, order preview, Auto or Ask, workspace), running and paused Goals as lanes, finished Goals
  with done evidence. The board view now carries `groups`, `chats`, `finishedGoals` and each done
  task's `evidence` line (`view.ts`, `contracts/board.ts`, `BoardService.view`).
- **Goals keep the board true** (`fd7f86b`), after the live NEFX Goal left plans unticked:
  `board_goal step` ticks a plan step of a Goal task or a parent; `done` takes `open` (steps to
  leave unticked), keeps the whole note as `doneNote` and names the parent steps pointing at the
  task; `decide` also files the decision in the board's register (verdict marked
  `MODEL_SETTLED`), and a person's verdict there shows on the Goal as `by: person`.
- **Goals screen chat** (`fd7f86b`): instructions box at start; "Discuss first" opens the thread
  without starting the Goal and shows a chat panel with Start now; a Chat toggle on every Goal card
  (`GoalChat`, messages followed only while open); each finished task's full result.
- **Decision types** (`2a1645cc2f`, `1fc5352608`; seen on the Dev Board): a decision's `type` is
  blocker, mandatory (untyped ones; a recommendation reads optional), optional or feature
  (`decisionType` in `store.ts`). Open blocker and mandatory decisions refuse an agent's done
  (`heldFromDone` in `chat.ts`; a person's edit in the app is not held). Skip is a drop whose
  verdict says "Skipped by the person"; Reopen undoes it. A Goal's model never settles a blocker,
  and `nextGoalTask` leaves its tasks out. Web: type select and Skip on the decision card, badges
  count blocker and mandatory, the Pin bar says Blocked only for a blocker and shows the rest as a
  count. Tool list grew 374 bytes (`agentContextBudget.json`).
- **Goals the person controls** (same commits; seen with a seeded Goal, no real thread): Pause and
  End go through `BoardService.stopGoal` (edit op `stopGoal`), which closes the Goal file and
  interrupts its threads. `ended` is final: resume is refused, its tasks are free for a new Goal,
  it lists under Finished. An answer on a Goal card is recorded as the person's verdict in the
  register. Auto mode's rules now say what can't be undone is never the model's to settle.
- **Tack access** (`1fc5352608`): Settings, Tack, "What Tack may do": Board Tack asks, Task Tack
  has full access by default (`t3.board.assistant.access`), read at send time so existing threads
  follow. Ask mode in a task always asks.
- **Board-scoped sidebar** (`1fc5352608`): opening a board sets the sidebar's own project scope to
  the board's projects (`BoardSidebarScope.tsx`, `boardSidebar.logic.ts`); a header button keeps
  "every thread" per board (`t3.board.sidebar.all`).
- **Phone and upright tablet** (`e3cd614749`, seen at 375, 800 and 1280px in five themes, not on a
  device): under 1024px `board-phone.css` folds the chrome into scrolling rows, snaps the columns
  one feature at a time, and turns the side panel into a sheet opened from `BoardPhoneBar`. Tack is
  the Panel host there; in an open task it is a row. Preview with screens and the native app
  proposal: `.t3/previews/mobile-layout-preview.html` (untracked).
- Windows build: the owner's install `Outputs/T3-Project-Board-Frozen-Windows-x64` holds
  `f6fc50bb21` (decision types, Goal controls, compact layout) since 2026-11-26 10:42, swapped in
  on the owner's say-so; ask before the next swap. The app must be closed first: its exe locks the
  folder. Older installs sit there as `win-unpacked.backup-20261126-104212` (161ba9d207),
  `-20261125-210142` (8b8baaec9b), `-181035` (ffd3944), `-121607` (e47a57c), `-103704` (19695a4),
  `-003448` (1b8d6a0), `-20261124-203554` (02f758c), `-143000` (3e74c49), `-090747` (22ad144) and
  `-082118` (fd7f86b). `Outputs/Board-rebuild-d3e1aed94b`, `-c5028dba08` and `-98d0dec660` were
  built and never installed. Not launched by me.

**Verified live this run.** Tack's avatar and look menu on the Dev Board. The Goals screen on the
Dev Board (three finished Goals with evidence) and on the real NEFX board, watching a Goal run by a
Claude thread (`claudeAgent/claude-opus-5-5`): the first Claude provider thread on the board. That
Goal, "AP Testbed demo ready", ran 77 minutes unattended in Auto mode: one task done, five decisions
recorded, then it paused itself with the steps that need the owner. Token use and the agent's
wasteful moves are measured in [TOKEN-BENCHMARK.md](TOKEN-BENCHMARK.md) (script:
`.t3/token-benchmark/usage.py`). NEFX side: `C:\nfx\NEFX Tasks handover\DEMO-TEST-HANDOFF.md`.

**Not built.**

- Goals screen: no model picker (the Goal thread uses the project's default model; start from the
  CLI to choose one, see Commands). Resume is a message to the thread. Launched from the UI on the
  Dev Board (Discuss first, an answer, Start now, finished); resume and an Ask-mode answer on a
  real Goal are untried.
- Tack: web only; no settings-page entry (look menu only); no unprompted visits (a task newly
  blocked, a Goal finished: the concept's events) and no auto-open when Tack waits for an
  approval while its bubble is shut (the bell rings at home). Tack in a task
  (`concepts/tack-in-task-concept.html`): the Wide size, the recap card on a long thread, the
  "start fresh from the handoff" offer, quick chats folded in the thread list and the narrow
  sheet are not built; Ask on a thread that already ran in Run did not stop for approval with
  the Replay provider (untried with a real one). Notices: the app's own toast (Settings, in-app
  notifications, off by default) is silenced on the board only; a banner's click on the board opens the task without Tack walking to
  the note first; the scholar's pose does not re-ring every half minute; chats that run outside
  the app never raise a notice; mobile has none of this. A reply naming a module item (not
  a note) leaves Tack at home; the concept's pointing hand and pen-drawn bubble are not drawn;
  `board_show` from any agent, not only Tack, sends Tack to the note in walk mode (the intent
  carries no thread id); no instant matcher for "open X", no model picker, no allowlist.
- Voice beyond the composer microphone. The native mobile app has no board at all. Other names cannot be listed or removed in the web board.

**Not verified.** Model-behaviour evals: the repo has no `.env` with API keys, and `evals/` has no
board cases, so none ran. Parallel Goal groups live. `WorktreeMcpService.test.ts` has one failing Windows
path test, not confirmed as pre-existing. `node scripts/i18n-check.ts` cannot run `gt generate` on
Windows; new keys were taken from `vp run i18n:generate` output and added to all ten catalogs by hand.

**Decisions and why.**

- Goal Mode replaces Dispatch, Batch and Orchestra; a Goal points at tasks and keeps no status copy.
- A Goal is driven only by its thread. The Goals screen therefore starts that thread and talks to
  it, and never writes the Goal file the executor is also writing.
- Delegation uses T3's `delegate_task`, which already wakes the parent: no new wake-up was built.
- Auto mode settles decisions as "settled by the model"; a person's decision always wins.
- The avatar's timing lives in CSS (`steps()`, run counts, `animationend`), not in timers or
  effects: sleep after four idle loops on the closed pill, hold still after a minute of sleep.
- No authored tags: other names only, saved after a missed search and the person's yes.
- Assistant writes need the person's yes in that turn; it starts supervised.
- Decision skip reuses the dropped status, and Pause and End reuse the `editBoard` RPC: no new
  status, RPC or permission to carry through server, web and mobile.
- No `board_goal` end action, CLI end or palette entry: ending is final and the person's, and a
  model action would add tool text to every thread.
- The sidebar filter is the sidebar's existing project scope, driven by the board; no hidden-thread
  count (it would subscribe the board page to every thread update).
- One compact layout under 1024px for phones and an upright tablet, CSS first; a tablet on its side
  keeps the desktop board. Native board: design only, recommended not to build yet.
- Tack lives on the board, not as an "Ask Tack" button (owner, 2026-11-24): Roamer and Panel host
  both built and selectable, Floating kept as the way back. Concepts in `docs/board/concepts/`.
- Plotter's options stay user settings, as the owner asked: speed, old ink, motion, hops, wobble.
- The "Plotter" theme (`22ad144`, `plotterTheme.ts` + `apps/web/src/plotter.css`) is the concept
  pages' look as a theme, separate from Plotter Tide: grid paper, cream notes on a rust pin, ink
  pins on modules, mono ledger panel, serif titles, day and night. Web and desktop only (in
  `WEB_BUILT_IN_THEMES`, like Plotter Tide Frozen): mobile's generated theme files need
  `vp run generate` in `apps/mobile`, which can't run here (mobile deps missing).

**Starting context.** A T3 Claude thread starts at about 52 K tokens of inherited tools and skill
listings. The Claude provider's Launch arguments `--disallowedTools
Artifact,ScheduleWakeup,ReportFindings,ListAgents --disable-slash-commands --strict-mcp-config` cut
it to 23 K with the board tools intact (measured; see TOKEN-BENCHMARK.md). Set in the dev T3 home
(`.t3/userdata/settings.json`, backup `settings.before-ctx.json`); the owner's install is theirs to set.

**Not fixed.** Model-facing text changed (`board_goal` schema, done and pause replies) with no eval
run. A parent step that names a task is ticked only when the thread ticks it; the `→ (task id)`
marker still auto-syncs. The NEFX board was corrected by one-off scripts (steps, feature last
action, five decisions filed); task files as they were before are in `.t3/nefx-tasks-backup-20261124`.

**Next step.** On the owner's Legion Y700 (Android Chrome): try the compact board (swipe, the
sheet, the keyboard over Tack's box) and fix what the device shows. Then, with a real provider: a
Goal paused, resumed and ended from the Goals screen while its thread runs; Task Tack in Run with
full access; a chat that stays working through background work. Still open: an eval for the changed
model-facing text (no API keys here), the 66 older board strings missing from the catalogs, the
Pin bar's swell and peek never looked at live.

**Commands and traps (Windows).**

- `~/.t3/userdata` is the owner's real T3 data. Always pass `--home-dir` / `--base-dir <clone>\.t3`.
- Dev on the Dev Board copy: `T3_BOARD_HOME=<clone>/.t3/claude-board node_modules/.bin/vp.cmd run dev
  --home-dir <clone>/.t3`. Without `T3_BOARD_HOME` the dev server reads the real boards in
  `~/.claude-board` (used for the NEFX Goal run; `C:\nfx` is a project in the dev T3 home).
- A restarted dev server needs pairing again: open the `pairingUrl` from its log.
- Start a thread on a chosen model: `node apps/server/src/bin.ts thread start --base-dir .t3 --provider
  claudeAgent --model claude-opus-5-5 --json <projectId|path> "<message>"`; read it with `thread show`.
  Editing server, contracts or board-core source restarts the dev server and cancels running turns;
  web-only edits do not.
- Tests: `packages\board-core`: `vp test run --config ../../vite.config.ts --dir .`; `apps\server`:
  `vp test run src/board src/mcp/toolkits/board src/provider/AgentContextBudget.test.ts`; `apps\web`:
  `vp test run src/components/board`; `vp run typecheck` in each package. Root `vp test run` and
  `check:changed` fail (mobile deps missing).
- A longer tool list changes `apps/server/src/provider/agentContextBudget.json`; its test names the value.
- Locale keys: `vp run i18n:generate` in `apps/web` reorders every catalog on Windows. Diff `en.json`
  for the new keys, `git checkout` the catalogs, append the keys by hand in all ten.
- Bash heredocs eat backslashes and break on quotes: write patch scripts to a file, not a heredoc.
- Dev runs under `React.StrictMode` (`main.tsx`): ref callbacks and effects are cycled once on
  mount, the built app does not. Anything started in a ref must survive detach and re-attach.
- The theme's accent is `--app-theme-accent`; `--primary` is a neutral (beige under Plotter).
- The Browser pane runs as a background page when the app window is not open: CSS and WAAPI
  animations do not advance. Step them with `getAnimations()` and `currentTime` to check a frame.
- Build (needs `node_modules/.bin` on PATH for `vp`): `T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=1 node
  scripts/build-desktop-artifact.ts --platform win --target dir --arch x64 --output-dir <folder>`
  (about 5 minutes). Install: rename the install's `win-unpacked` to a dated backup, copy the new one in.

**Resume.** "Read docs/board/HANDOFF.md and continue from Next step."
