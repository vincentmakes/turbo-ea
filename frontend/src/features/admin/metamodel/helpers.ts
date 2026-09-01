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

/** The subset of a relation type this module needs to derive a key. */
export interface RelationKeyPeer {
  key: string;
  source_type_key: string;
  target_type_key: string;
  sort_order?: number;
  is_hidden?: boolean;
}

/**
 * Suggest the key for a NEW relation type.
 *
 * Any number of relation types may connect the same ordered card-type pair, so
 * the plain `<Source>To<Target>` form is only right for the first one. The key
 * is not an internal id — it is the Excel column (`rel:<key>`), the calculation
 * variable (`relations.<key>`) and the survey field key — so a second relation
 * has to arrive with a key that reads as its own thing.
 *
 * - **First on a free pair** → `OrganizationToApplication` (unchanged).
 * - **Second and later** → the EXISTING relation's key plus the verb:
 *   `relOrgToApp` + `owns` → `relOrgToAppOwns`. Inheriting the existing key is
 *   what keeps a pair's keys reading as one family — deriving a fresh
 *   `OrganizationOwnsApplication` instead would sit oddly beside a first
 *   relation that is usually the seeded short form.
 * - **No verb typed yet, or that key is taken** → `relOrgToApp2`, `…3`, …
 *
 * The anchor is the pair's lowest `(sort_order, key)`, so a third relation
 * anchors on the same key as the second rather than on whichever row the API
 * happened to return first.
 *
 * Always returns a key matching the backend's `^[a-zA-Z][a-zA-Z0-9]*$`, or ""
 * when either endpoint is unset.
 */
export function deriveRelationKey(
  sourceTypeKey: string,
  targetTypeKey: string,
  verb: string,
  relationTypes: RelationKeyPeer[],
): string {
  if (!sourceTypeKey || !targetTypeKey) return "";

  const taken = new Set(relationTypes.map((r) => r.key));
  const free = (candidate: string) => !taken.has(candidate);

  const pairPeers = relationTypes.filter(
    (r) =>
      !r.is_hidden &&
      r.source_type_key === sourceTypeKey &&
      r.target_type_key === targetTypeKey,
  );

  // The pair's keys grow from this stem: the plain pair form for the first
  // relation, the existing relation's key for every one after it.
  const anchor =
    pairPeers.length === 0
      ? `${sourceTypeKey}To${targetTypeKey}`
      : [...pairPeers].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.key.localeCompare(b.key),
        )[0].key;

  if (pairPeers.length === 0 && free(anchor)) return anchor;

  const verbPart = coerceRelationVerb(verb);
  if (verbPart && free(`${anchor}${verbPart}`)) return `${anchor}${verbPart}`;

  let n = 2;
  while (!free(`${anchor}${n}`)) n += 1;
  return `${anchor}${n}`;
}

/**
 * A relation verb as a key fragment: title-cased, diacritics and punctuation
 * stripped ("is used by" → "IsUsedBy"). Mirrors `coerceKey` in
 * `components/KeyInput.tsx` so the result is always a valid key fragment.
 */
export function coerceRelationVerb(verb: string): string {
  // Strip diacritics BEFORE title-casing: `\w` does not match `é`, so in
  // "héberge" the accent would read as a word boundary and uppercase the `b`
  // ("HeBerge"). Fold to ASCII first and the word boundaries are the real ones.
  return verb
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}
