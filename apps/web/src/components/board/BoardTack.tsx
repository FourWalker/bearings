import type { BoardTask, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, XIcon } from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Popover, PopoverPopup } from "~/components/ui/popover";

import { type TackHome, useTackHome } from "./tackSettings";
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
import { type BoardNotice, latestExchange } from "./board.logic";
import {
  TackAvatar,
  type TackHold,
  TackSign,
  type TackSignal,
  useTackLook,
  useTackPen,
} from "./TackAvatar";
import { TackBanner } from "./TackBanner";
import {
  TACK_PLACES,
  tackArcPath,
  tackHopMs,
  type TackPlace,
  tackReplyNote,
} from "./tackPlace.logic";
import { registerTackShow } from "./tackShow";
import {
  type TackChat,
  type TackChatProps,
  type TackView,
  useTackChat,
  useTackKey,
} from "./useTackChat";

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
  readonly boardId: string;
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
  /** A task is open over the board: Tack keeps its place and its bubble waits. */
  readonly covered: boolean;
  /** What on the board wants the person: Tack holds these until they are dealt with. */
  readonly notices: ReadonlyArray<BoardNotice>;
  /** The notices with a banner up right now. */
  readonly banners: ReadonlyArray<BoardNotice>;
  readonly dismissBanner: (key: string) => void;
  readonly openNotice: (notice: BoardNotice) => void;
  readonly hold: TackHold | null;
  readonly signal: TackSignal;
  /** Tack sends a Sub Tack off (to the Pin bar) and stays where it is. */
  readonly release: () => void;
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
    /** Held by the board page, so Tack is as awake on a task's page as it was on the board. */
    readonly awake: boolean;
    readonly onAwake: (awake: boolean) => void;
    readonly covered: boolean;
    readonly notices: ReadonlyArray<BoardNotice>;
    /** The threads are loaded, so a notice not seen before really is new. */
    readonly noticesReady: boolean;
    readonly onOpenNotice: (notice: BoardNotice) => void;
    readonly children: ReactNode;
  },
) {
  const gt = useGT();
  const [tab, setTab] = useState<"stand" | "tack">("stand");
  const { awake, covered, notices } = props;
  // What stood when the board opened is old news: Tack holds it without announcing it.
  const [announced, setAnnounced] = useState<ReadonlyArray<string> | null>(null);
  const [bannerKeys, setBannerKeys] = useState<ReadonlyArray<string>>([]);
  const [signal, setSignal] = useState<TackSignal>({ at: 0, kind: "ring" });
  const urgent = notices.some((notice) => notice.kind !== "finished");
  if (props.noticesReady) {
    const keys = notices.map((notice) => notice.key);
    if (announced === null) setAnnounced(keys);
    else if (keys.length !== announced.length || keys.some((key) => !announced.includes(key))) {
      const fresh = notices.filter((notice) => !announced.includes(notice.key));
      setAnnounced(keys);
      if (fresh.some((notice) => notice.kind !== "finished"))
        setSignal((current) => ({ at: current.at + 1, kind: "ring" }));
      // A result, or the last notice dealt with: good news, unless something still waits.
      else if (!urgent && (fresh.length > 0 || keys.length === 0))
        setSignal((current) => ({ at: current.at + 1, kind: "cheer" }));
      // Behind an open task a banner would announce to nobody; the notice is held all the same.
      if (fresh.length > 0 && !covered)
        setBannerKeys((current) => [...current, ...fresh.map((notice) => notice.key)].slice(-2));
    }
  }
  const banners = bannerKeys.flatMap((key) => notices.find((notice) => notice.key === key) ?? []);
  const dismissBanner = useStableCallback((key: string) =>
    setBannerKeys((current) => current.filter((candidate) => candidate !== key)),
  );
  const chat = useTackChat(props, { follow: tab === "tack", asleep: !awake });
  // The note Tack stands on: it stays there until a reply names another note or it is sent home.
  const [stand, setStand] = useState<string | null>(null);
  const about = (title: string) => gt("About “{title}”: ", { title });
  if (!awake && stand !== null) {
    setStand(null);
    // The opening words put in the box for that note leave with Tack, unless the person wrote on.
    const title = props.tasks.find((task) => task.id === stand)?.title;
    if (title !== undefined && chat.draft === about(title)) chat.clearDraft();
  }
  const [landed, setLanded] = useState<string | null>(null);
  const [offscreen, setOffscreen] = useState<Offscreen | null>(null);
  const [anchor, setAnchorState] = useState<TackBoard["anchor"]>(null);
  const [showMode] = useTackShowMode();
  const open = chat.view !== "closed";
  // Tack's bubble lists what it holds, so banners make way for it.
  if (open && bannerKeys.length > 0) setBannerKeys([]);
  // The last message when Tack woke; see tackReplyNote.
  const [wokeAfter, setWokeAfter] = useState<string | null | undefined>(undefined);
  if (open && chat.loaded && wokeAfter === undefined) setWokeAfter(chat.bubbles.at(-1)?.id ?? null);
  if (!open && wokeAfter !== undefined) setWokeAfter(undefined);
  const reply =
    wokeAfter === undefined ? null : tackReplyNote(chat.bubbles, wokeAfter, props.tasks);
  // Each reply moves Tack once, so dropping Tack on another note afterwards is not undone.
  const [followed, setFollowed] = useState<string | null>(null);
  if (reply !== null && reply.key !== followed) {
    setFollowed(reply.key);
    setStand(reply.taskId);
  }
  const focus = open ? stand : null;
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
    props.onAwake(next !== "closed");
    chat.setView(next);
  };

  useTackKey(() => {
    if (!covered) setView("open");
  });

  const showTask = useEffectEvent((boardId: string, taskId: string) => {
    if (boardId !== props.boardId || showMode !== "walk" || !chat.canAsk) return false;
    // Only a note on the board itself: one inside an open task closes with it.
    const note = `[data-board-surface] [data-board-task="${CSS.escape(taskId)}"]`;
    if (document.querySelector(note) === null) return false;
    setStand(taskId);
    setView("open");
    return true;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- board tools reach Tack through a module-level channel
  useEffect(() => registerTackShow((boardId, taskId) => showTask(boardId, taskId)), []);

  const value: TackBoard = {
    chat: {
      ...chat,
      setView,
      // A message from the panel's own box wakes Tack too, or its answer would have no bubble.
      send: async (text) => {
        if (text.trim().length > 0 && !open) setView("open");
        await chat.send(text);
      },
    },
    place: props.place,
    setPlace: props.setPlace,
    environmentId: props.environmentId,
    boardId: props.boardId,
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
      setStand(task.id);
      chat.setDraft(about(task.title));
      setView("open");
    },
    offscreen,
    setOffscreen,
    covered,
    notices,
    banners: covered ? [] : banners,
    dismissBanner,
    openNotice: (notice) => {
      dismissBanner(notice.key);
      props.onOpenNotice(notice);
    },
    hold: notices.length === 0 ? null : urgent ? "needs" : "calm",
    signal,
    release: () => setSignal((previous) => ({ at: previous.at + 1, kind: "release" })),
  };
  if (!chat.canAsk) return props.children;
  return (
    <TackBoardContext value={value}>
      {props.children}
      <TackBubble />
    </TackBoardContext>
  );
}

