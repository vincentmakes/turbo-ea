/**
 * useBpmFieldOptions — metamodel-driven labels and colours for any
 * BusinessProcess `single_select` field (`maturity`, `automationLevel`, …).
 *
 * The BPM dashboard groups processes by the stored option key; its charts
 * must show the option's admin-configured, translated label (never the raw
 * key) and its colour when the metamodel defines one. `processType` keeps its
 * own richer hook (`useProcessTypeOptions`: visible-option order, a seeded
 * fallback while loading, a default bucket); this is the plain lookup every
 * other field needs.
 */
import { useMemo } from "react";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import type { FieldOption, SectionDef } from "@/types";

export interface BpmFieldOption {
  key: string;
  label: string;
  /** The option's metamodel colour; absent when the option defines none. */
  color?: string;
}

export interface BpmFieldOptionsResult {
  /** The field's options, in the metamodel's order. */
  options: BpmFieldOption[];
  /** Resolve a stored value; an unknown key degrades to the raw key, uncoloured. */
  resolve: (key: string) => BpmFieldOption;
  /**
   * A stored value's place in the option order; every key the field does not
   * define shares the last place (`options.length`), so a stable sort keeps
   * them in their own order after the known ones.
   */
  order: (key: string) => number;
  loading: boolean;
}

/** The pure resolver, given a card type's `fields_schema` and a field key. */
export function bpmFieldOptionsFrom(
  fieldsSchema: SectionDef[] | undefined,
  fieldKey: string,
  optLabel: (o: FieldOption) => string,
  loading: boolean,
): BpmFieldOptionsResult {
  // Stryker disable next-line ArrayDeclaration: a filler section has no `fields`, so it flattens to the same empty list
  const field = (fieldsSchema ?? [])
    // Stryker disable next-line ArrayDeclaration: a filler field has no `key`, so it matches nothing, as the empty list does
    .flatMap((s) => s.fields ?? [])
    .find((f) => f.key === fieldKey);
  const options = (field?.options ?? []).map(
    (o): BpmFieldOption =>
      o.color ? { key: o.key, label: optLabel(o), color: o.color } : { key: o.key, label: optLabel(o) },
  );
  const byKey = new Map(options.map((o) => [o.key, o]));
  const index = new Map(options.map((o, i) => [o.key, i]));
  const resolve = (key: string): BpmFieldOption => byKey.get(key) ?? { key, label: key };
  const order = (key: string): number => index.get(key) ?? options.length;
  return { options, resolve, order, loading };
}

/** The options of the BusinessProcess field `fieldKey`, from the metamodel. */
export function useBpmFieldOptions(fieldKey: string): BpmFieldOptionsResult {
  const { getType, loading } = useMetamodel();
  const optLabel = useOptionLabel();
  const bpType = getType("BusinessProcess");
  return useMemo(
    () => bpmFieldOptionsFrom(bpType?.fields_schema, fieldKey, optLabel, loading),
    [bpType, fieldKey, optLabel, loading],
  );
}
