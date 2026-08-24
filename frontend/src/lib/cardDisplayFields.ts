import type { CardType } from "@/types";

/**
 * Shared vocabulary for "which card attributes are shown on a shape".
 *
 * Two surfaces render the same detail lines and must not drift apart: the
 * Layered Dependency View's card display settings, and the DrawIO editor's
 * card-coloring / display dropdown. Both build their picker from
 * `buildFieldCatalog` and format values with `formatFieldValue`, so a field
 * reads identically in a report and on the diagram exported from it.
 */

/** The subset of a metamodel `FieldDef` needed to label and format a value. */
export interface FieldMeta {
  key: string;
  label: string;
  translations?: Record<string, string>;
  type: string;
  options?: { key: string; label: string; translations?: Record<string, string> }[];
  /**
   * Every card type *in play* that defines this key. Field keys are shared
   * across types in the metamodel, so a catalogue entry can have several
   * owners; the pickers group on this and put multi-owner keys in one shared
   * bucket rather than repeating a row the user could tick twice.
   */
  typeKeys: string[];
}

/** One label/value line displayed on a card and/or its tooltip. */
export interface DisplayLine {
  label: string;
  value: string;
}

/**
 * How many detail lines actually render on a card. Everything the user picks
 * beyond this still enriches the tooltip, but a shape has finite room — a
 * DrawIO card cell is 210x60 and a Layered Dependency View node 200x72, which
 * holds the name plus exactly two small lines.
 */
export const MAX_CARD_LINES = 2;

/** Sentinel `formatFieldValue` returns for an empty value, so callers can skip
 *  the line rather than render "Owner: —". */
export const EMPTY_VALUE = "—";

/**
 * Collect a de-duplicated, sorted catalogue of attribute fields across the card
 * types currently in play — drives the "extra fields" pickers.
 *
 * One entry per field key, so no picker ever shows the same field twice, but
 * every owning type is recorded on `typeKeys` so the entry can still be filed
 * under the right heading.
 */
export function buildFieldCatalog(
  types: CardType[],
  presentTypeKeys: Set<string>,
): FieldMeta[] {
  const out: FieldMeta[] = [];
  const byKey = new Map<string, FieldMeta>();
  for (const ct of types) {
    if (!presentTypeKeys.has(ct.key)) continue;
    for (const sec of ct.fields_schema || []) {
      for (const f of sec.fields || []) {
        const existing = byKey.get(f.key);
        if (existing) {
          // Same key on a second type — one row, two owners.
          if (!existing.typeKeys.includes(ct.key)) existing.typeKeys.push(ct.key);
          continue;
        }
        const meta: FieldMeta = {
          key: f.key,
          label: f.label || f.key,
          translations: f.translations,
          type: f.type,
          options: f.options?.map((o) => ({
            key: o.key,
            label: o.label || o.key,
            translations: o.translations,
          })),
          typeKeys: [ct.key],
        };
        byKey.set(f.key, meta);
        out.push(meta);
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One heading in a grouped field picker: either the bucket for keys several
 * card types share, or a single card type.
 */
export type FieldGroup =
  | { kind: "shared"; fields: FieldMeta[] }
  | { kind: "type"; type: CardType; fields: FieldMeta[] };

/**
 * File a catalogue under headings — shared keys first, then one heading per
 * card type in metamodel order. Empty groups are dropped.
 *
 * The flattened output is group-contiguous, which matters beyond looks: MUI's
 * `Autocomplete` `groupBy` re-prints a heading every time the group changes, so
 * an unordered option list renders the same heading several times. Consumers
 * that need a flat list must take it from these groups, not from the catalogue.
 */
export function groupFieldCatalog(
  catalog: FieldMeta[],
  types: CardType[],
): FieldGroup[] {
  const groups: FieldGroup[] = [];
  const shared = catalog.filter((f) => f.typeKeys.length > 1);
  if (shared.length > 0) groups.push({ kind: "shared", fields: shared });
  for (const ct of types) {
    const fields = catalog.filter(
      (f) => f.typeKeys.length === 1 && f.typeKeys[0] === ct.key,
    );
    if (fields.length > 0) groups.push({ kind: "type", type: ct, fields });
  }
  return groups;
}

/** Resolvers the formatter needs from the React layer (locale-aware option
 *  labels and the yes/no strings). Passed in so the formatter stays callable
 *  from plain helpers as well as components. */
export interface FormatDeps {
  /** Locale-aware label for a metamodel option — pass `useOptionLabel()`. */
  optionLabel: (opt: { key: string; label: string; translations?: Record<string, string> }) => string;
  yes: string;
  no: string;
}

/** Render a raw attribute value as display text. Returns `EMPTY_VALUE` when
 *  there is nothing to show. */
export function formatFieldValue(
  raw: unknown,
  meta: FieldMeta | undefined,
  deps: FormatDeps,
): string {
  if (raw === null || raw === undefined || raw === "") return EMPTY_VALUE;
  if (typeof raw === "boolean") return raw ? deps.yes : deps.no;
  const optText = (x: unknown) => {
    const o = meta?.options?.find((opt) => opt.key === x);
    return o ? deps.optionLabel(o) : String(x);
  };
  if (Array.isArray(raw)) return raw.map(optText).join(", ");
  if (meta?.options) return optText(raw);
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

/**
 * Which non-attribute lines a surface shows, alongside the picked attribute
 * fields. `fields` is a flat list of field keys (not per type) — a key that no
 * card of that type carries simply yields no line.
 */
export interface CardLabelSettings {
  showType?: boolean;
  showSubtype?: boolean;
  fields: string[];
}

export const DEFAULT_CARD_LABELS: CardLabelSettings = { fields: [] };

/** True when nothing at all would be rendered — lets callers skip the work. */
export function hasCardLabelLines(s: CardLabelSettings | undefined): boolean {
  if (!s) return false;
  return Boolean(s.showType || s.showSubtype || s.fields.length > 0);
}
