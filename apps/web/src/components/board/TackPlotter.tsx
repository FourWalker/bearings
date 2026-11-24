import { useState, type CSSProperties, type ReactNode } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

import { clipRuns, type TackClip, type TackMood, type TackMotion } from "./tackAvatar.logic";
import {
  PLOTTER_CHASE_MS,
  PLOTTER_CLIP_SECONDS,
  PLOTTER_DRAWING_OF,
  PLOTTER_DRAWINGS,
  type PlotterDrawing,
  type PlotterPen,
  plotterPenPath,
  plotterRetrace,
  plotterTimeline,
  wobblePath,
} from "./tackPlotter.logic";

interface Measured {
  readonly paths: ReadonlyArray<string>;
  readonly lengths: ReadonlyArray<number>;
  readonly hops: ReadonlyArray<number>;
}

const measured = new Map<string, Measured>();
let ruler: SVGSVGElement | null = null;

/** Stroke lengths, read once per drawing from a hidden sheet; the drawings never change. */
function measure(drawing: PlotterDrawing, wobble: boolean): Measured {
  const key = `${drawing}:${wobble}`;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  if (ruler === null) {
    ruler = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ruler.setAttribute("aria-hidden", "true");
    ruler.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
    document.body.append(ruler);
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  ruler.append(path);
  const paths = PLOTTER_DRAWINGS[drawing].map((stroke, i) =>
    wobble ? wobblePath(stroke.d, i + 1) : stroke.d,
  );
  const lengths: Array<number> = [];
  const hops: Array<number> = [];
  let at: DOMPoint | null = null;
  paths.forEach((d, i) => {
    if (PLOTTER_DRAWINGS[drawing][i]?.drawn === false) {
      lengths.push(0);
      hops.push(0);
      return;
    }
    path.setAttribute("d", d);
    const length = path.getTotalLength();
    const start = path.getPointAtLength(0);
    hops.push(at === null ? 0 : Math.hypot(start.x - at.x, start.y - at.y));
    lengths.push(length);
    at = path.getPointAtLength(length);
  });
  path.remove();
  const result = { paths, lengths, hops };
  measured.set(key, result);
  return result;
}

interface Sheet {
  readonly shown: PlotterDrawing;
  readonly leaving: PlotterDrawing | null;
  readonly epoch: number;
  /** The clip and run that brought this drawing in: its motion waits for the pen. */
  readonly firstClip: string;
  readonly arrival: number;
}

/**
 * Project Board fork: the Plotter skin. A clip shows a line drawing; changing to another drawing
 * erases the old one and a pen dot draws the new one. Everything plays as CSS animations, paused
 * while off screen, and the drawing's own motion stops once its clip has played out.
 */
export function TackPlotter(props: {
  readonly clip: TackClip;
  readonly mood: TackMood;
  readonly motion: TackMotion;
  readonly run: number;
  readonly held: boolean;
  readonly pen: PlotterPen;
  /** A rise means Tack just landed here: the pen draws it, with no old ink to clear. */
  readonly arrival: number;
  /** Tack holds a notice: the scholar looks up with a stamped card, and gestures if it is urgent. */
  readonly hold: "needs" | "calm" | null;
  /** Width and height in screen pixels. */
  readonly size: number;
  readonly onClipEnd: () => void;
  readonly onClick?: () => void;
  readonly className?: string;
}) {
  // Only the scholar holds a notice; the bell, the bird and the rest play as they are.
  const attentive = props.hold !== null && (props.clip === "idle" || props.clip === "wake");
  const drawing = attentive ? "attention" : PLOTTER_DRAWING_OF[props.clip];
  const clipKey = `${props.clip}:${props.run}`;
  const [sheet, setSheet] = useState<Sheet>({
    shown: drawing,
    leaving: null,
    epoch: 0,
    firstClip: clipKey,
    arrival: props.arrival,
  });
  const landed = sheet.arrival !== props.arrival;
  if (sheet.shown !== drawing || landed)
    setSheet({
      shown: drawing,
      leaving: props.motion === "still" || landed ? null : sheet.shown,
      epoch: sheet.epoch + 1,
      firstClip: clipKey,
      arrival: props.arrival,
    });
  const still = props.motion === "still";
  const { pen } = props;

  const leaving = sheet.leaving === null ? null : measure(sheet.leaving, pen.wobble);
  const retrace = leaving === null ? null : plotterRetrace(leaving.lengths, pen.speed);
  const eraseMs =
    leaving === null ? 0 : pen.ink === "retrace" ? (retrace?.total ?? 0) : PLOTTER_CHASE_MS;
  // Stable per erase time, so a re-render does not restart the pen mid-drawing.
  const startPen = useStableCallback((motion: SVGElement | null) => {
    if (motion instanceof SVGAnimationElement) motion.beginElementAt(eraseMs / 1000);
  });
  const shown = measure(sheet.shown, pen.wobble);
  const drawn = PLOTTER_DRAWINGS[sheet.shown].map((stroke) => stroke.drawn !== false);
  const timeline = plotterTimeline(
    shown.lengths.flatMap((length, i) =>
      drawn[i] === true ? [{ length, hop: shown.hops[i] ?? 0 }] : [],
    ),
    pen.speed,
    pen.hops,
  );
  const fresh = sheet.firstClip === clipKey && sheet.epoch > 0 && !still;
  const liveDelay = fresh ? eraseMs + timeline.total : 0;
  const runs = clipRuns(props.clip, props.mood);
  const live = !still && !props.held && (props.motion === "full" || runs !== null);
  const width = (1.4 * 200) / props.size;

  const style = {
    width: props.size,
    height: props.size,
    "--tp-w": width,
    "--tp-live": `${liveDelay}ms`,
  } as CSSProperties;

  let step = 0;
  const drawnPaths: Array<string> = [];
  const strokes = renderGroups(sheet.shown, (stroke, i) => {
    const d = shown.paths[i] ?? stroke.d;
    const isDrawn = stroke.drawn !== false;
    const at = isDrawn ? timeline.steps[step] : undefined;
    if (isDrawn) {
      step++;
      drawnPaths.push(d);
    }
    return (
      <path
        key={d}
        d={d}
        pathLength={1}
        data-tone={stroke.tone}
        data-drawn={isDrawn ? "" : undefined}
        style={
          {
            "--d": `${fresh ? eraseMs + (at?.delay ?? 0) : 0}ms`,
            "--t": `${fresh ? (at?.duration ?? 0) : 0}ms`,
            "--i": i,
          } as CSSProperties
        }
      />
    );
  });

  return (
    <span
      ref={observeVisibleAnimation}
      aria-hidden
      data-tack-clip={attentive ? "attention" : props.clip}
      data-hold={attentive ? (props.hold ?? undefined) : undefined}
      data-motion={still ? "still" : "moving"}
      data-live={live ? "" : undefined}
      className={cn("tack-plotter relative block shrink-0", props.className)}
      style={style}
      onClick={props.onClick}
    >
      <svg viewBox="0 0 200 200" role="presentation">
        {leaving !== null && sheet.leaving !== null ? (
          <g
            key={`leave-${sheet.epoch}`}
            className="tp-sheet"
            data-mode={pen.ink}
            onAnimationEnd={(event) => {
              if (event.animationName !== "tp-chase" && event.animationName !== "tp-retrace")
                return;
              if ((event.target as Element).getAttribute("data-last") === null) return;
              setSheet((current) => ({ ...current, leaving: null }));
            }}
          >
            {leaving.paths.map((d, i) => {
              const stroke = PLOTTER_DRAWINGS[sheet.leaving ?? "face"][i];
              if (stroke?.drawn === false) return null;
              const last =
                pen.ink === "retrace"
                  ? i === firstDrawn(sheet.leaving ?? "face")
                  : i === lastDrawn(sheet.leaving ?? "face");
              return (
                <path
                  key={d}
                  d={d}
                  pathLength={1}
                  data-tone={stroke?.tone}
                  data-last={last ? "" : undefined}
                  style={
                    {
                      "--i": i,
                      "--d": `${retrace?.steps[i]?.delay ?? 0}ms`,
                      "--t": `${retrace?.steps[i]?.duration ?? 0}ms`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </g>
        ) : null}
        <g key={`draw-${sheet.epoch}`} className="tp-sheet" data-mode="draw">
          {strokes}
        </g>
        {fresh ? (
          <circle
            key={`pen-${sheet.epoch}`}
            className="tp-pen"
            r={width * 2}
            cx={0}
            cy={0}
            style={{ "--d": `${eraseMs}ms`, "--t": `${timeline.total}ms` } as CSSProperties}
          >
            <animateMotion
              ref={startPen}
              begin="indefinite"
              dur={`${Math.max(1, timeline.total)}ms`}
              path={plotterPenPath(drawnPaths, pen.hops)}
              calcMode="linear"
              keyPoints="0;1"
              keyTimes="0;1"
              fill="freeze"
            />
          </circle>
        ) : null}
      </svg>
      {live && runs !== null ? (
        <span
          key={`clock-${clipKey}`}
          className="tp-clock"
          style={
            {
              "--tp-len": `${PLOTTER_CLIP_SECONDS[props.clip]}s`,
              "--tp-runs": runs,
            } as CSSProperties
          }
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) props.onClipEnd();
          }}
        />
      ) : null}
    </span>
  );
}

function firstDrawn(drawing: PlotterDrawing): number {
  return PLOTTER_DRAWINGS[drawing].findIndex((stroke) => stroke.drawn !== false);
}

function lastDrawn(drawing: PlotterDrawing): number {
  return PLOTTER_DRAWINGS[drawing].findLastIndex((stroke) => stroke.drawn !== false);
}

/** Strokes in drawing order, each part gathered in a group where it first appears. */
function renderGroups(
  drawing: PlotterDrawing,
  renderStroke: (stroke: (typeof PLOTTER_DRAWINGS)[PlotterDrawing][number], i: number) => ReactNode,
): ReadonlyArray<ReactNode> {
  const out: Array<ReactNode> = [];
  const groups = new Map<string, Array<ReactNode>>();
  PLOTTER_DRAWINGS[drawing].forEach((stroke, i) => {
    const node = renderStroke(stroke, i);
    if (stroke.part === undefined) {
      out.push(node);
      return;
    }
    const group = groups.get(stroke.part);
    if (group !== undefined) {
      group.push(node);
      return;
    }
    const children = [node];
    groups.set(stroke.part, children);
    out.push(
      <g key={`part-${stroke.part}`} data-part={stroke.part}>
        {children}
      </g>,
    );
  });
  return out;
}
