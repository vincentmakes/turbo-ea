/**
 * Whether the document's Discussion panel is open, remembered per viewer in
 * this browser. Every storage access is guarded: storage can be blocked (a
 * private window, cleared site data), and the panel then simply opens with
 * its default. A state stored by the earlier build also named a tab
 * (Discussion or History); History has left the panel, so that field is
 * ignored.
 */

export interface PanelState {
  open: boolean;
}

export const PANEL_STATE_KEY = "turboea.documentSidePanel";

const DEFAULT_STATE: PanelState = { open: true };

/** The remembered state, or the default (open). */
export function readPanelState(): PanelState {
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PanelState> | null;
    return { open: typeof parsed?.open === "boolean" ? parsed.open : DEFAULT_STATE.open };
  } catch {
    return DEFAULT_STATE;
  }
}

/** Remember the state; a storage failure is ignored. */
export function writePanelState(state: PanelState): void {
  try {
    window.localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ open: state.open }));
  } catch {
    // Storage blocked: the state lasts for this page only.
  }
}

/** The state the panel opens in: a notification's `?thread=` opens it whatever was remembered. */
export function initialPanelState(threadParam: string | null): PanelState {
  if (threadParam) return { open: true };
  return readPanelState();
}
