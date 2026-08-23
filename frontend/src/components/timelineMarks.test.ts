import { describe, it, expect } from "vitest";
import {
  MIN_LABEL_SPACING_PX,
  NOMINAL_TRACK_PX,
  thinYearLabels,
  type ThinnedMark,
  type YearMark,
} from "./timelineMarks";

const YEAR = 365.25 * 86_400_000;
const jan1 = (y: number) => new Date(y, 0, 1).getTime();

/** Consecutive January-1 ticks, exactly as `computeTimelineRange` emits them. */
const years = (from: number, to: number): YearMark[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    value: jan1(from + i),
    label: String(from + i),
  }));

/** The ±1 year padded range those ticks sit inside. */
const paddedRange = (from: number, to: number) => ({
  min: jan1(from) - YEAR,
  max: jan1(to) + YEAR,
});

const labelled = (marks: ThinnedMark[]) =>
  marks.filter((m) => m.label != null).map((m) => m.label);

const labelledIndices = (marks: ThinnedMark[]) =>
  marks.flatMap((m, i) => (m.label != null ? [i] : []));

/** Where each labelled mark lands, in pixels, exactly as MUI positions it. */
const labelledPositions = (
  marks: ThinnedMark[],
  range: { min: number; max: number },
  width: number,
) =>
  marks
    .flatMap((m) => (m.label != null ? [m.value] : []))
    .map((v) => ((v - range.min) / (range.max - range.min)) * width);

