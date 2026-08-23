/**
 * A controllable `window.matchMedia` for tests.
 *
 * jsdom ships none, so MUI's `useMediaQuery` resolves every query to `false`
 * and every test silently exercises the desktop branch. That is fine as a
 * default — and `setup.ts` keeps it, by resetting to a desktop width before
 * each test — but it makes a mobile branch untestable.
 *
 * Only the two query shapes this codebase actually emits are parsed:
 * `(max-width:Npx)` and `(min-width:Npx)`, which covers MUI's
 * `theme.breakpoints.down()/up()` as well as the hand-written px queries in
 * `AppLayout.tsx`. Anything unparseable reports `matches: false`, i.e. the
 * pre-existing behaviour.
 */

type Listener = (e: MediaQueryListEvent) => void;

interface TrackedList extends MediaQueryList {
  _listeners: Set<Listener>;
  _matches: boolean;
}

const lists = new Set<TrackedList>();
let currentWidth = 1280;

const QUERY = /\(\s*(max|min)-width:\s*([\d.]+)px\s*\)/;

function evaluate(query: string): boolean {
  const m = QUERY.exec(query);
  if (!m) return false;
  const value = parseFloat(m[2]);
  return m[1] === "max" ? currentWidth <= value : currentWidth >= value;
}

function createList(query: string): TrackedList {
  const list = {
    media: query,
    _matches: evaluate(query),
    _listeners: new Set<Listener>(),
    get matches() {
      return (this as TrackedList)._matches;
    },
    onchange: null,
    addEventListener: (type: string, cb: Listener) => {
      if (type === "change") list._listeners.add(cb);
    },
    removeEventListener: (type: string, cb: Listener) => {
      if (type === "change") list._listeners.delete(cb);
    },
    // Legacy API — MUI feature-detects and prefers addEventListener, but
    // older code paths still reach for these.
    addListener: (cb: Listener) => list._listeners.add(cb),
    removeListener: (cb: Listener) => list._listeners.delete(cb),
    dispatchEvent: () => true,
  } as unknown as TrackedList;
  lists.add(list);
  return list;
}

/** Install the stub. Call once, from the vitest setup file. */
export function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => createList(query),
  });
}

/**
 * Set the viewport width every live query is evaluated against, firing
 * `change` on the lists whose result flipped. Wrap in `act()` when a mounted
 * component should re-render as a result.
 */
export function setViewportWidth(width: number): void {
  currentWidth = width;
  for (const list of lists) {
    const next = evaluate(list.media);
    if (next === list._matches) continue;
    list._matches = next;
    const event = { matches: next, media: list.media } as MediaQueryListEvent;
    list.onchange?.(event);
    for (const cb of list._listeners) cb(event);
  }
}
