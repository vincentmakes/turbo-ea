/**
 * The bridge between TipTap's suggestion plugin (which lives outside React)
 * and the "@" popup (a React component next to the editor).
 *
 * The plugin calls the renderer's `onStart` / `onUpdate` / `onExit` as the
 * user types after "@"; the store keeps the latest query, anchor and insert
 * command, and the popup reads it with `useSyncExternalStore`. Keys typed
 * while the popup is open reach the plugin first; it hands them to
 * `onKeyDown`, which the store forwards to whatever handler the popup
 * registered (the popup owns the rows and the highlighted one). Escape is
 * handled by the plugin itself: it exits, which closes the store.
 */
import { useSyncExternalStore } from "react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";

import type { MentionItem } from "./mentionModel";

/** What the popup needs to render. */
export interface MentionSuggestionState {
  open: boolean;
  /** The text typed after "@", unfiltered. */
  query: string;
  /** The caret's rectangle, for anchoring the popup. */
  clientRect: (() => DOMRect | null) | null;
  /** Inserts a mention for the picked row in place of "@query". */
  command: ((item: Pick<MentionItem, "kind" | "id" | "label">) => void) | null;
}

type Renderer = {
  onStart: (props: SuggestionProps<MentionItem, Pick<MentionItem, "kind" | "id" | "label">>) => void;
  onUpdate: (props: SuggestionProps<MentionItem, Pick<MentionItem, "kind" | "id" | "label">>) => void;
  onExit: () => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

export interface MentionSuggestionStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MentionSuggestionState;
  /** True while the popup is shown (the comment editor's submit key stays inert). */
  isOpen: () => boolean;
  /** The popup's key handler: true when it used the key. */
  setKeyHandler: (handler: ((event: KeyboardEvent) => boolean) | null) => void;
  /** The suggestion option `render`. */
  render: () => Renderer;
}

const CLOSED: MentionSuggestionState = {
  open: false,
  query: "",
  clientRect: null,
  command: null,
};

export function createMentionSuggestionStore(): MentionSuggestionStore {
  let state = CLOSED;
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  const listeners = new Set<() => void>();

  const set = (next: MentionSuggestionState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const fromProps = (
    props: SuggestionProps<MentionItem, Pick<MentionItem, "kind" | "id" | "label">>,
  ): MentionSuggestionState => ({
    open: true,
    query: props.query,
    clientRect: props.clientRect ?? null,
    command: props.command,
  });

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    isOpen: () => state.open,
    setKeyHandler: (handler) => {
      keyHandler = handler;
    },
    render: () => ({
      onStart: (props) => set(fromProps(props)),
      onUpdate: (props) => set(fromProps(props)),
      onExit: () => set(CLOSED),
      onKeyDown: ({ event }) => (state.open && keyHandler ? keyHandler(event) : false),
    }),
  };
}

/** The store's state for a component. */
export function useMentionSuggestion(store: MentionSuggestionStore): MentionSuggestionState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
