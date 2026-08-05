import type { FieldDef, MetamodelTranslations, TranslationMap } from "@/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function emptyField(): FieldDef {
  // weight 1 ("Normal") so newly created fields count toward data quality by
  // default — admins opt out via the importance picker, not by accident.
  return { key: "", label: "", type: "text", required: false, weight: 1 };
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}

/** Remove empty-string entries from a TranslationMap. Returns undefined if all empty. */
export function cleanTranslationMap(
  map: TranslationMap | undefined,
): TranslationMap | undefined {
  if (!map) return undefined;
  const cleaned: TranslationMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) cleaned[k] = v.trim();
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/** Clean a MetamodelTranslations object, removing empty maps. */
export function cleanTranslations(
  trans: MetamodelTranslations | undefined,
): MetamodelTranslations | undefined {
  if (!trans) return undefined;
  const cleaned: MetamodelTranslations = {};
  for (const [key, map] of Object.entries(trans)) {
    const c = cleanTranslationMap(map);
    if (c) cleaned[key] = c;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
