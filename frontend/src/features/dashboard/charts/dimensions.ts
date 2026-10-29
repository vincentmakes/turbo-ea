/**
 * How a chart names and colours the keys of one dimension. The query
 * endpoint returns keys only; labels come from the metamodel (through the
 * entity-aware resolvers, never `.key` as a fallback) or i18n, and colours
 * from the entity itself or the status tokens. A dimension whose values have
 * no colour of their own takes the fixed-order categorical hues by the
 * value's position in its definition (an option's or subtype's index), so a
 * value keeps its colour however the counts move.
 *
 * A field or subtype is looked up in ONE card type: the one passed as
 * `cardType` (each side of a sankey passes its own end of the relation), else
 * the query's `card_type`. Only a query with neither searches every type —
 * two types may define the same field key with different options, and a
 * sankey side must never borrow the other side's.
 */
import type { TFunction } from "i18next";
import {
  APPROVAL_STATUS_COLORS,
  BOOLEAN_COLORS,
  DATA_QUALITY_COLORS,
  STATUS_COLORS,
} from "@/theme/tokens";
import { EOL_COVERAGE_COLORS, EOL_COVERAGE_LABEL_KEYS } from "@/lib/eol";
import type { CardType, DashboardQuery, FieldDef, FieldOption, RelationType, SubtypeDef } from "@/types";
import { fieldOfDimension, isCardKeyed, phaseOfDimension } from "../dashboardQuery";
import { OTHER_KEY } from "./buildOption";

export const LIFECYCLE_COLORS: Record<string, string> = {
  plan: STATUS_COLORS.neutral,
  phaseIn: STATUS_COLORS.info,
  active: STATUS_COLORS.success,
  phaseOut: STATUS_COLORS.warning,
  endOfLife: STATUS_COLORS.error,
  none: STATUS_COLORS.neutral,
};

export const DATA_QUALITY_LABELS: Record<string, string> = {
  "0-25": "0 - 25%",
  "25-50": "25 - 50%",
  "50-75": "50 - 75%",
  "75-100": "75 - 100%",
};

/** Keys the backend uses for "no value". */
const NONE_KEYS = new Set(["", "none", "__none__", "null"]);

export interface DimensionResolver {
  label: (key: string) => string;
  color: (key: string, index: number) => string;
  /** Whether values carry colours of their own (else one series, one hue). */
  colorByCategory: boolean;
}

export interface ResolverDeps {
  types: CardType[];
  t: TFunction;
  locale: string;
  typeLabel: (type: CardType) => string;
  /** Field, option and subtype labels (`useFieldLabel` and its aliases). */
  inlineLabel: (entity: FieldDef | FieldOption | SubtypeDef) => string;
  categorical: readonly string[];
  /** Card names of a card-keyed dimension's keys (the response's `labels`). */
  cardLabels?: Record<string, string>;
}

/** The card types at the two ends of a relation type (a sankey's sides). */
export function sideTypes(rt: Pick<RelationType, "source_type_key" | "target_type_key"> | null | undefined): {
  source: string | null;
  target: string | null;
} {
  return { source: rt?.source_type_key ?? null, target: rt?.target_type_key ?? null };
}

function slot(categorical: readonly string[], index: number): string {
  // Fixed order, never cycled: past the palette a value goes neutral (the
  // chart folds the tail into "Other" before it gets there).
  return index >= 0 && index < categorical.length ? categorical[index] : STATUS_COLORS.neutral;
}

export function findField(types: CardType[], cardType: string | null | undefined, fieldKey: string): FieldDef | null {
  const pool = cardType ? types.filter((t) => t.key === cardType) : types;
  for (const type of pool) {
    for (const section of type.fields_schema ?? []) {
      const field = section.fields.find((f) => f.key === fieldKey);
      if (field) return field;
    }
  }
  return null;
}

function findSubtype(
  types: CardType[],
  cardType: string | null | undefined,
  key: string,
): { subtype: SubtypeDef; index: number } | null {
  const pool = cardType ? types.filter((t) => t.key === cardType) : types;
  for (const type of pool) {
    const index = (type.subtypes ?? []).findIndex((s) => s.key === key);
    if (index >= 0) return { subtype: type.subtypes![index], index };
  }
  return null;
}

function monthLabel(key: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return date.toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });
}