describe("thinYearLabels", () => {
  it("labels an even stride and never forces the last mark", () => {
    // The reported bug: 2017…2034 is 18 marks, so a stride of 2 labels index 16
    // (2033) and stops. The old code additionally force-labelled index 17,
    // putting 2034 one stride after 2033 on an axis whose every other pair was
    // two strides apart — so the two collided.
    const marks = years(2017, 2034);
    // 18 marks across a 19-year padded span: at 480px a year is ~25px, so a
    // stride of 2 clears the 48px budget and a stride of 1 does not.
    const out = thinYearLabels(marks, paddedRange(2017, 2034), 480);

    expect(labelled(out)).toEqual([
      "2017",
      "2019",
      "2021",
      "2023",
      "2025",
      "2027",
      "2029",
      "2031",
      "2033",
    ]);
    expect(labelled(out)).not.toContain("2034");
    expect(out.at(-1)?.label).toBeUndefined();
  });

  it("keeps a tick for every mark, in order, whatever the width", () => {
    const marks = years(2017, 2034);
    for (const width of [40, 120, 440, 900, 4000]) {
      const out = thinYearLabels(marks, paddedRange(2017, 2034), width);
      expect(out).toHaveLength(marks.length);
      expect(out.map((m) => m.value)).toEqual(marks.map((m) => m.value));
    }
  });

  it("drops a label rather than emitting an empty string", () => {
    // MUI renders a markLabel span whenever `label != null`, so `""` would put a
    // stray empty span in the DOM for every unlabelled year.
    const out = thinYearLabels(years(2017, 2034), paddedRange(2017, 2034), 440);
    expect(out.some((m) => m.label === "")).toBe(false);
    for (const m of out) {
      if (m.label != null) expect(m.label).toBe(String(new Date(m.value).getFullYear()));
    }
  });

  it("keeps every labelled pair at least MIN_LABEL_SPACING_PX apart", () => {
    // Property sweep: the invariant the hook exists to enforce, checked in real
    // pixels rather than by counting marks against the width.
    for (let n = 2; n <= 40; n++) {
      const marks = years(2000, 2000 + n - 1);
      const range = paddedRange(2000, 2000 + n - 1);
      for (let width = 60; width <= 1000; width += 7) {
        const out = thinYearLabels(marks, range, width);
        const pos = labelledPositions(out, range, width);
        if (pos.length <= 1) continue; // one label can never collide
        for (let i = 1; i < pos.length; i++)
          expect(pos[i] - pos[i - 1]).toBeGreaterThanOrEqual(MIN_LABEL_SPACING_PX);
      }
    }
  });

  it("labels on a single stride, and never a wider one than needed", () => {
    for (let n = 2; n <= 40; n++) {
      const marks = years(2000, 2000 + n - 1);
      const range = paddedRange(2000, 2000 + n - 1);
      for (let width = 60; width <= 1000; width += 13) {
        const out = thinYearLabels(marks, range, width);
        const idx = labelledIndices(out);
        if (idx.length <= 1) continue;

        // Equidistant: the labelled set is exactly {0, k, 2k, …}.
        const k = idx[1] - idx[0];
        expect(idx).toEqual(
          Array.from({ length: Math.floor((n - 1) / k) + 1 }, (_, i) => i * k),
        );

        // Tightest gap on the lattice a given stride would label. Calendar
        // years are not all the same length, so this is a real minimum over
        // the pairs, not the pitch times the stride.
        const all = marks.map((m) => ((m.value - range.min) / (range.max - range.min)) * width);
        const minLatticeGap = (stride: number) => {
          let gap = Infinity;
          for (let i = 0; i + stride < n; i += stride)
            gap = Math.min(gap, all[i + stride] - all[i]);
          return gap;
        };

        expect(minLatticeGap(k)).toBeGreaterThanOrEqual(MIN_LABEL_SPACING_PX);
        // Minimal: one stride tighter would have collided.
        if (k > 1) expect(minLatticeGap(k - 1)).toBeLessThan(MIN_LABEL_SPACING_PX);
      }
    }
  });

  it("labels every year when there is room, last one included", () => {
    const out = thinYearLabels(years(2017, 2034), paddedRange(2017, 2034), 1600);
    expect(labelled(out)).toHaveLength(18);
    expect(labelled(out)).toContain("2034");
  });

  it("falls back to a single label when not even two fit", () => {
    const out = thinYearLabels(years(2017, 2034), paddedRange(2017, 2034), 24);
    expect(labelled(out)).toEqual(["2017"]);
    expect(out).toHaveLength(18);
  });

  it("handles empty and single-mark inputs", () => {
    expect(thinYearLabels([], paddedRange(2020, 2020), 400)).toEqual([]);
    const one = thinYearLabels(years(2020, 2020), paddedRange(2020, 2020), 400);
    expect(labelled(one)).toEqual(["2020"]);
  });

  it("falls back to a nominal width before the first measurement", () => {
    // jsdom and the first paint both report clientWidth 0; thinning against 0
    // would drop every label, so the marks would vanish rather than merely
    // render at the wrong density.
    const marks = years(2017, 2034);
    const range = paddedRange(2017, 2034);
    const expected = thinYearLabels(marks, range, NOMINAL_TRACK_PX);
    for (const width of [0, -10, NaN, Infinity])
      expect(thinYearLabels(marks, range, width)).toEqual(expected);
  });

  it("survives a degenerate range without leaking NaN", () => {
    const marks = years(2017, 2020);
    const out = thinYearLabels(marks, { min: jan1(2018), max: jan1(2018) }, 400);
    expect(labelled(out)).toEqual(["2017"]);
    expect(out.every((m) => Number.isFinite(m.value))).toBe(true);
  });

  it("keeps the spacing guarantee on irregularly spaced marks", () => {
    // Not a shape computeTimelineRange produces today, but the guarantee must
    // come from the pixel positions rather than from an assumption of an even
    // lattice.
    const marks: YearMark[] = [2010, 2011, 2012, 2030, 2031].map((y) => ({
      value: jan1(y),
      label: String(y),
    }));
    const range = { min: jan1(2009), max: jan1(2032) };
    for (const width of [200, 440, 900]) {
      const out = thinYearLabels(marks, range, width);
      const pos = labelledPositions(out, range, width);
      for (let i = 1; i < pos.length; i++)
        expect(pos[i] - pos[i - 1]).toBeGreaterThanOrEqual(MIN_LABEL_SPACING_PX);
    }
  });
});
