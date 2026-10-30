import { useEffect, useState } from "react";

/** The fixed app bar's height: the header counts as gone once it is under it. */
export const APP_BAR_OFFSET = 64;

/**
 * `true` while `element` has scrolled out of view under the 64 px app bar.
 *
 * Takes the element itself (from a callback ref held in state), not a ref
 * object: the card header only mounts once the card has loaded, and an effect
 * keyed on a ref object would never see it arrive. `false` when the browser
 * has no `IntersectionObserver` or there is no element.
 */
export function useHeaderOffscreen(element: Element | null): boolean {
  const [offscreen, setOffscreen] = useState(false);

  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") {
      setOffscreen(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        // Gone means scrolled up past the app bar, not still below the fold.
        if (entry) {
          const top = entry.boundingClientRect?.top ?? 0;
          setOffscreen(!entry.isIntersecting && top < APP_BAR_OFFSET);
        }
      },
      { threshold: 0, rootMargin: `-${APP_BAR_OFFSET}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return offscreen;
}
