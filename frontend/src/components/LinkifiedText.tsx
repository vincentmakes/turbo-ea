/**
 * Free text with its web addresses turned into links.
 *
 * Renders a *fragment* — text nodes and MUI `Link`s — never a wrapper, so a
 * call site keeps its own `Typography` / `<li>` / `Alert` (variant, colour,
 * `pre-wrap`, `noWrap`) and the swap is one line: `{text}` becomes
 * `<LinkifiedText text={text} />`. Testing Library's `getByText` matches an
 * element's direct text nodes, which is what keeps every existing "renders
 * the description" test green; a wrapping `<span>` would break them.
 *
 * Every link opens in a new tab with `rel="noopener noreferrer"` — the house
 * convention for anything leaving the app. Detection is `http(s)://` only
 * (`lib/linkify.ts`), so nothing here can ever emit a `javascript:` href.
 */
import { Fragment, useMemo, type MouseEvent, type ReactNode } from "react";
import Link, { type LinkProps } from "@mui/material/Link";

import { splitLinks } from "@/lib/linkify";

export interface LinkifiedTextProps {
  text: string | null | undefined;
  /** Extra props for every rendered link, e.g. `{ color: "inherit" }` inside an Alert. */
  linkProps?: Partial<LinkProps>;
}

function onLinkClick(e: MouseEvent<HTMLAnchorElement>) {
  // A link often sits inside something clickable — a todo row, a card that
  // navigates on click. The link is the more specific target, so the host
  // must not also fire. (AG Grid rows are the exception: their listener is
  // native and runs before React's, so the Inventory guards on `closest("a")`.)
  e.stopPropagation();
  // The second click of a double-click must not open a second tab. The native
  // `dblclick` still reaches the host, so double-click-to-edit in a grid cell
  // keeps working.
  if (e.detail > 1) e.preventDefault();
}

export default function LinkifiedText({ text, linkProps }: LinkifiedTextProps): ReactNode {
  const tokens = useMemo(() => (text ? splitLinks(text) : null), [text]);
  if (!tokens) return null;
  if (tokens.length === 1 && tokens[0].type === "text") return tokens[0].value;
  return tokens.map((tok, i) =>
    tok.type === "link" ? (
      <Link
        key={i}
        href={tok.href}
        target="_blank"
        rel="noopener noreferrer"
        underline="hover"
        onClick={onLinkClick}
        sx={{ wordBreak: "break-all" }}
        {...linkProps}
      >
        {tok.value}
      </Link>
    ) : (
      <Fragment key={i}>{tok.value}</Fragment>
    ),
  );
}
