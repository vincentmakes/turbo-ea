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
 */
export function buildFieldCatalog(
  types: CardType[],
  presentTypeKeys: Set<string>,
): FieldMeta[] {
  const out: FieldMeta[] = [];
  const seen = new Set<string>();
  for (const ct of types) {
    if (!presentTypeKeys.has(ct.key)) continue;
    for (const sec of ct.fields_schema || []) {
      for (const f of sec.fields || []) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        out.push({
          key: f.key,
          label: f.label || f.key,
          translations: f.translations,
          type: f.type,
          options: f.options?.map((o) => ({
            key: o.key,
            label: o.label || o.key,
            translations: o.translations,
          })),
        });
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
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
