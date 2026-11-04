/**
 * Every key English defines is read by some code — the reverse of
 * `translationKeys.test.ts` (every key the code asks for exists).
 *
 * A key nobody reads still costs a translation in ten locale files and a row in
 * every `/translate` pass, and a dead key is how a renamed string keeps its
 * stale twin alive. The check is strict: the list of unused English leaf keys
 * must be empty. A new string is read by the code that adds it; a string the
 * code stops reading is deleted from all 10 locale files
 * (`src/i18n/locales/<locale>/<ns>.json`) in the same change, or the parity
 * checks in `i18n.test.ts` fail on the other nine. A family whose keys no
 * source literal spells goes in `DYNAMIC_PREFIXES`, with a reason.
 *
 * What counts as a reference (`collectReferences`). Every rule errs towards
 * "used", so the guard never asks for a live key to be deleted:
 *   - the first argument of a bound `t` — `useTranslation("ns")`, an alias such
 *     as `t: tCards`, a `TFunction` parameter, an `i18n.t` wrapper; the bindings
 *     `translationKeys.test.ts` resolves, shared in `@/test/i18nKeys` — and of
 *     `i18n.t(…)`, with a `ns:` prefix or an `{ ns }` option winning;
 *     `<Trans i18nKey="…" ns="…">` likewise;
 *   - in a file that takes `t` as a narrowed parameter (`t: Translate`,
 *     `t: TFn`, `t: (key: string, …) => string`), a bare word in any namespace:
 *     the caller hands in its own bound `t`, so the file cannot say which
 *     (`ppm/ppmPortfolioModel.ts` reads `ppm` keys through `PpmPortfolioView`'s `t`);
 *   - a template key matches every key of its shape: `t(`status.${s}`)` reads
 *     `status.*`, `t(`cards:${family}.industryValueAll`)` reads
 *     `cards:*.industryValueAll`;
 *   - any other string literal that names a key: a dotted one in any namespace
 *     (`labelKey: "nav.reports"`, consumed by another file's `t`), a bare word
 *     only in a namespace its own file binds, `"ns:key"` in its namespace;
 *   - any other template literal with a dotted or underscored static part, in
 *     any namespace (`securityLog.actionLabels.${action}`,
 *     `compliance_phase_${phase}`), and a literal ending in `.` / `_` that
 *     starts some key (a prefix handed to a helper: `valueLabel("x_", v)`);
 *   - `DYNAMIC_PREFIXES`, for families whose keys no source literal spells.
 * A referenced key also covers its plural forms (`_one`, `_other`, …) and,
 * read with `returnObjects`, every leaf under it.
 */
import fs from "node:fs";
import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NS,
  NAMESPACES,
  NS_SET,
  TRANS_ATTR_WINDOW,
  TRANS_KEY_ATTR,
  TRANS_NS,
  TRANS_TAG,
  extractBindings,
  narrowedTParams,
} from "@/test/i18nKeys";
import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, parse, walkSources } from "@/test/sourceScanners";

const LOCALE_DIR = path.join(SRC, "i18n", "locales", "en");

/**
 * Key families no source literal spells, as `ns:prefix` — every key under the
 * prefix counts as read. One-line reason each.
 */
const DYNAMIC_PREFIXES: Record<string, string> = {};

/** Anti-rot floor: a scanner that stops matching must not pass by reporting nothing as read. */
const MIN_REFERENCED_KEYS = 3_000;

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;

/** A template's static text must carry this much before it may match keys outside a `t` call. */
const MIN_STATIC_WORD = /[A-Za-z]{3}/;

// ---------------------------------------------------------------------------
// Locale keys
// ---------------------------------------------------------------------------

