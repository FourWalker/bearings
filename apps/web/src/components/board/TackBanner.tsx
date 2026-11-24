import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useStableCallback } from "~/hooks/useStableCallback";

import type { BoardNotice } from "./board.logic";
import { AssistantApprovals } from "./BoardAssistant";
import { useTackLook, useTackPen } from "./TackAvatar";
import { TACK_CELL } from "./tackAvatar.logic";
import { tackArcPath, tackHopMs } from "./tackPlace.logic";
import {
  PLOTTER_CHASE_MS,
  type PlotterPen,
  plotterPenPath,
  plotterTimeline,
} from "./tackPlotter.logic";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Sheet units a screen pixel, at the size Tack is drawn at home: the slip uses the figure's pen. */
const SHEET_UNIT = 200 / Math.round(TACK_CELL.height * 3 * 1.3);
const PIXEL_OUT_MS = 280;
const EASE = "cubic-bezier(0.3, 0.1, 0.3, 1)";
let slips = 0;

interface Slip {
  readonly trail: string;
  readonly hop: number;
}
const drawn = new WeakMap<HTMLElement, Slip>();

function node(tag: string, attributes: Record<string, string>, parent: Element): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  parent.append(element);
  return element;
}

/**
 * The Plotter's banner: a second pen leaves Tack on a dotted trail and draws the slip (its frame,
 * the rule under the heading, the stamp's box) at the figure's own pen speed, the dot on the tip
 * of the line, the text inking in behind it. Returns how to call it off.
 */
