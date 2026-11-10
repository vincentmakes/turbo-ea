/**
 * Whether the document side panel is open and on which tab, remembered per
 * viewer in this browser. Every storage access is guarded: storage can be
 * blocked (a private window, cleared site data), and the panel then simply
 * opens with its defaults.
 */

export type PanelTab = "discussion" | "history";

export interface PanelState {
  open: boolean;
  tab: PanelTab;
}

export const PANEL_STATE_KEY = "turboea.documentSidePanel";

const DEFAULT_STATE: PanelState = { open: true, tab: "discussion" };

/** The remembered state, or the defaults (open, on Discussion). */
export function readPanelState(): PanelState {
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : DEFAULT_STATE.open,
      tab: parsed.tab === "history" ? "history" : "discussion",
    };
  } catch {
    return DEFAULT_STATE;
  }
}

/** Remember the state; a storage failure is ignored. */
export function writePanelState(state: PanelState): void {
  try {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the state lasts for this page only.
  }
}

/**
 * The state the panel opens in: a notification's `?thread=` opens it on the
 * Discussion tab whatever was remembered.
 */
export function initialPanelState(threadParam: string | null): PanelState {
  if (threadParam) return { open: true, tab: "discussion" };
  return readPanelState();
}