/** Asks Tack to release a Sub Tack; null where no Tack lives on the board. */
export function useTackRelease(): (() => void) | null {
  return use(TackBoardContext)?.release ?? null;
}

export function useTackBoard() {
  return use(TackBoardContext);
}

/** An open task, drawn over the board: its notes are not places Tack stands on. */
export function TackOffBoard(props: { readonly children: ReactNode }) {
  return <TackBoardContext value={null}>{props.children}</TackBoardContext>;
}

interface TackOrigin {
  readonly rect: DOMRect;
  /** A copy of Tack as it stood there: the Plotter's old ink, chased off as the pen leaves. */
  readonly ink: HTMLElement;
  readonly at: number;
}

let lastTack: TackOrigin | null = null;

function snapshotTack(element: HTMLElement): TackOrigin | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0) return null;
  return { rect, ink: element.cloneNode(true) as HTMLElement, at: performance.now() };
}

/** Remembers where Tack stood as its figure leaves. Reads and writes of `lastTack` stay in module
    functions: inside a component the React Compiler folded them into one, and no hop had a length. */
function leaveTack(element: HTMLElement) {
  lastTack = snapshotTack(element) ?? lastTack;
}

/**
 * Where Tack comes from. Its other figure can still be on screen (home is replaced one render
 * after a note takes Tack); otherwise it is where a figure left in this same change of place.
 */
function tackOrigin(element: HTMLElement): TackOrigin | null {
  for (const other of document.querySelectorAll<HTMLElement>("[data-tack-figure]"))
    if (other !== element) return snapshotTack(other);
  return lastTack !== null && performance.now() - lastTack.at < 500 ? lastTack : null;
}

