import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router";

/**
 * Per-page browser tab titles (#1085).
 *
 * `components/DocumentTitle.tsx` is the ONLY thing in the app that writes
 * `document.title`. It resolves the static label for the current route from
 * `ROUTE_TITLES`; a page that knows something better publishes it here, through
 * one of two slots:
 *
 *   - `usePageSubject(name)` — what the page is ABOUT. Replaces the route label,
 *     because a card's own name is a better page name than «Card».
 *   - `usePageSection(label)` — which TAB is showing. Qualifies whatever the
 *     name is, giving «GRC · Risk» or «Apollo Migration · Budget & Costs». It is
 *     a separate slot precisely because a page cannot compose this itself: the
 *     route label lives in the nav vocabulary, not in the page's namespace, and
 *     an entity page needs both halves at once.
 *
 * The store is module-level rather than React state at the app root, for the
 * same reason `useAppTitle` is: a root-level state change would re-render the
 * whole tree — the Inventory's AG Grid, the diagram editor's DrawIO iframe —
 * every time a card name arrived. Only `<DocumentTitle />` subscribes, and it
 * renders `null`. It reads through `useSyncExternalStore`, the idiom
 * `lib/extensionHost.tsx` already uses for its registry, so the snapshot is read
 * at commit time rather than pushed in from an effect. The snapshot object is
 * replaced only on a real change and is stable in between — the
 * `useSyncExternalStore` contract; a fresh object per call would loop.
 *
 * Nothing here fetches, so the boot-time singleton inflight-promise rule does
 * not apply: this is pub/sub over values the pages already hold.
 *
 * Nor can either slot be derived from the URL. `GrcPage` restores its tab from
 * localStorage when the URL carries no `?tab=`, and `CardDetail` renames a card
 * in place; in both cases the page knows and the URL does not. The flip side:
 * a tab the URL does NOT address must not publish a section — `CardDetail`
 * strips `?tab=` on mount, so its tabs are not reproducible from the URL and the
 * title deliberately ignores them.
 *
 * **Every entry is keyed by the pathname it was published from**, and the reader
 * discards one whose path is no longer current. That is not belt and braces:
 * `CardDetail` does not clear `card` when `:id` changes (it only refetches), so
 * navigating `/cards/a` → `/cards/b` leaves the previous card's name in state
 * for the whole request. Path-keying makes a stale entry structurally unable to
 * render, so no page can leak its name onto another route.
 */

export type PageTitleSlot = "subject" | "section";
type Slot = PageTitleSlot;

export interface PageTitleEntry {
  text: string;
  path: string;
}

type SlotEntry = PageTitleEntry;

export type PageTitleSlots = Readonly<Record<Slot, SlotEntry | null>>;
type Slots = PageTitleSlots;

const EMPTY: Slots = Object.freeze({ subject: null, section: null });

let _slots: Slots = EMPTY;
const _listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  _listeners.add(onChange);
  return () => {
    _listeners.delete(onChange);
  };
}

/** Stable snapshot — a new object only when a slot actually changed. */
function getSnapshot(): Slots {
  return _slots;
}

function same(a: SlotEntry | null, b: SlotEntry | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.text === b.text && a.path === b.path;
}

function publish(slot: Slot, entry: SlotEntry | null) {
  if (same(_slots[slot], entry)) return;
  _slots = { ..._slots, [slot]: entry };
  for (const fn of _listeners) fn();
}

/**
 * Clear, but only if the store still holds what this caller published. React
 * runs every destroy function in a commit before every create function, so an
 * ordered cleanup is already safe; the identity check keeps the hook correct
 * when called from a stale closure.
 */
function clearOwn(slot: Slot, entry: SlotEntry) {
  if (same(_slots[slot], entry)) publish(slot, null);
}

function usePublish(slot: Slot, value: string | null | undefined) {
  const { pathname } = useLocation();
  const text = (value ?? "").trim();

  useEffect(() => {
    const entry: SlotEntry = { text, path: pathname };
    publish(slot, entry);
    return () => {
      clearOwn(slot, entry);
    };
  }, [slot, text, pathname]);
}

/**
 * Publish what this page is about — the entity it shows. Replaces the route's
 * static label in the browser tab.
 *
 * Call it unconditionally, above any early return, and pass the optional value
 * straight through: `usePageSubject(card?.name)`. Empty means «not yet», so the
 * route label covers the gap and the tab never shows «undefined» or a raw id.
 * The value may change as often as it likes — an inline rename, a character
 * typed into a draft title. Writing `document.title` is free.
 */
export function usePageSubject(name: string | null | undefined): void {
  usePublish("subject", name);
}

/**
 * Publish the active tab of a page whose tab the URL addresses. It qualifies
 * the page name rather than replacing it.
 *
 * Not for a purely local tab: the title would then describe a state the URL
 * cannot reproduce and back/forward cannot restore.
 */
export function usePageSection(label: string | null | undefined): void {
  usePublish("section", label);
}

/** Test seam: drop anything left behind by a previous test's page. */
export function resetPageTitle(): void {
  publish("subject", null);
  publish("section", null);
}

/**
 * Read both slots. `<DocumentTitle />` is the only intended consumer — nothing
 * else may write `document.title`.
 */
export function usePageTitleSlots(): PageTitleSlots {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
