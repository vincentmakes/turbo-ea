import { useCallback, useState } from "react";
import { milestoneFor, scoreDelta, scoreDrop, type ScoreGain } from "./scoreGain";

/** Where the latest save came from: a section's DOM id, and a nonce per save. */
export interface SaveOrigin {
  anchor: string;
  nonce: number;
}

interface Tracked {
  cardId: string | null | undefined;
  score: number;
  gain: ScoreGain | null;
  nonce: number;
  /** The nonce of the last origin seen, so each is stamped on one change at most. */
  originNonce: number | null;
}

/**
 * The last save's change to this card's score, or `null`.
 *
 * Remembers the previous score per card: the first score a card shows (and the
 * first after switching to another card) is a starting point, never a change.
 * While `enabled`, a rise returns `{ from, to, delta, milestone, nonce,
 * direction: "gain", originAnchor }` and a drop the same with
 * `direction: "loss"`, a negative `delta` and no milestone; a new `nonce` per
 * change lets consumers key their animations on it. An unchanged score or
 * `enabled = false` returns `null`. The change stays until the score next
 * moves, so a re-render with the same score never replays it.
 *
 * `origin` is where the save came from (`CardDetailContent`'s `onSaveOrigin`).
 * The section reports it in the same tick as the card update, so the render
 * that brings a new origin nonce is the render that brings the new score: the
 * change is stamped with that anchor. A new origin whose save left the score
 * where it was is dropped, so it never travels to a later header save.
 *
 * Tracked in state adjusted during render (not a ref read in an effect), so the
 * change is there on the very render that shows the new score.
 */
export function useScoreGain(
  cardId: string | null | undefined,
  score: number | null | undefined,
  enabled: boolean,
  origin: SaveOrigin | null = null,
): ScoreGain | null {
  const value = score ?? 0;
  const originNonce = origin?.nonce ?? null;
  const [tracked, setTracked] = useState<Tracked>({
    cardId,
    score: value,
    gain: null,
    nonce: 0,
    originNonce,
  });
  const freshOrigin = origin && originNonce !== tracked.originNonce ? origin.anchor : null;

  if (tracked.cardId !== cardId) {
    setTracked({ cardId, score: value, gain: null, nonce: tracked.nonce, originNonce });
  } else if (tracked.score !== value) {
    const rise = enabled ? scoreDelta(tracked.score, value) : null;
    const drop = enabled && rise === null ? scoreDrop(tracked.score, value) : null;
    const delta = rise ?? drop;
    if (delta === null) {
      setTracked({ ...tracked, score: value, gain: null, originNonce });
    } else {
      const nonce = tracked.nonce + 1;
      setTracked({
        cardId,
        score: value,
        nonce,
        originNonce,
        gain: {
          from: tracked.score,
          to: value,
          delta,
          milestone: rise === null ? null : milestoneFor(tracked.score, value),
          nonce,
          direction: rise === null ? "loss" : "gain",
          originAnchor: freshOrigin,
        },
      });
    }
  } else if (originNonce !== tracked.originNonce) {
    setTracked({ ...tracked, originNonce });
  }

  const current = tracked.cardId === cardId && tracked.score === value;
  return enabled && current ? tracked.gain : null;
}

/**
 * Where the latest save came from, for `useScoreGain`: the state, and the
 * stable callback to hand `CardDetailContent` as `onSaveOrigin`. Each report
 * gets a new nonce, so a second save from the same section is a new origin.
 */
export function useSaveOrigin(): [SaveOrigin | null, (anchor: string) => void] {
  const [origin, setOrigin] = useState<SaveOrigin | null>(null);
  const report = useCallback((anchor: string) => {
    setOrigin((prev) => ({ anchor, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  return [origin, report];
}