/** Where the pen will start drawing the Plotter figure, on screen. */
function penStart(element: HTMLElement): { readonly x: number; readonly y: number } | null {
  const sheet = element.querySelector("svg");
  const first = element.querySelector<SVGPathElement>(
    '.tp-sheet[data-mode="draw"] path[data-drawn]',
  );
  if (sheet === null || first === null) return null;
  const at = first.getPointAtLength(0);
  const box = sheet.getBoundingClientRect();
  return { x: box.left + (at.x / 200) * box.width, y: box.top + (at.y / 200) * box.height };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PEN_LIFT_MS = 220;
let travelMasks = 0;

function svgNode(tag: string, attributes: Record<string, string>, parent: Element): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node);
  return node;
}

/**
 * Tack crossing the board to where its figure now is. It plays on a fixed layer, since the board
 * and the panel scroll separately and would each clip it. Pixel skins are carried over as they
 * are; the Plotter's old ink is chased off, its pen crosses on a dotted arc, and the figure is
 * drawn anew on landing. Returns how to call it off, or null when there is nowhere to go.
 */
function travelTack(input: {
  readonly element: HTMLElement;
  readonly origin: TackOrigin;
  readonly pen: { readonly trail: boolean } | null;
  readonly onLand: () => void;
}): (() => void) | null {
  const { element, origin } = input;
  const from = origin.rect;
  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const distance = Math.hypot(dx, dy);
  if (distance < 4) return null;
  const hop = tackHopMs(distance);
  const layer = document.createElement("div");
  layer.className = "tack-travel";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const put = (copy: HTMLElement, rect: DOMRect) => {
    copy.removeAttribute("data-tack-figure");
    Object.assign(copy.style, {
      position: "absolute",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      visibility: "visible",
    });
    layer.append(copy);
  };
  let total = hop;
  if (input.pen === null) {
    const carried = element.cloneNode(true) as HTMLElement;
    put(carried, to);
    carried.animate(
      [
        { translate: `${dx}px ${dy}px` },
        { translate: `${dx / 2}px ${dy / 2 - Math.min(64, distance * 0.18)}px` },
        { translate: "0 0" },
      ],
      { duration: hop, easing: `steps(${Math.max(6, Math.round(hop / 70))})` },
    );
  } else {
    total += PEN_LIFT_MS;
    origin.ink.classList.add("tack-travel-ink");
    put(origin.ink, from);
    const path = tackArcPath(
      { x: from.left + from.width / 2, y: from.top + from.height / 2 },
      penStart(element) ?? { x: to.left + to.width / 2, y: to.top + to.height / 2 },
    );
    const timing = {
      duration: hop,
      delay: PEN_LIFT_MS,
      easing: "cubic-bezier(0.3, 0.1, 0.3, 1)",
      fill: "both",
    } as const;
    if (input.pen.trail) {
      // The dotted trail shows only behind the pen: a mask draws itself along the same arc.
      const id = `tack-travel-${++travelMasks}`;
      const sheet = svgNode("svg", {}, layer);
      const mask = svgNode("mask", { id, maskUnits: "userSpaceOnUse" }, sheet);
      svgNode("path", { d: path, pathLength: "1" }, mask).animate(
        { strokeDashoffset: [1.01, 0] },
        timing,
      );
      svgNode("path", { class: "tack-travel-trail", d: path, mask: `url(#${id})` }, sheet);
    }
    const dot = document.createElement("span");
    dot.className = "tack-travel-pen";
    dot.style.offsetPath = `path("${path}")`;
    layer.append(dot);
    dot.animate({ offsetDistance: ["0%", "100%"] }, timing);
  }
  // A timer, not the animation's finish event: that waits for a frame a hidden window never paints.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const end = (landed: boolean) => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    layer.remove();
    if (landed) input.onLand();
  };
  timer = setTimeout(() => end(true), total);
  return () => end(false);
}

