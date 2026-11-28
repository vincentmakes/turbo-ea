import { createContext, useContext } from "react";

/** Runs one write of the card page's own and resolves with its result. */
export type TrackOwnCardWrite = <T>(run: () => Promise<T>) => Promise<T>;

/**
 * How a section of a card page writes something of this card (a relation, a
 * tag, the hierarchy) when the card itself is stored later, or not at all: it
 * WRAPS the request — `await trackOwnWrite(() => api.post(...))`. The card page
 * (`CardDetailContent`) provides it, so a live re-read applied while the write
 * is out, or within a few seconds of its success, plays its score change like
 * a save rather than moving the score silently (`useLiveCardUpdates`). A write
 * that fails counts for nothing.
 *
 * Wrap only a request that is actually sent. Outside a card page (an extension
 * using a section through the SDK, a test) it simply runs the write.
 */
export const OwnCardWriteContext = createContext<TrackOwnCardWrite>((run) => run());

/** The page's own-write tracker for the section calling it. */
export function useTrackOwnCardWrite(): TrackOwnCardWrite {
  return useContext(OwnCardWriteContext);
}
