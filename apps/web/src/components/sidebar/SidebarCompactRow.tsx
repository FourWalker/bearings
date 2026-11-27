import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { usePinCatch } from "../board/BoardPinBar";
import { pinBurstDelayMs } from "../board/boardPin.logic";
import { TackAvatar, useTackLook } from "../board/TackAvatar";
import { PLOTTER_SUB_BIRD } from "../board/tackPlotter.logic";
import { type SidebarRowEvent, type SidebarRowTone, sidebarRowEventOf } from "./sidebarRowDetails";

const RING = "M8 22C6 8 30 3 55 4C82 5 97 12 94 23C91 35 62 38 40 37C18 36 5 31 9 17";
const SCRIBBLE = "M1 4C14 1 22 7 36 4S58 1 72 4S90 7 99 3";
const WAVE = "M0 3C8 0 12 6 20 3S32 0 40 3S52 6 60 3S72 0 80 3S92 6 100 3";
const RAYS = ["M12 9L4 2", "M12 31L4 38", "M88 9L96 2", "M88 31L96 38", "M95 20L104 20"];

function Mark(props: { readonly kind: string; readonly box: string; readonly paths: string[] }) {
  return (
    <svg data-row-mark={props.kind} viewBox={props.box} preserveAspectRatio="none" aria-hidden>
      {props.paths.map((d, i) => (
        <path key={d} d={d} pathLength={1} style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}

/** The last change of tone this row saw, counted so a repeat replays. Mounting plays nothing. */
function useRowEvent(tone: SidebarRowTone) {
  const [state, setState] = useState<{
    tone: SidebarRowTone;
    event: SidebarRowEvent | null;
    seq: number;
  }>({ tone, event: null, seq: 0 });
  if (state.tone !== tone) {
    const event = sidebarRowEventOf(state.tone, tone);
    setState({
      tone,
      event: event ?? state.event,
      seq: event === null ? state.seq : state.seq + 1,
    });
  }
  return state.tone === tone ? state : { tone, event: state.event, seq: state.seq };
}

/**
 * Project Board fork: the body of a compact chat row. One line (status dot, title, status chip or
 * time), a second line only for the details set to show in the row, and the working look.
 * Motion is one-shot per change of tone; "needs you" replays on the Pin bar's slowing schedule.
 */
export function SidebarCompactRowBody(props: {
  readonly tone: SidebarRowTone;
  readonly isActive: boolean;
  readonly leading: ReactNode;
  readonly title: ReactNode;
  readonly afterTitle: ReactNode;
  /** The status chip, or null when the row has no status. */
  readonly chip: ReactNode;
  /** Shown where the chip would be when there is none. */
  readonly time: ReactNode;
  readonly controls: ReactNode;
  readonly hideTrailing: boolean;
  readonly trailingClassName?: string | undefined;
  readonly dragDestination: ReactNode;
  readonly jumpHint: ReactNode;
  readonly meta: ReactNode;
  readonly accessory: ReactNode;
}) {
  const { event, seq } = useRowEvent(props.tone);
  const lively = props.tone !== "idle";
  const [burst, setBurst] = useState({ seq, count: 1 });
  const bursts = burst.seq === seq ? burst.count : 1;
  const key = `${seq}-${bursts}`;
  return (
    <div
      data-compact-row-body
      data-row-event={event ?? undefined}
      className="flex min-w-0 flex-col justify-center"
    >
      {lively ? (
        <span key={key} data-row-fx aria-hidden>
          <span data-row-swell />
          <span data-row-tape />
          <Mark kind="tideline" box="0 0 100 6" paths={[WAVE]} />
          <Mark kind="scribble" box="0 0 100 8" paths={[SCRIBBLE]} />
        </span>
      ) : null}
      <div className="flex h-7 min-w-0 items-center gap-2">
        <span key={key} data-row-dot={props.tone} aria-hidden>
          {lively ? <Mark kind="ring" box="0 0 100 40" paths={[RING]} /> : null}
        </span>
        {props.leading}
        {props.title}
        {props.afterTitle}
        {props.dragDestination ?? (
          <span
            className={cn(
              "relative ml-auto flex h-6 min-w-6 shrink-0 items-center justify-end text-xs",
              props.hideTrailing && "hidden",
              props.trailingClassName,
            )}
          >
            <span className="pointer-events-none flex items-center tabular-nums text-secondary-label group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0">
              {props.chip !== null ? (
                <span key={key} data-row-chip={props.tone}>
                  {props.chip}
                  {props.tone === "needs" ? (
                    <Mark kind="rays" box="0 0 100 40" paths={RAYS} />
                  ) : null}
                </span>
              ) : (
                props.time
              )}
            </span>
            {props.controls}
            {props.jumpHint}
          </span>
        )}
        {props.accessory}
      </div>
      {props.meta}
      {props.tone === "needs" && event === "needs" ? (
        <SidebarNeedsYou
          seq={seq}
          bursts={bursts}
          isActive={props.isActive}
          onBurst={(count) => setBurst({ seq, count })}
        />
      ) : null}
    </div>
  );
}

/** Replays "needs you" until the chat is opened, and sends a Sub Tack the first time. */
function SidebarNeedsYou(props: {
  readonly seq: number;
  readonly bursts: number;
  readonly isActive: boolean;
  readonly onBurst: (count: number) => void;
}) {
  const [catching] = usePinCatch();
  const [look] = useTackLook();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const motion = reduced ? "still" : look.motion;
  const [seen, setSeen] = useState(props.isActive);
  if (props.isActive && !seen) setSeen(true);
  const replays = catching !== "off" && motion === "full" && !seen;
  const { bursts, onBurst } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wall-clock schedule: the next replay is a timer, which lives outside React.
  useEffect(() => {
    if (!replays) return;
    const timer = setTimeout(() => onBurst(bursts + 1), pinBurstDelayMs(bursts));
    return () => clearTimeout(timer);
  }, [replays, bursts, onBurst]);
  const anchor = useRef<HTMLSpanElement>(null);
  const flies =
    catching === "tack" && motion !== "still" && look.skin !== "emoji" && !props.isActive;
  return (
    <span ref={anchor} className="contents">
      {flies ? (
        <SidebarSubTack key={props.seq} anchor={anchor} plotter={look.skin === "plotter"} />
      ) : null}
    </span>
  );
}

const SUB_SIZE = 26;
const FLIGHT_MS = 1300;
const HOPS_MS = 1400;

/**
 * A small Tack leaves the Board entry, lands on the row's chip, hops three times and fades. It
 * plays once per notice, in a portal so the row's clipping does not cut it.
 */
function SidebarSubTack(props: {
  readonly anchor: React.RefObject<HTMLSpanElement | null>;
  readonly plotter: boolean;
}) {
  const [look] = useTackLook();
  const [done, setDone] = useState(false);
  const node = useRef<HTMLSpanElement>(null);
  const { anchor } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the row's chip and the Board entry in the DOM, then drives the flight with the Web Animations API.
  useEffect(() => {
    const element = node.current;
    const row = anchor.current?.closest("[data-sidebar-row]");
    const target = (row?.querySelector("[data-row-chip]") ?? row)?.getBoundingClientRect();
    if (element === null || target === undefined || target.width === 0) return;
    const from =
      document.querySelector("[data-sidebar-board-entry]")?.getBoundingClientRect() ??
      document.querySelector("[data-sidebar-new-chat]")?.getBoundingClientRect() ??
      null;
    const x = target.left + target.width / 2 - SUB_SIZE / 2;
    const y = target.top - SUB_SIZE + 4;
    const fx = from === null ? 0 : from.left + 12 - x;
    const fy = from === null ? -40 : from.top + from.height / 2 - SUB_SIZE / 2 - y;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    const flight = element.animate(
      [
        { translate: `${fx}px ${fy}px`, scale: "0.5", opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { translate: "0 0", scale: "1", opacity: 1 },
      ],
      { duration: FLIGHT_MS, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "both" },
    );
    const hops = element.animate(
      [
        { translate: "0 0", offset: 0 },
        { translate: "0 -7px", offset: 0.15 },
        { translate: "0 0", offset: 0.33 },
        { translate: "0 -7px", offset: 0.48 },
        { translate: "0 0", offset: 0.66 },
        { translate: "0 -7px", offset: 0.81 },
        { translate: "0 0", opacity: 1, offset: 0.92 },
        { translate: "0 0", opacity: 0, offset: 1 },
      ],
      { duration: HOPS_MS, delay: FLIGHT_MS, easing: "ease-in-out", fill: "forwards" },
    );
    hops.onfinish = () => setDone(true);
    return () => {
      flight.cancel();
      hops.cancel();
    };
  }, [anchor]);
  if (done) return null;
  return createPortal(
    <span
      ref={node}
      aria-hidden
      data-sidebar-subtack={props.plotter ? "plotter" : "pixel"}
      style={{ width: SUB_SIZE, height: SUB_SIZE, opacity: 0 }}
    >
      {props.plotter ? (
        <svg data-subtack-bird width={SUB_SIZE} height={SUB_SIZE} viewBox="0 0 60 60">
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
          motion="full"
          mood="idle"
          scale={2}
          signal={{ at: 1, kind: "ring" }}
        />
      )}
    </span>,
    document.body,
  );
}

/**
 * Read once for the whole list: the Pin bar's "catch my eye" choice and Tack's motion level. The
 * stylesheet plays row motion only under these, so a still or "off" sidebar paints nothing.
 */
export function useSidebarRowMotionAttributes() {
  const [catching] = usePinCatch();
  const [look] = useTackLook();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const compact = useClientSettings((settings) => settings.sidebarRowStyle === "compact");
  return {
    "data-sidebar-rows": compact ? "compact" : "classic",
    "data-sidebar-catch": catching,
    "data-sidebar-motion": reduced ? "still" : look.motion,
  };
}
