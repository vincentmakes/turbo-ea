import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import type { EventEntry } from "@/types";

const STORAGE_KEY = "turbo-ea.cardTabsSeen";
const LRU_CAP = 200;
const HISTORY_PAGE_SIZE = 50;
// Sentinel timestamp captured on the very first hook mount per card; never
// overwritten on subsequent visits. Acts as the fallback "you've been here"
// baseline for tabs the user has never explicitly opened.
const FIRST_VISIT_KEY = "__first";

const EVENT_TAB_MAP: Record<string, string> = {
  "comment.created": "comments",
  "stakeholder.added": "stakeholders",
  "stakeholder.role_changed": "stakeholders",
  "stakeholder.removed": "stakeholders",
  "risk.added": "risks",
  "risk.updated": "risks",
  "risk.removed": "risks",
  "document.added": "resources",
  "document.removed": "resources",
  "file.uploaded": "resources",
  "file.deleted": "resources",
  "card.created": "card",
  "card.updated": "card",
  "card.archived": "card",
  "card.restored": "card",
  "card.approval_status.approve": "card",
  "card.approval_status.reject": "card",
  "card.approval_status.reset": "card",
  "relation.created": "card",
  "relation.updated": "card",
  "relation.deleted": "card",
};

type StoreShape = {
  __lru?: string[];
  [cardId: string]: Record<string, string> | string[] | undefined;
};

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as StoreShape;
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage may be disabled, full, or unavailable (SSR); silently skip.
  }
}

function bumpLru(store: StoreShape, cardId: string) {
  const lru = (store.__lru ?? []).filter((id) => id !== cardId);
  lru.push(cardId);
  while (lru.length > LRU_CAP) {
    const evict = lru.shift();
    if (evict) delete store[evict];
  }
  store.__lru = lru;
}

function getCardEntry(store: StoreShape, cardId: string): Record<string, string> {
  const entry = store[cardId];
  if (!entry || Array.isArray(entry)) return {};
  return entry;
}

export interface UseCardTabActivity {
  hasUpdates: (tabKey: string) => boolean;
  /**
   * Note that the user has opened a tab during this visit. The persisted
   * lastSeen timestamp is NOT written immediately — it's buffered and
   * flushed on unmount or before the page unloads, so the dot stays
   * visible for the duration of the current visit.
   */
  noteVisit: (tabKey: string) => void;
}

export function useCardTabActivity(
  cardId: string,
  currentUserId?: string,
): UseCardTabActivity {
  const [latestActivity, setLatestActivity] = useState<Record<string, string>>({});

  // Snapshot the persisted entry once per cardId, stamping a first-visit
  // baseline if absent. Dots are frozen against this snapshot for the
  // duration of the visit — clicking a dotted tab does NOT clear it until
  // the user actually leaves the card.
  const snapshot = useMemo(() => {
    const store = readStore();
    const entry = getCardEntry(store, cardId);
    if (!entry[FIRST_VISIT_KEY]) {
      entry[FIRST_VISIT_KEY] = new Date().toISOString();
      store[cardId] = entry;
      bumpLru(store, cardId);
      writeStore(store);
    }
    return { ...entry };
  }, [cardId]);

  // Tabs the user opens during this visit. Flushed to lastSeen on unmount
  // or beforeunload so the next visit starts fresh.
  const pendingRef = useRef<Set<string>>(new Set());

  // beforeunload covers tab close / reload; the cleanup covers in-app
  // navigation and cardId changes mid-instance. Each effect captures its
  // own cardId, so a cardId change cleanly flushes to the prior card.
  useEffect(() => {
    const target = cardId;
    const pending = pendingRef.current;
    const flush = () => {
      if (pending.size === 0) return;
      const store = readStore();
      const entry = getCardEntry(store, target);
      const now = new Date().toISOString();
      for (const tab of pending) entry[tab] = now;
      store[target] = entry;
      bumpLru(store, target);
      writeStore(store);
      pending.clear();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
      // Start fresh for the next cardId.
      pendingRef.current = new Set();
    };
  }, [cardId]);

  useEffect(() => {
    let cancelled = false;
    setLatestActivity({});
    api
      .get<EventEntry[]>(
        `/cards/${cardId}/history?page=1&page_size=${HISTORY_PAGE_SIZE}`,
      )
      .then((events) => {
        if (cancelled) return;
        const latest: Record<string, string> = {};
        for (const e of events) {
          if (!e.created_at) continue;
          // Skip the user's own events — own changes never dot themselves.
          if (currentUserId && e.user_id === currentUserId) continue;
          const tabKey = EVENT_TAB_MAP[e.event_type];
          if (!tabKey) continue;
          const current = latest[tabKey];
          if (!current || e.created_at > current) {
            latest[tabKey] = e.created_at;
          }
        }
        setLatestActivity(latest);
      })
      .catch(() => {
        if (!cancelled) setLatestActivity({});
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, currentUserId]);

  const hasUpdates = useCallback(
    (tabKey: string): boolean => {
      const firstVisit = snapshot[FIRST_VISIT_KEY];
      if (!firstVisit) return false; // card has never been visited
      const latest = latestActivity[tabKey];
      if (!latest) return false;
      // Tabs the user has explicitly opened on a prior visit use that
      // timestamp; otherwise fall back to the card-wide first-visit
      // baseline. Pending in-session visits are deliberately NOT consulted
      // here so the dot stays visible until the user leaves.
      const baseline = snapshot[tabKey] || firstVisit;
      return latest > baseline;
    },
    [latestActivity, snapshot],
  );

  const noteVisit = useCallback((tabKey: string) => {
    pendingRef.current.add(tabKey);
  }, []);

  return { hasUpdates, noteVisit };
}
