import { useEffect, useRef, useState, type RefObject } from "react";

/** An element's content box, in px. */
export interface ElementSize {
  width: number;
  height: number;
}

/**
 * The live size of the element the returned ref is attached to.
 *
 * Read from the element's box when it mounts, then kept current by a
 * `ResizeObserver` (its `contentRect`). The size is `undefined` until a
 * measurement arrives, and stays so where `ResizeObserver` does not exist
 * (jsdom without the shim), so a caller always has a "not measured yet" path.
 * The ref is read once, on mount: attach it to an element that is rendered
 * for as long as the component is.
 */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, ElementSize | undefined] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Only a real change re-renders the caller.
    const update = (width: number, height: number) =>
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    // A box not laid out yet (or jsdom's) measures 0 × 0, which says nothing:
    // wait for the observer instead.
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) update(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
