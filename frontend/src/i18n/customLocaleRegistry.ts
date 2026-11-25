/**
 * The runtime registry of custom (admin-added) languages: code → native name,
 * direction and bundle hash.
 *
 * A leaf module on purpose — no imports of `./index` or the API client — so
 * `isRtlLocale` in `./index` can consult it without an import cycle. The
 * loader and the public helpers live in `./customLocales`, which re-exports
 * these functions.
 */
/**
 * One registered language. Structurally `CustomLocaleInfo` from `@/types`, but
 * spelled out here: `./index` imports this module and the test setup imports
 * `./index`, so an import of `@/types` would put the whole types file on the
 * path every test run starts from (`scripts/pr-test-scope.test.ts`).
 */
type CustomLocaleInfo = { code: string; name: string; rtl: boolean; hash: string };

const _registry = new Map<string, CustomLocaleInfo>();

/** Add or update one custom language (a later entry replaces the earlier one). */
export function registerCustomLocale(entry: CustomLocaleInfo): void {
  _registry.set(entry.code, { ...entry });
}

/** Add or update several custom languages at once. */
export function registerCustomLocales(entries: readonly CustomLocaleInfo[]): void {
  for (const entry of entries) registerCustomLocale(entry);
}

/** The registered custom language for `code`, if any. */
export function getCustomLocale(code: string | null | undefined): CustomLocaleInfo | undefined {
  return code ? _registry.get(code) : undefined;
}

/** Drop one custom language (it was deleted). */
export function forgetCustomLocale(code: string): void {
  _registry.delete(code);
}
