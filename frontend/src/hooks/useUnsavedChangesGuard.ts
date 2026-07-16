import { useEffect } from "react";

/**
 * Warn the user before they navigate away while there are unsaved changes.
 *
 * The app is mounted under a `BrowserRouter` (component form), not a data
 * router, so React Router's `useBlocker` / `usePrompt` are unavailable. This
 * hook guards the realistic "leave" surfaces without any router-internal APIs:
 *
 *  1. **beforeunload** — reload, tab close, and hard navigation (same shape as
 *     the DiagramEditor unsaved-changes guard).
 *  2. **In-app link clicks** — a capture-phase document listener intercepts
 *     left-clicks on same-origin, in-app `<a href>` links (React Router
 *     `<Link>` renders these). Cancelling keeps the user on the page. Running
 *     in the capture phase means we can `stopPropagation()` before React
 *     Router's own click handler fires.
 *  3. **Back / forward** — a `popstate` guard backed by a history sentinel, so
 *     the browser Back button prompts instead of silently discarding edits.
 *
 * Known limitation: purely programmatic `navigate()` calls from button handlers
 * are not intercepted (they don't go through a link click or popstate). The
 * three mechanisms above cover the common leave paths on the card detail page.
 *
 * @param dirty   Whether there are unsaved changes right now.
 * @param message The confirmation prompt shown for in-app navigation.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string): void {
  // 1. Browser unload (reload / tab close / hard nav).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message but still show a generic
      // confirmation dialog when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // 2. In-app link clicks (React Router <Link> renders <a href>).
  useEffect(() => {
    if (!dirty) return;
    const onClickCapture = (e: MouseEvent) => {
      // Only left-clicks without modifier keys are single-page navigations;
      // modified clicks / middle-clicks open a new tab and don't leave.
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      // New-tab / download / non-same-origin links don't unload this page here
      // (a same-tab external link is caught by the beforeunload guard instead).
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Navigating to the exact same URL is a no-op — don't nag.
      if (url.href === window.location.href) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [dirty, message]);

  // 3. Back / forward. Push a same-URL sentinel so a Back press lands here and
  //    can be confirmed instead of silently navigating away.
  useEffect(() => {
    if (!dirty) return;
    const sentinelUrl = window.location.href;
    window.history.pushState(null, "", sentinelUrl);
    const onPopState = () => {
      if (window.confirm(message)) {
        // Leaving: remove our guard and go back past the real entry.
        window.removeEventListener("popstate", onPopState);
        window.history.back();
      } else {
        // Staying: re-arm the sentinel.
        window.history.pushState(null, "", window.location.href);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // If the sentinel is still the top entry (edits were saved without
      // navigating away), consume it so we don't leave a dead history entry.
      if (window.location.href === sentinelUrl) window.history.back();
    };
  }, [dirty, message]);
}

export default useUnsavedChangesGuard;
