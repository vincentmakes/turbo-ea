import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import {
  useFieldLabel,
  useOptionLabel,
  useRelationLabel,
  useSubtypeLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { isFacetField, resolveFacetField } from "@/lib/fieldFacets";
import { buildRelationFilterOptions, buildRelSubtypes } from "./cardFilters";
import type { FilterMember, RelationFilterOption } from "./cardFilters";
import type { FieldDef, RelSubtype, RelTypeDef } from "./portfolioHelpers";

export interface CardFilterOptionsInput {
  /** The card type the filters apply to; empty means none chosen yet. */
  cardTypeKey: string;
  /** The payload's relation types and related cards (`/reports/roadmap`,
   * `/web-portals/filter-options`, …), as `build_portfolio_payload` returns them. */
  relationTypes: RelTypeDef[];
  groupableTypes: Record<string, FilterMember[]>;
  includeDescendants: boolean;
}

export interface CardFilterOptions {
  relationOptions: RelationFilterOption[];
  relSubtypes: RelSubtype[];
  subtypeOptions: { key: string; label: string }[];
  /** The type's facet fields (selects with options, yes/no fields), labels resolved. */
  facetFields: FieldDef[];
}

/**
 * Everything `CardFilterSection` offers for one card type, labelled for the
 * current locale: the Related-by facets, the relation subtypes, the subtypes
 * and the facet fields. Shared by the Lifecycle report and the web portal
 * dialog so the two cannot drift on what a filter row lists. (The Portfolio
 * report narrows relation subtypes by its Group By and builds its own.)
 */
export function useCardFilterOptions({
  cardTypeKey,
  relationTypes,
  groupableTypes,
  includeDescendants,
}: CardFilterOptionsInput): CardFilterOptions {
  const { t } = useTranslation(["common"]);
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const relLabel = useRelationLabel();
  const subtypeDefLabel = useSubtypeLabel();

  const selectedType = useMemo(() => types.find((tp) => tp.key === cardTypeKey), [types, cardTypeKey]);

  const relationOptions = useMemo(
    () =>
      cardTypeKey
        ? buildRelationFilterOptions({
            groupableTypes,
            relationTypes,
            cardType: cardTypeKey,
            includeDescendants,
            typeMeta: (typeKey) => {
              const tm = types.find((tp) => tp.key === typeKey);
              return { label: typeLabel(tm) || typeKey, icon: tm?.icon, hierarchical: !!tm?.has_hierarchy };
            },
            relationVerb: (rt, reverse) => relLabel(rt, reverse),
          })
        : [],
    [cardTypeKey, groupableTypes, relationTypes, includeDescendants, types, typeLabel, relLabel],
  );

  const relSubtypes = useMemo(
    () =>
      cardTypeKey
        ? buildRelSubtypes(relationTypes, cardTypeKey, {
            relationVerb: (rt, reverse) => relLabel(rt, reverse),
            fieldLabel,
            optionLabel: optLabel,
          })
        : [],
    [cardTypeKey, relationTypes, relLabel, fieldLabel, optLabel],
  );

  const subtypeOptions = useMemo(
    () => (selectedType?.subtypes ?? []).map((st) => ({ key: st.key, label: subtypeDefLabel(st) })),
    [selectedType, subtypeDefLabel],
  );

  const facetFields = useMemo(() => {
    const out: FieldDef[] = [];
    if (!selectedType) return out;
    const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };
    for (const section of selectedType.fields_schema) {
      for (const f of section.fields) {
        if (!isFacetField(f)) continue;
        const resolved: FieldDef = {
          ...f,
          label: fieldLabel(f),
          options: f.options?.map((o) => ({ ...o, label: optLabel(o) })),
        };
        out.push(resolveFacetField(resolved, yesNo));
      }
    }
    return out;
  }, [selectedType, fieldLabel, optLabel, t]);

  return { relationOptions, relSubtypes, subtypeOptions, facetFields };
}
