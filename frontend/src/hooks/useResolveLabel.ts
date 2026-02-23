import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import type { TranslationMap, MetamodelTranslations } from "@/types";

/**
 * Resolve a translated label from a translations map.
 * Falls back to the English default label if no translation exists.
 *
 * For top-level translations (card type label, relation type label):
 *   resolveLabel("Application", type.translations?.label, "fr") → "Application" (fr)
 *
 * For inline JSONB translations (field labels, option labels, section names):
 *   resolveLabel("Risk Level", field.translations, "fr") → "Niveau de Risque"
 */
export function resolveLabel(
  label: string,
  translations?: TranslationMap,
  locale?: string,
): string {
  if (!translations || !locale || locale === "en") return label;
  return translations[locale] || label;
}

/**
 * Resolve a top-level translated property from a MetamodelTranslations object.
 *
 * resolveMetaLabel("Application", type.translations, "label", "fr") → "Application" (fr)
 */
export function resolveMetaLabel(
  label: string,
  translations?: MetamodelTranslations,
  property?: string,
  locale?: string,
): string {
  if (!translations || !property || !locale || locale === "en") return label;
  return translations[property]?.[locale] || label;
}

/**
 * Hook that returns a bound resolver using the current i18n language.
 *
 * Usage:
 *   const rl = useResolveLabel();
 *   // For inline translations (fields, options, sections, subtypes):
 *   rl(field.label, field.translations)
 *   // For top-level translations (card types, relation types):
 *   rl(type.label, type.translations?.label)
 */
export function useResolveLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useCallback(
    (label: string, translations?: TranslationMap): string =>
      resolveLabel(label, translations, locale),
    [locale],
  );
}

/**
 * Hook returning a resolver for top-level metamodel translations.
 *
 * Usage:
 *   const rml = useResolveMetaLabel();
 *   rml(type.label, type.translations, "label")
 *   rml(rt.reverse_label, rt.translations, "reverse_label")
 */
export function useResolveMetaLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useCallback(
    (label: string, translations?: MetamodelTranslations, property?: string): string =>
      resolveMetaLabel(label, translations, property, locale),
    [locale],
  );
}
