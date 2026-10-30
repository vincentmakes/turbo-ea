/**
 * Whether the reader keeps the data-quality breakdown open beside card pages
 * (#1334). A click on the score opens it and it stays open — on this card and
 * the next — until the reader closes it. A per-browser convenience, so it
 * lives in `localStorage`; every access is guarded — storage can be blocked,
 * full or absent (a private window, a preview) — and anything unreadable
 * reads as closed.
 *
 * `useDataQualityPanelOpen()` shares the value between everything that opens
 * or closes the breakdown and the card page that shows it.
 */
import { useCallback, useSyncExternalStore } from "react";

export const DATA_QUALITY_PANEL_KEY = "turboea_dq_panel_open";

export function readPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(DATA_QUALITY_PANEL_KEY) === "true";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

export function writePanelOpen(open: boolean): void {
  try {
    if (open) window.localStorage.setItem(DATA_QUALITY_PANEL_KEY, "true");
    else window.localStorage.removeItem(DATA_QUALITY_PANEL_KEY);
  } catch {
    // Storage refused the write: the panel simply is not remembered.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const closed = () => false;

export function useDataQualityPanelOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, readPanelOpen, closed);
  const setOpen = useCallback((next: boolean) => writePanelOpen(next), []);
  return [open, setOpen];
}