function dayLabel(key: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return key;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The resolver for one dimension (`null` = no grouping). */
export function dimensionResolver(
  dimension: string | null | undefined,
  query: DashboardQuery | null | undefined,
  deps: ResolverDeps,
  cardType?: string | null,
): DimensionResolver {
  const { types, t, locale, typeLabel, inlineLabel, categorical } = deps;
  const notSet = t("labels.notSet");
  // The one type fields and subtypes are looked up in (null = every type).
  const scope = cardType ?? query?.card_type ?? null;
  const wrap = (r: DimensionResolver): DimensionResolver => ({
    colorByCategory: r.colorByCategory,
    label: (key) => (key === OTHER_KEY ? t("dashboard.query.other") : r.label(key)),
    color: (key, index) => (key === OTHER_KEY ? STATUS_COLORS.neutral : r.color(key, index)),
  });

  if (isCardKeyed(dimension)) {
    const names = deps.cardLabels ?? {};
    // Cards of one type (`card` on a sankey side, or on an ordinary query
    // with its `card_type`) are painted in that type's colour, else the first
    // hue; a related-card grouping has no colour of its own (one series, one
    // hue). A card has no colour of its own, and fixed slots by row would run
    // past the palette on the 20-30 cards a chart shows.
    const typeColor = dimension === "card" ? types.find((ct) => ct.key === scope)?.color : undefined;
    return wrap({
      colorByCategory: dimension === "card",
      label: (key) => (NONE_KEYS.has(key) ? t("dashboard.query.noRelated") : (names[key] ?? key)),
      color: (key) => {
        if (NONE_KEYS.has(key)) return STATUS_COLORS.neutral;
        return typeColor || slot(categorical, 0);
      },
    });
  }
  const phase = phaseOfDimension(dimension);
  if (phase) {
    return wrap({
      colorByCategory: false,
      label: (key) => monthLabel(key, locale),
      color: () => LIFECYCLE_COLORS[phase] ?? slot(categorical, 0),
    });
  }

  switch (dimension) {
    case "eol_coverage":
      return wrap({
        colorByCategory: true,
        label: (key) => {
          const labelKey = EOL_COVERAGE_LABEL_KEYS[key as keyof typeof EOL_COVERAGE_LABEL_KEYS];
          return labelKey ? t(`reports:${labelKey}`) : key;
        },
        color: (key) => EOL_COVERAGE_COLORS[key as keyof typeof EOL_COVERAGE_COLORS] ?? STATUS_COLORS.neutral,
      });
    case "stakeholders":
      return wrap({
        colorByCategory: true,
        label: (key) =>
          key === "true"
            ? t("dashboard.query.stakeholders.with")
            : key === "false"
              ? t("dashboard.query.stakeholders.without")
              : notSet,
        color: (key) =>
          key === "true" ? STATUS_COLORS.success : key === "false" ? STATUS_COLORS.warning : STATUS_COLORS.neutral,
      });
    case "type":
      return wrap({
        colorByCategory: true,
        label: (key) => {
          const type = types.find((ct) => ct.key === key);
          if (type) return typeLabel(type);
          // A sankey node can be a subtype rather than a type.
          const st = findSubtype(types, null, key);
          return st ? inlineLabel(st.subtype) : key;
        },
        color: (key, index) => types.find((ct) => ct.key === key)?.color ?? slot(categorical, index),
      });
    case "subtype":
      return wrap({
        colorByCategory: false,
        label: (key) => {
          if (NONE_KEYS.has(key)) return notSet;
          const st = findSubtype(types, scope, key);
          return st ? inlineLabel(st.subtype) : key;
        },
        color: (key) => {
          if (NONE_KEYS.has(key)) return STATUS_COLORS.neutral;
          const st = findSubtype(types, scope, key);
          return st ? slot(categorical, st.index) : STATUS_COLORS.neutral;
        },
      });
    case "approval_status":
      return wrap({
        colorByCategory: true,
        label: (key) => t(`status.${key.toLowerCase()}`, { defaultValue: key }),
        color: (key) =>
          APPROVAL_STATUS_COLORS[key as keyof typeof APPROVAL_STATUS_COLORS] ?? STATUS_COLORS.neutral,
      });
    case "lifecycle_phase":
      return wrap({
        colorByCategory: true,
        label: (key) => (NONE_KEYS.has(key) ? t("lifecycle.notSet") : t(`lifecycle.${key}`, { defaultValue: key })),
        color: (key) => LIFECYCLE_COLORS[key] ?? STATUS_COLORS.neutral,
      });
    case "data_quality_bucket":
      return wrap({
        colorByCategory: true,
        label: (key) => DATA_QUALITY_LABELS[key] ?? key,
        color: (key) => DATA_QUALITY_COLORS[key as keyof typeof DATA_QUALITY_COLORS] ?? STATUS_COLORS.neutral,
      });
    case "created_month":
      return wrap({
        colorByCategory: false,
        label: (key) => monthLabel(key, locale),
        color: () => slot(categorical, 0),
      });
    case "date":
      return wrap({
        colorByCategory: false,
        label: (key) => dayLabel(key, locale),
        color: () => slot(categorical, 0),
      });
    default: {
      const fieldKey = fieldOfDimension(dimension);
      const field = fieldKey ? findField(types, scope, fieldKey) : null;
      if (field && field.type === "boolean") {
        return wrap({
          colorByCategory: true,
          label: (key) => (key === "true" ? t("labels.yes") : key === "false" ? t("labels.no") : notSet),
          color: (key) =>
            key === "true" ? BOOLEAN_COLORS.true : key === "false" ? BOOLEAN_COLORS.false : STATUS_COLORS.neutral,
        });
      }
      if (field) {
        const options = field.options ?? [];
        return wrap({
          colorByCategory: options.some((o) => !!o.color),
          label: (key) => {
            if (NONE_KEYS.has(key)) return notSet;
            const option = options.find((o) => o.key === key);
            return option ? inlineLabel(option) : key;
          },
          color: (key) => {
            if (NONE_KEYS.has(key)) return STATUS_COLORS.neutral;
            const index = options.findIndex((o) => o.key === key);
            if (index < 0) return STATUS_COLORS.neutral;
            return options[index].color ?? slot(categorical, index);
          },
        });
      }
      return wrap({
        colorByCategory: false,
        label: (key) => (NONE_KEYS.has(key) ? notSet : key),
        color: (_key, index) => slot(categorical, index),
      });
    }
  }
}