function drawSlip(root: HTMLElement, pen: PlotterPen): () => void {
  const sheet = root.querySelector<SVGSVGElement>(".tack-banner-ink");
  const dot = root.querySelector<HTMLElement>(".tack-banner-pen");
  const head = root.querySelector("[data-tack-banner-head]");
  const stamp = root.querySelector(".tack-banner-stamp");
  const home = document.querySelector(
    "[data-tack-home] [data-tack-figure], [data-tack-home] [data-tack-ghost]",
  );
  if (sheet === null || dot === null || head === null || stamp === null) return () => {};
  const box = root.getBoundingClientRect();
  const { width, height } = box;
  const within = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left - box.left, y: rect.top - box.top, w: rect.width, h: rect.height };
  };
  const inset = 5;
  const r = 5;
  const [right, bottom] = [width - inset, height - inset];
  const at = (value: number) => value.toFixed(1);
  const headBox = within(head);
  const stampBox = within(stamp);
  // From the corner nearest Tack, so the trail meets the line it starts.
  const frame = `M${at(right - r)} ${at(bottom)}H${inset + r}Q${inset} ${at(bottom)} ${inset} ${at(bottom - r)}V${inset + r}Q${inset} ${inset} ${inset + r} ${inset}H${at(right - r)}Q${at(right)} ${inset} ${at(right)} ${inset + r}V${at(bottom - r)}Q${at(right)} ${at(bottom)} ${at(right - r)} ${at(bottom)}`;
  const rule = `M${at(width - 16)} ${at(headBox.y + headBox.h + 1)}H16`;
  const stampFrame = `M${at(stampBox.x - 1)} ${at(stampBox.y + stampBox.h + 1)}V${at(stampBox.y - 1)}H${at(stampBox.x + stampBox.w + 1)}V${at(stampBox.y + stampBox.h + 1)}Z`;
  const strokes = [
    ["frame", frame],
    ["rule", rule],
    ["stamp", stampFrame],
  ] as const;
  const homeBox = home?.getBoundingClientRect();
  const trail = tackArcPath(
    homeBox === undefined
      ? { x: right - r, y: bottom + 60 }
      : {
          x: homeBox.left + homeBox.width / 2 - box.left,
          y: homeBox.top + homeBox.height / 2 - box.top,
        },
    { x: right - r, y: bottom },
  );

  sheet.replaceChildren();
  sheet.setAttribute("viewBox", `0 0 ${at(width)} ${at(height)}`);
  const id = `tack-slip-${++slips}`;
  const mask = node(
    "mask",
    {
      id,
      maskUnits: "userSpaceOnUse",
      x: "-600",
      y: "-600",
      width: at(width + 1200),
      height: at(height + 1200),
    },
    sheet,
  );
  const reveal = node("path", { d: trail, pathLength: "1" }, mask) as SVGPathElement;
  const trailPath = node("path", { "data-trail": "", d: trail, mask: `url(#${id})` }, sheet);
  const inked = strokes.map(
    ([part, d]) => node("path", { "data-ink": part, d, pathLength: "1" }, sheet) as SVGPathElement,
  );

  let from: DOMPoint | null = null;
  const sized = inked.map((path) => {
    const length = path.getTotalLength();
    const start = path.getPointAtLength(0);
    const hop = from === null ? 0 : Math.hypot(start.x - from.x, start.y - from.y);
    from = path.getPointAtLength(length);
    return { length: length * SHEET_UNIT, hop: hop * SHEET_UNIT, px: length + hop };
  });
  const timeline = plotterTimeline(sized, pen.speed, true);
  const trailLength = reveal.getTotalLength();
  const hop = tackHopMs(trailLength);
  const penLength = sized.reduce((sum, stroke) => sum + stroke.px, 0);
  const all = hop + timeline.total;
  // One path for the dot: along the trail, then through every stroke as the pen joins them.
  dot.style.offsetPath = `path("${trail}${plotterPenPath(
    ["M0 0", ...strokes.map(([, d]) => d)],
    true,
  ).slice("M0 0".length)}")`;
  drawn.set(root, { trail, hop });

  const paper = root.querySelector(".tack-banner-paper");
  const text = [...root.querySelectorAll("[data-tack-banner-text] > *, [data-tack-banner-close]")];
  const linear = { easing: "linear", fill: "both" } as const;
  const animations = [
    paper?.animate({ opacity: [0, 1] }, { duration: 220, ...linear }),
    reveal.animate({ strokeDashoffset: [1.01, 0] }, { duration: hop, easing: EASE, fill: "both" }),
    trailPath.animate([{ opacity: 0.8 }, { opacity: 0.8, offset: 0.9 }, { opacity: 0 }], {
      duration: all + 500,
      ...linear,
    }),
    ...inked.map((path, i) =>
      path.animate(
        { strokeDashoffset: [1.01, 0] },
        {
          duration: timeline.steps[i]?.duration ?? 0,
          delay: hop + (timeline.steps[i]?.delay ?? 0),
          ...linear,
        },
      ),
    ),
    dot.animate(
      [
        { offsetDistance: "0%", easing: EASE },
        {
          offsetDistance: `${(trailLength / (trailLength + penLength)) * 100}%`,
          offset: hop / all,
          easing: "linear",
        },
        { offsetDistance: "100%" },
      ],
      { duration: all, fill: "both" },
    ),
    dot.animate([{ opacity: 1 }, { opacity: 1, offset: 0.97 }, { opacity: 0 }], {
      duration: all + 160,
      ...linear,
    }),
    ...text.map((element, i) =>
      element.animate(
        { opacity: [0, 1] },
        {
          duration: 260,
          delay: hop + timeline.total * (0.3 + (0.7 * i) / Math.max(1, text.length - 1)),
          easing: "linear",
          fill: "backwards",
        },
      ),
    ),
  ];
  return () => {
    for (const animation of animations) animation?.cancel();
    drawn.delete(root);
  };
}

/** The slip leaves: its ink is chased off and the pen rides the trail back to Tack. In ms. */
function eraseSlip(root: HTMLElement): number {
  const slip = drawn.get(root);
  const sheet = root.querySelector(".tack-banner-ink");
  const dot = root.querySelector<HTMLElement>(".tack-banner-pen");
  if (slip === undefined || sheet === null || dot === null) return 0;
  const linear = { easing: "linear", fill: "both" } as const;
  sheet.querySelectorAll("[data-ink]").forEach((path, i) => {
    path.animate(
      { strokeDashoffset: [0, -1.01] },
      { duration: PLOTTER_CHASE_MS, delay: i * 40, ...linear },
    );
  });
  root
    .querySelectorAll("[data-tack-banner-text], [data-tack-banner-close]")
    .forEach((element) => element.animate({ opacity: [1, 0] }, { duration: 200, ...linear }));
  root
    .querySelector(".tack-banner-paper")
    ?.animate({ opacity: [1, 0] }, { duration: 260, delay: 220, ...linear });
  for (const animation of dot.getAnimations()) animation.cancel();
  dot.style.offsetPath = `path("${slip.trail}")`;
  dot.animate(
    [
      { offsetDistance: "100%", opacity: 1 },
      { offsetDistance: "0%", opacity: 1 },
    ],
    { duration: slip.hop, easing: EASE, fill: "both" },
  );
  const trail = sheet.querySelector("[data-trail]");
  for (const animation of trail?.getAnimations() ?? []) animation.cancel();
  trail?.animate({ opacity: [0.8, 0.8] }, { duration: slip.hop, fill: "both" });
  sheet
    .querySelector("mask path")
    ?.animate({ strokeDashoffset: [0, 1.01] }, { duration: slip.hop, easing: EASE, fill: "both" });
  return Math.max(slip.hop, 520);
}

