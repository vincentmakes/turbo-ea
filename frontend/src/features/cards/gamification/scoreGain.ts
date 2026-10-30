/**
 * Gamified data quality — the pure part: what counts as a gain or a loss,
 * which gains are milestones, the motion timings, and the keyframes every
 * animated piece shares.
 *
 * Reward, never punish: a rise is celebrated (the "+X%" flies from the saved
 * section to the health bar, which flashes and glows on impact). A drop is the
 * toned-down mirror — the "−X%" flies off the bar back to where the data was
 * cleared, the bar drains, and nothing flashes or bursts. Celebrations
 * (confetti) are rare on purpose: only entering the green band and reaching
 * 100 earn one.
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

/** Whether a save raised the score or lowered it. */
export type ScoreDirection = "gain" | "loss";

/**
 * One save that moved a card's score. `nonce` tells consecutive changes apart.
 * A loss has a negative `delta` and never a milestone.
 */
export interface ScoreGain {
  from: number;
  to: number;
  /** `to - from`, one decimal: positive for a gain, negative for a loss. */
  delta: number;
  milestone: ScoreMilestone | null;
  nonce: number;
  direction: ScoreDirection;
  /** The DOM id of the section the save came from, or `null` (a header save). */
  originAnchor: string | null;
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
/** The orb's flight from the saved section to the bar (or back, for a loss). */
export const FLIGHT_MS = 650;
/** The white hit flash on impact. */
export const IMPACT_FLASH_MS = 180;
/** The halo ring that expands from the bar on impact. */
export const HALO_MS = 500;
/** The light sweeping across the bar on impact. */
export const SHINE_MS = 500;
/** The impact glow (a static shadow on a wrapper whose opacity fades). */
export const IMPACT_GLOW_MS = 600;
/** The figure dimming as points leave the bar. */
export const DIM_MS = 300;
/** Material 3 standard: the orb's flight. */
export const EASE_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)";
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

/** The drop from `prev` to `next` as a negative number, one decimal; `null`
 * unless the score went down by at least a tenth. */
export function scoreDrop(prev: number, next: number): number | null {
  if (!(next < prev)) return null;
  const delta = Math.round((next - prev) * 10) / 10;
  return delta < 0 ? delta : null;
}

/** How a change reads on screen: "+6.7%" or "−6.7%" (a true minus sign). */
export function changeLabel(change: ScoreGain): string {
  return change.direction === "loss" ? `\u2212${Math.abs(change.delta)}%` : `+${change.delta}%`;
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

/** What assistive tech hears for a change: the figure, then a gain's milestone
 * caption. */
export function gainAnnouncement(
  gain: ScoreGain,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (gain.direction === "loss") {
    return t("dataQuality.lossAnnouncement", { pct: Math.abs(gain.delta) });
  }
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

/** How long a burst stays mounted: its longest piece, or the static chip. A
 * loss never celebrates. */
export function burstLifetime(gain: ScoreGain, reduced: boolean): number {
  if (reduced) return STATIC_CHIP_MS;
  return gain.direction === "gain" && gain.milestone ? CONFETTI_MS : FLOAT_MS;
}

/** A point on the screen, in viewport pixels. */
export interface FlightPoint {
  x: number;
  y: number;
}

/** How far below the section's top edge the orb leaves from: its header row. */
export const ORIGIN_HEADER_OFFSET = 24;

/** Where the orb leaves a section from: its header row, at the centre of its
 * right third (where the edit pencil and Save sit). */
export function originPoint(rect: Pick<DOMRect, "left" | "top" | "width">): FlightPoint {
  return { x: rect.left + (rect.width * 5) / 6, y: rect.top + ORIGIN_HEADER_OFFSET };
}

/** The middle of the bar the orb lands on. */
export function centrePoint(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): FlightPoint {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Keyframes in a flight. */
export const FLIGHT_FRAMES = 14;

/** How far above the straight line the arc's control point sits: 30 % of the
 * distance, held between 60 and 120 px. */
export function flightLift(from: FlightPoint, to: FlightPoint): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(60, Math.min(120, distance * 0.3));
}

/** The point at `t` (0–1) on the quadratic arc from `from` to `to`. */
export function flightPoint(from: FlightPoint, to: FlightPoint, t: number): FlightPoint {
  const lift = flightLift(from, to);
  const c = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - lift };
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * c.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * c.y + t * t * to.y,
  };
}

/**
 * The orb's Web Animations keyframes: `FLIGHT_FRAMES` points along the arc,
 * centred on each point, shrinking from 1 to 0.75. A gain stays opaque until
 * 85 % of the way and fades on arrival; a loss fades over its last 30 %.
 * `opacity` scales the whole curve, for the gain's fainter trailing copies.
 */
export function flightKeyframes(
  from: FlightPoint,
  to: FlightPoint,
  direction: ScoreDirection,
  opacity = 1,
): Keyframe[] {
  const fadeFrom = direction === "loss" ? 0.7 : 0.85;
  return Array.from({ length: FLIGHT_FRAMES }, (_, i) => {
    const t = i / (FLIGHT_FRAMES - 1);
    const p = flightPoint(from, to, t);
    const scale = 1 - 0.25 * t;
    const visible = t <= fadeFrom ? 1 : 1 - (t - fadeFrom) / (1 - fadeFrom);
    return {
      offset: t,
      transform: `translate(${round2(p.x)}px, ${round2(p.y)}px) translate(-50%, -50%) scale(${round2(scale)})`,
      opacity: round2(visible * opacity),
    };
  });
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
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
  @keyframes dq-flash { from { opacity: 0.85 } to { opacity: 0 } }
  @keyframes dq-halo { from { transform: scale(1); opacity: 0.8 } to { transform: scale(1.7); opacity: 0 } }
  @keyframes dq-impact-glow { from { opacity: 1 } to { opacity: 0 } }
  @keyframes dq-shine { from { transform: translateX(-100%) } to { transform: translateX(250%) } }
  @keyframes dq-dim { 0%, 100% { opacity: 1 } 50% { opacity: 0.7 } }
  .dq-float { animation: dq-float-up ${FLOAT_MS}ms ${EASE_DECELERATE} forwards }
  .dq-caption { animation: dq-float-up ${CONFETTI_MS}ms ${EASE_DECELERATE} forwards }
  .dq-pop { animation: dq-pop ${POP_MS}ms ${EASE_OVERSHOOT} }
  .dq-pop.dq-pop-alt { animation-name: dq-pop-alt }
  .dq-glow { animation: dq-glow ${FILL_MS}ms ${EASE_DECELERATE} forwards }
  .dq-confetti { animation: dq-confetti ${CONFETTI_MS}ms ${EASE_DECELERATE} forwards }
  .dq-flash { animation: dq-flash ${IMPACT_FLASH_MS}ms ease-out forwards }
  .dq-halo { animation: dq-halo ${HALO_MS}ms ${EASE_DECELERATE} forwards }
  .dq-impact-glow { animation: dq-impact-glow ${IMPACT_GLOW_MS}ms ease-out forwards }
  .dq-shine { animation: dq-shine ${SHINE_MS}ms ${EASE_DECELERATE} forwards }
  .dq-dim { animation: dq-dim ${DIM_MS}ms ease-in-out }
}
@media (prefers-reduced-motion: reduce) {
  .dq-float, .dq-caption, .dq-pop, .dq-glow, .dq-confetti, .dq-fill, .dq-flash, .dq-halo, .dq-impact-glow, .dq-shine, .dq-dim { animation: none !important; transition: none !important }
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
