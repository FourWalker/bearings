import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { BoardTask, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { ChevronDownIcon, PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { boardEnvironment } from "~/state/board";
import { useQuietThreadProjection } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";

import { type BoardIndex, type BoardTaskTab, ancestorsOf } from "./board.logic";
import {
  PIN_CATCHES,
  type PinCatch,
  type PinPeekVerb,
  type PinView,
  type PinWhy,
  lastBoardCallId,
  pinBurstDelayMs,
  pinNeedsYou,
  pinNoticeKey,
  pinPeekRows,
  pinViewOf,
} from "./boardPin.logic";
import { useTackRelease } from "./BoardTack";
import { TackAvatar, useTackLook } from "./TackAvatar";
import { TACK_CELL, TACK_RELEASED } from "./tackAvatar.logic";
import { PLOTTER_SUB_BIRD } from "./tackPlotter.logic";

const PinsSchema = Schema.Record(Schema.String, Schema.String);
const NO_PINS: Readonly<Record<string, string>> = {};

/** The task or module pinned on a board, on this device: one per board. */
export function useBoardPin(boardId: string): [string | null, (taskId: string | null) => void] {
  const [pins, setPins] = useLocalStorage("t3.board.pin", NO_PINS, PinsSchema);
  return [
    pins[boardId] ?? null,
    (taskId) =>
      setPins((previous) => {
        const { [boardId]: _, ...others } = previous;
        return taskId === null ? others : { ...others, [boardId]: taskId };
      }),
  ];
}

const CatchSchema = Schema.Literals(PIN_CATCHES);
export function usePinCatch() {
  return useLocalStorage<PinCatch, PinCatch>("t3.board.pin.catch", "theme", CatchSchema);
}

/** Pins a task to the board's bar, or takes it off: in a task's or module's header. */
export function BoardPinToggle(props: { readonly boardId: string; readonly taskId: string }) {
  const gt = useGT();
  const [pinned, setPinned] = useBoardPin(props.boardId);
  const on = pinned === props.taskId;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-pressed={on}
            aria-label={on ? gt("Unpin") : gt("Pin")}
            onClick={() => setPinned(on ? null : props.taskId)}
          />
        }
      >
        {on ? <PinOffIcon /> : <PinIcon />}
      </TooltipTrigger>
      <TooltipPopup>
        {on ? gt("Take it off the board's bar") : gt("Keep it in view on the board's bar")}
      </TooltipPopup>
    </Tooltip>
  );
}

const TONE: Record<PinWhy, string> = {
  approval: "needs",
  question: "needs",
  decision: "needs",
  blocked: "blocked",
  stopped: "stopped",
  working: "working",
  waiting: "waiting",
  finished: "finished",
  idle: "idle",
  none: "idle",
};

const RING = "M8 22C6 8 30 3 55 4C82 5 97 12 94 23C91 35 62 38 40 37C18 36 5 31 9 17";
const SCRIBBLE = "M1 4C14 1 22 7 36 4S58 1 72 4S90 7 99 3";
const RULE = "M0 3C20 1 40 5 60 3S90 2 100 3";
const RAYS = ["M12 9L4 2", "M12 31L4 38", "M88 9L96 2", "M88 31L96 38", "M95 20L104 20"];

