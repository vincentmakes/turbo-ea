/**
 * Which card fields can colour or filter a report, and how a stored value
 * reads as one of their options.
 *
 * Every surface that colours or filters by a card's own field — the
 * Portfolio, Capability Map and Lifecycle reports, the Cost and Inventory
 * group-bys and the diagram "Colour by" perspective — asks this module, so
 * a field type is either a facet everywhere or nowhere. A facet field is a
 * `single_select` or `multiple_select` with options, or a `boolean`:
 *
 *  - a **boolean** has no stored options, so it is given two synthetic ones,
 *    `"true"` (Yes) and `"false"` (No), coloured from `BOOLEAN_COLORS`;
 *  - a **multiple_select** can colour and filter, but cannot GROUP: a card
 *    with two values belongs to two groups, so `isGroupableField` leaves it
 *    out, and a card carrying several values colours as the Multiple bucket;
 *  - an option the admin left **uncoloured** takes `categoricalColor(index)`
 *    — a stable colour by its position — instead of falling into the Not-set
 *    grey, which made "unset" and "set to an uncoloured option" look alike.
 *
 * Callers normalise at the edge: they pass each field through
 * `resolveFacetField` once (in the memo that already localises labels), so
 * downstream `options.find(...)` code works unchanged for booleans; only reads
 * of a card's raw attribute value go through `facetValues` / `facetBucket`.
 *
 * Pure: imports only design tokens and the colour helpers.
 */

import { categoricalColor } from "@/lib/color";
import { BOOLEAN_COLORS, MULTIPLE_VALUE_COLOR } from "@/theme/tokens";

export interface FacetOptionLike {
  key: string;
  label: string;
  color?: string;
}

export interface FacetFieldLike {
  key: string;
  label: string;
  type: string;
  options?: FacetOptionLike[];
}

/** Labels for a boolean field's two synthetic options. */
export interface FacetLabels {
  yes: string;
  no: string;
}

/** Labels for the two buckets that are not an option. */
export interface BucketLabels {
  notSet: string;
  multiple: string;
}

export const BOOL_TRUE = "true";
export const BOOL_FALSE = "false";
export const MULTIPLE_KEY = "__multiple__";
export const UNSET_KEY = "__unset__";
export const MULTIPLE_COLOR = MULTIPLE_VALUE_COLOR;

const SELECT_TYPES = new Set(["single_select", "multiple_select"]);

/** Can this field colour or filter a report? */
export function isFacetField(f: FacetFieldLike): boolean {
  if (f.type === "boolean") return true;
  return SELECT_TYPES.has(f.type) && (f.options?.length ?? 0) > 0;
}

/** Can this field partition cards into groups (one group per card)? */
export function isGroupableField(f: FacetFieldLike): boolean {
  return isFacetField(f) && f.type !== "multiple_select";
}

/** Every facet field of a `fields_schema`, in schema order. */
export function pickFacetFields<F extends FacetFieldLike>(
  schema: readonly { fields: readonly F[] }[],
): F[] {
  return schema.flatMap((s) => s.fields.filter(isFacetField));
}

/** Every groupable field of a `fields_schema`, in schema order. */
export function pickGroupableFields<F extends FacetFieldLike>(
  schema: readonly { fields: readonly F[] }[],
): F[] {
  return schema.flatMap((s) => s.fields.filter(isGroupableField));
}

/**
 * A facet field's options, every one of them coloured: its own colour, else
 * the palette colour of its position. A boolean field gets Yes / No.
 */
export function facetOptions<O extends FacetOptionLike>(
  f: { type: string; options?: O[] },
  labels: FacetLabels,
): (O & { color: string })[] {
  if (f.type === "boolean") {
    return [
      { key: BOOL_TRUE, label: labels.yes, color: BOOLEAN_COLORS.true },
      { key: BOOL_FALSE, label: labels.no, color: BOOLEAN_COLORS.false },
    ] as (O & { color: string })[];
  }
  return (f.options ?? []).map((o, i) => ({ ...o, color: o.color || categoricalColor(i) }));
}

