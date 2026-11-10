/**
 * Stored rich text with live mention chips, outside the editor (the decision
 * and SoAW previews): one delegated click / Enter / Space handler finds the
 * mention span hit and navigates in-app. The sanitiser strips relative hrefs,
 * so a chip is a `span` that `sanitizeRichHtml` marks `role="link"`
 * (`lib/richHtml.ts`), not an anchor. The chip look is shared with the editor.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import Box from "@mui/material/Box";
import { alpha, type Theme } from "@mui/material/styles";
import { useNavigate } from "react-router";

import { mentionHrefFromTarget } from "./mentionModel";

/** The chip look, for any container of rendered mention spans (editor included). */
export const MENTION_CHIP_SX = {
  "& span[data-type='mention']": {
    px: 0.5,
    borderRadius: 1,
    color: "primary.main",
    fontWeight: 500,
    bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.08),
    "&[role='link']": {
      cursor: "pointer",
      "&:hover": { textDecoration: "underline" },
      "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
    },
    "&[data-archived='true']": { color: "text.secondary" },
    "&[data-restricted='true']": {
      color: "text.secondary",
      fontStyle: "italic",
      bgcolor: "action.hover",
    },
    "&[data-missing='true']": {
      color: "text.disabled",
      textDecoration: "line-through",
      bgcolor: "transparent",
    },
  },
} as const;

/** Click and Enter / Space on a mention chip open its card or decision. */
function useMentionNavigation() {
  const navigate = useNavigate();
  return {
    onClick: (event: MouseEvent) => {
      const href = mentionHrefFromTarget(event.target);
      if (!href) return;
      event.preventDefault();
      navigate(href);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const href = mentionHrefFromTarget(event.target);
      if (!href) return;
      event.preventDefault();
      navigate(href);
    },
  };
}

interface Props {
  /** The rendered stored text (its own `dangerouslySetInnerHTML` box). */
  children: ReactNode;
}

/**
 * Wraps rendered stored text so its mention chips look like chips and
 * navigate: events bubble up from the sanitised HTML inside.
 */
export default function MentionContainer({ children }: Props) {
  const handlers = useMentionNavigation();
  return (
    <Box sx={MENTION_CHIP_SX} {...handlers}>
      {children}
    </Box>
  );
}
