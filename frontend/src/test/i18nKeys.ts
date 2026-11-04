// How source code names a translation key: the namespace list, the per-file
// `t` bindings (`useTranslation`, aliases, `TFunction` parameters, `i18n.t`
// wrappers) and the call shapes (`t("…")`, `i18n.t("…")`, `<Trans i18nKey>`).
// Shared by the two guards that read `src/` for keys — `i18n/translationKeys.test.ts`
// (every key the code asks for exists) and `i18n/unusedKeys.sourceScan.test.ts`
// (every key English defines is asked for, which also reads `narrowedTParams`).
// Pure regexes over text; reading the files is the caller's job, inside
// `describeSourceScan` / `itSourceScan`.

export const NAMESPACES = [
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

export const NS_SET = new Set<string>(NAMESPACES);

/** `i18n/index.ts` sets this and declares no `fallbackNS`. */
export const DEFAULT_NS = "common";

/**
 * Bindings are per file and there can be several: 9 files declare more than
 * one, and ~99 call sites go through an alias such as `t: tCards`. Resolving
 * every bare `t()` against "the first useTranslation in the file" mis-attributes
 * all of them.
 */
export type Bindings = Map<string, string>;

/** `const { t } = useTranslation("x")` / `const { t: tCards } = useTranslation(["cards", …])` */
export const HOOK_BINDING = /\{\s*t\s*(?::\s*(\w+))?\s*[,}][^=]*?=\s*useTranslation\(\s*([^)]*)\)/g;

/**
 * Namespace-binding wrapper helpers in plain `.ts` modules — they have no
 * `useTranslation`, so without this they would all default to `common` and
 * every key in them would read as a miss (~170 phantoms across 6 files). Two
 * shapes exist: a template prefix (``i18n.t(`delivery:${key}`)``) and an
 * options object (`i18n.t(key, { ns: "inventory" })`).
 */
export const WRAPPER_BINDING =
  /(?:const|let)\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]*?)?=>\s*(?:String\()?\s*i18n\.t\(\s*(?:`(\w+):\$\{|[^;]*?\{\s*ns:\s*"(\w+)")/g;

/** `t: TFunction` / `t: TFunction<"common">` parameters — 2 files, no binding otherwise. */
export const TFUNCTION_BINDING = /(\w+)\s*:\s*TFunction(?:<\s*"(\w+)")?/g;

/**
 * A `t` parameter typed with a narrowed signature instead of `TFunction`:
 * `t: Translate`, `t: TFn`, `t: (key: string, …) => string` (also `tr`, or an
 * alias such as `tCards`). Plain `.ts` helpers (`ppm/ppmPortfolioModel.ts`,
 * `reports/matrixExport.ts`, `admin/securityLogDetails.ts`, …) take one so they
 * need no i18n import, and the caller hands in its own bound `t` — so the
 * namespace is decided at the call site, not in the file, and no binding can
 * name it. Other parameters of the same shape (`subtypeLabel: (key: string) =>
 * string`) are label resolvers, not translators, and are left alone.
 */
export const NARROWED_T_PARAM =
  /\b(t|tr|t[A-Z]\w*)\s*\??\s*:\s*(?:(?:Translate|TFn)\b|\(\s*key\s*:\s*string\b[^)]*\)\s*=>\s*string\b)/g;

/** The names of narrowed-`t` parameters in `src` (see `NARROWED_T_PARAM`). */
export function narrowedTParams(src: string): string[] {
  return [...new Set([...src.matchAll(NARROWED_T_PARAM)].map((m) => m[1]))];
}

export function extractBindings(src: string): { bindings: Bindings; unresolvable: string[] } {
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

/** `i18n.t("literal…")` called directly, outside any binding. */
export const DIRECT_I18N_CALL = /i18n\.t\(\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * `<Trans i18nKey="…" ns="…">`. Matched as "tag head + a bounded attribute
 * window" rather than one regex ending at `i18nKey`, because `ns=` is usually
 * written *after* it and a pattern that stops at the key never sees it — and
 * because an attribute value can itself contain `>` (`components={{ strong:
 * <strong /> }}`), so `[^>]*` is not a safe way to reach the end of the tag.
 */
export const TRANS_TAG = /<Trans\b/g;
export const TRANS_ATTR_WINDOW = 400;
export const TRANS_KEY_ATTR = /i18nKey=(?:"([^"]+)"|\{"([^"]+)"\})/;
export const TRANS_NS = /\bns="(\w+)"/;

export function buildCallRegex(names: string[]): RegExp {
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
