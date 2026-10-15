/**
 * Pure helpers that turn a Security & admin log row's `details` into something
 * a person can read: the four-key contract the backend writes (`reason`,
 * `changes`, `items`, `context` — enforced by `audit_log.record`), the i18n key
 * for every label, and a classification of each value so the drawer can format
 * it (Yes / No, a date, a colour swatch, a masked secret, a permission's
 * description, a language name).
 *
 * Rows written before the contract existed keep rendering: their top-level
 * `{old, new}` pairs are read as `changes`, their plain values as `context`,
 * and anything nested is handed back as `legacy` for the JSON fallback.
 */
import i18n from "@/i18n";

/** One semantic change: `{kind: "<noun>.<verb>", ...named args}`. */
export interface ChangeItem {
  kind: string;
  [arg: string]: unknown;
}

export interface ChangePair {
  old: unknown;
  new: unknown;
}

export interface DescribedDetails {
  /** A reason code (`bad_password`), translated through `securityLog.reasons.*`. */
  reason: string | null;
  items: ChangeItem[];
  changes: Record<string, ChangePair>;
  context: Record<string, unknown>;
  /** Whatever fits none of the above — rendered as JSON. */
  legacy: Record<string, unknown> | null;
}

export type ValueClass =
  | "empty"
  | "bool"
  | "datetime"
  | "color"
  | "masked"
  | "bytes"
  | "permission"
  | "locale"
  | "list"
  | "code"
  | "text"
  | "number";

/** A reason the backend files as a code; anything longer is free text. */
const REASON_CODE_RE = /^[a-z0-9_]{1,40}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const CODE_TOKEN_RE = /^[a-z0-9_:-]{1,40}$/;
const PERMISSION_RE = /^[a-z_]+\.[a-z_*]+$/;
const DATETIME_FIELD_RE = /(_at|_until)$/;
const BYTES_FIELDS = new Set(["size_bytes", "file_size"]);
const PERMISSION_FIELDS = new Set(["permission", "permissions"]);
const LOCALE_FIELDS = new Set(["locale", "locales"]);
/**
 * Names whose values are free text an admin typed (a label, a slug, an email):
 * never read as an enumeration code, so a portal slugged `cards` stays `cards`.
 * (A portal toggle's `item` is not here: a built-in one is a code such as
 * `lifecycle`, a custom field's is its label.)
 */
const TEXT_FIELDS = new Set([
  "label",
  "name",
  "title",
  "description",
  "slug",
  "email",
  "display_name",
  "section",
  "field",
  "option",
  "attribute",
  "role",
  "user",
  "from_section",
  "to_section",
  "reference",
]);
/** The description pseudo-section, labelled wherever it appears. */
const DESCRIPTION_SECTION = "__description";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isScalar(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

/** A scalar, or a flat list of scalars — what `context` may hold. */
function isFlat(v: unknown): boolean {
  return isScalar(v) || (Array.isArray(v) && v.every(isScalar));
}

/** `{old, new}` — the shape `audit_log.diff()` writes for one field. */
export function isChangePair(v: unknown): v is ChangePair {
  return isPlainObject(v) && "old" in v && "new" in v;
}

function isChangeItem(v: unknown): v is ChangeItem {
  return isPlainObject(v) && typeof v.kind === "string" && v.kind.length > 0;
}

/** Split a row's `details` into the contract's parts (see the module doc). */
export function describeDetails(details: unknown): DescribedDetails {
  const out: DescribedDetails = { reason: null, items: [], changes: {}, context: {}, legacy: null };
  if (!isPlainObject(details)) return out;
  const legacy: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (key === "reason") {
      if (typeof value === "string" && REASON_CODE_RE.test(value)) out.reason = value;
      else if (value !== null && value !== undefined && value !== "") out.context.reason = value;
      continue;
    }
    if (key === "items" && Array.isArray(value)) {
      const rejected = value.filter((v) => !isChangeItem(v));
      out.items.push(...value.filter(isChangeItem));
      if (rejected.length > 0) legacy.items = rejected;
      continue;
    }
    if ((key === "changes" || key === "context") && isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        if (key === "changes" && isChangePair(v)) out.changes[k] = v;
        else if (key === "context" && isFlat(v)) out.context[k] = v;
        else legacy[k] = v;
      }
      continue;
    }
    // A row written before the contract: classify each top-level value.
    if (isChangePair(value)) out.changes[key] = value;
    else if (isFlat(value)) out.context[key] = value;
    else legacy[key] = value;
  }
  out.legacy = Object.keys(legacy).length > 0 ? legacy : null;
  return out;
}

