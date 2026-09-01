/**
 * Which relation type is a card type's *lineage* (successor) relation.
 *
 * Successor relations are a UI-isolated category: `SuccessorsSection` owns them on
 * card detail, and the ordinary Relations views hide them so a card does not show
 * "succeeds" twice. That hiding used to be `key.endsWith("Successor")`, which was
 * safe only while the metamodel allowed one relation type per ordered card-type
 * pair — a second self-pair type whose key happened to end in "Successor" then had
 * no UI anywhere: invisible, uneditable, undeletable.
 *
 * Exactly ONE relation type per card type is the lineage relation. Every other
 * self-pair type — Successor-suffixed or not — is an ordinary relation and belongs
 * in the Relations section and the metamodel Relations tab.
 *
 * The key is not predictable from the card type: the backend auto-provisions
 * `rel{TypeKey}Successor`, but the seeded built-ins are abbreviated
 * (`relAppSuccessor` for Application, `relProcessSuccessor` for BusinessProcess).
 * Preference order, most to least specific:
 *   1. the exact auto-provisioned key `rel{TypeKey}Successor`;
 *   2. a `built_in` one — the seeded lineage relation, whatever its spelling;
 *   3. the first by (sort_order, key).
 * Never "whichever the array happened to hold first": an admin's custom
 * `relAppLegacySuccessor` sorts before the built-in `relAppSuccessor`
 * alphabetically, and picking it would hide the wrong relation.
 */

import type { RelationType } from "@/types";

const SUCCESSOR_SUFFIX = "Successor";

/** The lineage relation type for `typeKey`, or undefined when it has none. */
export function findSuccessorRelationType(
  relationTypes: RelationType[],
  typeKey: string,
): RelationType | undefined {
  const candidates = relationTypes.filter(
    (rt) =>
      !rt.is_hidden &&
      rt.source_type_key === typeKey &&
      rt.target_type_key === typeKey &&
      rt.key.endsWith(SUCCESSOR_SUFFIX),
  );
  if (candidates.length === 0) return undefined;
  const canonical = candidates.find((rt) => rt.key === `rel${typeKey}${SUCCESSOR_SUFFIX}`);
  if (canonical) return canonical;
  const builtIn = candidates.filter((rt) => rt.built_in);
  if (builtIn.length === 1) return builtIn[0];
  return [...(builtIn.length > 1 ? builtIn : candidates)].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.key.localeCompare(b.key),
  )[0];
}

/**
 * Keys the ordinary Relations views must hide — one per card type, never every
 * `*Successor`-suffixed key. Pass the full relation-type list.
 */
export function successorRelationKeys(relationTypes: RelationType[]): Set<string> {
  const selfTypeKeys = new Set(
    relationTypes
      .filter((rt) => rt.source_type_key === rt.target_type_key)
      .map((rt) => rt.source_type_key),
  );
  const keys = new Set<string>();
  for (const typeKey of selfTypeKeys) {
    const rt = findSuccessorRelationType(relationTypes, typeKey);
    if (rt) keys.add(rt.key);
  }
  return keys;
}
