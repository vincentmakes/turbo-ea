import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMetamodel } from "@/hooks/useMetamodel";
import {
  useFieldLabel,
  useOptionLabel,
  useRelationLabel,
  useResolveLabel,
  useSubtypeLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { resolveFacetField } from "@/lib/fieldFacets";
import { buildFilterCatalog, catalogFields } from "@/lib/fieldFilters";
import type { FilterCatalog } from "@/lib/fieldFilters";
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
  /**
   * Every facet field of the type (selects with options, yes/no fields),
   * labels resolved — hidden-from-filters sections included, because the
   * matcher must still apply a value such a field holds.
   */
  facetFields: FieldDef[];
  /** The type's filter catalog: what the Fields row shows and "Add filter" offers. */
  catalog: FilterCatalog<FieldDef>;
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
  const rl = useResolveLabel();

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

  const catalog = useMemo<FilterCatalog<FieldDef>>(() => {
    if (!selectedType) return [];
    const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };
    return buildFilterCatalog(selectedType.fields_schema, {
      sectionLabel: (section) => rl(section.section, section.translations),
      descriptionLabel: t("common:labels.description"),
      resolveField: (f): FieldDef =>
        resolveFacetField(
          { ...f, label: fieldLabel(f), options: f.options?.map((o) => ({ ...o, label: optLabel(o) })) },
          yesNo,
        ),
    });
  }, [selectedType, fieldLabel, optLabel, rl, t]);

  // Every catalog field is a facet field today. Once other kinds (text,
  // number, date) join the catalog, this list keeps the facet ones only.
  const facetFields = useMemo(() => catalogFields(catalog).map((e) => e.field), [catalog]);

  return { relationOptions, relSubtypes, subtypeOptions, facetFields, catalog };
}
