import { useState } from "react";
import { milestoneFor, scoreDelta, type ScoreGain } from "./scoreGain";

interface Tracked {
  cardId: string | null | undefined;
  score: number;
  gain: ScoreGain | null;
  nonce: number;
}

/**
 * The last save's gain on this card, or `null`.
 *
 * Remembers the previous score per card: the first score a card shows (and the
 * first after switching to another card) is a starting point, never a gain. A
 * rise while `enabled` returns `{ from, to, delta, milestone, nonce }`, with a
 * new `nonce` per rise so consumers can key their animations on it; a drop, an
 * unchanged score or `enabled = false` returns `null`. The gain stays until the
 * score next moves, so a re-render with the same score never replays it.
 *
 * Tracked in state adjusted during render (not a ref read in an effect), so the
 * gain is there on the very render that shows the new score.
 */
export function useScoreGain(
  cardId: string | null | undefined,
  score: number | null | undefined,
  enabled: boolean,
): ScoreGain | null {
  const value = score ?? 0;
  const [tracked, setTracked] = useState<Tracked>({
    cardId,
    score: value,
    gain: null,
    nonce: 0,
  });

  if (tracked.cardId !== cardId) {
    setTracked({ cardId, score: value, gain: null, nonce: tracked.nonce });
  } else if (tracked.score !== value) {
    const delta = enabled ? scoreDelta(tracked.score, value) : null;
    if (delta === null) {
      setTracked({ ...tracked, score: value, gain: null });
    } else {
      const nonce = tracked.nonce + 1;
      setTracked({
        cardId,
        score: value,
        nonce,
        gain: {
          from: tracked.score,
          to: value,
          delta,
          milestone: milestoneFor(tracked.score, value),
          nonce,
        },
      });
    }
  }

  const current = tracked.cardId === cardId && tracked.score === value;
  return enabled && current ? tracked.gain : null;
}
