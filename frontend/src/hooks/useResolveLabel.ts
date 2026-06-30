import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import type { TranslationMap, MetamodelTranslations } from "@/types";

/**
 * Metamodel label resolution.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PREFERRED API — entity-aware resolvers. Pass the WHOLE entity; the correct
 * `entity.label || entity.key` fallback is computed internally, so the
 * internal key can never leak to the UI.
 *
 *   const typeLabel  = useTypeLabel();      typeLabel(cardType)
 *   const relLabel   = useRelationLabel();  relLabel(rt)  /  relLabel(rt, true)
 *   const fieldLabel = useFieldLabel();     fieldLabel(field)
 *   const optLabel   = useOptionLabel();    optLabel(option)
 *   const stLabel    = useSubtypeLabel();   stLabel(subtype)
 *
 * Non-React contexts (excelExport/excelImport, plain helpers) use the pure
 * variants with an explicit locale:
 *   typeLabel(t, i18n.language)
 *   relationLabel(rt, i18n.language, true)
 *   fieldLabel(field, i18n.language)
 * ──────────────────────────────────────────────────────────────────────────
 */

/** Card/relation type, portal type info, stakeholder role def — top-level `translations`. */
interface MetaEntityLike {
  key: string;
  label: string;
  translations?: MetamodelTranslations;
}

/** A relation-type-like entity that additionally carries a reverse label. */
interface RelationLike extends MetaEntityLike {
  reverse_label?: string;
}

/** Field, option, subtype — inline `translations` map keyed directly by locale. */
interface InlineEntityLike {
  key: string;
  label: string;
  translations?: TranslationMap;
}

/* ------------------------------------------------------------------ */
/*  Low-level primitives                                               */
/* ------------------------------------------------------------------ */

/**
 * Low-level primitive. Prefer the entity-aware resolvers
 * (`typeLabel` / `relationLabel` / `fieldLabel` / `optionLabel`), which compute
 * the correct `label || key` fallback for you.
 *
 * ⚠️ NEVER pass an entity's `.key` as the fallback — custom (admin-created)
 * metamodel entities have an empty `translations` map, so the fallback is what
 * renders, and `.key` leaks the internal slug ("itAsset") to the UI instead of
 * the display label ("IT Asset"). This bug recurred twice (#661 subtypes,
 * #731 card/relation types). Pass the human label, never the key.
 *
 * For inline JSONB translations (field labels, option labels, section names, subtypes):
 *   resolveLabel("Risk Level", field.translations, "fr") → "Niveau de Risque"
 *   resolveLabel("Risk Level", field.translations, "en") → "Risk Level"
 *   resolveLabel("Risk Level", undefined, "en") → "Risk Level"
 */
export function resolveLabel(
  fallback: string,
  translations?: TranslationMap,
  locale?: string,
): string {
  if (!translations || !locale) return fallback;
  return translations[locale] || fallback;
}

/**
 * Low-level primitive for top-level metamodel translations. Prefer the
 * entity-aware resolvers (`typeLabel` / `relationLabel`).
 *
 * ⚠️ NEVER pass an entity's `.key` as the fallback (see `resolveLabel` above).
 *
 *   resolveMetaLabel("Application", type.label is preferred over type.key,
 *                    type.translations, "label", "fr")
 */
export function resolveMetaLabel(
  fallback: string,
  translations?: MetamodelTranslations,
  property?: string,
  locale?: string,
): string {
  if (!translations || !property || !locale) return fallback;
  return translations[property]?.[locale] || fallback;
}

/* ------------------------------------------------------------------ */
/*  Entity-aware pure resolvers (for non-React / explicit-locale code) */
/* ------------------------------------------------------------------ */

/** Localized display label for a card type / portal type / stakeholder role def. */
export function typeLabel(entity: MetaEntityLike | null | undefined, locale?: string): string {
  if (!entity) return "";
  return resolveMetaLabel(entity.label || entity.key, entity.translations, "label", locale);
}

/**
 * Localized verb for a relation type. `reverse=false` (default) → forward
 * "label"; `reverse=true` → "reverse_label", falling back to the forward label
 * (localized), then the raw label, then key, when no reverse exists.
 */
export function relationLabel(
  rt: RelationLike | null | undefined,
  locale?: string,
  reverse = false,
): string {
  if (!rt) return "";
  if (reverse) {
    return (
      resolveMetaLabel(
        rt.reverse_label || rt.label || rt.key,
        rt.translations,
        "reverse_label",
        locale,
      ) || typeLabel(rt, locale)
    );
  }
  return resolveMetaLabel(rt.label || rt.key, rt.translations, "label", locale);
}

/** Localized label for an inline-translated entity: field, option, or subtype. */
export function fieldLabel(entity: InlineEntityLike | null | undefined, locale?: string): string {
  if (!entity) return "";
  return resolveLabel(entity.label || entity.key, entity.translations, locale);
}

/** Same resolver as `fieldLabel`; named for intent at option / subtype call sites. */
export const optionLabel = fieldLabel;
export const subtypeLabel = fieldLabel;

/* ------------------------------------------------------------------ */
/*  Hooks — bind the current i18n language                             */
/* ------------------------------------------------------------------ */

/**
 * Hook that returns a bound resolver using the current i18n language.
 * Prefer the entity-aware hooks below; reach for this only for loose string
 * values that have no entity object (and then pass the human label, not a key).
 */
export function useResolveLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useCallback(
    (fallback: string, translations?: TranslationMap): string =>
      resolveLabel(fallback, translations, locale),
    [locale],
  );
}

/**
 * Hook returning the low-level resolver for top-level metamodel translations.
 * Prefer `useTypeLabel` / `useRelationLabel`.
 */
export function useResolveMetaLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useCallback(
    (fallback: string, translations?: MetamodelTranslations, property?: string): string =>
      resolveMetaLabel(fallback, translations, property, locale),
    [locale],
  );
}

/** Entity-aware: localized label for a card type (pass the whole type). */
export function useTypeLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  return useCallback(
    (entity: MetaEntityLike | null | undefined): string => typeLabel(entity, locale),
    [locale],
  );
}

/** Entity-aware: localized relation verb. Call with `(rt)` or `(rt, true)` for reverse. */
export function useRelationLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  return useCallback(
    (rt: RelationLike | null | undefined, reverse = false): string =>
      relationLabel(rt, locale, reverse),
    [locale],
  );
}

/** Entity-aware: localized label for a field (pass the whole field). */
export function useFieldLabel() {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  return useCallback(
    (entity: InlineEntityLike | null | undefined): string => fieldLabel(entity, locale),
    [locale],
  );
}

/** Entity-aware: localized label for a select option (alias of `useFieldLabel`). */
export function useOptionLabel() {
  return useFieldLabel();
}

/** Entity-aware: localized label for a subtype (alias of `useFieldLabel`). */
export function useSubtypeLabel() {
  return useFieldLabel();
}
