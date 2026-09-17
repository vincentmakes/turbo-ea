/**
 * Bare-URL detection for free text.
 *
 * A description, a comment, a risk note or a status report is plain text
 * the user typed; when it carries a web address the reader expects to click
 * it. This module finds those addresses and nothing else — it never turns
 * text into HTML, so there is no injection surface: the renderer
 * (`components/LinkifiedText.tsx`) maps the tokens to React elements, and
 * the HTML path (`lib/richHtml.ts`) builds DOM nodes from them.
 *
 * Detection is deliberately narrow: only `http://` and `https://`. That is
 * the allowlist a `url`-typed attribute already enforces (`ALLOWED_URL_SCHEMES`
 * in `cardDetailUtils.tsx`, `_ALLOWED_URL_SCHEMES` on the backend) and it
 * produces no false positives on `e.g.`, file names or `www.` fragments. A
 * `javascript:` or `data:` URI can never become a link, whatever the text.
 */

export type LinkToken =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

/**
 * What an `href` may be once it exists — on a stored anchor or a `url`-typed
 * value. `mailto:` is allowed here (the url field accepts it) but is never
 * *detected* in prose; see `URL_RE`.
 */
export const LINKABLE_HREF = /^(?:https?:\/\/|mailto:)/i;

export function isLinkableHref(href: string): boolean {
  return LINKABLE_HREF.test(href.trim());
}

/**
 * A scheme at a word boundary, running to whitespace, an angle bracket, a
 * quote or a backtick. Trailing punctuation is trimmed afterwards — the regex
 * stays a single greedy class so it cannot backtrack catastrophically on a
 * very long URL.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

const TRAILING_PUNCT = new Set([".", ",", ";", ":", "!", "?"]);

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Split a raw match into the URL proper and the punctuation that followed it.
 * A closing `)` or `]` is only dropped when unbalanced, so a Wikipedia-style
 * `…/Foo_(bar)` keeps its bracket while `(see https://x.io)` does not swallow
 * the sentence's own.
 */
function trimTrailing(raw: string): [url: string, rest: string] {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (last === undefined) break;
    if (TRAILING_PUNCT.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")" && count(url, "(") < count(url, ")")) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === "]" && count(url, "[") < count(url, "]")) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return [url, raw.slice(url.length)];
}

/** True when the match is nothing but a scheme (`https://`). */
function isBareScheme(url: string): boolean {
  return /^https?:\/\/$/i.test(url);
}

/**
 * Tokenise `text` into text runs and links. Text with no link comes back as
 * exactly one text token whose value is the input itself — callers rely on
 * that to take a fast path.
 */
export function splitLinks(text: string): LinkToken[] {
  const lower = text.toLowerCase();
  if (!lower.includes("http://") && !lower.includes("https://")) {
    return [{ type: "text", value: text }];
  }

  const tokens: LinkToken[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === "text") prev.value += value;
    else tokens.push({ type: "text", value });
  };

  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const [url, rest] = trimTrailing(m[0]);
    pushText(text.slice(cursor, start));
    if (isBareScheme(url)) {
      pushText(m[0]);
    } else {
      tokens.push({ type: "link", value: url, href: url });
      pushText(rest);
    }
    cursor = start + m[0].length;
  }
  pushText(text.slice(cursor));

  if (tokens.length === 0) return [{ type: "text", value: text }];
  return tokens;
}

/** True when `splitLinks` would find at least one link. */
export function hasLink(text: string): boolean {
  return splitLinks(text).some((t) => t.type === "link");
}
