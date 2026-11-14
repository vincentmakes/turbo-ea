/**
 * The kind-agnostic half of the inline-picture contract for decision (ADR)
 * and SoAW rich text, kept in `lib/` so the one sanitiser, the print path and
 * the content check can apply it without importing a feature module.
 *
 * A stored picture is exactly
 * `<img src="/api/v1/document-images/{adr|soaw}/{uuid}" [alt] [title]
 * [width="N"] [height="N"] [data-align="center|right"]>` — the relative route,
 * the attributes in that order, `width` / `height` integers 1–4000, and
 * `data-align` absent for left. The editor side (which knows the kind) is
 * `features/ea-delivery/documentImages.ts`.
 */

export type DocumentImageKind = "adr" | "soaw";

/** Every stored picture's `src` starts with this. */
export const DOCUMENT_IMAGE_PATH_PREFIX = "/api/v1/document-images/";

/** The largest width / height a stored picture carries. */
export const MAX_DOCUMENT_IMAGE_DIMENSION = 4000;

// Upper-case hex is still a UUID; the route prefix and the kind are exact.
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const PATH_RE = new RegExp(`^/api/v1/document-images/(adr|soaw)/(${UUID})$`);

export interface DocumentImageRef {
  kind: DocumentImageKind;
  /** The picture's id, lower-cased as the server stores it. */
  id: string;
  /** The canonical relative `src`. */
  path: string;
}

/**
 * The picture a `src` references, of either kind, or `null` for anything
 * else. Accepts the relative route, or the same route absolutised by the
 * browser against this page's own origin (pasted HTML carries that form);
 * every other origin, scheme, query string, fragment or trailing path is
 * refused, and a protocol-relative `//host/…` never matches.
 */
export function parseDocumentImageSrc(src: string | null | undefined): DocumentImageRef | null {
  if (typeof src !== "string") return null;
  let path = src;
  if (!src.startsWith("/")) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    if (!origin || origin === "null" || !src.startsWith(`${origin}/`)) return null;
    path = src.slice(origin.length);
  }
  const match = PATH_RE.exec(path);
  if (!match) return null;
  const kind = match[1] as DocumentImageKind;
  const id = match[2].toLowerCase();
  return { kind, id, path: `${DOCUMENT_IMAGE_PATH_PREFIX}${kind}/${id}` };
}

/** A stored `width` / `height`: plain digits, 1–4000, else `null`. */
export function parseDocumentImageDimension(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_DOCUMENT_IMAGE_DIMENSION ? n : null;
}

/** A stored `data-align`: `center` or `right`, else `null` (left). */
export function parseDocumentImageAlign(
  raw: string | null | undefined,
): "center" | "right" | null {
  return raw === "center" || raw === "right" ? raw : null;
}

// ─── How a picture sits in a document ───────────────────────────────────────

/**
 * The rules, once: never wider than the text, and `data-align` (absent =
 * start) in logical margins so right-to-left locales mirror. Each rule is a
 * selector under the surface's root and its declarations, kebab-case.
 */
const RULES: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  [
    "img",
    [
      ["max-width", "100%"],
      ["height", "auto"],
    ],
  ],
  [
    'img[data-align="center"]',
    [
      ["display", "block"],
      ["margin-inline", "auto"],
    ],
  ],
  [
    'img[data-align="right"]',
    [
      ["display", "block"],
      ["margin-inline-start", "auto"],
    ],
  ],
];

/**
 * The rules as plain CSS, each selector prefixed with `scope` (a descendant
 * selector such as `.soaw-preview`); no scope gives the bare `img` rules.
 */
export function documentImageCss(scope = ""): string {
  const prefix = scope ? `${scope} ` : "";
  return RULES.map(
    ([selector, decls]) =>
      `${prefix}${selector} { ${decls.map(([prop, value]) => `${prop}: ${value};`).join(" ")} }`,
  ).join("\n");
}

/** The unscoped rules, for a surface that injects them under its own root. */
export const DOCUMENT_IMAGE_CSS = documentImageCss();

const camel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** The same rules as an MUI `sx` fragment for the element holding the HTML. */
export const DOCUMENT_IMAGE_SX: Record<string, Record<string, string>> = Object.fromEntries(
  RULES.map(([selector, decls]) => [
    `& ${selector}`,
    Object.fromEntries(decls.map(([prop, value]) => [camel(prop), value])),
  ]),
);
