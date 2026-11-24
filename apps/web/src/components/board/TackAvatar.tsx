import * as Schema from "effect/Schema";
import { useState, type CSSProperties } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

import { TackPlotter } from "./TackPlotter";
import {
  advanceTackPlayback,
  clipMoves,
  clipRuns,
  finishTackClip,
  paintTackStrip,
  pokeTack,
  startTackPlayback,
  TACK_CELL,
  TACK_CLIPS,
  TACK_MOTIONS,
  TACK_SKINS,
  type TackClip,
  type TackMood,
  type TackMotion,
  type TackPixelSkin,
  type TackSkin,
} from "./tackAvatar.logic";
import {
  DEFAULT_PLOTTER_PEN,
  PLOTTER_INKS,
  PLOTTER_SPEEDS,
  type PlotterPen,
} from "./tackPlotter.logic";

const TackLook = Schema.Struct({
  skin: Schema.Literals(TACK_SKINS),
  motion: Schema.Literals(TACK_MOTIONS),
});
const DEFAULT_LOOK: typeof TackLook.Type = { skin: "claude", motion: "full" };

/** How Tack looks on this device. */
export function useTackLook() {
  return useLocalStorage("t3.board.assistant.look", DEFAULT_LOOK, TackLook);
}

const PenSchema = Schema.Struct({
  speed: Schema.Literals(PLOTTER_SPEEDS),
  ink: Schema.Literals(PLOTTER_INKS),
  hops: Schema.Boolean,
  wobble: Schema.Boolean,
});

/** How the Plotter skin's pen draws, on this device. */
export function useTackPen() {
  return useLocalStorage<PlotterPen, typeof PenSchema.Encoded>(
    "t3.board.assistant.pen",
    DEFAULT_PLOTTER_PEN,
    PenSchema,
  );
}

const strips = new Map<string, string>();

function stripUrl(skin: TackPixelSkin, clip: TackClip): string {
  const key = `${skin}:${clip}`;
  const cached = strips.get(key);
  if (cached !== undefined) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = TACK_CLIPS[clip].frames.length * TACK_CELL.width;
  canvas.height = TACK_CELL.height;
  const context = canvas.getContext("2d");
  if (context !== null)
    paintTackStrip(skin, clip, (x, y, color) => {
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    });
  const url = canvas.toDataURL();
  strips.set(key, url);
  return url;
}

/**
 * Project Board fork: Tack's pixel avatar. A clip is one image strip stepped by CSS, paused while
 * off screen, so it costs no timer and no script per frame.
 */
export function TackAvatar(props: {
  readonly skin: TackSkin;
  readonly motion: TackMotion;
  readonly mood: TackMood;
  /** Notes Tack has started writing; a rise while it works plays the note clip. */
  readonly notes?: number;
  /** Screen pixels per sprite pixel. */
  readonly scale: number;
  /** The mood Tack is taken to have had before it appeared, so appearing can be a reaction. */
  readonly from?: TackMood;
  /** Clicking Tack makes it wave. */
  readonly pokeable?: boolean;
  /** Rises each time Tack lands somewhere after crossing the board: the Plotter draws itself there. */
  readonly arrival?: number;
  readonly className?: string;
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [pen] = useTackPen();
  const motion = reduced ? "still" : props.motion;
  const notes = props.notes ?? 0;
  const [stored, setPlayback] = useState(() =>
    startTackPlayback(props.from ?? props.mood, notes, motion),
  );
  const playback = advanceTackPlayback(stored, props.mood, notes, motion);
  if (playback !== stored) setPlayback(playback);

  if (props.skin === "emoji")
    return (
      <span aria-hidden className={cn("text-base", props.className)}>
        📌
      </span>
    );

  const poke =
    props.pokeable === true ? () => setPlayback((current) => pokeTack(current, motion)) : undefined;
  if (props.skin === "plotter")
    return (
      <TackPlotter
        clip={playback.clip}
        mood={playback.mood}
        motion={motion}
        run={playback.run}
        held={playback.held}
        pen={pen}
        arrival={props.arrival ?? 0}
        size={Math.round(TACK_CELL.height * props.scale * 1.3)}
        onClipEnd={() => setPlayback((current) => finishTackClip(current, motion))}
        {...(poke === undefined ? {} : { onClick: poke })}
        {...(props.className === undefined ? {} : { className: props.className })}
      />
    );

  const { clip } = playback;
  const frames = TACK_CLIPS[clip].frames.length;
  const width = TACK_CELL.width * props.scale;
  const height = TACK_CELL.height * props.scale;
  const moving = clipMoves(clip, motion) && !playback.held;
  const style = {
    width,
    height,
    backgroundImage: `url(${stripUrl(props.skin, clip)})`,
    backgroundSize: `${frames * width}px ${height}px`,
    "--tack-strip-end": `-${frames * width}px`,
    animationName: moving ? "tack-strip" : "none",
    animationDuration: `${frames / TACK_CLIPS[clip].fps}s`,
    animationTimingFunction: `steps(${frames})`,
    animationIterationCount: clipRuns(clip, playback.mood) ?? "infinite",
  } as CSSProperties;
  return (
    <span
      key={`${clip}:${playback.run}`}
      ref={observeVisibleAnimation}
      aria-hidden
      data-tack-clip={clip}
      className={cn("tack-avatar block shrink-0", props.className)}
      style={style}
      onAnimationEnd={() => setPlayback((current) => finishTackClip(current, motion))}
      onClick={poke}
    />
  );
}
