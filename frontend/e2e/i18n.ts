/**
 * `t("ns:key", vars)` over the English locale files, so a spec never carries a
 * hardcoded label: a copy change breaks the spec at the key, not silently.
 * Resolves i18next's flat keys (`"login.email"`) and nested objects alike,
 * picks `_one` / `_other` when `count` is given and interpolates `{{var}}`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Dict = Record<string, unknown>;

const cache = new Map<string, Dict>();

function localesDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    for (const rel of ["src/i18n/locales/en", "frontend/src/i18n/locales/en"]) {
      const candidate = path.join(dir, rel);
      if (existsSync(candidate)) return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error("could not find src/i18n/locales/en from " + process.cwd());
}

function load(ns: string): Dict {
  let dict = cache.get(ns);
  if (!dict) {
    dict = JSON.parse(readFileSync(path.join(localesDir(), `${ns}.json`), "utf8")) as Dict;
    cache.set(ns, dict);
  }
  return dict;
}

function walk(dict: Dict, key: string): unknown {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Dict)[part];
  }
  return node;
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const sep = key.indexOf(":");
  const ns = sep >= 0 ? key.slice(0, sep) : "common";
  const rest = sep >= 0 ? key.slice(sep + 1) : key;
  const dict = load(ns);
  const candidates =
    typeof vars.count === "number" ? [`${rest}_${vars.count === 1 ? "one" : "other"}`, rest] : [rest];
  let value: unknown;
  for (const k of candidates) {
    value = dict[k] ?? walk(dict, k);
    if (typeof value === "string") break;
  }
  if (typeof value !== "string") throw new Error(`no English translation for ${key}`);
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}
