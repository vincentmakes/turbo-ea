/**
 * A mention chip inside the editor. It carries the same data attributes as
 * the stored span, so the shared chip look (`MENTION_CHIP_SX`) applies. A chip
 * for a card or decision the reader can open is a link once the editor is
 * read-only. In an editable document it is plain text to the keyboard and to
 * assistive tech: no `role="link"`, no tab stop, and a click only places the
 * caret.
 */
import type { KeyboardEvent, MouseEvent } from "react";
import { NodeViewWrapper, useEditorState, type ReactNodeViewProps } from "@tiptap/react";
import { useInRouterContext, useNavigate } from "react-router";

import type { MentionLabels } from "@/lib/mentionHtml";
import { mentionChipText, mentionHref, mentionSpanAttributes, type MentionAttrs } from "./mentionModel";

function RoutedChip({
  href,
  attrs,
  text,
}: {
  href: string;
  attrs: Record<string, string>;
  text: string;
}) {
  const navigate = useNavigate();
  const follow = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    navigate(href);
  };
  return (
    <span
      {...attrs}
      role="link"
      tabIndex={0}
      onClick={follow}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") follow(e);
      }}
    >
      {text}
    </span>
  );
}

export default function MentionNodeView({ node, editor, extension }: ReactNodeViewProps) {
  const attrs = node.attrs as MentionAttrs;
  const labels = (extension.options as { labels: MentionLabels }).labels;
  const text = mentionChipText(attrs, labels);
  const spanAttrs = mentionSpanAttributes(attrs);
  const href = mentionHref(attrs);
  const inRouter = useInRouterContext();
  // Re-read on every transaction: the editor turning read-only (or back)
  // dispatches one.
  const editable = useEditorState({ editor, selector: ({ editor: e }) => e.isEditable });
  return (
    <NodeViewWrapper as="span">
      {href && inRouter && !editable ? (
        <RoutedChip href={href} attrs={spanAttrs} text={text} />
      ) : (
        <span {...spanAttrs}>{text}</span>
      )}
    </NodeViewWrapper>
  );
}
