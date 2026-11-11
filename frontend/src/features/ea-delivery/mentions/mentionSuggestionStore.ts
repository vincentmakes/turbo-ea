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
 * handled by the plugin itself: it exits, which closes the store; the store
 * stops the key there, so it closes the popup only (never a drawer or dialog
 * around the editor).
 *
 * The query may contain spaces (`@Customer Portal`). It stops being a
 * suggestion (`shouldShow`) after two spaces in a row, or once the user keeps
 * typing past a query the popup found nothing for. `close()` dismisses the
 * suggestion (the editor lost focus); one store at a time is open on a page.
 * `browse()` (the popup's "Browse…" row) closes the suggestion and hands the
 * "@query" range to the editor, which opens the browse dialog and later
 * replaces that text with what was picked.
 *
 * `dismiss()` is the editor's blur: it closes like `close()` and remembers the
 * "@query" range, so the toolbar's "Mention…" button (whose press blurs the
 * editor first) can replace that text as the "Browse…" row does
 * (`takeDismissed()`). The memory ends at the next "@", when the editor takes
 * focus again, or once the text there is no longer that "@query".
 */
import { useSyncExternalStore } from "react";
import type { Editor, Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";

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

type Props = SuggestionProps<MentionItem, Pick<MentionItem, "kind" | "id" | "label">>;

type Renderer = {
  onStart: (props: Props) => void;
  onUpdate: (props: Props) => void;
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
  /** The suggestion plugin's key (one per editor). */
  pluginKey: PluginKey;
  /** The suggestion option `shouldShow`: false once the query has run on too far. */
  shouldShow: (props: { range: Range; query: string }) => boolean;
  /** The popup found nothing for the open query (its searches have settled). */
  reportNoResults: (query: string) => void;
  /** Close the open suggestion. */
  close: () => void;
  /** The editor lost focus: close, and remember the "@query" range for `takeDismissed`. */
  dismiss: () => void;
  /**
   * The "@query" range the last `dismiss()` closed, when that text is still
   * there; null otherwise. Forgets it either way.
   */
  takeDismissed: () => Range | null;
  /** Who opens the browse dialog (the editor), given the "@query" range. */
  setBrowseHandler: (handler: ((range: Range | null) => void) | null) => void;
  /** Close the suggestion and open the browse dialog in place of "@query". */
  browse: () => void;
}

const CLOSED: MentionSuggestionState = {
  open: false,
  query: "",
  clientRect: null,
  command: null,
};

/**
 * Whether a query has run on past a mention: two spaces in a row, or more
 * typed after a query that found nothing at the same "@".
 */
export function queryRanOn(
  query: string,
  from: number,
  noResults: { from: number; query: string } | null,
): boolean {
  if (query.includes("  ")) return true;
  if (!noResults || noResults.from !== from) return false;
  return query.length > noResults.query.length && query.startsWith(noResults.query);
}

/** The store whose popup is open on the page, if any: opening another closes it. */
let openStore: MentionSuggestionStore | null = null;

export function createMentionSuggestionStore(): MentionSuggestionStore {
  let state = CLOSED;
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
  let editor: Editor | null = null;
  let from = -1;
  let range: Range | null = null;
  let browseHandler: ((range: Range | null) => void) | null = null;
  let noResults: { from: number; query: string } | null = null;
  let dismissed: { range: Range; text: string } | null = null;
  const listeners = new Set<() => void>();
  const pluginKey = new PluginKey("documentMention");

  const set = (next: MentionSuggestionState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const fromProps = (props: Props): MentionSuggestionState => ({
    open: true,
    query: props.query,
    clientRect: props.clientRect ?? null,
    command: props.command,
  });
  const track = (props: Props) => {
    editor = props.editor ?? null;
    if (props.range) {
      from = props.range.from;
      range = props.range;
    }
  };

  const store: MentionSuggestionStore = {
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
    pluginKey,
    shouldShow: ({ range, query }) => !queryRanOn(query, range.from, noResults),
    reportNoResults: (query) => {
      if (state.open && state.query === query) noResults = { from, query };
    },
    close: () => {
      if (!state.open) return;
      const view = editor && !editor.isDestroyed ? editor.view : null;
      if (view) exitSuggestion(view, pluginKey);
      // The plugin's exit calls `onExit`; without a live view, close here.
      if (openStore === store) openStore = null;
      if (state.open) set(CLOSED);
    },
    dismiss: () => {
      // A second blur (nothing open any more) keeps what the first remembered.
      if (state.open && range) dismissed = { range, text: `@${state.query}` };
      store.close();
    },
    takeDismissed: () => {
      const last = dismissed;
      dismissed = null;
      if (!last || !editor || editor.isDestroyed) return null;
      const { doc } = editor.state;
      if (last.range.to > doc.content.size) return null;
      return doc.textBetween(last.range.from, last.range.to) === last.text ? last.range : null;
    },
    setBrowseHandler: (handler) => {
      browseHandler = handler;
    },
    browse: () => {
      if (!state.open) return;
      const at = range;
      store.close();
      browseHandler?.(at);
    },
    render: () => ({
      onStart: (props) => {
        if (openStore && openStore !== store) openStore.close();
        openStore = store;
        range = null;
        dismissed = null;
        track(props);
        if (noResults && noResults.from !== from) noResults = null;
        set(fromProps(props));
      },
      onUpdate: (props) => {
        track(props);
        set(fromProps(props));
      },
      onExit: () => {
        if (openStore === store) openStore = null;
        set(CLOSED);
      },
      onKeyDown: ({ event }) => {
        if (!state.open) return false;
        // Escape closes the popup only: the plugin exits on it, and nothing
        // around the editor (a drawer, a dialog) may take it as its own.
        if (event.key === "Escape" || event.key === "Esc") {
          event.stopPropagation();
          return true;
        }
        return keyHandler ? keyHandler(event) : false;
      },
    }),
  };
  return store;
}

/** The store's state for a component. */
export function useMentionSuggestion(store: MentionSuggestionStore): MentionSuggestionState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
