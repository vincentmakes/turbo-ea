import { useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

/**
 * Warn the user before they navigate away while there are unsaved changes.
 *
 * The app is mounted under a `BrowserRouter` (component form), not a data
 * router, so React Router's `useBlocker` / `usePrompt` are unavailable. This
 * hook guards every realistic "leave" surface without a router migration:
 *
 *  1. **beforeunload** — reload, tab close, and hard navigation (same shape as
 *     the DiagramEditor unsaved-changes guard).
 *  2. **In-app navigation** — both `<Link>` clicks AND programmatic
 *     `navigate()` calls go through the router's shared `navigator`
 *     (`push` / `replace`), so patching those catches everything the SPA does,
 *     including clicking a related card in the Relations section (which uses
 *     `navigate()`, not an `<a href>`). Cancelling keeps the user on the page.
 *  3. **Back / forward** — a `popstate` guard backed by a history sentinel, so
 *     the browser Back/Forward buttons prompt instead of silently discarding
 *     edits.
 *
 * @param dirty   Whether there are unsaved changes right now.
 * @param message The confirmation prompt shown for in-app navigation.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string): void {
  const { navigator } = useContext(UNSAFE_NavigationContext);

  // Read the latest dirty/message through refs so the navigator patch can be
  // installed once for the component's lifetime and stay transparent (pass
  // through) whenever there are no unsaved changes.
  const dirtyRef = useRef(dirty);
  const messageRef = useRef(message);
  dirtyRef.current = dirty;
  messageRef.current = message;

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

  // 2. In-app navigation — patch the shared router navigator's push/replace.
  //    Covers React Router <Link> clicks and every programmatic navigate().
  useEffect(() => {
    const nav = navigator as unknown as {
      push: (...args: unknown[]) => void;
      replace: (...args: unknown[]) => void;
    };
    if (!nav?.push || !nav?.replace) return;
    const originalPush = nav.push;
    const originalReplace = nav.replace;
    const guarded =
      (original: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        if (dirtyRef.current && !window.confirm(messageRef.current)) return;
        return original.apply(nav, args);
      };
    nav.push = guarded(originalPush);
    nav.replace = guarded(originalReplace);
    return () => {
      nav.push = originalPush;
      nav.replace = originalReplace;
    };
  }, [navigator]);

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
