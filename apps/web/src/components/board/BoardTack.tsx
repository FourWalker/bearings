import type { BoardTask, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { createContext, use, useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { Popover, PopoverPopup } from "~/components/ui/popover";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import {
  HeaderButton,
  TackComposer,
  TackLookMenu,
  TackMessages,
  TackThreadButtons,
} from "./BoardAssistant";
import { latestExchange } from "./board.logic";
import { TackAvatar, useTackLook } from "./TackAvatar";
import {
  latestTackText,
  TACK_PLACES,
  tackFocusTask,
  tackHopMs,
  type TackPlace,
} from "./tackPlace.logic";
import { registerTackShow } from "./tackShow";
import { type TackChat, type TackChatProps, type TackView, useTackChat } from "./useTackChat";

const PlaceSchema = Schema.Literals(TACK_PLACES);

/** Where Tack lives on this device's boards. */
export function useTackPlace() {
  return useLocalStorage<TackPlace, TackPlace>("t3.board.assistant.place", "roam", PlaceSchema);
}

export const TACK_SHOW_MODES = ["walk", "open"] as const;
export type TackShowMode = (typeof TACK_SHOW_MODES)[number];
const ShowSchema = Schema.Literals(TACK_SHOW_MODES);

/** When an agent shows a task: Tack walks to its note, or the task opens at once. */
export function useTackShowMode() {
  return useLocalStorage<TackShowMode, TackShowMode>("t3.board.assistant.show", "walk", ShowSchema);
}

type AnchorKind = "corner" | "host" | "note";
type Offscreen = "up" | "down" | "left" | "right";

interface TackBoard {
  readonly chat: TackChat;
  readonly place: Exclude<TackPlace, "float">;
  readonly setPlace: (place: TackPlace) => void;
  readonly environmentId: EnvironmentId;
  readonly boardName: string;
  /** The note Tack is standing on while it talks, or null when it is at home. */
  readonly focus: string | null;
  readonly focusTitle: string | null;
  /** The note that actually rendered Tack; the home shows Tack until one does. */
  readonly landed: string | null;
  readonly land: (update: (current: string | null) => string | null) => void;
  readonly anchor: { readonly element: HTMLElement; readonly kind: AnchorKind } | null;
  readonly setAnchor: (element: HTMLElement | null, kind: AnchorKind) => void;
  readonly tab: "stand" | "tack";
  readonly setTab: (tab: "stand" | "tack") => void;
  readonly askAbout: (task: BoardTask) => void;
  /** Which way Tack is when its note has scrolled out of view, or null while it is in view. */
  readonly offscreen: Offscreen | null;
  readonly setOffscreen: (offscreen: Offscreen | null) => void;
}

const TackBoardContext = createContext<TackBoard | null>(null);

/**
 * Project Board fork: Tack living on the board rather than in a floating chat. Its home is in the
 * panel; while it talks about a note it stands on that note, and its speech bubble is the chat.
 */
export function TackBoardProvider(
  props: TackChatProps & {
    readonly place: Exclude<TackPlace, "float">;
    readonly setPlace: (place: TackPlace) => void;
    readonly tasks: ReadonlyArray<BoardTask>;
    readonly children: ReactNode;
  },
) {
  const gt = useGT();
  const [tab, setTab] = useState<"stand" | "tack">("stand");
  const chat = useTackChat(props, { follow: tab === "tack" });
  const [asked, setAsked] = useState<string | null>(null);
  // Tack sleeps at home whenever the board opens, even if its chat was left open last time.
  const [awake, setAwake] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const [offscreen, setOffscreen] = useState<Offscreen | null>(null);
  const [anchor, setAnchorState] = useState<TackBoard["anchor"]>(null);
  const [showMode] = useTackShowMode();
  const view: TackView = awake ? chat.view : "closed";
  const open = view !== "closed";
  const latest = chat.bubbles.at(-1);
  // The last message when Tack woke: only a reply newer than it sends Tack to a note, so an
  // old reply never pulls Tack back there.
  const [wokeAfter, setWokeAfter] = useState<string | null | undefined>(undefined);
  if (open && chat.loaded && wokeAfter === undefined) setWokeAfter(latest?.id ?? null);
  if (!open && wokeAfter !== undefined) setWokeAfter(undefined);
  const replyFocus =
    wokeAfter !== undefined && latest !== undefined && latest.id !== wokeAfter
      ? tackFocusTask(latestTackText(chat.bubbles), props.tasks)
      : null;
  const focus = open ? (asked ?? replyFocus) : null;
  const focusTitle = props.tasks.find((task) => task.id === focus)?.title ?? null;
  // Stable, because Tack's elements report themselves through ref callbacks built on these.
  const setAnchor = useStableCallback((element: HTMLElement | null, kind: AnchorKind) =>
    setAnchorState((current) =>
      element === null
        ? current?.kind === kind
          ? null
          : current
        : current?.element === element
          ? current
          : { element, kind },
    ),
  );

  const setView = (next: TackView) => {
    if (next === "closed") setAsked(null);
    setAwake(next !== "closed");
    chat.setView(next);
  };

  const callTack = useEffectEvent(() => setView("open"));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a window-wide shortcut calls Tack
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "t" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      event.preventDefault();
      callTack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showTask = useEffectEvent((boardId: string, taskId: string) => {
    if (boardId !== props.boardId || showMode !== "walk" || !chat.canAsk) return false;
    if (document.querySelector(`[data-board-task="${CSS.escape(taskId)}"]`) === null) return false;
    setAsked(taskId);
    setView("open");
    return true;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- board tools reach Tack through a module-level channel
  useEffect(() => registerTackShow((boardId, taskId) => showTask(boardId, taskId)), []);

  const value: TackBoard = {
    chat: {
      ...chat,
      view,
      setView,
      send: async (text) => {
        setAsked(null);
        await chat.send(text);
      },
    },
    place: props.place,
    setPlace: props.setPlace,
    environmentId: props.environmentId,
    boardName: props.boardName,
    focus,
    focusTitle,
    landed,
    land: setLanded,
    anchor,
    setAnchor,
    tab,
    setTab,
    askAbout: (task) => {
      setAsked(task.id);
      chat.setDraft(gt("About “{title}”: ", { title: task.title }));
      setView("open");
    },
    offscreen,
    setOffscreen,
  };
  if (!chat.canAsk) return props.children;
  return (
    <TackBoardContext value={value}>
      {props.children}
      <TackBubble />
    </TackBoardContext>
  );
}

function useTackBoard() {
  return use(TackBoardContext);
}

let lastTackRect: DOMRect | null = null;

/** Records where Tack now stands and returns where it stood before. Kept out of the component so
    the React Compiler cannot fold the read into the write (it did, and every hop had length 0). */
function moveTackRect(rect: DOMRect): DOMRect | null {
  const from = lastTackRect;
  lastTackRect = rect;
  return from;
}

/**
 * Tack's hop from where it last stood to where it now is. A copy flies on a fixed layer, since
 * the board and the panel scroll separately and would each clip Tack on the way.
 */
function fly(element: HTMLElement, from: DOMRect, to: DOMRect) {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const distance = Math.hypot(dx, dy);
  if (distance < 4) return;
  const duration = tackHopMs(distance);
  const ghost = element.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-tack-figure");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    margin: "0",
    zIndex: "200",
    pointerEvents: "none",
  });
  document.body.append(ghost);
  element.style.visibility = "hidden";
  const animation = ghost.animate(
    [
      { translate: `${dx}px ${dy}px` },
      { translate: `${dx / 2}px ${dy / 2 - Math.min(64, distance * 0.18)}px` },
      { translate: "0 0" },
    ],
    { duration, easing: `steps(${Math.max(6, Math.round(duration / 70))})` },
  );
  const land = () => {
    ghost.remove();
    element.style.visibility = "";
  };
  animation.onfinish = land;
  animation.oncancel = land;
}

/** Tack itself: wherever it mounts, it hops there from where it last stood. */
function TackFigure(props: { readonly kind: AnchorKind; readonly scale: number }) {
  const gt = useGT();
  const board = useTackBoard();
  const [look] = useTackLook();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const hops = !reduced && look.motion !== "still";
  const setAnchor = board?.setAnchor;
  const { kind } = props;
  const place = useStableCallback((element: HTMLButtonElement | null) => {
    if (element === null) return;
    setAnchor?.(element, kind);
    // A note Tack lands on is brought into view, so the person sees where it went.
    if (kind === "note") element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const from = moveTackRect(rect);
    if (hops && from !== null) fly(element, from, rect);
    return () => {
      // Where Tack was when it left; skipped once it is detached and measures as zero.
      const leaving = element.getBoundingClientRect();
      if (leaving.width > 0) moveTackRect(leaving);
      setAnchor?.(null, kind);
    };
  });
  if (board === null) return null;
  const { chat } = board;
  return (
    <button
      type="button"
      data-tack-figure={props.kind}
      aria-label={gt("Tack")}
      draggable
      className="block cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      ref={place}
      onClick={() => {
        if (chat.view === "closed") chat.setView("open");
        // On a note Tack keeps talking there; at home a click puts it back to rest.
        else if (kind !== "note") chat.setView("closed");
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-tack", "tack");
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <TackAvatar
        skin={look.skin}
        motion={look.motion}
        mood={chat.mood}
        notes={chat.notes}
        scale={props.scale}
        from="rest"
      />
    </button>
  );
}

/** Tack standing on a note's top edge while it talks about it. Every note renders one. */
export function TackPerch(props: { readonly taskId: string }) {
  const board = useTackBoard();
  const land = board?.land;
  const setOffscreen = board?.setOffscreen;
  const { taskId } = props;
  const perch = useStableCallback((element: HTMLSpanElement | null) => {
    if (element === null) return;
    land?.(() => taskId);
    // Watches whether the person scrolled Tack out of view, for the pointer at the board's edge.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) return;
        const box = entry.boundingClientRect;
        const view = entry.rootBounds;
        setOffscreen?.(
          entry.isIntersecting || view === null
            ? null
            : box.bottom < view.top
              ? "up"
              : box.top > view.bottom
                ? "down"
                : box.right < view.left
                  ? "left"
                  : "right",
        );
      },
      { root: element.closest("[data-board-surface]"), threshold: 0.5 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setOffscreen?.(null);
      land?.((current) => (current === taskId ? null : current));
    };
  });
  if (board === null || board.focus !== props.taskId) return null;
  return (
    <span
      data-tack-perch
      ref={perch}
      // The cell's two empty bottom rows sit below the note's top edge, so Tack stands on it.
      className="pointer-events-auto absolute -top-[36px] end-3 z-10 scroll-mt-12"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <TackFigure kind="note" scale={2} />
    </span>
  );
}

const POINTER_ICONS = {
  up: ArrowUpIcon,
  down: ArrowDownIcon,
  left: ArrowLeftIcon,
  right: ArrowRightIcon,
} as const;

/** Shown at the board's edge while Tack stands on a note scrolled out of view. */
function TackPointer(props: { readonly direction: Offscreen; readonly title: string | null }) {
  const gt = useGT();
  const Icon = POINTER_ICONS[props.direction];
  return (
    <div
      className={cn(
        "pointer-events-none sticky z-20 flex h-0 justify-center",
        props.direction === "down" ? "bottom-10" : "top-2",
      )}
    >
      <button
        type="button"
        data-tack-pointer={props.direction}
        className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-popover px-3 text-xs shadow-md hover:bg-accent"
        onClick={() =>
          document
            .querySelector("[data-tack-perch]")
            ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
        }
      >
        <Icon className="size-3.5" />
        {props.title === null
          ? gt("Tack is over here")
          : gt("Tack is at {title}", { title: props.title })}
      </button>
    </div>
  );
}

/** The board surface. Notes take Tack dropped on them: Tack is then asked about that note. */
export function TackDropSurface(props: {
  readonly tasks: ReadonlyArray<BoardTask>;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const board = useTackBoard();
  const carriesTack = (event: React.DragEvent) =>
    board !== null && event.dataTransfer.types.includes("application/x-tack");
  return (
    <div
      data-board-surface
      className={props.className}
      onDragOver={(event) => {
        if (carriesTack(event)) event.preventDefault();
      }}
      onDrop={(event) => {
        if (board === null || !carriesTack(event)) return;
        event.preventDefault();
        const id = (event.target as HTMLElement)
          .closest("[data-board-task]")
          ?.getAttribute("data-board-task");
        const task = props.tasks.find((candidate) => candidate.id === id);
        if (task !== undefined) board.askAbout(task);
      }}
    >
      {board?.offscreen != null && board.offscreen !== "down" ? (
        <TackPointer direction={board.offscreen} title={board.focusTitle} />
      ) : null}
      {props.children}
      {board?.offscreen === "down" ? (
        <TackPointer direction="down" title={board.focusTitle} />
      ) : null}
    </div>
  );
}

/** Is Tack at home, i.e. not standing on the note it is talking about? */
function atHome(board: TackBoard) {
  return board.focus === null || board.landed !== board.focus;
}

/** The Roamer's home: a round frosted nest at the foot of the panel where Tack sleeps. */
export function TackCorner(props: { readonly active: number; readonly blocked: number }) {
  const gt = useGT();
  const board = useTackBoard();
  // Tack says hello once each time the board opens; the bubble fades out by itself.
  const [greeted, setGreeted] = useState(false);
  if (board === null || board.place !== "roam") return null;
  const home = atHome(board);
  const { chat } = board;
  return (
    <div
      data-tack-home="corner"
      className="pointer-events-none sticky bottom-0 mt-4 flex justify-end pt-2"
    >
      <div className="relative">
        {!greeted && home && chat.view === "closed" ? (
          <button
            type="button"
            data-tack-greeting
            className="tack-greeting pointer-events-auto absolute end-2 bottom-full mb-2 w-56 rounded-xl border bg-popover px-3 py-2 text-start text-xs shadow-md"
            onAnimationEnd={() => setGreeted(true)}
            onClick={() => {
              setGreeted(true);
              chat.setView("open");
            }}
          >
            {props.blocked > 0
              ? gt("Hi, I'm Tack. {active} open, {blocked} blocked. Click me or press T to talk.", {
                  active: props.active,
                  blocked: props.blocked,
                })
              : gt("Hi, I'm Tack. {active} open, nothing blocked. Click me or press T to talk.", {
                  active: props.active,
                })}
          </button>
        ) : null}
        <div className="pointer-events-auto grid size-28 place-items-center rounded-full border bg-card/55 shadow-sm backdrop-blur-md">
          {home ? <TackFigure kind="corner" scale={3} /> : null}
        </div>
      </div>
    </div>
  );
}

/** The Panel host's home: Tack at the top of the panel, saying where things stand. */
export function TackHost(props: {
  readonly active: number;
  readonly blocked: number;
  readonly todo: number;
}) {
  const gt = useGT();
  const board = useTackBoard();
  if (board === null || board.place !== "host") return null;
  const home = atHome(board);
  const { chat } = board;
  const line = !home
    ? gt("Over at {title}.", { title: board.focusTitle ?? "" })
    : chat.busy
      ? gt("Checking the board…")
      : chat.waiting
        ? gt("I need your answer.")
        : gt("{active} open · {blocked} blocked · {todo} to do", props);
  return (
    <div data-tack-home="host" className="mb-4 grid gap-2 border-b pb-3">
      <div className="flex items-end gap-2">
        <div className="grid min-h-[60px] min-w-[78px] place-items-end">
          {home ? <TackFigure kind="host" scale={3} /> : null}
        </div>
        <p className="min-w-0 flex-1 pb-1 text-sm">{line}</p>
      </div>
      <TackComposer chat={chat} />
    </div>
  );
}

/** The panel's two tabs when Tack lives on the board: where things stand, and Tack's history. */
export function TackPanelTabs(props: { readonly stand: ReactNode }) {
  const gt = useGT();
  const board = useTackBoard();
  if (board === null) return props.stand;
  const tabs = [
    ["stand", gt("Where things stand")],
    ["tack", gt("Tack")],
  ] as const;
  return (
    <>
      <div role="tablist" className="mb-3 flex gap-1 border-b">
        {tabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={board.tab === tab}
            data-active={board.tab === tab ? "" : undefined}
            className={cn(
              "-mb-px border-b-2 px-2 pb-1.5 text-sm",
              board.tab === tab
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => board.setTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {board.tab === "stand" ? props.stand : <TackHistory />}
    </>
  );
}

/** Tack's whole conversation, in the panel. */
function TackHistory() {
  const board = useTackBoard();
  const [look, setLook] = useTackLook();
  const [showMode, setShowMode] = useTackShowMode();
  if (board === null) return null;
  const { chat } = board;
  return (
    <div className="grid min-h-0 gap-2">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {board.boardName}
        </span>
        <TackLookMenu
          skin={look.skin}
          motion={look.motion}
          onSkin={(skin) => setLook((previous) => ({ ...previous, skin }))}
          onMotion={(motion) => setLook((previous) => ({ ...previous, motion }))}
          place={board.place}
          onPlace={board.setPlace}
          show={showMode}
          onShow={setShowMode}
        />
        <TackThreadButtons chat={chat} />
      </div>
      <TackMessages
        chat={chat}
        environmentId={board.environmentId}
        bubbles={chat.bubbles}
        className="px-0"
      />
      {board.place === "roam" ? <TackComposer chat={chat} /> : null}
    </div>
  );
}

/** Tack's speech bubble: the latest exchange, next to wherever Tack stands. */
function TackBubble() {
  const gt = useGT();
  const board = useTackBoard();
  const [look, setLook] = useTackLook();
  const [showMode, setShowMode] = useTackShowMode();
  if (board === null) return null;
  const { chat, anchor } = board;
  const open = chat.view !== "closed" && anchor !== null && board.tab !== "tack";
  const side = anchor?.kind === "note" ? "right" : anchor?.kind === "corner" ? "top" : "bottom";
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // Focus moving off the bubble is not leaving it: clicking Tack, the board or another
        // window moves focus, and only a press elsewhere, Escape or the close button sends Tack home.
        if (details.reason === "focus-out") return;
        // A click on Tack toggles the bubble itself; outside presses elsewhere close it.
        const target = details.event.target;
        if (target instanceof Node && anchor?.element.contains(target)) return;
        // Following the pointer to Tack is not leaving the conversation.
        if (target instanceof Element && target.closest("[data-tack-pointer]") !== null) return;
        chat.setView("closed");
      }}
    >
      <PopoverPopup
        anchor={anchor?.element ?? null}
        side={side}
        align={side === "top" ? "end" : "start"}
        sideOffset={8}
        padding="compact"
        width="md"
        initialFocus={board.place === "roam"}
        finalFocus={false}
      >
        <div data-tack-bubble className="grid gap-2">
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate font-medium text-sm">
              {board.focusTitle ?? gt("Tack")}
            </span>
            <TackLookMenu
              skin={look.skin}
              motion={look.motion}
              onSkin={(skin) => setLook((previous) => ({ ...previous, skin }))}
              onMotion={(motion) => setLook((previous) => ({ ...previous, motion }))}
              place={board.place}
              onPlace={board.setPlace}
              show={showMode}
              onShow={setShowMode}
            />
            <HeaderButton label={gt("Full history")} onClick={() => board.setTab("tack")}>
              <span className="px-1 text-xs">{gt("History")}</span>
            </HeaderButton>
            <HeaderButton label={gt("Send Tack home")} onClick={() => chat.setView("closed")}>
              <XIcon />
            </HeaderButton>
          </div>
          <TackMessages
            chat={chat}
            environmentId={board.environmentId}
            bubbles={latestExchange(chat.bubbles)}
            className="max-h-72 px-0"
          />
          {board.place === "roam" ? <TackComposer chat={chat} autoFocus /> : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
