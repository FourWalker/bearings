import type { BoardTask, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { createContext, use, useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { Popover, PopoverPopup } from "~/components/ui/popover";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
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
import { type TackChat, type TackChatProps, useTackChat } from "./useTackChat";

const PlaceSchema = Schema.Literals(TACK_PLACES);

/** Where Tack lives on this device's boards. */
export function useTackPlace() {
  return useLocalStorage<TackPlace, TackPlace>("t3.board.assistant.place", "roam", PlaceSchema);
}

type AnchorKind = "corner" | "host" | "note";

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
  readonly land: (taskId: string | null) => void;
  readonly anchor: { readonly element: HTMLElement; readonly kind: AnchorKind } | null;
  readonly setAnchor: (element: HTMLElement | null, kind: AnchorKind) => void;
  readonly tab: "stand" | "tack";
  readonly setTab: (tab: "stand" | "tack") => void;
  readonly askAbout: (task: BoardTask) => void;
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
  const [landed, setLanded] = useState<string | null>(null);
  const [anchor, setAnchorState] = useState<TackBoard["anchor"]>(null);
  const open = chat.view !== "closed";
  const replyFocus = tackFocusTask(latestTackText(chat.bubbles), props.tasks);
  const focus = open ? (asked ?? replyFocus) : null;
  const focusTitle = props.tasks.find((task) => task.id === focus)?.title ?? null;

  const callTack = useEffectEvent(() => chat.setView("open"));
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

  const value: TackBoard = {
    chat: {
      ...chat,
      send: async (text) => {
        setAsked(null);
        await chat.send(text);
      },
      setView: (view) => {
        if (view === "closed") setAsked(null);
        chat.setView(view);
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
    setAnchor: (element, kind) =>
      setAnchorState((current) =>
        element === null
          ? current?.kind === kind
            ? null
            : current
          : current?.element === element
            ? current
            : { element, kind },
      ),
    tab,
    setTab,
    askAbout: (task) => {
      setAsked(task.id);
      chat.setDraft(gt("About “{title}”: ", { title: task.title }));
      chat.setView("open");
    },
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

/**
 * Tack itself. Wherever it mounts, it hops there from where it last stood: one short stepped
 * animation, so Tack crosses the board without a loop or a timer.
 */
function TackFigure(props: { readonly kind: AnchorKind; readonly scale: number }) {
  const gt = useGT();
  const board = useTackBoard();
  const [look] = useTackLook();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  if (board === null) return null;
  const { chat } = board;
  const hops = !reduced && look.motion !== "still";
  return (
    <button
      type="button"
      data-tack-figure={props.kind}
      aria-label={gt("Tack")}
      draggable
      className="block cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      ref={(element) => {
        board.setAnchor(element, props.kind);
        if (element === null) return;
        const rect = element.getBoundingClientRect();
        const from = lastTackRect;
        lastTackRect = rect;
        if (!hops || from === null) return;
        const dx = from.left - rect.left;
        const dy = from.top - rect.top;
        const distance = Math.hypot(dx, dy);
        if (distance < 4) return;
        const duration = tackHopMs(distance);
        element.animate(
          [
            { translate: `${dx}px ${dy}px` },
            { translate: `${dx / 2}px ${dy / 2 - Math.min(48, distance * 0.15)}px` },
            { translate: "0 0" },
          ],
          { duration, easing: `steps(${Math.max(4, Math.round(duration / 80))})` },
        );
      }}
      onClick={() => chat.setView(chat.view === "closed" ? "open" : "closed")}
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
  if (board === null || board.focus !== props.taskId) return null;
  return (
    <span
      data-tack-perch
      ref={(element) => {
        if (element !== null) board.land(props.taskId);
        else if (board.landed === props.taskId) board.land(null);
      }}
      // The cell's two empty bottom rows sit below the note's top edge, so Tack stands on it.
      className="pointer-events-auto absolute -top-[36px] end-3 z-10"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <TackFigure kind="note" scale={2} />
    </span>
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
      {props.children}
    </div>
  );
}

/** Is Tack at home, i.e. not standing on the note it is talking about? */
function atHome(board: TackBoard) {
  return board.focus === null || board.landed !== board.focus;
}

/** The Roamer's home: a corner at the foot of the panel where Tack sleeps. */
export function TackCorner() {
  const board = useTackBoard();
  if (board === null || board.place !== "roam") return null;
  const home = atHome(board);
  return (
    <div
      data-tack-home="corner"
      className="sticky bottom-0 mt-4 flex items-end gap-3 border-t bg-card/80 px-1 pt-2 pb-1 backdrop-blur-sm"
    >
      <div className="grid min-h-[60px] min-w-[78px] place-items-end border-b-2 border-dotted border-border">
        {home ? <TackFigure kind="corner" scale={3} /> : null}
      </div>
      <p className="min-w-0 flex-1 pb-1 text-muted-foreground text-xs">
        {home ? (
          board.chat.view === "closed" ? (
            <T>Tack's corner. Click Tack or press T to talk.</T>
          ) : (
            <T>Tack is listening.</T>
          )
        ) : (
          <T>Over at {board.focusTitle}.</T>
        )}
      </p>
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
  if (board === null) return null;
  const { chat, anchor } = board;
  const open = chat.view !== "closed" && anchor !== null && board.tab !== "tack";
  const side = anchor?.kind === "note" ? "right" : anchor?.kind === "corner" ? "left" : "bottom";
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // A click on Tack toggles the bubble itself; outside presses elsewhere close it.
        const target = details.event.target;
        if (target instanceof Node && anchor?.element.contains(target)) return;
        chat.setView("closed");
      }}
    >
      <PopoverPopup
        anchor={anchor?.element ?? null}
        side={side}
        align={side === "bottom" ? "start" : "end"}
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
