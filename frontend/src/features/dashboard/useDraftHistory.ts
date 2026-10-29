/**
 * Undo / redo over a draft value: the customize-mode widget list of the
 * homepage dashboards.
 *
 * Every `set` makes the current value an undo step and clears the redo
 * stack, except when the new value is the same as the present one (compared
 * by `JSON.stringify`). That dedupe is load-bearing: react-grid-layout
 * reports its layout back through `onLayoutChange` after every prop change,
 * and that echo must not become a history entry — or Undo would appear to
 * do nothing until it has walked back through the echoes.
 *
 * The undo stack keeps the last `HISTORY_LIMIT` steps; the oldest is
 * dropped. `reset` replaces the value and forgets both stacks (entering or
 * leaving customize mode). Every returned callback is stable.
 *
 * `undoRedoAction` and `isEditableTarget` are the keyboard side: which
 * shortcut a key press is, and whether it belongs to a text field that does
 * its own undo.
 */
import { useCallback, useReducer } from "react";

export const HISTORY_LIMIT = 50;

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

type Action<T> =
  | { kind: "set"; next: T | ((current: T) => T) }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "reset"; value: T };

function reducer<T>(state: History<T>, action: Action<T>): History<T> {
  switch (action.kind) {
    case "set": {
      const next =
        typeof action.next === "function"
          ? (action.next as (current: T) => T)(state.present)
          : action.next;
      if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
      return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: next, future: [] };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    }
    case "reset":
      return { past: [], present: action.value, future: [] };
  }
}

export function useDraftHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(reducer<T>, { past: [], present: initial, future: [] });
  const set = useCallback((next: T | ((current: T) => T)) => dispatch({ kind: "set", next }), []);
  const undo = useCallback(() => dispatch({ kind: "undo" }), []);
  const redo = useCallback(() => dispatch({ kind: "redo" }), []);
  const reset = useCallback((value: T) => dispatch({ kind: "reset", value }), []);
  return {
    present: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/** Ctrl/Cmd+Z is undo; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y are redo. */
export function undoRedoAction(event: ShortcutEvent): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}

/** A text field, select or editable element: it handles its own undo. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