/** Every leaf of a locale bundle as a dotted path (nested objects and flat dotted keys read alike). */
function leafKeys(bundle: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(bundle)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...leafKeys(value as Record<string, unknown>, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** English keys per namespace: every leaf and every plural base. */
type KnownKeys = Map<string, Set<string>>;

function knownKeys(bundles: Record<string, Record<string, unknown>>): KnownKeys {
  const known: KnownKeys = new Map();
  for (const [ns, bundle] of Object.entries(bundles)) {
    const keys = new Set<string>();
    for (const leaf of leafKeys(bundle)) {
      keys.add(leaf);
      keys.add(leaf.replace(PLURAL_SUFFIX, ""));
    }
    known.set(ns, keys);
  }
  return known;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** What the code names: exact `ns:key`s, and per-namespace key shapes from template literals. */
interface References {
  keys: Set<string>;
  /** `ns` → sources of anchored RegExps over that namespace's keys. */
  shapes: Map<string, Set<string>>;
}

function emptyReferences(): References {
  return { keys: new Set(), shapes: new Map() };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `ns:rest` → [ns, rest] when `ns` is a namespace, else [fallback, raw]. */
function splitNs(raw: string, fallback: string): [string, string] {
  const colon = raw.indexOf(":");
  if (colon > 0 && NS_SET.has(raw.slice(0, colon))) return [raw.slice(0, colon), raw.slice(colon + 1)];
  return [fallback, raw];
}

/** The static parts of a template literal: the head, then the text after each substitution. */
function templateParts(node: ts.TemplateExpression): string[] {
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
}

/**
 * True for the value of a property named like a translation key (`labelKey: "todos"`,
 * `tKey`, `i18nKey`): a bare word there is a key some other file's `t` reads.
 */
function isNamedKey(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) &&
    /.Key$/.test(parent.name.text)
  );
}

/** The `{ ns: "…" }` option of a `t(key, options)` call, when it names a namespace. */
function nsOption(call: ts.CallExpression): string | undefined {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const prop of options.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "ns" &&
      ts.isStringLiteral(prop.initializer) &&
      NS_SET.has(prop.initializer.text)
    ) {
      return prop.initializer.text;
    }
  }
  return undefined;
}

/**
 * Every key one source file references, added to `out`. `known` is the English
 * key set per namespace, against which literals outside a `t` call are matched.
 */
