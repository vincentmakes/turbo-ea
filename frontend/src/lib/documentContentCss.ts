/**
 * How stored rich content looks — the ONE definition.
 *
 * Decision (ADR) sections and SoAW sections are stored as the editor's HTML
 * and shown on several surfaces: the decision preview and its history pane
 * (MUI `sx`), the SoAW preview (a stylesheet under `.soaw-preview`) and the
 * printed / PDF documents (a stylesheet under `.doc-print`). Each surface
 * takes its rules from the table below, so a link, a code span, a sub-heading,
 * a table or a picture looks the same everywhere.
 *
 * Colours are roles (`link`, `rule`, `fill`, `subheading`) the surface
 * supplies: screen surfaces give MUI palette keys, so dark mode follows the
 * theme; print and the SoAW preview give `PRINT_COLORS` tokens. Borders are
 * written as longhands so `border-color` can be a palette key in `sx`.
 *
 * In print and in the SoAW preview a stored fragment sits in a `.doc-content`
 * wrapper and these rules are scoped to it, so they never restyle the
 * document's own generated tables (facts, links, signatures); they also
 * restate every property the generated-table rules set, so those never
 * restyle a stored table either.
 *
 * On screen the element holding the HTML scrolls sideways, so a resized
 * table wider than its box scrolls instead of spilling over the page
 * (`DOCUMENT_CONTENT_SX`'s root, and the `scroll` option of the stylesheet,
 * screen media only). Print never gets a scrolling box: `printTableWidths`
 * fits a resized table to the page there.
 */
import { PRINT_COLORS, brand } from "@/theme/tokens";

/** The class that wraps each stored rich fragment in a print or preview body. */
export const DOCUMENT_CONTENT_CLASS = "doc-content";

/** A colour per role; each surface supplies its own. */
export interface DocumentContentColours {
  /** A link's text. */
  link: string;
  /** Table borders. */
  rule: string;
  /** A table header's fill, and the fill behind code. */
  fill: string;
  /** A sub-heading (`h4`). */
  subheading: string;
}

/** Screen surfaces: MUI palette keys, so dark mode follows the theme. */
export const SCREEN_CONTENT_COLOURS: DocumentContentColours = {
  link: "primary.main",
  rule: "divider",
  fill: "action.hover",
  subheading: "text.secondary",
};

/** Print and the SoAW preview: the print tokens. */
export const PRINT_CONTENT_COLOURS: DocumentContentColours = {
  link: brand.primary,
  rule: PRINT_COLORS.control,
  fill: PRINT_COLORS.panel,
  subheading: PRINT_COLORS.subheading,
};

/** Monospace font stack for code. */
export const MONO_FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

type ColourRole = keyof DocumentContentColours;
/** A declaration's value: literal text, or a colour role the surface fills in. */
type Value = string | { role: ColourRole };
type Rule = readonly [selector: string, decls: readonly (readonly [prop: string, value: Value])[]];

const colour = (role: ColourRole): Value => ({ role });

