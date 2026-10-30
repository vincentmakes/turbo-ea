import type { MouseEvent } from "react";

/**
 * A click the browser should handle itself — open the link in a new tab or
 * window — rather than the app: Ctrl / Cmd / Shift / Alt held, or the middle
 * button. The same set react-router's `Link` hands to the browser.
 *
 * A link's side-effect `onClick` (close a drawer, dismiss a hover card) checks
 * this first, so a background-tab open leaves the current page as it was.
 */
export function isModifiedClick(
  e: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "button">,
) {
  return e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1;
}
