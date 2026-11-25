/**
 * Pure helpers for the custom-languages admin: reading a language-pack file,
 * saving one, and turning an API error into a message.
 *
 * The client-side checks here are a convenience for the admin (a wrong file is
 * refused before anything is sent). The server validates every string again
 * and is the only gate.
 */
import { ApiError } from "@/api/client";
import type { LanguagePack } from "@/types";

export const PACK_FORMAT = "turbo-ea-language-pack";
export const PACK_FORMAT_VERSION = 1;

/** Error codes the custom-language endpoints answer with that have their own message. */
export const KNOWN_ERROR_CODES = [
  "invalid_code",
  "built_in_code",
  "locale_exists",
  "job_running",
  "ai_not_configured",
  "catalog_unavailable",
] as const;

/** Reasons `POST …/strings` rejects a string with. */
export const REJECT_REASONS = [
  "unknown_key",
  "empty",
  "too_long",
  "placeholder_mismatch",
  "nesting_mismatch",
  "markup_not_in_source",
  "url_not_in_source",
  "control_chars",
  "not_a_string",
] as const;

/** Mirrors the backend's code rule: `nl`, `fil`, `pt-BR`. */
export const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;
/** Mirrors the backend's English-name rule (the name reaches an AI prompt). */
export const ENGLISH_NAME_PATTERN = /^[A-Za-z][A-Za-z ()-]{1,59}$/;

export type PackParseError = "invalid_json" | "not_a_pack" | "unsupported_version" | "no_strings";

export type PackParseResult =
  | { ok: true; pack: LanguagePack; namespaces: string[]; stringCount: number }
  | { ok: false; error: PackParseError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the text of a language-pack file. Refuses anything that is not a
 * `turbo-ea-language-pack` of a version this client understands, or that
 * carries no strings. Namespaces whose value is not an object are dropped.
 */
export function parseLanguagePack(text: string): PackParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (
    !isPlainObject(raw) ||
    raw.format !== PACK_FORMAT ||
    !isPlainObject(raw.locale) ||
    typeof raw.locale.code !== "string"
  ) {
    return { ok: false, error: "not_a_pack" };
  }
  if (raw.format_version !== PACK_FORMAT_VERSION) return { ok: false, error: "unsupported_version" };
  if (!isPlainObject(raw.strings)) return { ok: false, error: "no_strings" };

  const strings: Record<string, Record<string, unknown>> = {};
  let stringCount = 0;
  for (const [ns, values] of Object.entries(raw.strings)) {
    if (!isPlainObject(values)) continue;
    const count = Object.keys(values).length;
    if (count === 0) continue;
    strings[ns] = values;
    stringCount += count;
  }
  const namespaces = Object.keys(strings).sort();
  if (namespaces.length === 0) return { ok: false, error: "no_strings" };

  const hashes = isPlainObject(raw.source_hashes)
    ? (raw.source_hashes as LanguagePack["source_hashes"])
    : undefined;
  const pack = { ...(raw as unknown as LanguagePack), strings, source_hashes: hashes };
  return { ok: true, pack, namespaces, stringCount };
}

/** The `POST …/strings` body importing one namespace of a pack. */
export function importBody(pack: LanguagePack, namespace: string) {
  const hashes = pack.source_hashes?.[namespace];
  return {
    strings: { [namespace]: pack.strings[namespace] },
    ...(isPlainObject(hashes) ? { source_hashes: { [namespace]: hashes } } : {}),
    origin: "import" as const,
  };
}

/** Read a picked file as text. */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

/** Offer `data` to the browser as a pretty-printed JSON download. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The machine-readable code of an API error (`detail` as a string or `{code}`). */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const { detail } = err;
  if (typeof detail === "string") return detail;
  if (isPlainObject(detail) && typeof detail.code === "string") return detail.code;
  return null;
}

/** Whether an error code has its own message under `customLocales.errors.*`. */
export function isKnownErrorCode(code: string | null): code is (typeof KNOWN_ERROR_CODES)[number] {
  return code !== null && (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

/** Whether a rejection reason has its own label under `customLocales.reasons.*`. */
export function isKnownReason(reason: string): reason is (typeof REJECT_REASONS)[number] {
  return (REJECT_REASONS as readonly string[]).includes(reason);
}

/** Whole percent of `part` in `total`, 0 when there is nothing to count. */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The message for a failed request: the error code's own message when the
 * server answered with a known one, else `fallback`.
 */
export function errorMessage(err: unknown, t: Translate, fallback: string): string {
  const code = apiErrorCode(err);
  return isKnownErrorCode(code) ? t(`customLocales.errors.${code}`) : fallback;
}

/** The label of a rejection reason, or the raw code when it is not one we know. */
export function reasonLabel(reason: string, t: Translate): string {
  return isKnownReason(reason) ? t(`customLocales.reasons.${reason}`) : reason;
}