function collectReferences(
  file: string,
  src: string,
  known: KnownKeys,
  out: References = emptyReferences(),
): References {
  const { bindings } = extractBindings(src);
  // A `t` taken as a narrowed parameter (`t: Translate`) is whatever `t` the
  // caller hands in, so the file's bare words may be keys of any namespace.
  const handedT = narrowedTParams(src).length > 0;
  const fileNamespaces = new Set<string>(handedT ? NAMESPACES : [DEFAULT_NS, ...bindings.values()]);

  const addKey = (ns: string, key: string) => {
    if (key) out.keys.add(`${ns}:${key}`);
  };
  const addShape = (ns: string, parts: string[]) => {
    const shapes = out.shapes.get(ns) ?? new Set<string>();
    shapes.add(`^${parts.map(escapeRe).join(".+")}$`);
    out.shapes.set(ns, shapes);
  };

  /** A `t` / `i18n.t` call's first argument, in `fallback` unless a `ns:` prefix or `{ ns }` says otherwise. */
  const addCallArgument = (call: ts.CallExpression, fallback: string) => {
    const arg = call.arguments[0];
    const ns = nsOption(call) ?? fallback;
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
      const [keyNs, key] = splitNs(arg.text, ns);
      addKey(keyNs, key);
    } else if (arg && ts.isTemplateExpression(arg)) {
      const parts = templateParts(arg);
      const [keyNs, head] = splitNs(parts[0], ns);
      parts[0] = head;
      // `t(`${key}`)` and a `delivery:${key}` wrapper name no family.
      if (parts.join("") !== "") addShape(keyNs, parts);
    }
  };

  const addLiteral = (raw: string, namedKey: boolean) => {
    if (!raw) return;
    const [ns, key] = splitNs(raw, "");
    if (ns) {
      if (known.get(ns)?.has(key)) addKey(ns, key);
      return;
    }
    for (const candidate of raw.includes(".") || namedKey ? NAMESPACES : fileNamespaces) {
      if (known.get(candidate)?.has(raw)) addKey(candidate, raw);
    }
    // A key prefix handed to a helper (`valueLabel("turbolens_priority_", p)`).
    if (/[._]$/.test(raw) && MIN_STATIC_WORD.test(raw)) {
      for (const candidate of NAMESPACES) {
        if ([...(known.get(candidate) ?? [])].some((k) => k.startsWith(raw))) addShape(candidate, [raw, ""]);
      }
    }
  };

  const addTemplate = (node: ts.TemplateExpression) => {
    const parts = templateParts(node);
    const [ns, head] = splitNs(parts[0], "");
    parts[0] = head;
    const text = parts.join("");
    if (!/[._]/.test(text) || !MIN_STATIC_WORD.test(text)) return;
    for (const candidate of ns ? [ns] : NAMESPACES) addShape(candidate, parts);
  };

  const callNs = (callee: ts.Expression): string | undefined => {
    if (ts.isIdentifier(callee)) return bindings.get(callee.text);
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "t" &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "i18n"
    ) {
      return DEFAULT_NS;
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const ns = callNs(node.expression);
      if (ns !== undefined) {
        addCallArgument(node, ns);
        // A computed key (`t(cond ? "a.b" : "a.c")`) is read as plain literals.
        const [first, ...rest] = node.arguments;
        if (first && !ts.isStringLiteralLike(first) && !ts.isTemplateExpression(first)) visit(first);
        rest.forEach(visit);
        return;
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      addLiteral(node.text, isNamedKey(node));
    }
    else if (ts.isTemplateExpression(node)) addTemplate(node);
    ts.forEachChild(node, visit);
  };
  visit(parse(file, src));

  // `<Trans i18nKey="…" ns="…">`: the visit saw the attribute as a plain
  // literal, but not the namespace its `ns=` names.
  for (const m of src.matchAll(TRANS_TAG)) {
    const window = src.slice(m.index, m.index + TRANS_ATTR_WINDOW);
    const keyAttr = TRANS_KEY_ATTR.exec(window);
    if (!keyAttr) continue;
    const nsAttr = TRANS_NS.exec(window);
    const fallback = nsAttr && NS_SET.has(nsAttr[1]) ? nsAttr[1] : DEFAULT_NS;
    addKey(...splitNs(keyAttr[1] ?? keyAttr[2], fallback));
  }
  return out;
}

/** The leaves (`ns:key`) no reference reaches, sorted. */
function unusedLeaves(leaves: string[], refs: References, dynamicPrefixes: string[] = []): string[] {
  const shapes = new Map(
    [...refs.shapes].map(([ns, sources]) => [ns, [...sources].map((s) => new RegExp(s))] as const),
  );
  const used = (leaf: string): boolean => {
    if (dynamicPrefixes.some((prefix) => leaf.startsWith(prefix))) return true;
    const colon = leaf.indexOf(":");
    const ns = leaf.slice(0, colon);
    const key = leaf.slice(colon + 1);
    const base = key.replace(PLURAL_SUFFIX, "");
    for (const candidate of base === key ? [key] : [key, base]) {
      if (refs.keys.has(`${ns}:${candidate}`)) return true;
      // A key read with `returnObjects` names an object above its leaves.
      const segments = candidate.split(".");
      for (let i = segments.length - 1; i > 0; i--) {
        if (refs.keys.has(`${ns}:${segments.slice(0, i).join(".")}`)) return true;
      }
      if (shapes.get(ns)?.some((re) => re.test(candidate))) return true;
    }
    return false;
  };
  return leaves.filter((leaf) => !used(leaf)).sort();
}

// ---------------------------------------------------------------------------
// Self-tests (strings only — no disk)
// ---------------------------------------------------------------------------