/** Pictures: never wider than the text; `data-align` in logical margins (RTL mirrors). */
const PICTURE_RULES: readonly Rule[] = [
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

/** Everything but pictures. Selectors are relative to the surface's root. */
const CONTENT_RULES: readonly Rule[] = [
  [
    "a",
    [
      ["color", colour("link")],
      ["word-break", "break-word"],
    ],
  ],
  [
    "code",
    [
      ["font-family", MONO_FONT_STACK],
      ["font-size", "0.9em"],
      ["background-color", colour("fill")],
      ["padding", "0.1em 0.3em"],
      ["border-radius", "3px"],
    ],
  ],
  [
    "pre",
    [
      ["display", "block"],
      ["white-space", "pre-wrap"],
      ["font-family", MONO_FONT_STACK],
      ["font-size", "0.9em"],
      ["background-color", colour("fill")],
      ["padding", "8px 12px"],
      ["border-radius", "4px"],
      ["margin", "8px 0"],
    ],
  ],
  [
    "pre code",
    [
      ["font-size", "inherit"],
      ["background-color", "transparent"],
      ["padding", "0"],
      ["border-radius", "0"],
    ],
  ],
  [
    "h4",
    [
      ["font-size", "1.05em"],
      ["font-weight", "600"],
      ["color", colour("subheading")],
      ["margin", "16px 0 8px"],
    ],
  ],
  [
    "table",
    [
      ["border-collapse", "collapse"],
      // An inline width (a resized table) overrides this, as inline styles do.
      ["width", "100%"],
      // Fixed: the stored column widths (`<col style="width">`) are honoured.
      ["table-layout", "fixed"],
      ["margin", "12px 0"],
    ],
  ],
  [
    "th, td",
    [
      ["border-width", "1px"],
      ["border-style", "solid"],
      ["border-color", colour("rule")],
      ["padding", "6px 10px"],
      ["vertical-align", "top"],
      ["text-align", "start"],
      ["font-size", "inherit"],
      ["overflow-wrap", "break-word"],
    ],
  ],
  [
    "th",
    [
      ["background-color", colour("fill")],
      ["font-weight", "600"],
    ],
  ],
  // A cell's blocks sit flush with its padding and 4px apart (the Word
  // export's `SPACING_CELL_AFTER`): no margin on any block, a 4px top margin
  // on every block after the first. Written with a sibling combinator, not
  // `:first-child`, which Emotion warns about in `sx` (unsafe under SSR).
  [
    "td > *, th > *",
    [["margin", "0"]],
  ],
  [
    "td > * + *, th > * + *",
    [["margin-top", "4px"]],
  ],
];

/** Print only: a table row and a picture never split across a page break. */
const PRINT_RULES: readonly Rule[] = [
  [
    "tr",
    [
      ["break-inside", "avoid"],
      ["page-break-inside", "avoid"],
    ],
  ],
];
const PRINT_PICTURE_RULES: readonly Rule[] = [
  [
    "img",
    [
      ["break-inside", "avoid"],
      ["page-break-inside", "avoid"],
    ],
  ],
];

function resolve(value: Value, colours: DocumentContentColours): string {
  return typeof value === "string" ? value : colours[value.role];
}

/** `scope` prefixed to every part of a comma-separated selector. */
function scoped(scope: string, selector: string): string {
  const prefix = scope ? `${scope} ` : "";
  return selector
    .split(",")
    .map((part) => `${prefix}${part.trim()}`)
    .join(", ");
}

function toCss(rules: readonly Rule[], scope: string, colours: DocumentContentColours): string {
  return rules
    .map(
      ([selector, decls]) =>
        `${scoped(scope, selector)} { ${decls
          .map(([prop, value]) => `${prop}: ${resolve(value, colours)};`)
          .join(" ")} }`,
    )
    .join("\n");
}

export interface DocumentContentCssOptions {
  /** Include the picture rules (default true). */
  pictures?: boolean;
  /** Add the print-only rules: rows (and pictures) never split across pages. */
  print?: boolean;
  /** On screen only, let `scope` itself scroll sideways (a table wider than it). */
  scroll?: boolean;
}

/** The screen-only rule that lets the element holding stored HTML scroll sideways. */
export function documentContentScrollCss(scope: string): string {
  return `@media screen { ${scope} { overflow-x: auto; } }`;
}

/**
 * The rules as plain CSS, every selector under `scope` (e.g.
 * `.doc-print .doc-content`), coloured from `colours`.
 */
export function documentContentCss(
  scope: string,
  colours: DocumentContentColours,
  { pictures = true, print = false, scroll = false }: DocumentContentCssOptions = {},
): string {
  const rules: Rule[] = [...CONTENT_RULES];
  if (pictures) rules.push(...PICTURE_RULES);
  if (print) {
    rules.push(...PRINT_RULES);
    if (pictures) rules.push(...PRINT_PICTURE_RULES);
  }
  const css = toCss(rules, scope, colours);
  return scroll ? `${css}\n${documentContentScrollCss(scope)}` : css;
}

/**
 * The picture rules alone as plain CSS under `scope`; no scope gives the bare
 * `img` rules.
 */
export function documentImageCss(scope = ""): string {
  // Pictures carry no colour; any surface's colours do.
  return toCss(PICTURE_RULES, scope, PRINT_CONTENT_COLOURS);
}

/** The unscoped picture rules, for a surface that injects them under its own root. */
export const DOCUMENT_IMAGE_CSS = documentImageCss();

const camel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

type Sx = Record<string, Record<string, string>>;

/** Nested rules only: every key is a selector under the element (`& …`). */
type SelectorSx = { [selector: `& ${string}`]: Record<string, string> };

/**
 * `DOCUMENT_CONTENT_SX`: the element's own sideways scroll, then the nested
 * rules (so `DOCUMENT_CONTENT_SX["& a"]` stays an object a caller can spread).
 */
export type DocumentContentSx = { overflowX: "auto" } & SelectorSx;

function toSx(rules: readonly Rule[], colours: DocumentContentColours): Sx {
  return Object.fromEntries(
    rules.map(([selector, decls]) => [
      scoped("&", selector),
      Object.fromEntries(decls.map(([prop, value]) => [camel(prop), resolve(value, colours)])),
    ]),
  );
}

/** The picture rules as an MUI `sx` fragment for the element holding the HTML. */
export const DOCUMENT_IMAGE_SX: Sx = toSx(PICTURE_RULES, SCREEN_CONTENT_COLOURS);

/**
 * Every rule as an MUI `sx` fragment for the element holding stored HTML,
 * coloured with theme palette keys (dark mode follows the theme). The
 * element itself scrolls sideways, so a table wider than it scrolls.
 */
export const DOCUMENT_CONTENT_SX: DocumentContentSx = {
  overflowX: "auto",
  ...toSx([...CONTENT_RULES, ...PICTURE_RULES], SCREEN_CONTENT_COLOURS),
};