/** Tack itself: wherever it mounts, it crosses the board there from where it last stood. */
function TackFigure(props: { readonly kind: AnchorKind; readonly scale: number }) {
  const gt = useGT();
  const board = useTackBoard();
  const [look] = useTackLook();
  const [pen] = useTackPen();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Behind an open task nobody sees the crossing, and its layer would be drawn over the task.
  const travels = !reduced && look.motion !== "still" && board?.covered !== true;
  const penTravel = look.skin === "plotter" ? { trail: pen.hops } : null;
  // Null while Tack is still on its way here: it is out of sight and its bubble stays shut. Then
  // how many crossings ended here, which has the Plotter draw itself on landing.
  const [landings, setLandings] = useState<number | null>(null);
  const setAnchor = board?.setAnchor;
  const { kind } = props;
  // Where this figure came from is kept apart from its ref: React can detach and re-attach a ref
  // on the same figure (StrictMode does on mount), and the crossing then starts over, not anew.
  const trip = useRef<{ readonly origin: TackOrigin | null; landed: boolean } | null>(null);
  const place = useStableCallback((element: HTMLButtonElement | null) => {
    if (element === null) return;
    if (trip.current === null) {
      // A note Tack goes to is brought into view first, so the person sees it land.
      if (kind === "note") element.scrollIntoView({ block: "nearest", inline: "nearest" });
      trip.current = { origin: travels ? tackOrigin(element) : null, landed: false };
    }
    const current = trip.current;
    const arrive = (crossings: number) => {
      current.landed = true;
      setLandings(crossings);
      setAnchor?.(element, kind);
    };
    let callOff: (() => void) | null = null;
    if (current.landed) setAnchor?.(element, kind);
    else {
      callOff =
        current.origin === null
          ? null
          : travelTack({
              element,
              origin: current.origin,
              pen: penTravel,
              onLand: () => arrive(1),
            });
      if (callOff === null) arrive(0);
    }
    return () => {
      callOff?.();
      leaveTack(element);
      setAnchor?.(null, kind);
    };
  });
  if (board === null) return null;
  const { chat } = board;
  return (
    <button
      type="button"
      data-tack-figure={props.kind}
      data-tack-self
      aria-label={gt("Tack")}
      draggable
      className="block cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      style={landings === null ? { visibility: "hidden" } : undefined}
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
        // Holding a notice, Tack stays up with it and does not doze off.
        mood={board.hold !== null && chat.mood === "rest" ? "idle" : chat.mood}
        notes={chat.notes}
        scale={props.scale}
        from="rest"
        arrival={landings ?? 0}
        hold={board.hold}
        signal={board.signal}
      />
    </button>
  );
}

/** Beside Tack at home: how many notices it holds. A sign for the pixel skins, a stamp otherwise. */
function TackHeld(props: {
  /** Where the stamped count sits. */
  readonly stamp: string;
  /** Where the pixel skins' sign stands: on the ground beside the sprite. */
  readonly sign: string;
}) {
  const board = useTackBoard();
  const [look] = useTackLook();
  if (board === null || board.hold === null) return null;
  const count = board.notices.length;
  return look.skin === "plotter" || look.skin === "emoji" ? (
    <span data-tack-count={board.hold} className={cn("tack-count absolute", props.stamp)}>
      {count}
    </span>
  ) : (
    <TackSign
      count={count}
      hot={board.hold === "needs"}
      scale={3}
      wave={board.signal.kind === "ring" ? board.signal.at : 0}
      className={cn("absolute", props.sign)}
    />
  );
}

/** Tack's banners for notices that just arrived, stacked beside its home. */
function TackBanners(props: { readonly className: string }) {
  const board = useTackBoard();
  if (board === null || board.banners.length === 0) return null;
  return (
    <div className={cn("pointer-events-none absolute z-20 flex w-72 gap-3", props.className)}>
      {board.banners.map((notice) => (
        <div key={notice.key} className="pointer-events-auto">
          <TackBanner
            notice={notice}
            environmentId={board.environmentId}
            onOpen={() => board.openNotice(notice)}
            onGone={() => board.dismissBanner(notice.key)}
          />
        </div>
      ))}
    </div>
  );
}

