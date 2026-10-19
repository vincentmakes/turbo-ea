/**
 * Turns an error from a `/metamodel/categories` write (or a card-type save
 * that named an unknown category) into a translated sentence.
 *
 * The backend answers with `detail: {error, message, …}` where `error` is a
 * stable code; the code picks the `metamodel.categories.errors.<code>` key and
 * the rest of `detail` fills its placeholders. Anything else falls back to the
 * error's own message, then to a generic sentence.
 */
import type { TFunction } from "i18next";

export const CATEGORY_ERROR_CODES = [
  "category_exists",
  "types_present",
  "built_in_locked",
  "unknown_category",
  "invalid_category",
  "invalid_order",
] as const;

type CategoryErrorCode = (typeof CATEGORY_ERROR_CODES)[number];

interface CategoryErrorDetail {
  error?: unknown;
  types?: unknown;
  category?: unknown;
}

function detailOf(err: unknown): CategoryErrorDetail | null {
  if (!err || typeof err !== "object" || !("detail" in err)) return null;
  const detail = (err as { detail: unknown }).detail;
  return detail && typeof detail === "object" ? (detail as CategoryErrorDetail) : null;
}

/** The category error code an API error carries, or `null`. */
export function categoryErrorCode(err: unknown): CategoryErrorCode | null {
  const code = detailOf(err)?.error;
  return typeof code === "string" &&
    (CATEGORY_ERROR_CODES as readonly string[]).includes(code)
    ? (code as CategoryErrorCode)
    : null;
}

export function categoryErrorMessage(err: unknown, t: TFunction): string {
  const code = categoryErrorCode(err);
  if (code) {
    const detail = detailOf(err)!;
    const types = Array.isArray(detail.types)
      ? detail.types.filter((x) => typeof x === "string").join(", ")
      : "";
    const category = typeof detail.category === "string" ? detail.category : "";
    return t(`admin:metamodel.categories.errors.${code}`, { types, category });
  }
  if (err instanceof Error && err.message) return err.message;
  return t("admin:metamodel.categories.errors.generic");
}