/** True when `describeDetails` found nothing to show below the reason. */
export function isEmptyDescription(d: DescribedDetails): boolean {
  return (
    d.items.length === 0 &&
    Object.keys(d.changes).length === 0 &&
    Object.keys(d.context).length === 0 &&
    d.legacy === null
  );
}

/** `smtpHost` / `smtp-host` / `smtp_host` → `smtp_host`. */
export function toSnake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s.]+/g, "_")
    .toLowerCase();
}

/** `smtp_host` / `isActive` / `date-format` → "Smtp host" / "Is active" / "Date format". */
export function humanise(key: string): string {
  const words = toSnake(key).split("_").filter(Boolean).join(" ");
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The i18n keys that may label a field name, most specific first: a label
 * scoped to the row's target type, then the generic one. Pass the result to
 * `t()` with `{ defaultValue: humanise(field) }`.
 */
export function fieldLabelKey(field: string, targetType?: string | null): string[] {
  const name = toSnake(field);
  const generic = `securityLog.fields.${name}`;
  return targetType ? [`securityLog.fields.${targetType}.${name}`, generic] : [generic];
}

/** The i18n key of an enumeration code (`1:n` → `securityLog.values.1_n`). */
export function valueLabelKey(code: string): string {
  return `securityLog.values.${code.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

export function targetTypeLabelKey(type: string): string {
  return `securityLog.targetTypes.${type}`;
}

/** The i18n key naming a setting slug (`date-format`). */
export function settingLabelKey(slug: string): string {
  return `securityLog.settings.${slug}`;
}

/** `field.added` → `securityLog.changes.field_added`. */
export function changeKindKey(kind: string): string {
  return `securityLog.changes.${kind.replace(/\./g, "_")}`;
}

/** Whether this build has a label for an enumeration code. */
export function hasValueLabel(code: string): boolean {
  return i18n.exists(`admin:${valueLabelKey(code)}`);
}

/**
 * What kind of value this is, so the drawer can format it. `field` is the
 * name the value sits under (a changed field, an item's argument, a
 * `*.changed` item's `property`); several classes are decided by it.
 */
export function classifyValue(
  value: unknown,
  field: string,
  hasCode: (code: string) => boolean = hasValueLabel,
): ValueClass {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : "list";
  if (typeof value === "boolean") return "bool";
  const name = toSnake(field);
  if (typeof value === "number") return BYTES_FIELDS.has(name) ? "bytes" : "number";
  if (typeof value !== "string") return "text";
  if (value === "***") return "masked";
  if (COLOR_RE.test(value)) return "color";
  const datetimeShaped = ISO_DATETIME_RE.test(value) || DATETIME_FIELD_RE.test(name);
  if (datetimeShaped && !Number.isNaN(Date.parse(value))) return "datetime";
  if (PERMISSION_FIELDS.has(name) && PERMISSION_RE.test(value)) return "permission";
  if (LOCALE_FIELDS.has(name)) return "locale";
  if (value === DESCRIPTION_SECTION) return "code";
  if (TEXT_FIELDS.has(name)) return "text";
  if (CODE_TOKEN_RE.test(value) && hasCode(value)) return "code";
  return "text";
}

/** A byte count as "512 B", "12 KB" or "1.3 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Number((n / (1024 * 1024)).toFixed(1))} MB`;
}

/** Every value a description holds, with the field it is classified under. */
export function describedValues(d: DescribedDetails): { value: unknown; field: string }[] {
  const out: { value: unknown; field: string }[] = [];
  const push = (value: unknown, field: string) => {
    if (Array.isArray(value)) value.forEach((v) => out.push({ value: v, field }));
    else out.push({ value, field });
  };
  for (const item of d.items) {
    for (const [arg, value] of Object.entries(item)) {
      if (arg === "kind") continue;
      push(value, valueFieldFor(item, arg));
    }
  }
  for (const [field, pair] of Object.entries(d.changes)) {
    push(pair.old, field);
    push(pair.new, field);
  }
  for (const [field, value] of Object.entries(d.context)) push(value, field);
  return out;
}

/** Whether any value in the description is a permission key (the drawer then fetches their descriptions). */
export function hasPermissionValue(d: DescribedDetails): boolean {
  return describedValues(d).some(
    ({ value, field }) => classifyValue(value, field) === "permission",
  );
}

/**
 * Arguments of an item that name a field or a setting rather than carry a
 * value: they are labelled through `securityLog.fields.*`.
 */
const NAME_ARGS: Record<string, string[]> = {
  "*": ["property", "component"],
  "portal_option.changed": ["option"],
  "user.changed": ["field"],
};

export function isNameArg(kind: string, arg: string): boolean {
  return NAME_ARGS["*"].includes(arg) || NAME_ARGS[kind]?.includes(arg) === true;
}

/**
 * The field an item argument's value is classified under. The `old` / `new`
 * of a `*.changed` item take the name of what changed (its `property`, or a
 * user's `field`), so a `required` change reads Yes / No and a `color` change
 * shows a hex; every other argument is classified under its own name.
 */
export function valueFieldFor(item: ChangeItem, arg: string): string {
  if (arg === "old" || arg === "new") {
    const named = item.kind === "user.changed" ? item.field : item.property;
    if (typeof named === "string" && named.length > 0) return named;
  }
  return arg;
}

/**
 * A `translation.changed` item's prefixed property — `field:<label>`,
 * `option:<label>`, `section:<name>`, `field_help:<label>`, … — split into its
 * scope (labelled through `securityLog.values.translation_scope_<scope>`) and
 * the name. A bare property (`label`, `reverse_label`) is not prefixed: null.
 */
export function splitTranslationProperty(property: string): { scope: string; name: string } | null {
  const m = /^([a-z_]+):(.+)/.exec(property);
  return m ? { scope: m[1], name: m[2] } : null;
}

/** The value key labelling a translation scope (`field_help` → "field help"). */
export function translationScopeKey(scope: string): string {
  return valueLabelKey(`translation_scope_${scope}`);
}

/** The subset of an audit row `formatTarget` reads. */
export interface TargetRef {
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
}

type Translate = (key: string, opts: { defaultValue: string }) => string;

/**
 * The Target line: the target type's label and the target's own label
 * (`Role · Viewer`). A setting is named through `securityLog.settings.<slug>`,
 * since its label is the slug itself. Null when the row names no target.
 */
export function formatTarget(entry: TargetRef, t: Translate): string | null {
  const label = entry.target_label ?? entry.target_id;
  if (!label) return null;
  const shown =
    entry.target_type === "setting"
      ? t(settingLabelKey(entry.target_id ?? label), { defaultValue: label })
      : label;
  if (!entry.target_type) return shown;
  const type = t(targetTypeLabelKey(entry.target_type), {
    defaultValue: humanise(entry.target_type),
  });
  return `${type} · ${shown}`;
}

/** The target as stored, for a tooltip beside the labelled form. */
export function rawTarget(entry: TargetRef): string | null {
  const label = entry.target_label ?? entry.target_id;
  if (!label) return null;
  return entry.target_type ? `${entry.target_type} · ${label}` : label;
}
