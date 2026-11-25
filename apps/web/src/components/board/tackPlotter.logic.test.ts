import { describe, expect, it } from "vite-plus/test";

import {
  plotterPenPath,
  plotterRetrace,
  plotterSpeed,
  plotterTimeline,
  wobblePath,
} from "./tackPlotter.logic";

describe("plotterTimeline", () => {
  const strokes = [
    { length: 300, hop: 0 },
    { length: 150, hop: 90 },
    { length: 90, hop: 30 },
  ];

  it("fits a drawing in 0.9 s at app speed, pen-up moves included", () => {
    const { total, steps } = plotterTimeline(strokes, "app", true);
    expect(total).toBeCloseTo(900);
    // Each stroke starts after the one before it and the hop to it.
    expect(steps[1]?.delay).toBeCloseTo(steps[0]!.delay + steps[0]!.duration + 90 / (660 / 900));
  });

  it("never crawls on a short drawing, and drops hops when they are off", () => {
    const { total, steps } = plotterTimeline([{ length: 70, hop: 0 }], "app", false);
    expect(total).toBeCloseTo(100);
    expect(plotterTimeline(strokes, "app", false).steps[1]?.delay).toBeCloseTo(
      steps[0]!.duration * (300 / 70),
    );
  });

  it("takes the fixed speeds as they are", () => {
    expect(plotterSpeed("slow", 5000)).toBe(520);
    expect(plotterSpeed("fast", 10)).toBe(3600);
  });
});

describe("plotterRetrace", () => {
  it("eats the last stroke first", () => {
    const { steps } = plotterRetrace([100, 200], "slow");
    expect(steps[1]?.delay).toBe(0);
    expect(steps[0]?.delay).toBeCloseTo(steps[1]!.duration);
  });
});

describe("plotterPenPath", () => {
  it("joins strokes with pen-up lines only when hops are shown", () => {
    expect(plotterPenPath(["M0 0L5 5", "M9 9L1 1"], true)).toBe("M0 0L5 5L9 9L1 1");
    expect(plotterPenPath(["M0 0L5 5", "M9 9L1 1"], false)).toBe("M0 0L5 5M9 9L1 1");
  });

  it("closes a stroke onto its own start, not the first stroke's", () => {
    expect(plotterPenPath(["M0 0L5 5", "M9 9L1 1L1 9Z"], true)).toBe("M0 0L5 5L9 9L1 1L1 9L9 9");
  });
});

describe("wobblePath", () => {
  it("nudges coordinates slightly and leaves arcs alone", () => {
    const wobbled = wobblePath("M10 10L50 50", 1);
    const numbers = wobbled.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers).toHaveLength(4);
    for (const [i, value] of [10, 10, 50, 50].entries())
      expect(Math.abs((numbers[i] ?? 0) - value)).toBeLessThan(0.61);
    expect(wobblePath("M0 0a2 2 0 1 0 4 0", 1)).toBe("M0 0a2 2 0 1 0 4 0");
    expect(wobblePath("M10 10L50 50", 1)).toBe(wobbled);
  });
});
