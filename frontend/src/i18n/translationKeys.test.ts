import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

import i18n from "@/i18n";

/**
 * Guards the direction `i18n.test.ts` does not cover.
 *
 * That suite checks locale-to-locale PARITY — every non-English locale has all
 * the English keys, placeholders match, plurals are consistent. What nothing
 * checked is the reverse: that a key the *code* asks for actually exists.
 * `i18n/index.ts` sets `fallbackLng: "en"`, so a key missing from English has
 * no fallback left and i18next renders the raw key string to the user, in
 * every language. That is exactly how `t("dependency.selectHint")` shipped to
 * the Dependencies report — 22 such keys were live across 5 files.
 *
 * So: walk the source tree, pull out every literal `t("…")` call, work out
 * which namespace it resolves against, and fail on any that resolve to
 * nothing.
 *
 * Deliberate blind spots, so this is not over-trusted:
 *   - Dynamic keys (`t(`status.${s}`)`, `t(variable)`) are counted but not
 *     checked. They are not statically knowable and are legitimate.
 *   - Regex, not AST. A `t(` inside a string literal or block comment would be
 *     a false positive; none exist today. Reach for the TypeScript parser only
 *     when one appears — it costs a dependency and ~10x the runtime.
 *   - Existence only, not placeholder agreement between call site and value.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACES = [
  "common",
  "auth",
  "nav",
  "inventory",
  "cards",
  "reports",
  "admin",
  "bpm",
  "diagrams",
  "delivery",
  "grc",
  "ppm",
  "notifications",
  "validation",
] as const;

const NS_SET = new Set<string>(NAMESPACES);

/** `i18n/index.ts` sets this and declares no `fallbackNS`. */
const DEFAULT_NS = "common";

const SRC_ROOT = resolve(__dirname, "..");

/**
 * Ratchet, not a target. These call sites supply their own English fallback
 * (`t("k", "Literal")` / `{ defaultValue }`), so they render correctly in
 * English but are untranslatable for the other 9 locales — a milder defect
 * than a raw key on screen, and a different fix. The inequality blocks new
 * ones without failing the PR that removes one. Measured 2026-08-24.
 */
const DEFAULT_VALUE_BASELINE = 43;

/**
 * Anti-rot floor. If `useTranslation` is ever wrapped in a custom hook, or `t`
 * is renamed, the binding regexes below stop matching, the scan silently drops
 * to near-zero call sites and every other assertion in this file passes
 * vacuously. Measured 5,740 across 403 files on 2026-08-24.
 */
const MIN_LITERAL_CALLS = 4_000;

// ---------------------------------------------------------------------------
// English resolution
// ---------------------------------------------------------------------------

/**
 * Resolve through i18next itself rather than a hand-rolled bundle walk. Two
 * reasons: it is the same code path that decides at runtime whether the user
 * sees a string or a raw key, and 12 of the 14 namespaces use flat dotted keys
 * while `grc` and `ppm` nest some of theirs under real objects (`soaw.*`,
 * `governance.*`, `tabs.*`). A `bundle[key] !== undefined` check reports 34
 * phantom misses on those two; `exists()` handles both shapes.
 *
 * `lng` is pinned so the ambient language can never leak in, and the `count`
 * probes cover plural-only keys — i18next will not find `cost.scopeCount`
 * without a count when only `cost.scopeCount_one` / `_other` are defined. The
 * `count: 1` probe also covers the base-key + `_other` pattern documented in
 * `i18n.test.ts`'s `findPluralKeys`.
 */
function resolvesInEnglish(ns: string, key: string): boolean {
  return (
    i18n.exists(key, { ns, lng: "en" }) ||
    i18n.exists(key, { ns, lng: "en", count: 1 }) ||
    i18n.exists(key, { ns, lng: "en", count: 2 })
  );
}

// ---------------------------------------------------------------------------
// Source walker
// ---------------------------------------------------------------------------

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test") continue;
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-file namespace bindings
// ---------------------------------------------------------------------------

/**
 * Bindings are per file and there can be several: 9 files declare more than
 * one, and ~99 call sites go through an alias such as `t: tCards`. Resolving
 * every bare `t()` against "the first useTranslation in the file" mis-attributes
 * all of them.
 */
type Bindings = Map<string, string>;

/** `const { t } = useTranslation("x")` / `const { t: tCards } = useTranslation(["cards", …])` */
const HOOK_BINDING = /\{\s*t\s*(?::\s*(\w+))?\s*[,}][^=]*?=\s*useTranslation\(\s*([^)]*)\)/g;

/**
 * Namespace-binding wrapper helpers in plain `.ts` modules — they have no
 * `useTranslation`, so without this they would all default to `common` and
 * every key in them would read as a miss (~170 phantoms across 6 files). Two
 * shapes exist: a template prefix (``i18n.t(`delivery:${key}`)``) and an
 * options object (`i18n.t(key, { ns: "inventory" })`).
 */