/** Tack's faint outline at home while it is out on a note; a click calls it back. */
function TackGhost(props: { readonly scale: number }) {
  const gt = useGT();
  const board = useTackBoard();
  const [look] = useTackLook();
  if (board === null) return null;
  return (
    <button
      type="button"
      data-tack-ghost
      aria-label={gt("Send Tack home")}
      className="block cursor-pointer rounded-md opacity-20 outline-none hover:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={() => board.chat.setView("closed")}
    >
      <TackAvatar skin={look.skin} motion="still" mood="idle" scale={props.scale} />
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

/** Boards Tack has said hello on since the app started: coming back from a task is not opening the board. */
const greetedBoards = new Set<string>();

function markGreeted(board: string) {
  greetedBoards.add(board);
}

/**
 * The Roamer's home: a round frosted nest where Tack sleeps, at the board's bottom right or at the
 * foot of the side panel. With the panel hidden, the board's corner is home whatever was chosen.
 */
export function TackCorner(props: {
  readonly active: number;
  readonly blocked: number;
  readonly at: TackHome;
  readonly panelOpen?: boolean;
}) {
  const gt = useGT();
  const board = useTackBoard();
  const [homeAt] = useTackHome();
  const boardKey = board === null ? "" : `${board.environmentId}:${board.boardId}`;
  // Tack says hello once when a board opens; the bubble fades out by itself.
  const [greeted, setGreeted] = useState(() => greetedBoards.has(boardKey));
  if (board === null) return null;
  const here =
    props.at === "panel"
      ? board.place === "roam" && homeAt === "panel"
      : props.panelOpen === false || (board.place === "roam" && homeAt === "board");
  if (!here) return null;
  const home = atHome(board);
  const { chat } = board;
  // Once the person has called Tack, the hello is over; it does not come back when Tack goes home.
  if (!greeted && chat.view !== "closed") setGreeted(true);
  return (
    <div
      data-tack-home="corner"
      className={
        props.at === "board"
          ? "pointer-events-none absolute end-4 bottom-4 z-10 flex justify-end"
          : "pointer-events-none sticky bottom-0 mt-4 flex justify-end pt-2"
      }
    >
      <div className="relative">
        <TackBanners className="end-0 bottom-full mb-3 flex-col-reverse" />
        {!greeted && home && chat.view === "closed" && board.banners.length === 0 ? (
          <button
            type="button"
            data-tack-greeting
            ref={() => markGreeted(boardKey)}
            className="tack-greeting pointer-events-auto absolute end-2 bottom-full mb-2 w-56 rounded-xl border bg-popover px-3 py-2 text-start text-xs shadow-md"
            onAnimationEnd={() => setGreeted(true)}
            onClick={() => {
              setGreeted(true);
              chat.setView("open");
            }}
          >
            {board.notices.length > 0
              ? gt("Hi, I'm Tack. I'm holding {count} for you. Click me to see.", {
                  count: board.notices.length,
                })
              : props.blocked > 0
                ? gt(
                    "Hi, I'm Tack. {active} open, {blocked} blocked. Click me or press T to talk.",
                    {
                      active: props.active,
                      blocked: props.blocked,
                    },
                  )
                : gt("Hi, I'm Tack. {active} open, nothing blocked. Click me or press T to talk.", {
                    active: props.active,
                  })}
          </button>
        ) : null}
        <div className="pointer-events-auto relative grid size-28 place-items-center rounded-full border bg-card/55 shadow-sm backdrop-blur-md">
          {home ? <TackFigure kind="corner" scale={3} /> : <TackGhost scale={3} />}
          <TackHeld stamp="-end-1 top-0" sign="end-1 bottom-8" />
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
        <div className="relative grid min-h-[60px] min-w-[78px] place-items-end">
          {home ? <TackFigure kind="host" scale={3} /> : <TackGhost scale={3} />}
          <TackHeld stamp="-end-4 top-0" sign="-end-5 bottom-0" />
          <TackBanners className="start-0 top-full mt-3 flex-col" />
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
  const open = chat.view !== "closed" && anchor !== null && board.tab !== "tack" && !board.covered;
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
        <div data-tack-bubble className="grid min-w-0 grid-cols-1 gap-2">
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
          {board.notices.length > 0 ? (
            <div data-tack-held className="grid gap-0.5 border-b pb-2">
              <span className="px-1 text-muted-foreground text-xs">
                {gt("Tack is holding {count}", { count: board.notices.length })}
              </span>
              {board.notices.map((notice) => (
                <button
                  key={notice.key}
                  type="button"
                  className="flex items-center gap-2 rounded-md px-1 py-1 text-start text-sm hover:bg-accent"
                  onClick={() => board.openNotice(notice)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block size-2 shrink-0",
                      notice.kind === "needs"
                        ? "rotate-45 bg-board-attention"
                        : notice.kind === "stopped"
                          ? "bg-destructive"
                          : "rounded-full bg-success",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{notice.title}</span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {notice.kind === "needs"
                      ? gt("needs you")
                      : notice.kind === "stopped"
                        ? gt("stopped")
                        : gt("finished")}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
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
