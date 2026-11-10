import { useMemo, useRef, useState } from "react";
import { fetchCardsByIdsDetailed } from "@/api/cardsByIds";
import { useAbortableEffect } from "@/hooks/useLatestRequest";

/** What a picked card id resolves to for the reader. */
export type CardNameEntry =
  | { kind: "card"; name: string; type: string }
  /** The card exists but a card-type View deny hides it from the reader. */
  | { kind: "hidden" }
  /** No such card (deleted, or never was). */
  | { kind: "unknown" };

/**
 * Names the cards a query picks, for the path strip's chips and the cards
 * editor. One request per new set of ids, over `fetchCardsByIdsDetailed`
 * (never a hand-built `ids=` URL); only ids not resolved before are fetched.
 * A failed fetch leaves its ids absent, so they show as their id.
 *
 * The cache lives as long as the component that calls this: a card renamed
 * while the strip is mounted keeps its old name here until the strip remounts.
 */
export function useCardNames(ids: string[]): Map<string, CardNameEntry> {
  const cache = useRef(new Map<string, CardNameEntry>());
  const [version, setVersion] = useState(0);
  const key = [...new Set(ids)].sort().join(",");

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!key) return;
      const missing = key.split(",").filter((id) => !cache.current.has(id));
      if (missing.length === 0) return;
      let result: Awaited<ReturnType<typeof fetchCardsByIdsDetailed>>;
      try {
        result = await fetchCardsByIdsDetailed(missing, { signal });
      } catch {
        return;
      }
      if (!isCurrent()) return;
      const found = new Set<string>();
      for (const card of result.cards) {
        cache.current.set(card.id, { kind: "card", name: card.name, type: card.type });
        found.add(card.id);
      }
      for (const id of result.withheldIds) {
        cache.current.set(id, { kind: "hidden" });
        found.add(id);
      }
      for (const id of missing) {
        if (!found.has(id)) cache.current.set(id, { kind: "unknown" });
      }
      setVersion((v) => v + 1);
    },
    [key],
  );

  return useMemo(() => {
    const names = new Map<string, CardNameEntry>();
    if (!key) return names;
    for (const id of key.split(",")) {
      const entry = cache.current.get(id);
      if (entry) names.set(id, entry);
    }
    return names;
    // `version` stands for the cache's contents, which a ref does not signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}
