/**
 * A mention chip inside the editor. It carries the same data attributes as
 * the stored span, so the shared chip look (`MENTION_CHIP_SX`) applies. A chip
 * for a card or decision the reader can open is a link once the editor is
 * read-only (a click in an editable document only places the caret).
 */
import type { KeyboardEvent, MouseEvent } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useInRouterContext, useNavigate } from "react-router";

import type { MentionLabels } from "@/lib/mentionHtml";
import { mentionChipText, mentionHref, mentionSpanAttributes, type MentionAttrs } from "./mentionModel";

function RoutedChip({
  href,
  editable,
  attrs,
  text,
}: {
  href: string;
  editable: () => boolean;
  attrs: Record<string, string>;
  text: string;
}) {
  const navigate = useNavigate();
  const follow = (event: MouseEvent | KeyboardEvent) => {
    if (editable()) return;
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
  return (
    <NodeViewWrapper as="span">
      {href && inRouter ? (
        <RoutedChip
          href={href}
          editable={() => editor.isEditable}
          attrs={spanAttrs}
          text={text}
        />
      ) : (
        <span {...spanAttrs}>{text}</span>
      )}
    </NodeViewWrapper>
  );
}