/**
 * Project Board fork: Tack's banner for a notice, in the style of its skin. It never takes the
 * keyboard; left alone it goes back to Tack, which keeps holding the notice.
 */
export function TackBanner(props: {
  readonly notice: BoardNotice;
  readonly environmentId: EnvironmentId;
  readonly onOpen: () => void;
  /** The banner has left; the notice stays with Tack. */
  readonly onGone: () => void;
}) {
  const gt = useGT();
  const { notice } = props;
  const [look] = useTackLook();
  const [pen] = useTackPen();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const moving = !reduced && look.motion !== "still";
  const skin = look.skin === "plotter" ? "plotter" : look.skin === "emoji" ? "plain" : "pixel";
  const [leaving, setLeaving] = useState(false);
  const gone = useStableCallback(props.onGone);
  const slip = useStableCallback((root: HTMLDivElement | null) => {
    if (root === null || skin !== "plotter" || !moving) return;
    return drawSlip(root, pen);
  });
  const leave = (root: HTMLElement | null) => {
    if (leaving) return;
    setLeaving(true);
    const wait = root === null || !moving ? 0 : skin === "plotter" ? eraseSlip(root) : PIXEL_OUT_MS;
    // A timer, not an animation's end: that waits for a frame a hidden window never paints.
    setTimeout(gone, wait);
  };

  const stamp =
    notice.goal !== null && notice.kind === "needs"
      ? gt("Goal needs you")
      : notice.kind === "needs"
        ? gt("Needs you")
        : notice.kind === "stopped"
          ? gt("Stopped")
          : gt("Finished");
  const line =
    notice.kind === "stopped"
      ? gt("The turn stopped on an error.")
      : notice.kind === "finished"
        ? gt("The turn finished. Its result is waiting for you.")
        : notice.goal !== null
          ? gt("Its thread stopped and waits for you.")
          : notice.why === "approval"
            ? null
            : gt("It asked a question.");
  const threadId = notice.chat?.threadId ?? null;
  const approval = notice.kind === "needs" && notice.why === "approval" && threadId !== null;

  return (
    <div
      ref={slip}
      data-tack-banner={notice.kind}
      data-skin={skin}
      data-moving={moving ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      className="tack-banner"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "tack-banner-life")
          leave(event.currentTarget);
      }}
    >
      <div className="tack-banner-paper" />
      <svg className="tack-banner-ink" aria-hidden />
      <i className="tack-banner-pen" aria-hidden />
      <div data-tack-banner-close className="absolute end-1 top-1 z-10">
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={gt("Later: Tack keeps it")}
          onClick={(event) => leave(event.currentTarget.closest<HTMLElement>(".tack-banner"))}
        >
          <XIcon />
        </Button>
      </div>
      <div data-tack-banner-text className="relative grid gap-1 px-4 pt-3.5 pb-3">
        <div data-tack-banner-head className="flex items-center gap-2.5 pe-5 pb-1.5">
          <span className="tack-banner-stamp shrink-0">{stamp}</span>
          {notice.detail !== null ? (
            <span className="tack-banner-crumb min-w-0 truncate">{notice.detail}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="tack-banner-title text-start font-medium text-base leading-tight hover:underline"
          onClick={props.onOpen}
        >
          {notice.title}
        </button>
        {line !== null ? <p className="tack-banner-line text-sm">{line}</p> : null}
        {approval ? (
          <AssistantApprovals
            environmentId={props.environmentId}
            threadRef={scopeThreadRef(props.environmentId, threadId)}
          />
        ) : null}
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Button size="compact" variant={approval ? "outline" : "default"} onClick={props.onOpen}>
            {notice.goal !== null
              ? gt("Open the Goal")
              : notice.task !== null
                ? gt("Go to task")
                : gt("Open the thread")}
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={(event) => leave(event.currentTarget.closest<HTMLElement>(".tack-banner"))}
          >
            {gt("Later")}
          </Button>
        </div>
      </div>
    </div>
  );
}
