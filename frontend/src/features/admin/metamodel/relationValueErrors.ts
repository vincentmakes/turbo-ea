/**
 * Turns an error from a `PATCH /metamodel/relation-types/{key}` save of the
 * relation "type values" into a translated sentence.
 *
 * The backend refuses a change to a built-in attribute or value with
 * `detail: {error, message, attribute, value?}`, where `error` is a stable
 * code; the code picks the `metamodel.relationValueErrors.<code>` key and the
 * attribute / value keys are shown by their display names, read from the
 * stored schema. Anything else falls back to a string detail, then the error's
 * own message, then a generic sentence.
 */
import type { TFunction } from "i18next";
import type { FieldDef, FieldOption } from "@/types";

export const RELATION_VALUE_ERROR_CODES = [
  "relation_attribute_required",
  "relation_attribute_locked",
  "relation_value_required",
  "relation_value_locked",
] as const;

type RelationValueErrorCode = (typeof RELATION_VALUE_ERROR_CODES)[number];

interface RelationValueErrorDetail {
  error?: unknown;
  attribute?: unknown;
  value?: unknown;
}

/** A display name for a field or option — `useFieldLabel()` / `useOptionLabel()`. */
type LabelOf = (entity: FieldDef | FieldOption) => string;

function detailOf(err: unknown): RelationValueErrorDetail | null {
  if (!err || typeof err !== "object" || !("detail" in err)) return null;
  const detail = (err as { detail: unknown }).detail;
  return detail && typeof detail === "object" ? (detail as RelationValueErrorDetail) : null;
}

/** The relation-value error code an API error carries, or `null`. */
export function relationValueErrorCode(err: unknown): RelationValueErrorCode | null {
  const code = detailOf(err)?.error;
  return typeof code === "string" &&
    (RELATION_VALUE_ERROR_CODES as readonly string[]).includes(code)
    ? (code as RelationValueErrorCode)
    : null;
}

export function relationValueErrorMessage(
  err: unknown,
  t: TFunction,
  schema: FieldDef[],
  labelOf: LabelOf,
): string {
  const code = relationValueErrorCode(err);
  if (code) {
    const detail = detailOf(err)!;
    const attrKey = typeof detail.attribute === "string" ? detail.attribute : "";
    const valueKey = typeof detail.value === "string" ? detail.value : "";
    const field = schema.find((f) => f.key === attrKey);
    const option = field?.options?.find((o) => o.key === valueKey);
    return t(`admin:metamodel.relationValueErrors.${code}`, {
      attribute: field ? labelOf(field) : attrKey,
      value: option ? labelOf(option) : valueKey,
    });
  }
  const raw = err && typeof err === "object" && "detail" in err ? err.detail : undefined;
  if (typeof raw === "string" && raw) return raw;
  if (err instanceof Error && err.message) return err.message;
  return t("admin:metamodel.relationValuesSaveFailed");
}
