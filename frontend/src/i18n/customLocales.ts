/**
 * Custom (admin-added) UI languages at runtime.
 *
 * Built-in locales are bundled and registered in `./index`; a custom language
 * is data: its strings arrive from `GET /custom-locales/{code}/bundle` (public
 * for an enabled language) and are added to i18next here, one resource bundle
 * per namespace, under the language's own code. Anything the bundle lacks falls
 * back to English through i18next's `fallbackLng`.
 *
 * Every language switch goes through `setAppLanguage`, which loads the bundle
 * first and falls back to English when it cannot be loaded.
 */
import { api } from "@/api/client";
import type { CustomLocaleBundle } from "@/types";
import i18n, { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from "./index";
import { getCustomLocale, registerCustomLocale } from "./customLocaleRegistry";

export {
  forgetCustomLocale,
  getCustomLocale,
  registerCustomLocale,
  registerCustomLocales,
} from "./customLocaleRegistry";

/** How long the first render waits for a custom language's bundle. */
export const PRELOAD_TIMEOUT_MS = 3000;

/** Whether `code` is one of the languages that ship with the app. */
export function isBuiltInLocale(code: string | null | undefined): code is SupportedLocale {
  return !!code && (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/**
 * The display name of a language: the built-in label, else the custom
 * language's native name, else `fallback`, else the code itself.
 */
export function localeLabel(code: string | null | undefined, fallback?: string): string {
  if (isBuiltInLocale(code)) return LOCALE_LABELS[code];
  const custom = getCustomLocale(code);
  if (custom) return custom.name;
  return fallback ?? code ?? "";
}

/** Bundle hash per loaded custom language. */
const _loadedHash = new Map<string, string>();
/** Namespaces added to i18next per custom language, so a reload can replace them. */
const _loadedNamespaces = new Map<string, string[]>();
const _inflight = new Map<string, Promise<boolean>>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadBundle(code: string): Promise<boolean> {
  let bundle: CustomLocaleBundle;
  try {
    bundle = await api.get<CustomLocaleBundle>(
      `/custom-locales/${encodeURIComponent(code)}/bundle`,
    );
  } catch {
    return false;
  }
  if (!isPlainObject(bundle) || !isPlainObject(bundle.resources)) return false;

  // Only the namespaces English has: a bundle cannot invent one.
  const known = new Set(Object.keys(i18n.getDataByLanguage("en") ?? {}));
  // Replace, not merge: a string cleared since the last load must disappear.
  for (const ns of _loadedNamespaces.get(code) ?? []) i18n.removeResourceBundle(code, ns);
  const added: string[] = [];
  for (const [ns, resources] of Object.entries(bundle.resources)) {
    if (!known.has(ns) || !isPlainObject(resources)) continue;
    i18n.addResourceBundle(code, ns, resources, true, true);
    added.push(ns);
  }
  _loadedNamespaces.set(code, added);
  const hash = typeof bundle.hash === "string" ? bundle.hash : "";
  _loadedHash.set(code, hash);
  registerCustomLocale({
    code,
    name: typeof bundle.name === "string" && bundle.name ? bundle.name : localeLabel(code),
    rtl: bundle.rtl === true,
    hash,
  });
  return true;
}

/**
 * Make sure a language's strings are in i18next. A no-op for a built-in
 * language. A custom language is fetched once, again when the registry's hash
 * (from `/settings/bootstrap`) no longer matches the loaded one, and again on
 * `force`. Concurrent calls share one request. Resolves `false` when the bundle
 * cannot be loaded; whatever was loaded before stays.
 */
export function ensureLocaleLoaded(
  code: string,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  if (!code) return Promise.resolve(false);
  if (isBuiltInLocale(code)) return Promise.resolve(true);
  const pending = _inflight.get(code);
  if (pending) {
    // A forced reload must not reuse a request that started before the change.
    return opts.force ? pending.then(() => ensureLocaleLoaded(code, opts)) : pending;
  }
  if (!opts.force && _loadedHash.has(code)) {
    const expected = getCustomLocale(code)?.hash;
    if (!expected || expected === _loadedHash.get(code)) return Promise.resolve(true);
  }
  const request = loadBundle(code).finally(() => {
    _inflight.delete(code);
  });
  _inflight.set(code, request);
  return request;
}

/**
 * Switch the interface language. A custom language is loaded first; when it
 * cannot be loaded the interface falls back to English. Resolves to the
 * language actually applied.
 */
export async function setAppLanguage(code: string | null | undefined): Promise<string> {
  const target = code || "en";
  if (isBuiltInLocale(target)) {
    await i18n.changeLanguage(target);
    return target;
  }
  const lang = (await ensureLocaleLoaded(target)) ? target : "en";
  await i18n.changeLanguage(lang);
  return lang;
}

/**
 * The admin changed a custom language's strings or settings. Drop what is
 * loaded so the next switch refetches it, and when it is the active language,
 * reload it now and re-render (react-i18next re-renders on `languageChanged`,
 * not on `addResourceBundle`). Resolves `true` when the active language was
 * reloaded.
 */
export async function refreshCustomLocale(code: string): Promise<boolean> {
  if (isBuiltInLocale(code)) return false;
  _loadedHash.delete(code);
  if (i18n.language !== code) return false;
  if (!(await ensureLocaleLoaded(code, { force: true }))) return false;
  await i18n.changeLanguage(code);
  return true;
}

/**
 * Before the first render: when the stored language is a custom one, wait (at
 * most `timeoutMs`) for its bundle so the user does not see English first.
 * Never waits for a built-in language. A bundle that cannot be loaded falls
 * back to English; one that is merely slow is applied when it lands.
 */
export async function preloadDetectedLocale(timeoutMs = PRELOAD_TIMEOUT_MS): Promise<void> {
  const lang = i18n.language;
  if (!lang || isBuiltInLocale(lang)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const load = ensureLocaleLoaded(lang);
  const outcome = await Promise.race([load, timeout]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    void load.then((ok) => {
      if (ok && i18n.language === lang) void i18n.changeLanguage(lang);
    });
    return;
  }
  await i18n.changeLanguage(outcome ? lang : "en");
}