const WRAPPER_BINDING =
  /(?:const|let)\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]*?)?=>\s*(?:String\()?\s*i18n\.t\(\s*(?:`(\w+):\$\{|[^;]*?\{\s*ns:\s*"(\w+)")/g;

/** `t: TFunction` / `t: TFunction<"common">` parameters — 2 files, no binding otherwise. */
const TFUNCTION_BINDING = /(\w+)\s*:\s*TFunction(?:<\s*"(\w+)")?/g;

function extractBindings(src: string): { bindings: Bindings; unresolvable: string[] } {
  const bindings: Bindings = new Map();
  const unresolvable: string[] = [];

  for (const m of src.matchAll(TFUNCTION_BINDING)) {
    bindings.set(m[1], m[2] && NS_SET.has(m[2]) ? m[2] : DEFAULT_NS);
  }

  for (const m of src.matchAll(HOOK_BINDING)) {
    const name = m[1] ?? "t";
    const args = m[2] ?? "";
    const literals = [...args.matchAll(/"([^"]+)"|'([^']+)'/g)].map((l) => l[1] ?? l[2]);
    if (literals.length === 0) {
      // `useTranslation()` with no argument is the documented default-namespace
      // form. Anything else means a shape this scanner does not understand —
      // record it rather than guessing `common` and emitting phantom misses.
      if (args.trim() === "") bindings.set(name, DEFAULT_NS);
      else unresolvable.push(`${name} = useTranslation(${args.trim()})`);
      continue;
    }
    bindings.set(name, literals[0]);
  }

  // A wrapper rebinds the namespace outright, so it wins over anything above.
  for (const m of src.matchAll(WRAPPER_BINDING)) {
    bindings.set(m[1], m[2] ?? m[3]);
  }

  return { bindings, unresolvable };
}

// ---------------------------------------------------------------------------
// Call extraction
// ---------------------------------------------------------------------------

/** `i18n.t("literal…")` called directly, outside any binding. */
const DIRECT_I18N_CALL = /i18n\.t\(\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * `<Trans i18nKey="…" ns="…">`. Matched as "tag head + a bounded attribute
 * window" rather than one regex ending at `i18nKey`, because `ns=` is usually
 * written *after* it and a pattern that stops at the key never sees it — and
 * because an attribute value can itself contain `>` (`components={{ strong:
 * <strong /> }}`), so `[^>]*` is not a safe way to reach the end of the tag.
 */
const TRANS_TAG = /<Trans\b/g;
const TRANS_ATTR_WINDOW = 400;
const TRANS_KEY_ATTR = /i18nKey=(?:"([^"]+)"|\{"([^"]+)"\})/;
const TRANS_NS = /\bns="(\w+)"/;

function buildCallRegex(names: string[]): RegExp {
  // The lookbehind is load-bearing: it excludes `it(`, `format(`, `expect(`
  // and — critically — `i18n.t(`, which has its own namespace rules below.
  return new RegExp(
    `(?<![\\w$.])(${names.join("|")})\\(\\s*` +
      `(?:"((?:[^"\\\\]|\\\\.)*)"` +
      `|'((?:[^'\\\\]|\\\\.)*)'` +
      "|(`|[A-Za-z_$]))",
    "g",
  );
}

/**
 * `t("k", "Literal")`, `t("k", { defaultValue: … })`, and the 3-arg wrapper
 * `t(key, fallback, opts)` in `reportExport.ts` where arg 2 is positionally the
 * default.
 */
const SUPPLIES_DEFAULT = /^\s*,\s*(?:"|'|\{[^}]*\bdefaultValue\b)/;

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// ---------------------------------------------------------------------------
// Scan (runs once at module load; the assertions below just read the result)
// ---------------------------------------------------------------------------

interface Hit {
  file: string;
  line: number;
  ns: string;
  key: string;
}

const report = {
  files: 0,
  literalCalls: 0,
  dynamic: 0,
  missing: [] as Hit[],
  unknownNamespace: [] as Hit[],
  defaultValueMisses: [] as Hit[],
  unresolvableBindings: [] as string[],
};

for (const file of collectSourceFiles(SRC_ROOT)) {
  const src = readFileSync(file, "utf-8");
  const rel = relative(SRC_ROOT, file);
  report.files++;

  const { bindings, unresolvable } = extractBindings(src);
  for (const u of unresolvable) report.unresolvableBindings.push(`${rel} :: ${u}`);

  const record = (key: string, defaultNs: string, index: number, hasDefault: boolean) => {
    let ns = defaultNs;
    let bare = key;
    if (key.includes(":")) {
      const [prefix, ...rest] = key.split(":");
      bare = rest.join(":");
      if (!NS_SET.has(prefix)) {
        // i18next's nsSeparator still splits this, so it looks in a namespace
        // that does not exist — a real runtime bug, not a scanner artefact.
        report.unknownNamespace.push({ file: rel, line: lineOf(src, index), ns: prefix, key: bare });
        return;
      }
      ns = prefix;
    }
    if (resolvesInEnglish(ns, bare)) return;
    const hit: Hit = { file: rel, line: lineOf(src, index), ns, key: bare };
    (hasDefault ? report.defaultValueMisses : report.missing).push(hit);
  };

  if (bindings.size > 0) {
    const callRegex = buildCallRegex([...bindings.keys()]);
    for (const m of src.matchAll(callRegex)) {
      const key = m[2] ?? m[3];
      if (key === undefined) {
        report.dynamic++;
        continue;
      }
      report.literalCalls++;
      const after = src.slice(m.index + m[0].length);
      record(key, bindings.get(m[1]) ?? DEFAULT_NS, m.index, SUPPLIES_DEFAULT.test(after));
    }
  }

  for (const m of src.matchAll(DIRECT_I18N_CALL)) {
    report.literalCalls++;
    const after = src.slice(m.index + m[0].length);
    record(m[1], DEFAULT_NS, m.index, SUPPLIES_DEFAULT.test(after));
  }

  for (const m of src.matchAll(TRANS_TAG)) {
    const window = src.slice(m.index, m.index + TRANS_ATTR_WINDOW);
    const keyAttr = TRANS_KEY_ATTR.exec(window);
    if (!keyAttr) continue; // dynamic i18nKey (a ternary) — not statically knowable
    report.literalCalls++;
    const nsAttr = TRANS_NS.exec(window);
    record(
      keyAttr[1] ?? keyAttr[2],
      nsAttr && NS_SET.has(nsAttr[1]) ? nsAttr[1] : DEFAULT_NS,
      m.index,
      false,
    );
  }
}

function format(hits: Hit[]): string {
  const byFile = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byFile.get(h.file) ?? [];
    list.push(h);
    byFile.set(h.file, list);
  }
  return [...byFile.entries()]
    .map(([file, list]) =>
      [`  ${file}`, ...list.map((h) => `    :${h.line}  ${h.ns}:${h.key}`)].join("\n"),
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// 1. Canaries — without these a broken resolver makes every check below vacuous
// ---------------------------------------------------------------------------

describe("English resolution helper", () => {
  it("resolves a flat dotted key", () => {
    expect(resolvesInEnglish("reports", "dependency.selectCard")).toBe(true);
  });

  it("resolves a key nested under an object (grc, ppm)", () => {
    expect(resolvesInEnglish("grc", "soaw.title")).toBe(true);
    expect(resolvesInEnglish("ppm", "tabs.portfolio")).toBe(true);
  });

  it("resolves a key that only exists in plural form", () => {
    expect(resolvesInEnglish("reports", "cost.scopeCount")).toBe(true);
  });

  it("does NOT resolve a key that does not exist", () => {
    expect(resolvesInEnglish("common", "__definitely_not_a_key__")).toBe(false);
    expect(resolvesInEnglish("reports", "dependency.selectHint")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The guard
// ---------------------------------------------------------------------------

describe("Every literal t() key resolves in English", () => {
  it("has no key that would render as a raw string", () => {
    if (report.missing.length > 0) {
      expect.fail(
        `${report.missing.length} translation key(s) are used in code but defined in no ` +
          `locale file. With fallbackLng:"en" these render the raw key to the user:\n` +
          format(report.missing),
      );
    }
  });

  it("has no key targeting an unknown namespace", () => {
    if (report.unknownNamespace.length > 0) {
      expect.fail(
        `${report.unknownNamespace.length} key(s) carry a namespace prefix that is not one ` +
          `of the ${NAMESPACES.length} declared namespaces:\n${format(report.unknownNamespace)}`,
      );
    }
  });

  it("resolves every t binding to a namespace", () => {
    if (report.unresolvableBindings.length > 0) {
      expect.fail(
        `useTranslation() is called in a shape this scanner does not understand. Teach it ` +
          `the new shape rather than letting these fall back to "${DEFAULT_NS}":\n  ` +
          report.unresolvableBindings.join("\n  "),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Anti-rot
// ---------------------------------------------------------------------------

describe("Scanner still sees the codebase", () => {
  it(`finds at least ${MIN_LITERAL_CALLS} literal t() calls`, () => {
    expect(report.files).toBeGreaterThan(300);
    expect(report.literalCalls).toBeGreaterThanOrEqual(MIN_LITERAL_CALLS);
  });
});

describe("Inline defaultValue fallbacks do not grow", () => {
  it(`stays at or below ${DEFAULT_VALUE_BASELINE} call sites`, () => {
    if (report.defaultValueMisses.length > DEFAULT_VALUE_BASELINE) {
      expect.fail(
        `${report.defaultValueMisses.length} call sites supply an inline English fallback ` +
          `for a key no locale defines (baseline ${DEFAULT_VALUE_BASELINE}). These render in ` +
          `English but are untranslatable — add the key to en/*.json and the other 9 locales ` +
          `instead:\n${format(report.defaultValueMisses)}`,
      );
    }
  });
});