/** A copy of `f` whose `options` are `facetOptions(f)`. Idempotent. */
export function resolveFacetField<F extends FacetFieldLike>(f: F, labels: FacetLabels): F {
  return { ...f, options: facetOptions(f, labels) };
}

/**
 * A raw attribute value as a list of option keys, whatever the field type:
 * nothing → `[]`, a boolean → `"true"` / `"false"`, a list → each non-empty
 * entry once, anything else → its string form.
 */
export function rawValues(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  if (typeof raw === "boolean") return [raw ? BOOL_TRUE : BOOL_FALSE];
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const v of raw) {
      if (v === null || v === undefined || v === "") continue;
      const s = String(v);
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }
  return [String(raw)];
}

const LEGACY_TRUE = new Set(["true", "yes"]);
const LEGACY_FALSE = new Set(["false", "no"]);

/**
 * A raw value as the option keys of field `f`. A boolean field also reads the
 * legacy `"yes"` / `"no"` / `"true"` / `"false"` strings an import may have
 * stored; any other value on a boolean field counts as not set.
 */
export function facetValues(f: { type: string }, raw: unknown): string[] {
  if (f.type !== "boolean") return rawValues(raw);
  if (typeof raw === "boolean") return [raw ? BOOL_TRUE : BOOL_FALSE];
  if (typeof raw !== "string") return [];
  const s = raw.trim().toLowerCase();
  if (LEGACY_TRUE.has(s)) return [BOOL_TRUE];
  if (LEGACY_FALSE.has(s)) return [BOOL_FALSE];
  return [];
}

/**
 * Does a card's value pass a facet filter? Nothing selected passes everything;
 * otherwise any one selected key matches, and `emptyKey` matches a card with
 * no value.
 */
export function matchesFacet(
  f: { type: string },
  raw: unknown,
  selected: readonly string[],
  emptyKey: string,
): boolean {
  if (selected.length === 0) return true;
  const values = facetValues(f, raw);
  if (values.length === 0) return selected.includes(emptyKey);
  return values.some((v) => selected.includes(v));
}

export type FacetBucket =
  | { kind: "unset"; key: string; label: string; color: null }
  | { kind: "value"; key: string; label: string; color: string | null }
  | { kind: "multiple"; key: string; label: string; color: string };

/**
 * The colour bucket a card falls into. `color` is `null` for an unset value
 * and for a stored key that is not one of the field's options — each report
 * keeps its own grey for those.
 */
export function facetBucket(
  f: FacetFieldLike,
  raw: unknown,
  labels: FacetLabels & BucketLabels,
): FacetBucket {
  const values = facetValues(f, raw);
  if (values.length === 0) {
    return { kind: "unset", key: UNSET_KEY, label: labels.notSet, color: null };
  }
  if (values.length > 1) {
    return { kind: "multiple", key: MULTIPLE_KEY, label: labels.multiple, color: MULTIPLE_COLOR };
  }
  const key = values[0];
  const opt = facetOptions(f, labels).find((o) => o.key === key);
  if (!opt) return { kind: "value", key, label: key, color: null };
  return { kind: "value", key, label: opt.label, color: opt.color };
}

/**
 * Legend swatches for a facet field: one per option, plus Multiple when any
 * card carries several values. The Not-set swatch is the caller's, as it
 * always was.
 */
export function facetLegend(
  f: FacetFieldLike,
  labels: FacetLabels & BucketLabels,
  anyMultiple: boolean,
): { key: string; label: string; color: string }[] {
  const out = facetOptions(f, labels).map((o) => ({ key: o.key, label: o.label, color: o.color }));
  if (anyMultiple) out.push({ key: MULTIPLE_KEY, label: labels.multiple, color: MULTIPLE_COLOR });
  return out;
}

/**
 * The field a report colours by when nothing is chosen: the first
 * `single_select` with options (what every report defaulted to before), else
 * the first facet field, else none.
 */
export function defaultColorField(fields: readonly FacetFieldLike[]): string {
  const single = fields.find((f) => f.type === "single_select" && (f.options?.length ?? 0) > 0);
  if (single) return single.key;
  return fields.find(isFacetField)?.key ?? "";
}
