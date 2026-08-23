/**
 * Year-label thinning for the Time Travel slider.
 *
 * Pure and separate from `TimelineSlider.tsx` so the stride maths can be tested
 * without rendering MUI — this is the part that was wrong (#timeline-labels),
 * and rendering a slider to assert label spacing is far more expensive than
 * calling a function.
 */

/** A year tick as `computeTimelineRange` emits it. */
export interface YearMark {
  value: number;
  label: string;
}

/** A tick after thinning: every mark survives, only the label may be dropped. */
export interface ThinnedMark {
  value: number;
  label?: string;
}

/**
 * Minimum centre-to-centre gap between two year labels. A 4-digit year at
 * 0.68rem / weight 600 is ~26px wide, so 48px leaves ~22px of air. Grow this if
 * the label format ever gains characters (a quarter, a localized suffix).
 */
export const MIN_LABEL_SPACING_PX = 48;

/**
 * Width assumed before the first measurement. Both jsdom and the first paint
 * report `clientWidth` 0, and thinning against 0 would drop every label, so the
 * marks would vanish rather than merely render at the wrong density.
 */
export const NOMINAL_TRACK_PX = 400;

/**
 * Keep a tick for every mark, but label only a subset so the labels never
 * collide.
 *
 * Labels land on a fixed stride — indices `0, k, 2k, …` — so the gap between
 * any two neighbouring labels is the same number of years. The previous
 * implementation additionally force-labelled the LAST mark, which is exactly
 * how `2033` and `2034` ended up one stride apart on an axis whose every other
 * pair was two: with 18 marks and a stride of 2, index 16 is labelled by the
 * stride and index 17 was labelled by the special case. A trailing partial
 * stride now simply goes unlabelled — equidistance beats labelling the end.
 *
 * `k` is chosen from REAL pixel positions rather than by counting marks against
 * the width, so `minSpacingPx` is an actual guarantee and not an approximation
 * that holds only while the marks are evenly spread.
 *
 * Thinned marks carry `label: undefined`, never `""`: MUI renders a markLabel
 * span whenever `label != null`, so an empty string would emit a stray empty
 * span for every unlabelled year.
 */
export function thinYearLabels(
  marks: readonly YearMark[],
  range: { min: number; max: number },
  width: number,
  minSpacingPx: number = MIN_LABEL_SPACING_PX,
): ThinnedMark[] {
  const n = marks.length;
  if (n === 0) return [];
  if (n === 1) return [{ value: marks[0].value, label: marks[0].label }];

  /** One label always fits; it is the second that can collide with it. */
  const firstOnly = (): ThinnedMark[] =>
    marks.map((m, i) => (i === 0 ? { value: m.value, label: m.label } : { value: m.value }));

  const px = width > 0 && Number.isFinite(width) ? width : NOMINAL_TRACK_PX;
  const span = range.max - range.min;
  // A degenerate range maps every mark to the same pixel, so no stride can
  // separate them.
  if (!(span > 0)) return firstOnly();

  const pos = (i: number) => ((marks[i].value - range.min) / span) * px;

  for (let k = 1; k < n; k++) {
    let fits = true;
    // Only pairs that actually get labels matter: (0,k), (k,2k), …
    for (let i = 0; i + k < n; i += k) {
      if (pos(i + k) - pos(i) < minSpacingPx) {
        fits = false;
        break;
      }
    }
    if (fits)
      return marks.map((m, i) =>
        i % k === 0 ? { value: m.value, label: m.label } : { value: m.value },
      );
  }

  // Narrower than a single stride: one label, so nothing can overlap.
  return firstOnly();
}
