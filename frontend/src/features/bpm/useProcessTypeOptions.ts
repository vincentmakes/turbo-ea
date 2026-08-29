/**
 * useProcessTypeOptions — metamodel-driven Process Type presentation.
 *
 * Resolves the BusinessProcess `processType` single_select options (label,
 * translations, color — all admin-customizable) so BPM surfaces (Process
 * Navigator, Process Map report, BPM dashboard) never hardcode process-type
 * labels or colors (issue #857).
 */
import { useMemo } from "react";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import type { FieldOption, SectionDef } from "@/types";

export interface ProcessTypeOption {
  key: string;
  label: string;
  color: string;
}

/** Grey for stored values whose option no longer exists in the metamodel. */
export const PROCESS_TYPE_NEUTRAL_COLOR = "#9e9e9e";

// Mirrors seed.py PROCESS_TYPE_OPTIONS. Used only while the metamodel is
// still loading, or if the processType field was removed from the type.
const FALLBACK_OPTIONS: ProcessTypeOption[] = [
  { key: "core", label: "Core", color: "#1976d2" },
  { key: "support", label: "Support", color: "#607d8b" },
  { key: "management", label: "Management", color: "#9c27b0" },
];

export interface ProcessTypeOptionsResult {
  /** Visible options in metamodel-declared order (hidden options excluded). */
  options: ProcessTypeOption[];
  /** Every option (hidden included) so stored values still resolve. */
  byKey: Map<string, ProcessTypeOption>;
  /** Bucket for cards without a processType: "core" when it exists. */
  defaultKey: string;
  /** Resolve a stored value; unknown keys degrade to raw key + neutral grey. */
  resolve: (key: string | null | undefined) => ProcessTypeOption;
  loading: boolean;
}

/**
 * The pure resolver, given a card type's `fields_schema`.
 *
 * Split out so a surface with no metamodel session can reuse it: a web portal
 * receives the (cost-stripped) schema of its pinned card type in the public
 * portal payload, and must not call `useMetamodel()` — that hook fetches
 * `/metamodel/types` unconditionally on mount, so an optional argument to
 * `useProcessTypeOptions` would still 401 a portal visitor. A hook cannot be
 * skipped; the resolution logic can be shared.
 */
export function processTypeOptionsFrom(
  fieldsSchema: SectionDef[] | undefined,
  optLabel: (o: FieldOption | ProcessTypeOption) => string,
  loading: boolean,
): ProcessTypeOptionsResult {
  const field = (fieldsSchema ?? [])
    .flatMap((s) => s.fields ?? [])
    .find((f) => f.key === "processType");
  const source: (FieldOption | ProcessTypeOption)[] = field?.options?.length
    ? field.options
    : FALLBACK_OPTIONS;

  const all = source.map((o) => ({
    key: o.key,
    label: optLabel(o),
    color: o.color || PROCESS_TYPE_NEUTRAL_COLOR,
    hidden: (o as FieldOption).hidden === true,
  }));
  const byKey = new Map<string, ProcessTypeOption>(
    all.map(({ key, label, color }) => [key, { key, label, color }]),
  );
  const options = all
    .filter((o) => !o.hidden)
    .map(({ key, label, color }) => ({ key, label, color }));
  const defaultKey = byKey.has("core") ? "core" : (options[0]?.key ?? all[0].key);

  const resolve = (key: string | null | undefined): ProcessTypeOption => {
    if (!key) return { key: "", label: "", color: PROCESS_TYPE_NEUTRAL_COLOR };
    return byKey.get(key) ?? { key, label: key, color: PROCESS_TYPE_NEUTRAL_COLOR };
  };

  return { options, byKey, defaultKey, resolve, loading };
}

export function useProcessTypeOptions(): ProcessTypeOptionsResult {
  const { getType, loading } = useMetamodel();
  const optLabel = useOptionLabel();
  const bpType = getType("BusinessProcess");
  return useMemo(
    () => processTypeOptionsFrom(bpType?.fields_schema, optLabel, loading),
    [bpType, optLabel, loading],
  );
}

/**
 * The same result, resolved from a schema the caller already holds.
 *
 * Used by the published Process House, which reads `type_info.fields_schema`
 * off the public portal payload instead of the metamodel.
 */
export function useProcessTypeOptionsFrom(
  fieldsSchema: SectionDef[] | undefined,
): ProcessTypeOptionsResult {
  const optLabel = useOptionLabel();
  return useMemo(
    () => processTypeOptionsFrom(fieldsSchema, optLabel, false),
    [fieldsSchema, optLabel],
  );
}