function Mark(props: { readonly kind: string; readonly box: string; readonly paths: string[] }) {
  return (
    <svg data-pin-mark={props.kind} viewBox={props.box} preserveAspectRatio="none" aria-hidden>
      {props.paths.map((d, i) => (
        <path key={d} d={d} pathLength={1} style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}

/** How many times the bar has moved for this notice: once on arrival, then on a slowing schedule. */
function usePinBursts(key: string | null, more: boolean): number {
  const [state, setState] = useState({ key, count: 1 });
  if (state.key !== key) setState({ key, count: 1 });
  const count = state.key === key ? state.count : 1;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wall-clock schedule: the next move is a timer, which lives outside React.
  useEffect(() => {
    if (key === null || !more) return;
    const timer = setTimeout(
      () => setState((current) => (current.key === key ? { key, count: count + 1 } : current)),
      pinBurstDelayMs(count),
    );
    return () => clearTimeout(timer);
  }, [key, count, more]);
  return count;
}

/**
 * Project Board fork: the Pin bar. It sits under the board's header on every board view and says,
 * from the board's files and the chats' own events, where the pinned task or module stands.
 */
export function BoardPinBar(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly index: BoardIndex;
  readonly task: BoardTask;
  /** Chats sitting on background work they started. */
  readonly waiting: ReadonlySet<string>;
  readonly onOpenTask: (task: BoardTask, tab?: BoardTaskTab) => void;
  readonly onUnpin: () => void;
  /** Reads the board again: the chat just ticked a step or saved a handoff. */
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const { index, task } = props;
  const real = pinViewOf(index, task, props.waiting);
  // Dev builds only: localStorage "t3.board.pin.demo" names a state to look at without staging it.
  const demo = import.meta.env.DEV ? window.localStorage.getItem("t3.board.pin.demo") : null;
  const view: PinView = demo !== null && demo in TONE ? { ...real, why: demo as PinWhy } : real;
  const [peek, setPeek] = useState(false);
  const [catching, setCatching] = usePinCatch();
  const [look] = useTackLook();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const motion = reduced ? "still" : look.motion;
  const notice = pinNoticeKey(view);
  // Opening it is seeing it: the bar keeps its colour and stops moving for that notice.
  const [quiet, setQuiet] = useState<string | null>(null);
  const bursts = usePinBursts(notice, motion === "full" && quiet !== notice);
  const moving = notice !== null && catching !== "off" && motion !== "still";

  // The chat is followed only while it is at work or wants something, or the peek is open.
  const follows = view.why !== "idle" && view.why !== "finished" && view.why !== "none";
  const threadId = view.chat?.threadId ?? null;
  const thread = useQuietThreadProjection(
    threadId !== null && (follows || peek) ? scopeThreadRef(props.environmentId, threadId) : null,
  );
  const items = thread?.projection.turnItems ?? [];
  const rows = pinPeekRows(items, 5);
  const boardCall = lastBoardCallId(items);
  const { onChanged } = props;
  const seenCall = useRef(boardCall);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the chat's board tool call landed on the server: the board's files are read again so the tick shows at once.
  useEffect(() => {
    if (boardCall === seenCall.current) return;
    seenCall.current = boardCall;
    if (boardCall !== null) onChanged();
  }, [boardCall, onChanged]);

  const verbs: Record<PinPeekVerb, string> = {
    ran: gt("ran"),
    running: gt("running"),
    edited: gt("edited"),
    searched: gt("searched"),
    tool: gt("tool"),
    board: gt("board"),
    wants: gt("wants to"),
  };
  const chip: Record<PinWhy, string> = {
    approval: gt("Needs approval"),
    question: gt("Asks you"),
    decision: gt("Decision open"),
    blocked: gt("Blocked"),
    stopped: gt("Stopped"),
    working: gt("Working"),
    waiting: gt("Waiting on background work"),
    finished: gt("Finished, not seen"),
    idle: gt("Idle"),
    none: gt("No chat on it"),
  };
  const act =
    view.why === "approval"
      ? gt("Review")
      : view.why === "question"
        ? gt("Answer")
        : view.why === "decision"
          ? gt("Decide")
          : view.why === "blocked"
            ? gt("Open blocker")
            : gt("Open");
  const open = () => {
    setQuiet(notice);
    if (view.why === "blocked" && view.blocker !== null) props.onOpenTask(view.blocker);
    else props.onOpenTask(task, view.why === "decision" ? "decisions" : "threads");
  };
  const top = rows[0];
  const line =
    view.why === "blocked" && view.blocker !== null
      ? gt("by {title}", { title: view.blocker.title })
      : top !== undefined && follows
        ? `${verbs[top.verb]} ${top.text}`
        : (task.lastAction?.text ?? view.chat?.title ?? "");
  const path = ancestorsOf(index, task).map((parent) => parent.title);
  const { slot, progress } = view;
  const pips = progress.total <= 14 ? progress.total : 0;
  const skin = look.skin === "plotter" ? "plotter" : "pixel";

  return (
    <>
      <section
        data-board-pin
        data-pin-tone={TONE[view.why]}
        data-pin-catch={notice !== null && catching !== "off" ? catching : undefined}
        data-pin-skin={skin}
        data-pin-moving={moving ? "" : undefined}
        aria-label={gt("Pinned")}
      >
        {/* The pinned note keeps an outline wherever the board shows it. */}
        <style>{`[data-board-task="${CSS.escape(task.id)}"]{outline:2px solid var(--app-theme-accent,var(--primary));outline-offset:2px}`}</style>
        <span key={`swell-${bursts}`} data-pin-swell aria-hidden />
        <span key={`rule-${bursts}`} className="contents" aria-hidden>
          <Mark kind="rule" box="0 0 100 6" paths={[RULE]} />
        </span>
        <PinIcon className="size-4 text-(--pin-accent)" aria-hidden />
        <button type="button" data-board-pin-what onClick={open}>
          <span
            data-board-panel-kicker
            className="block truncate text-2xs text-muted-foreground uppercase tracking-wide"
          >
            {path.length > 0 ? path.join(" › ") : gt("Pinned")}
          </span>
          <span data-board-task-title className="block truncate font-semibold text-sm">
            {task.title}
          </span>
          <span key={`scribble-${bursts}`} className="contents" aria-hidden>
            <Mark kind="scribble" box="0 0 100 8" paths={[SCRIBBLE]} />
          </span>
        </button>
        <div data-board-pin-plan>
          <div className="flex items-center gap-2">
            {pips > 0 ? (
              <span data-board-pin-pips className="flex gap-0.75" aria-hidden>
                {Array.from({ length: pips }, (_, i) => (
                  <span
                    key={i}
                    data-board-pin-pip={
                      i < progress.done ? "done" : i === progress.done ? "next" : "open"
                    }
                  />
                ))}
              </span>
            ) : null}
            <span className="whitespace-nowrap font-mono text-2xs text-muted-foreground">
              {progress.unit === "tasks"
                ? gt("{done}/{total} tasks", { done: progress.done, total: progress.total })
                : `${progress.done}/${progress.total}`}
            </span>
          </div>
          <div
            // A new step in hand slides in; the same one never moves.
            key={slot.kind === "step" ? slot.id : slot.kind === "task" ? slot.task.id : slot.kind}
            data-board-pin-step
            className="truncate text-xs"
          >
            <span className="mr-1 text-(--pin-accent)" aria-hidden>
              {slot.kind === "done" ? "✓" : "▸"}
            </span>
            {slot.kind === "step" ? (
              <>
                <b className="mr-1 font-semibold">{slot.id}</b>
                {slot.text}
              </>
            ) : slot.kind === "task" ? (
              gt("Task in hand: {title}", { title: slot.task.title })
            ) : slot.kind === "done" ? (
              progress.unit === "tasks" ? (
                gt("Every task is done")
              ) : (
                gt("Every step is ticked")
              )
            ) : (
              gt("No plan yet")
            )}
          </div>
        </div>
        <div data-board-pin-now className="flex min-w-0 items-center gap-2">
          <span className="relative inline-flex shrink-0">
            <span key={`chip-${bursts}`} data-pin-quake className="inline-flex">
              <span data-board-pin-chip={TONE[view.why]}>
                {chip[view.why]}
                {view.others > 0 ? ` +${view.others}` : ""}
                <Mark kind="ring" box="0 0 100 40" paths={[RING]} />
                <Mark kind="rays" box="0 0 100 40" paths={RAYS} />
              </span>
            </span>
            {notice !== null && catching === "tack" && look.skin !== "emoji" ? (
              <PinSubTack key={notice} bursts={bursts} still={motion === "still"} />
            ) : null}
          </span>
          <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">{line}</span>
        </div>
        <div data-board-pin-acts className="flex items-center gap-1">
          <Button variant={pinNeedsYou(view.why) ? "default" : "outline"} size="xs" onClick={open}>
            {act}
          </Button>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-expanded={peek}
            aria-label={gt("Peek")}
            onClick={() => setPeek(!peek)}
          >
            <ChevronDownIcon />
          </Button>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Unpin")}
            onClick={props.onUnpin}
          >
            <XIcon />
          </Button>
        </div>
      </section>
      {peek ? (
        <div className="relative z-2 grid border-b bg-card text-xs sm:grid-cols-[1.2fr_1fr]">
          <section className="min-w-0 p-3">
            <h4
              data-board-panel-kicker
              className="mb-1.5 text-2xs text-muted-foreground uppercase tracking-wide"
            >
              {gt("What the agent is doing")}
            </h4>
            {rows.length > 0 ? (
              <ul className="grid gap-0.5 font-mono">
                {rows.map((row) => (
                  <li key={row.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                    <span className="text-muted-foreground">{verbs[row.verb]}</span>
                    <span className="truncate">{row.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {task.lastAction?.text ?? gt("Nothing has run on this yet.")}
              </p>
            )}
          </section>
          <PinPlan
            environmentId={props.environmentId}
            boardId={props.boardId}
            taskId={slot.kind === "task" ? slot.task.id : task.id}
          />
          <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-dashed px-3 py-1.5 text-muted-foreground">
            <span>{gt("Catch my eye when it needs me")}</span>
            <ToggleGroup
              aria-label={gt("Catch my eye when it needs me")}
              value={[catching]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "off" || value === "theme" || value === "tack") setCatching(value);
              }}
            >
              <Toggle value="off">{gt("Off")}</Toggle>
              <Toggle value="theme">{gt("By theme")}</Toggle>
              <Toggle value="tack">{gt("By Tack")}</Toggle>
            </ToggleGroup>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The plan of the item in hand, read while the peek is open. */
function PinPlan(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: string;
  readonly taskId: string;
}) {
  const gt = useGT();
  const detail = useEnvironmentQuery(
    boardEnvironment.taskDetail({
      environmentId: props.environmentId,
      input: { boardId: props.boardId, taskId: props.taskId },
    }),
  ).data;
  const steps = detail?.plan.flatMap((phase) => phase.steps) ?? [];
  const current = steps.findIndex((step) => !step.done);
  return (
    <section className="min-w-0 border-t p-3 sm:border-t-0 sm:border-l">
      <h4
        data-board-panel-kicker
        className="mb-1.5 text-2xs text-muted-foreground uppercase tracking-wide"
      >
        {gt("Plan")}
      </h4>
      {steps.length > 0 ? (
        <ul className="grid max-h-40 gap-0.5 overflow-y-auto font-mono">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className={
                step.done
                  ? "grid grid-cols-[1rem_2.25rem_minmax(0,1fr)] gap-1.5 text-muted-foreground"
                  : i === current
                    ? "grid grid-cols-[1rem_2.25rem_minmax(0,1fr)] gap-1.5 text-(--pin-accent)"
                    : "grid grid-cols-[1rem_2.25rem_minmax(0,1fr)] gap-1.5"
              }
            >
              <span aria-hidden>{step.done ? "✓" : i === current ? "▸" : "·"}</span>
              <span>{step.id}</span>
              <span className="truncate">{step.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{gt("No plan yet")}</p>
      )}
    </section>
  );
}

const SUB_SCALE = 2;
const BIRD_SIZE = 46;

/**
 * A Sub Tack: Tack stays where it is and releases a small Tack that stands on top of the bar, above
 * the state chip, and makes the fuss there. It leaves from Tack once Tack's release has played.
 */
function PinSubTack(props: { readonly bursts: number; readonly still: boolean }) {
  const [look] = useTackLook();
  const release = useTackRelease();
  const plotter = look.skin === "plotter";
  const [phase, setPhase] = useState<"wait" | "fly" | "land">(props.still ? "land" : "wait");
  const host = useRef<HTMLSpanElement>(null);
  const { still } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks Tack (elsewhere on the page) to play its release, measures where Tack stands, and waits for its animation's event.
  useEffect(() => {
    const element = host.current;
    if (element === null || still) return;
    const here = element.getBoundingClientRect();
    const bar = element.closest("[data-board-pin]")?.getBoundingClientRect();
    element.style.setProperty("--sub-run", `${Math.max(60, here.left - (bar?.left ?? 0) - 36)}px`);
    const tack = document.querySelector<HTMLElement>("[data-tack-self]")?.getBoundingClientRect();
    const go = () => setPhase((current) => (current === "wait" ? "fly" : current));
    if (release === null || tack === undefined || tack.width === 0) {
      go();
      return;
    }
    // The Plotter's bird leaves from the note it was sketched in; a pixel one from Tack's head.
    const from = plotter
      ? { x: tack.left + tack.width * 0.43, y: tack.top + tack.height * 0.69 }
      : { x: tack.left + tack.width / 2, y: tack.top + tack.height * 0.3 };
    element.style.setProperty("--sub-fx", `${from.x - (here.left + here.width / 2)}px`);
    element.style.setProperty("--sub-fy", `${from.y - (here.top + here.height / 2)}px`);
    release();
    window.addEventListener(TACK_RELEASED, go);
    // Tack may be unable to play it (covered, still, mid-crossing): the Sub Tack goes anyway.
    const fallback = setTimeout(go, plotter ? 8000 : 1500);
    return () => {
      window.removeEventListener(TACK_RELEASED, go);
      clearTimeout(fallback);
    };
  }, [release, plotter, still]);

  const width = plotter ? BIRD_SIZE : TACK_CELL.width * SUB_SCALE;
  return (
    <span
      ref={host}
      aria-hidden
      data-subtack={plotter ? "plotter" : "pixel"}
      data-phase={phase}
      // Between bursts it keeps a small life of its own, unless Tack is set to move less.
      data-lively={look.motion === "full" && !still ? "" : undefined}
      style={{ "--sub-w": `${width}px`, "--sub-from-scale": plotter ? 0.5 : 0.2 } as CSSProperties}
      onAnimationEnd={(event) => {
        if (event.animationName === "subtack-fly") setPhase("land");
      }}
    >
      <span key={props.bursts} data-subtack-walk className="relative">
        <span data-subtack-jump>
          <span data-subtack-face>
            {plotter ? (
              <svg data-subtack-bird width={BIRD_SIZE} height={BIRD_SIZE} viewBox="0 0 60 60">
                {PLOTTER_SUB_BIRD.filter((stroke) => stroke.part === undefined).map((stroke) => (
                  <path key={stroke.d} d={stroke.d} data-tone={stroke.tone} />
                ))}
                <g data-part="wing">
                  {PLOTTER_SUB_BIRD.filter((stroke) => stroke.part === "wing").map((stroke) => (
                    <path key={stroke.d} d={stroke.d} data-tone={stroke.tone} />
                  ))}
                </g>
              </svg>
            ) : (
              <TackAvatar
                skin={look.skin}
                motion={still ? "still" : "full"}
                mood="idle"
                scale={SUB_SCALE}
                signal={{ at: phase === "land" ? props.bursts : 0, kind: "ring" }}
              />
            )}
          </span>
        </span>
        {!plotter && phase === "land" ? <span data-subtack-bang>!</span> : null}
      </span>
    </span>
  );
}
