/**
 * The bridge between the table plugins (outside React) and the table actions
 * menu next to the editor (`TableActionsMenu.tsx`): one store per editor.
 *
 * A plugin calls `open()` with the menu's set and the viewport point it opens
 * at; the menu reads the snapshot with `useSyncExternalStore` and calls
 * `close()` when it is dismissed or an action has run. A closed snapshot keeps
 * the last set and point, so the menu does not jump while it fades out.
 */
import type { TableMenuSet } from "./tableActions";

/** The menus a pointer or a grip opens (the toolbar's own menu is apart). */
export type TableMenuStoreSet = Exclude<TableMenuSet, "toolbar">;

export interface TableMenuSnapshot {
  open: boolean;
  set: TableMenuStoreSet;
  /** Viewport coordinates of the menu's top-left corner (MUI `anchorPosition`). */
  top: number;
  left: number;
}

export interface TableMenuStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TableMenuSnapshot;
  /** Opens the menu with `set` at the viewport point; replaces one already open. */
  open: (at: { set: TableMenuStoreSet; top: number; left: number }) => void;
  /** Closes the menu; nothing happens when it is closed already. */
  close: () => void;
  isOpen: () => boolean;
}

export function createTableMenuStore(): TableMenuStore {
  let snapshot: TableMenuSnapshot = { open: false, set: "context", top: 0, left: 0 };
  const listeners = new Set<() => void>();
  const emit = (next: TableMenuSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    open: ({ set, top, left }) => emit({ open: true, set, top, left }),
    close: () => {
      if (snapshot.open) emit({ ...snapshot, open: false });
    },
    isOpen: () => snapshot.open,
  };
}
