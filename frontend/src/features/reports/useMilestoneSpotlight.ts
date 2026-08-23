import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cardsChangingBetween } from "./timelineRange";
import type { Lifecycle } from "./portfolioHelpers";
import type { TimelineMilestoneCard } from "@/components/TimelineSlider";
import { STATUS_COLORS, TIMELINE_COLORS } from "@/theme/tokens";

/** How long a mark-click spotlight lasts before the view settles back. */
export const PULSE_MS = 1600;

/** Which way a spotlighted card glows: going live, or retiring. */
export type PulseKind = "live" | "retire";

/**
 * A container pulsed on behalf of the cards inside it (the Capability Map's
 * boxes when app chips are hidden) can hold both an arriving and a retiring
 * card at once — "mixed" is that third, container-only state. Individual
 * cards are always exactly one of the two `PulseKind`s.
 */
export type ContainerPulseKind = PulseKind | "mixed";

/** Accent per pulse kind — the ring/row colour every spotlighting view uses. */
export const PULSE_COLORS: Record<ContainerPulseKind, string> = {
  live: TIMELINE_COLORS.goLive,
  retire: STATUS_COLORS.error,
  mixed: TIMELINE_COLORS.mixed,
};

/**
 * Keyframes for the mark-click spotlight, injected by each report while a
 * pulse is running. Two shapes on purpose: a box-shadow ring for card-shaped
 * DOM (chips, tree cards, capability boxes), and a background pulse for table
 * rows — MUI's table collapses its borders, and a collapsed-border `<tr>`
 * does not paint a box-shadow.
 */
export const TIMELINE_PULSE_KEYFRAMES = `
@keyframes tl-pulse-live { 0%,100% { box-shadow: 0 0 0 0 ${PULSE_COLORS.live}00 } 50% { box-shadow: 0 0 0 8px ${PULSE_COLORS.live}66 } }
@keyframes tl-pulse-retire { 0%,100% { box-shadow: 0 0 0 0 ${PULSE_COLORS.retire}00 } 50% { box-shadow: 0 0 0 8px ${PULSE_COLORS.retire}66 } }
@keyframes tl-pulse-mixed { 0%,100% { box-shadow: 0 0 0 0 ${PULSE_COLORS.mixed}00 } 50% { box-shadow: 0 0 0 8px ${PULSE_COLORS.mixed}66 } }
@keyframes tl-pulse-row-live { 0%,100% { background-color: ${PULSE_COLORS.live}1f } 50% { background-color: ${PULSE_COLORS.live}47 } }
@keyframes tl-pulse-row-retire { 0%,100% { background-color: ${PULSE_COLORS.retire}1f } 50% { background-color: ${PULSE_COLORS.retire}47 } }
`;

export interface MilestoneSpotlightOptions {
  /**
   * The cards the transition marks are computed from — the SAME scope the
   * report feeds `computeTimelineMilestones`, so a spotlight can never hit a
   * card the mark above it did not count.
   */
  scope: { id: string; name: string; lifecycle?: Lifecycle }[];
  /** Accent for a card's pill in the slider's pill row; undefined falls back
   *  to the slider's default. */
  getColor?: (id: string) => string | undefined;
}

export interface MilestoneSpotlight {
  /** Cards currently spotlighted, and which way each glows. */
  pulseCards: Record<string, PulseKind>;
  /** Retiring cards transiently revealed so the pulse has something to point
   *  at — reports OR this into their timeline visibility filter. */
  revealedForPulse: Set<string>;
  /** True while a spotlight is running — gates the keyframes `<style>` and
   *  the dim-the-rest styling. */
  pulsing: boolean;
  spotlight: (hit: Record<string, PulseKind>, reveal: Set<string>) => void;
  /** `TimelineSlider`'s `onMilestoneClick`. */
  handleMilestoneClick: (from: number, to: number) => void;
  /** `TimelineSlider`'s `milestoneCards`. */
  milestoneCards: (from: number, to: number) => TimelineMilestoneCard[];
  /** `TimelineSlider`'s `onMilestoneCardClick`. */
  handleMilestoneCardClick: (card: TimelineMilestoneCard) => void;
}

/**
 * The mark-click spotlight state machine shared by every timeline-bearing
 * report (Dependencies, Portfolio, Capability Map): clicking a transition
 * mark — or stepping to one with the arrows — pulses the cards that change
 * there for ~1.6s, transiently revealing retiring cards the view would
 * otherwise hide. Transient by design: the persistent badges/ghosts already
 * state what each card is, the click only answers "which one just changed?".
 */
export function useMilestoneSpotlight({
  scope,
  getColor,
}: MilestoneSpotlightOptions): MilestoneSpotlight {
  const [pulseCards, setPulseCards] = useState<Record<string, PulseKind>>({});
  // A retirement mark clicked while retired cards are hidden has nothing to
  // point at, so the subjects are revealed for the duration of the pulse and
  // then hidden again — the report's own visibility rule is not changed, only
  // briefly overridden.
  const [revealedForPulse, setRevealedForPulse] = useState<Set<string>>(new Set());
  const pulseTimer = useRef<number | null>(null);

  const spotlight = useCallback((hit: Record<string, PulseKind>, reveal: Set<string>) => {
    if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    setPulseCards(hit);
    setRevealedForPulse(reveal);
    pulseTimer.current = window.setTimeout(() => {
      setPulseCards({});
      setRevealedForPulse(new Set());
      pulseTimer.current = null;
    }, PULSE_MS);
  }, []);

  const handleMilestoneClick = useCallback(
    (from: number, to: number) => {
      const hit: Record<string, PulseKind> = {};
      const reveal = new Set<string>();
      // A card that arrives AND retires inside one merged span is listed
      // twice, but it is ONE node on the canvas and can only glow one colour.
      // `cardsChangingBetween` sorts activating first, so the retirement — the
      // later fact, and the one that decides whether the card is still there
      // when the span is out — overwrites the arrival. Its own pill still
      // pulses the other way when clicked directly.
      for (const c of cardsChangingBetween(scope, from, to)) {
        if (c.kind === "disappearing") {
          hit[c.id] = "retire";
          reveal.add(c.id);
        } else {
          hit[c.id] = "live";
        }
      }
      spotlight(hit, reveal);
    },
    [scope, spotlight],
  );

  // The same cards, named, for the pill row the slider renders under the
  // marks. Built from `scope` — what the marks themselves are computed from —
  // so a pill can never name a card the mark above it did not count.
  const milestoneCards = useCallback(
    (from: number, to: number) =>
      cardsChangingBetween(scope, from, to).map((c) => ({
        ...c,
        color: getColor?.(c.id),
      })),
    [scope, getColor],
  );

  const handleMilestoneCardClick = useCallback(
    (card: TimelineMilestoneCard) => {
      const retiring = card.kind === "disappearing";
      spotlight(
        { [card.id]: retiring ? "retire" : "live" },
        retiring ? new Set([card.id]) : new Set(),
      );
    },
    [spotlight],
  );

  useEffect(
    () => () => {
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    },
    [],
  );

  const pulsing = useMemo(() => Object.keys(pulseCards).length > 0, [pulseCards]);

  return {
    pulseCards,
    revealedForPulse,
    pulsing,
    spotlight,
    handleMilestoneClick,
    milestoneCards,
    handleMilestoneCardClick,
  };
}
