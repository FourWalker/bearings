import { useTackLook } from "./TackAvatar";

/**
 * Project Board fork: under the Plotter theme or with Tack's Plotter skin, an opening task or module
 * is drawn first: a pen dot runs the card's edge, then the contents appear. Pure CSS, played once
 * as the view mounts, and hidden in every other case (see tack-plotter.css).
 */
export function PlotterCardDraw() {
  const [look] = useTackLook();
  return (
    <div
      aria-hidden
      className="plotter-card-draw"
      data-skin={look.skin === "plotter" ? "" : undefined}
      data-still={look.motion === "still" ? "" : undefined}
    >
      <svg role="presentation">
        <rect pathLength={1} />
      </svg>
      <span className="plotter-card-pen" />
    </div>
  );
}
