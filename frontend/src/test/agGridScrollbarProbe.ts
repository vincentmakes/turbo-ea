/**
 * Let AG Grid's scrollbar measurement succeed under jsdom, so it caches.
 *
 * AG Grid measures the browser's scrollbar by probing a hidden 100×100 div and
 * caching the result — but only when the measurement is non-degenerate
 * (`ag-grid-community/dist/package/main.esm.mjs`, `initScrollbarWidthAndVisibility`):
 *
 *     let width = div.offsetWidth - div.clientWidth;
 *     if (width === 0 && div.clientWidth === 0) width = null;   // discard
 *     if (width != null) { browserScrollbarWidth = width; … }   // cache
 *
 * jsdom reports 0 for every layout box, so the measurement is always discarded
 * and the cache never fills. `_getScrollbarWidth()` therefore re-probes
 * `document` on **every** call, forever — including from work AG Grid defers on
 * a timer (`ColumnAnimationService.executeLaterVMTurn`). On a loaded runner one
 * of those timers lands after Vitest has torn the environment down, and the
 * probe throws `ReferenceError: document is not defined`, failing the whole run
 * even though every test passed. That is what broke CI on main after #1030.
 *
 * Answering the probe the way a scrollbar-less environment does — equal offset
 * and client widths, i.e. a 0px scrollbar — makes the value cache on first use,
 * so `document` is never touched again from this path. The drain in `setup.ts`
 * stays as defence in depth for everything else AG Grid and React can leave in
 * flight; this closes the one path that could not be drained, because it was
 * guaranteed to re-arm itself.
 *
 * Scoped to the probe alone, by the inline styles AG Grid gives it. Every other
 * element keeps jsdom's own answer, so no test's view of layout changes.
 */

/** AG Grid's probe: a 100px square, invisible, absolutely positioned, scrolling. */
function isScrollbarProbe(el: Element): boolean {
  const style = (el as HTMLElement).style;
  return (
    el.tagName === "DIV" &&
    style?.overflow === "scroll" &&
    style.opacity === "0" &&
    style.position === "absolute" &&
    style.width === "100px" &&
    style.height === "100px"
  );
}

/** The size the probe reports: any equal, non-zero pair means "no scrollbar". */
const PROBE_SIZE = 100;

export function installAgGridScrollbarProbe(): void {
  for (const proto of [HTMLElement.prototype, Element.prototype]) {
    for (const prop of ["offsetWidth", "clientWidth"] as const) {
      const original = Object.getOwnPropertyDescriptor(proto, prop);
      if (!original?.get) continue;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: original.enumerable,
        get(this: Element) {
          return isScrollbarProbe(this) ? PROBE_SIZE : original.get!.call(this);
        },
      });
    }
  }
}
