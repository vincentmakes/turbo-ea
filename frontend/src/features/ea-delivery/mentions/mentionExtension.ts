/**
 * The TipTap mention node for decisions and SoAWs (and comments), on top of
 * `@tiptap/extension-mention`.
 *
 * - Attributes: kind, id, token, label, restricted, missing, archived. The
 *   label is read from the span's TEXT (the server writes the name there for
 *   each reader), never stored by the server.
 * - `renderHTML` writes the span in the server's canonical attribute order
 *   with the label as its text, so a document loaded and saved again is
 *   byte-stable; a restricted span goes back exactly as it came (token, no
 *   id), which is how the server restores a mention the writer cannot see.
 * - The chip is a React node view (`MentionNodeView`).
 * - "@" opens the suggestion popup through `store`; the suggestion's default
 *   `allowedPrefixes: [" "]` is kept, so typing an e-mail address opens
 *   nothing. The query may hold spaces (`@Customer Portal`); the store's
 *   `shouldShow` ends it after two spaces in a row or once the user types on
 *   past a query that found nothing.
 */
import Mention, { type MentionOptions } from "@tiptap/extension-mention";
import { ReactNodeViewRenderer } from "@tiptap/react";

import type { MentionLabels } from "@/lib/mentionHtml";
import MentionNodeView from "./MentionNodeView";
import {
  mentionAttrsFromElement,
  mentionSpanAttributes,
  mentionText,
  type MentionAttrs,
  type MentionItem,
} from "./mentionModel";
import type { MentionSuggestionStore } from "./mentionSuggestionStore";

export interface MentionExtensionOptions extends MentionOptions<
  MentionItem,
  Pick<MentionItem, "kind" | "id" | "label">
> {
  /** Words for chips the server left empty (restricted, gone). */
  labels: MentionLabels;
}

const EMPTY_LABELS: MentionLabels = {
  restricted: { card: "", decision: "", user: "", other: "" },
  missing: { card: "", decision: "", user: "", other: "" },
};

/** Reads one attribute off the parsed span. */
const fromSpan =
  <K extends keyof MentionAttrs>(key: K) =>
  (el: HTMLElement): MentionAttrs[K] =>
    mentionAttrsFromElement(el)[key];

const attr = <K extends keyof MentionAttrs>(key: K, fallback: MentionAttrs[K]) => ({
  default: fallback,
  parseHTML: fromSpan(key),
  // The node's `renderHTML` writes every attribute itself, in order.
  rendered: false,
});

const DocumentMention = Mention.extend<MentionExtensionOptions>({
  addOptions() {
    return { ...this.parent!(), labels: EMPTY_LABELS };
  },

  addAttributes() {
    return {
      kind: attr("kind", null),
      id: attr("id", null),
      token: attr("token", null),
      label: attr("label", ""),
      restricted: attr("restricted", false),
      missing: attr("missing", false),
      archived: attr("archived", false),
      // Kept for the base extension's Backspace and text handling.
      mentionSuggestionChar: { default: "@", rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ node }) {
    const attrs = node.attrs as MentionAttrs;
    const text = mentionText(attrs);
    return text
      ? ["span", mentionSpanAttributes(attrs), text]
      : ["span", mentionSpanAttributes(attrs)];
  },

  renderText({ node }) {
    return mentionText(node.attrs as MentionAttrs);
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView, { as: "span" });
  },
});

/** The mention extension wired to an editor's popup store. */
export function createMentionExtension(store: MentionSuggestionStore, labels: MentionLabels) {
  return DocumentMention.configure({
    labels,
    suggestion: {
      char: "@",
      pluginKey: store.pluginKey,
      allowSpaces: true,
      shouldShow: store.shouldShow,
      // The popup fetches and ranks its own rows (cards, decisions, people).
      items: () => [],
      render: store.render,
    },
  });
}
