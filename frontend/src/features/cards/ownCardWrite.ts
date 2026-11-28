import { createContext, useContext } from "react";

/**
 * How a section of a card page says "I am about to write something of this
 * card" (a relation, a tag, the hierarchy) when the card itself is stored
 * later, or not at all. The card page (`CardDetailContent`) provides it, so
 * the live re-read that brings the write back plays its score change like a
 * save rather than moving the score silently (`useLiveCardUpdates`).
 *
 * Call it BEFORE the write: the server's "this card changed" ping can arrive
 * before the write's own response. Outside a card page (an extension using a
 * section through the SDK, a test) it does nothing.
 */
export const OwnCardWriteContext = createContext<() => void>(() => {});

/** The page's "own write" note for the section calling it. */
export function useNoteOwnCardWrite(): () => void {
  return useContext(OwnCardWriteContext);
}
