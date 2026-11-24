import * as Schema from "effect/Schema";
import { useState, type CSSProperties } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";

import { TackPlotter } from "./TackPlotter";
import {
  advanceTackPlayback,
  cheerTack,
  clipMoves,
  clipRuns,
  finishTackClip,
  paintTackSign,
  paintTackStrip,
  pokeTack,
  releaseTack,
  ringTack,
  startTackPlayback,
  TACK_RELEASED,
  TACK_CELL,
  TACK_CLIPS,
  TACK_SIGN,
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

export type TackHold = "needs" | "calm";
export interface TackSignal {
  readonly at: number;
  /** release: Tack sends a Sub Tack off and stays where it is. */
  readonly kind: "ring" | "cheer" | "release";
}

const strips = new Map<string, string>();
const signs = new Map<string, string>();

function signUrl(count: number, hot: boolean): string {
  const key = `${count}:${hot}`;
  const cached = signs.get(key);
  if (cached !== undefined) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = TACK_SIGN.width;
  canvas.height = TACK_SIGN.height;
  const context = canvas.getContext("2d");
  if (context !== null)
    paintTackSign(count, hot, (x, y, color) => {
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    });
  const url = canvas.toDataURL();
  signs.set(key, url);
  return url;
}

/** The sign a pixel Tack plants beside itself while it holds notices: their count, red if urgent. */
export function TackSign(props: {
  readonly count: number;
  readonly hot: boolean;
  /** Screen pixels per sprite pixel, as the avatar beside it. */
  readonly scale: number;
  /** Rises when a notice arrives: the sign waves. */
  readonly wave: number;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      data-tack-sign={props.hot ? "hot" : "calm"}
      className={cn("tack-sign block shrink-0", props.className)}
      style={{
        width: TACK_SIGN.width * props.scale,
        height: TACK_SIGN.height * props.scale,
        backgroundImage: `url(${signUrl(Math.min(9, props.count), props.hot)})`,
        // Two names for one motion: alternating them replays it without remounting.
        animationName: props.wave === 0 ? "none" : props.wave % 2 ? "tack-sign-a" : "tack-sign-b",
      }}
    />
  );
}

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
  /** Tack holds a notice for the person: urgent ("needs") or only a result to look at ("calm"). */
  readonly hold?: TackHold | null;
  /** A reaction to play once: `at` rises for each. A ring for a notice, a cheer for good news. */
  readonly signal?: TackSignal;
  readonly className?: string;
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [pen] = useTackPen();
  const motion = reduced ? "still" : props.motion;
  const notes = props.notes ?? 0;
  const [stored, setPlayback] = useState(() =>
    startTackPlayback(props.from ?? props.mood, notes, motion),
  );
  const signalAt = props.signal?.at ?? 0;
  const [signalled, setSignalled] = useState(signalAt);
  // The run that releases a Sub Tack: it shows the release on top of its clip.
  const [releaseRun, setReleaseRun] = useState(-1);
  let reacted = stored;
  if (signalAt !== signalled) {
    setSignalled(signalAt);
    if (signalAt > signalled) {
      if (props.signal?.kind === "release") {
        reacted = releaseTack(stored, motion, props.skin);
        if (reacted !== stored) setReleaseRun(reacted.run);
      } else
        reacted =
          props.signal?.kind === "cheer" ? cheerTack(stored, motion) : ringTack(stored, motion);
    }
  }
  const playback = advanceTackPlayback(reacted, props.mood, notes, motion);
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
        hold={props.hold ?? null}
        size={Math.round(TACK_CELL.height * props.scale * 1.3)}
        onClipEnd={() => setPlayback((current) => finishTackClip(current, motion))}
        sketch={playback.clip === "write" && playback.run === releaseRun}
        {...(poke === undefined ? {} : { onClick: poke })}
        {...(props.className === undefined ? {} : { className: props.className })}
      />
    );

  const { clip } = playback;
  const frames = TACK_CLIPS[clip].frames.length;
  const width = TACK_CELL.width * props.scale;
  const height = TACK_CELL.height * props.scale;
  const moving = clipMoves(clip, motion) && !playback.held;
  const releasing = moving && clip === "alert" && playback.run === releaseRun;
  const style = {
    width,
    height,
    backgroundImage: `url(${stripUrl(props.skin, clip)})`,
    backgroundSize: `${frames * width}px ${height}px`,
    "--tack-strip-end": `-${frames * width}px`,
    // Releasing a Sub Tack, the strip plays under a squash of the whole sprite.
    animationName: releasing ? "tack-strip, tack-squash" : moving ? "tack-strip" : "none",
    animationDuration: `${frames / TACK_CLIPS[clip].fps}s${releasing ? ", 0.55s" : ""}`,
    animationTimingFunction: `steps(${frames})${releasing ? ", ease-out" : ""}`,
    animationIterationCount: `${clipRuns(clip, playback.mood) ?? "infinite"}${releasing ? ", 1" : ""}`,
  } as CSSProperties;
  return (
    <span
      key={`${clip}:${playback.run}`}
      ref={observeVisibleAnimation}
      aria-hidden
      data-tack-clip={clip}
      data-tack-release={releasing ? "" : undefined}
      className={cn("tack-avatar relative block shrink-0", props.className)}
      style={style}
      onAnimationEnd={(event) => {
        if (event.animationName === "tack-squash") window.dispatchEvent(new Event(TACK_RELEASED));
        else if (event.target === event.currentTarget)
          setPlayback((current) => finishTackClip(current, motion));
      }}
      onClick={poke}
    />
  );
}