const BUNDLES = {
  common: {
    actions: { save: "Save" },
    status: { active: "Active", retired: "Retired" },
    items_one: "{{count}} item",
    items_other: "{{count}} items",
  },
  cards: { "relations.title": "Relations", catalogue: { all: "All", none: "None" }, process: { all: "All" } },
  nav: { reports: "Reports", inventory: "Inventory" },
  ppm: { printOn: "On", derivedTip_one: "From {{count}}", derivedTip_other: "From {{count}}" },
};
const KNOWN = knownKeys(BUNDLES);
const LEAVES = Object.entries(BUNDLES).flatMap(([ns, bundle]) => leafKeys(bundle).map((key) => `${ns}:${key}`));
const refsOf = (src: string, file = "x.tsx") => collectReferences(file, src, KNOWN);
const unusedIn = (src: string) => unusedLeaves(LEAVES, refsOf(src));

describe("collectReferences", () => {
  it("reads a bound t()'s literal key in its namespace, and a ns:key in that namespace", () => {
    const src = 'const { t } = useTranslation("cards"); t("relations.title"); t("common:actions.save");';
    expect([...refsOf(src).keys].sort()).toEqual(["cards:relations.title", "common:actions.save"]);
  });

  it("reads an aliased binding and i18n.t", () => {
    const src = 'const { t: tNav } = useTranslation("nav"); tNav("reports"); i18n.t("actions.save");';
    expect([...refsOf(src).keys].sort()).toEqual(["common:actions.save", "nav:reports"]);
  });

  it("reads a template key as every key of its shape", () => {
    const unused = unusedIn("const { t } = useTranslation(); t(`status.${s}`); t(`cards:${family}.all`);");
    expect(unused).toEqual(["cards:catalogue.none", "cards:relations.title", "common:actions.save",
      "common:items_one", "common:items_other", "nav:inventory", "nav:reports", "ppm:derivedTip_one",
      "ppm:derivedTip_other", "ppm:printOn"]);
  });

  it("reads a dotted template outside t() in every namespace", () => {
    expect(unusedIn("const key = `status.${s}`;")).not.toContain("common:status.active");
  });

  it("reads a key prefix handed to a helper, and an underscored template", () => {
    const unused = unusedLeaves(LEAVES, refsOf('label(valueLabel("items_", n)); const k = `relations.${x}`;'));
    expect(unused).not.toContain("common:items_one");
    expect(unused).not.toContain("cards:relations.title");
  });

  it("ignores a template that names no family", () => {
    const src = "const { t } = useTranslation(); t(`${key}`); const u = `/cards/${id}`; const k = `${a}.${b}`;";
    expect(refsOf(src).shapes.size).toBe(0);
  });

  it("reads <Trans i18nKey> in its ns", () => {
    expect([...refsOf('<Trans i18nKey="reports" ns="nav" components={{ b: <b /> }} />').keys]).toContain(
      "nav:reports",
    );
  });

  it("reads a dotted literal in any namespace, a bare word only in the file's own namespaces", () => {
    const src = 'const items = [{ labelKey: "relations.title" }, { key: "inventory" }];';
    expect(refsOf(src, "x.ts").keys.has("cards:relations.title")).toBe(true);
    expect(refsOf(src, "x.ts").keys.has("nav:inventory")).toBe(false);
    expect(refsOf(`const { t } = useTranslation("nav"); ${src}`).keys.has("nav:inventory")).toBe(true);
  });

  it("reads a bare word under a *Key property in any namespace", () => {
    expect(refsOf('const item = { labelKey: "inventory", key: "reports" };', "x.ts").keys).toEqual(
      new Set(["nav:inventory"]),
    );
  });

  it("counts a plural form read when its base is, and a leaf when its object is", () => {
    const unused = unusedIn('const { t } = useTranslation(); t("items", { count }); t("status", { returnObjects: true });');
    expect(unused).not.toContain("common:items_one");
    expect(unused).not.toContain("common:items_other");
    expect(unused).not.toContain("common:status.active");
    expect(unused).toContain("common:actions.save");
  });

  it("reads the literals of a computed key", () => {
    const src = 'const { t } = useTranslation("nav"); t(open ? "relations.title" : "reports");';
    expect([...refsOf(src).keys].sort()).toEqual(["cards:relations.title", "nav:reports"]);
  });

  it("honours a { ns } option on the call", () => {
    expect([...refsOf('const { t } = useTranslation(); t("reports", { ns: "nav" });').keys]).toEqual([
      "nav:reports",
    ]);
  });

  it("reads a bare word in every namespace where t is a narrowed parameter", () => {
    const helper =
      "export type Translate = (key: string, options?: Record<string, unknown>) => string;\n" +
      'export const tip = (both: boolean) => (both ? "derivedTip" : null);\n' +
      'export function params(t: Translate) { return [t("printOn")]; }';
    const unused = unusedLeaves(LEAVES, refsOf(helper, "ppmModel.ts"));
    expect(unused).not.toContain("ppm:printOn");
    expect(unused).not.toContain("ppm:derivedTip_one");
    for (const param of ["t: TFn", "t?: (key: string) => string", "tr: (key: string, o?: object) => string"]) {
      expect(refsOf(`function f(${param}) { return t("printOn"); }`, "x.ts").keys).toContain("ppm:printOn");
    }
  });

  it("does not widen for a label resolver of the same shape", () => {
    const src = 'function f(subtypeLabel: (key: string) => string) { return subtypeLabel("printOn"); }';
    expect(refsOf(src, "x.ts").keys.has("ppm:printOn")).toBe(false);
  });

  it("marks a dynamic prefix's family read", () => {
    expect(unusedLeaves(LEAVES, emptyReferences(), ["cards:catalogue."])).not.toContain("cards:catalogue.none");
  });
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

interface Scan {
  leaves: string[];
  unused: string[];
}

let scanned: Scan | undefined;

/** Every English leaf and the ones `src/` never reads. Read once, on first use. */
function scan(): Scan {
  if (scanned) return scanned;
  const bundles: Record<string, Record<string, unknown>> = {};
  const leaves: string[] = [];
  for (const ns of NAMESPACES) {
    bundles[ns] = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${ns}.json`), "utf8"));
    leaves.push(...leafKeys(bundles[ns]).map((key) => `${ns}:${key}`));
  }
  const known = knownKeys(bundles);
  const refs = emptyReferences();
  for (const file of walkSources(SRC)) collectReferences(file, fs.readFileSync(file, "utf8"), known, refs);
  scanned = { leaves, unused: unusedLeaves(leaves, refs, Object.keys(DYNAMIC_PREFIXES)) };
  return scanned;
}

describeSourceScan("unused translation keys", () => {
  itSourceScan(`reads at least ${MIN_REFERENCED_KEYS} English keys`, () => {
    const { leaves, unused } = scan();
    expect(leaves.length - unused.length).toBeGreaterThanOrEqual(MIN_REFERENCED_KEYS);
  });

  itSourceScan("every English key is read by some code", () => {
    expect(
      scan().unused,
      "These English keys are read by no code. Read each where it is meant to show, or delete it " +
        "from all 10 locale files (src/i18n/locales/<locale>/<ns>.json). A key built in a way this " +
        "scan cannot see goes in DYNAMIC_PREFIXES, with why.",
    ).toEqual([]);
  });

  itSourceScan("marks only prefixes that still name keys (stale DYNAMIC_PREFIXES)", () => {
    const { leaves } = scan();
    const stale = Object.keys(DYNAMIC_PREFIXES).filter((p) => !leaves.some((leaf) => leaf.startsWith(p)));
    expect(stale, "no English key starts with this prefix any more — delete the entry").toEqual([]);
  });
});
