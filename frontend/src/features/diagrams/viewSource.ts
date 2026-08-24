import { APPROVAL_STATUS_COLORS, SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { CardType, FieldDef } from "@/types";

/**
 * The diagram's "colour by" setting, and everything needed to resolve it.
 *
 * Deliberately a plain module with no React in it: the colour logic used to
 * live inside the dropdown component, which made it untestable without
 * rendering MUI — and it shipped with a bug (see `colorKeyForCard`) that a
 * three-line unit test would have caught.
 */

/**
 * How the canvas is coloured.
 *
 *  - `card_type` — every card keeps its card-type colour. The default, and what
 *    "nothing selected" collapses to.
 *  - `approval_status` — one scale across every card on the canvas.
 *  - `card_fields` — one field rule per card type, several types at once. A type
 *    with no entry is left alone.
 *
 * The union is what enforces that a global perspective and per-type rules are
 * mutually exclusive: there is no state where both exist.
 */
export type ViewSource =
  | { kind: "card_type" }
  | { kind: "approval_status" }
  | { kind: "card_fields"; fields: Record<string, string> };

/** One swatch: a colour, the value it stands for, and where that value came from. */
export interface ColorEntry {
  /** Composite identity — unique across rules. Map key and React key. */
  key: string;
  /** Raw option key (or {@link NO_VALUE}). */
  value: string;
  label: string;
  color: string;
  typeKey: string;
  fieldKey: string;
}

/** Stands in for "this card's type has a rule, but the card has no value for it". */
export const NO_VALUE = "__none__";

/** Colour used for {@link NO_VALUE}. */
export const NO_VALUE_COLOR = "#cbd5e1";

/** The card type the approval scale is filed under — it applies to all of them. */
const APPROVAL_SCOPE = "";

/**
 * Identity of a colour within the whole view.
 *
 * Keying on the option key alone collides: rules on `Application.criticality`
 * and `Process.criticality` both emit `"high"`, so one type would render in the
 * other's palette — and it does not even need a shared field name, since
 * `Application.lifecycle = active` and `ITComponent.status = active` collide the
 * same way. The unit separator cannot appear in a metamodel key.
 */
export const colorKey = (typeKey: string, fieldKey: string, value: string): string =>
  `${typeKey}\u001f${fieldKey}\u001f${value}`;

/** Palette for options whose metamodel entry carries no colour of its own. */
const FALLBACK_PALETTE = [
  SEVERITY_COLORS.low,
  SEVERITY_COLORS.medium,
  SEVERITY_COLORS.high,
  SEVERITY_COLORS.critical,
  STATUS_COLORS.info,
  STATUS_COLORS.success,
  STATUS_COLORS.warning,
  STATUS_COLORS.error,
  STATUS_COLORS.neutral,
];

type OptionLike = { key: string; label: string; translations?: Record<string, string> };

/** Resolvers the pure helpers need from the React layer. */
export interface ViewResolvers {
  typeLabel: (t: CardType) => string;
  fieldLabel: (f: { key: string; label: string; translations?: Record<string, string> }) => string;
  optionLabel: (o: OptionLike) => string;
  /** Localised label for an approval status, and the "no value" caption. */
  t: (key: string) => string;
}

function findField(type: CardType | undefined, fieldKey: string): FieldDef | undefined {
  return (type?.fields_schema ?? []).flatMap((s) => s.fields ?? []).find((f) => f.key === fieldKey);
}

/** The `(type, field)` pairs a view colours by, in metamodel order. */
export function activeRules(
  view: ViewSource,
  types: CardType[],
): Array<{ type: CardType; field: FieldDef }> {
  if (view.kind !== "card_fields") return [];
  const out: Array<{ type: CardType; field: FieldDef }> = [];
  for (const type of types) {
    const fieldKey = view.fields[type.key];
    if (!fieldKey) continue;
    const field = findField(type, fieldKey);
    if (field) out.push({ type, field });
  }
  return out;
}

/**
 * Every colour the view can paint, keyed by {@link colorKey}.
 *
 * Empty for `card_type` — those cells keep the colour they already have.
 */
export function buildColorMap(
  view: ViewSource,
  types: CardType[],
  r: ViewResolvers,
): Map<string, ColorEntry> {
  const result = new Map<string, ColorEntry>();
  if (view.kind === "card_type") return result;

  if (view.kind === "approval_status") {
    for (const [status, color] of Object.entries(APPROVAL_STATUS_COLORS)) {
      const key = colorKey(APPROVAL_SCOPE, "approval_status", status);
      result.set(key, {
        key,
        value: status,
        label: r.t(`common:status.${status.toLowerCase()}`),
        color,
        typeKey: APPROVAL_SCOPE,
        fieldKey: "approval_status",
      });
    }
    return result;
  }

  for (const { type, field } of activeRules(view, types)) {
    (field.options ?? []).forEach((opt, i) => {
      const key = colorKey(type.key, field.key, opt.key);
      result.set(key, {
        key,
        value: opt.key,
        label: r.optionLabel(opt),
        color: opt.color || FALLBACK_PALETTE[i % FALLBACK_PALETTE.length],
        typeKey: type.key,
        fieldKey: field.key,
      });
    });
    // "No value" is an ordinary entry, so an unset field is a map hit rather
    // than a special case the apply pass has to remember to handle.
    const noneKey = colorKey(type.key, field.key, NO_VALUE);
    result.set(noneKey, {
      key: noneKey,
      value: NO_VALUE,
      label: r.t("legend.noValue"),
      color: NO_VALUE_COLOR,
      typeKey: type.key,
      fieldKey: field.key,
    });
  }
  return result;
}

/**
 * Which colour a card should take, as a {@link colorKey}, or `null` when the
 * view says nothing about it.
 *
 * `null` means **leave the cell alone** — not "paint it grey". Painting every
 * card the view did not cover is what greyed out an entire canvas the moment a
 * single card type was coloured by a field.
 */
export function colorKeyForCard(
  view: ViewSource,
  card: { type: string; approval_status?: string; attributes?: Record<string, unknown> | null },
): string | null {
  if (view.kind === "card_type") return null;
  if (view.kind === "approval_status") {
    return card.approval_status
      ? colorKey(APPROVAL_SCOPE, "approval_status", card.approval_status)
      : null;
  }
  const fieldKey = view.fields[card.type];
  if (!fieldKey) return null; // this type carries no rule
  const raw = card.attributes?.[fieldKey];
  if (raw === null || raw === undefined || raw === "") {
    return colorKey(card.type, fieldKey, NO_VALUE);
  }
  return colorKey(card.type, fieldKey, typeof raw === "string" ? raw : String(raw));
}

/**
 * Human description of a view: one section per active rule, plus a short label
 * for the toolbar button.
 *
 * One source of truth — the button and the legend both formatted `Type · Field`
 * independently before, so a shape change could desync them silently.
 */
export function describeView(
  view: ViewSource,
  types: CardType[],
  r: ViewResolvers,
): {
  sections: Array<{ key: string; typeKey: string; fieldKey: string; title: string }>;
  shortLabel: string;
} {
  if (view.kind === "card_type") {
    return { sections: [], shortLabel: r.t("viewSelector.cardType") };
  }
  if (view.kind === "approval_status") {
    const title = r.t("viewSelector.approvalStatus");
    return {
      sections: [
        {
          key: colorKey(APPROVAL_SCOPE, "approval_status", ""),
          typeKey: APPROVAL_SCOPE,
          fieldKey: "approval_status",
          title,
        },
      ],
      shortLabel: title,
    };
  }
  const sections = activeRules(view, types).map(({ type, field }) => ({
    key: colorKey(type.key, field.key, ""),
    typeKey: type.key,
    fieldKey: field.key,
    title: `${r.typeLabel(type)} · ${r.fieldLabel(field)}`,
  }));
  if (sections.length === 0) {
    return { sections: [], shortLabel: r.t("viewSelector.cardType") };
  }
  return { sections, shortLabel: sections[0].title };
}

/**
 * Parse whatever the server handed back into a `ViewSource`.
 *
 * The editor used to cast `diagram.data.view` straight from JSON. That blob can
 * predate any change to this shape, and workspace-transfer bundles carry it
 * verbatim between instances, so it is genuinely untrusted input.
 */
export function normaliseViewSource(raw: unknown): ViewSource {
  const CARD_TYPE: ViewSource = { kind: "card_type" };
  if (!raw || typeof raw !== "object") return CARD_TYPE;
  const v = raw as Record<string, unknown>;

  if (v.kind === "approval_status") return { kind: "approval_status" };

  // Legacy singular shape: one type, one field.
  if (v.kind === "card_field") {
    const typeKey = typeof v.type_key === "string" ? v.type_key : "";
    const fieldKey = typeof v.field_key === "string" ? v.field_key : "";
    if (!typeKey || !fieldKey) return CARD_TYPE;
    return { kind: "card_fields", fields: { [typeKey]: fieldKey } };
  }

  if (v.kind === "card_fields" && v.fields && typeof v.fields === "object") {
    const fields: Record<string, string> = {};
    for (const [typeKey, fieldKey] of Object.entries(v.fields as Record<string, unknown>)) {
      if (typeKey === "__proto__" || !typeKey) continue;
      if (typeof fieldKey === "string" && fieldKey) fields[typeKey] = fieldKey;
    }
    return Object.keys(fields).length > 0 ? { kind: "card_fields", fields } : CARD_TYPE;
  }

  return CARD_TYPE;
}

/** Apply a field pick to a view: one rule per type, and never alongside a global. */
export function toggleFieldRule(view: ViewSource, typeKey: string, fieldKey: string): ViewSource {
  const current = view.kind === "card_fields" ? view.fields : {};
  const next: Record<string, string> = { ...current };
  if (next[typeKey] === fieldKey) {
    delete next[typeKey];
  } else {
    next[typeKey] = fieldKey; // replaces any other field on this type
  }
  return Object.keys(next).length > 0
    ? { kind: "card_fields", fields: next }
    : { kind: "card_type" };
}
