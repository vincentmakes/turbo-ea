/**
 * Gamified data quality — the pure part: what counts as a gain, which gains
 * are milestones, the motion timings, and the keyframes every animated piece
 * shares.
 *
 * Reward, never punish: only a rise in the score is a gain. A drop updates the
 * number and nothing moves. Celebrations (confetti) are rare on purpose: only
 * entering the green band and reaching 100 earn one.
 *
 * Every animation is CSS on `transform` / `opacity` (compositor-friendly),
 * declared once in `DQ_MOTION_CSS` and injected by `useDqMotionStyles()`. The
 * keyframes and the classes that run them sit inside
 * `@media (prefers-reduced-motion: no-preference)`, so a reader who asked their
 * operating system for less motion gets none of it even where a component
 * forgot to check `useReducedMotion()`.
 */
import { STATUS_COLORS, brand } from "@/theme/tokens";
import { bandOf } from "@/lib/dataQualityBands";

export type ScoreMilestone = "complete" | "perfect";

/** One save that raised a card's score. `nonce` tells consecutive gains apart. */
export interface ScoreGain {
  from: number;
  to: number;
  /** `to - from`, one decimal. */
  delta: number;
  milestone: ScoreMilestone | null;
  nonce: number;
}

/** The fill of the bar and the count of the figure. */
export const FILL_MS = 500;
/** How long the bar holds at the old score, the gain shown ahead of it. */
export const GHOST_HOLD_MS = 400;
/** The pill's pop. */
export const POP_MS = 300;
/** The flying "+X%". */
export const FLOAT_MS = 900;
/** The milestone confetti and caption. */
export const CONFETTI_MS = 1200;
/** How long the reduced-motion "+X%" chip stays. */
export const STATIC_CHIP_MS = 2000;
/** Material 3 standard-decelerate: fills. */
export const EASE_DECELERATE = "cubic-bezier(0, 0, 0, 1)";
/** A small overshoot: the pop, never the bar. */
export const EASE_OVERSHOOT = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Particles in a milestone burst. */
export const CONFETTI_COUNT = 14;
/** The colours the confetti cycles through. */
export const CONFETTI_COLORS = [
  STATUS_COLORS.success,
  STATUS_COLORS.info,
  STATUS_COLORS.warning,
  brand.primary,
] as const;

/** The rise from `prev` to `next`, one decimal; `null` unless the score went up. */
export function scoreDelta(prev: number, next: number): number | null {
  if (!(next > prev)) return null;
  const delta = Math.round((next - prev) * 10) / 10;
  return delta > 0 ? delta : null;
}

/** The milestone a rise reaches, if any: 100 first, then entering the green band. */
export function milestoneFor(prev: number, next: number): ScoreMilestone | null {
  if (next >= 100 && prev < 100) return "perfect";
  if (bandOf(next) === "complete" && bandOf(prev) !== "complete") return "complete";
  return null;
}

/** Whether the score moved into another colour band. */
export function bandChanged(prev: number, next: number): boolean {
  return bandOf(prev) !== bandOf(next);
}

/** How long after the burst the live region keeps its text before clearing. */
export const ANNOUNCEMENT_LINGER_MS = 500;

/** What assistive tech hears for a gain: the figure, then the milestone caption. */
export function gainAnnouncement(
  gain: ScoreGain,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const caption =
    gain.milestone === "perfect"
      ? t("dataQuality.milestonePerfect")
      : gain.milestone === "complete"
        ? t("dataQuality.milestoneComplete")
        : null;
  return [t("dataQuality.gainAnnouncement", { pct: gain.delta }), caption]
    .filter(Boolean)
    .join(" ");
}

/** How long a gain's burst stays mounted: its longest piece, or the static chip. */
export function burstLifetime(gain: ScoreGain, reduced: boolean): number {
  if (reduced) return STATIC_CHIP_MS;
  return gain.milestone ? CONFETTI_MS : FLOAT_MS;
}

/** Where the i-th confetti particle flies: an even spread over 360°, 28–56 px out. */
export function confettiParticle(i: number): {
  dx: number;
  dy: number;
  rotate: number;
  color: string;
} {
  const angle = (i * 2 * Math.PI) / CONFETTI_COUNT;
  const distance = 28 + ((i * 7) % 15) * 2;
  return {
    dx: Math.round(Math.cos(angle) * distance),
    dy: Math.round(Math.sin(angle) * distance),
    rotate: (i % 2 === 0 ? 1 : -1) * (180 + i * 20),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  };
}

/** The `<style>` element's id, so the CSS is injected once per document. */
export const DQ_MOTION_STYLE_ID = "dq-motion-styles";

/**
 * Keyframes and the classes that play them. `dq-pop-alt` is `dq-pop` under
 * another name: alternating the two restarts the pop on every gain without
 * remounting the pill.
 */
export const DQ_MOTION_CSS = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes dq-float-up { from { transform: translateY(0); opacity: 1 } to { transform: translateY(-24px); opacity: 0 } }
  @keyframes dq-pop { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.08) } }
  @keyframes dq-pop-alt { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.08) } }
  @keyframes dq-glow { from { transform: scale(1); opacity: 0.8 } to { transform: scale(1.35); opacity: 0 } }
  @keyframes dq-confetti { from { transform: translate(0, 0) rotate(0deg); opacity: 1 } to { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0 } }
  .dq-float { animation: dq-float-up ${FLOAT_MS}ms ${EASE_DECELERATE} forwards }
  .dq-caption { animation: dq-float-up ${CONFETTI_MS}ms ${EASE_DECELERATE} forwards }
  .dq-pop { animation: dq-pop ${POP_MS}ms ${EASE_OVERSHOOT} }
  .dq-pop.dq-pop-alt { animation-name: dq-pop-alt }
  .dq-glow { animation: dq-glow ${FILL_MS}ms ${EASE_DECELERATE} forwards }
  .dq-confetti { animation: dq-confetti ${CONFETTI_MS}ms ${EASE_DECELERATE} forwards }
}
@media (prefers-reduced-motion: reduce) {
  .dq-float, .dq-caption, .dq-pop, .dq-glow, .dq-confetti, .dq-fill { animation: none !important; transition: none !important }
}
`;

/** Add `DQ_MOTION_CSS` to the document once; later calls do nothing. */
export function injectDqMotionStyles(doc: Document = document): void {
  if (doc.getElementById(DQ_MOTION_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = DQ_MOTION_STYLE_ID;
  style.textContent = DQ_MOTION_CSS;
  doc.head.appendChild(style);
}
