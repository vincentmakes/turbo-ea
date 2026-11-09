/**
 * Pure helpers that read a `CardQuery` (a multi-hop condition authored through
 * the MCP server) as a sentence: card types by their label and each hop by its
 * relation verb, read from the side under view (UI_GUIDELINES §3.13).
 */
import { relationLabel, typeLabel } from "@/hooks/useResolveLabel";
import { parseSideKey } from "@/lib/relationSort";
import type { CardQuery, CardQueryHop, CardType, RelationType } from "@/types";

/** Separator between the steps of a compact path. */
export const PATH_SEPARATOR = " › ";

/**
 * Is the card under view (of `nodeTypeKey`) at the TARGET end of `rt` for this
 * hop? A self-referencing type says so in the hop's key (`__out` = the node is
 * the source, `__in` = the target); any other type answers from its ends.
 */
export function hopIsReverse(
  rt: Pick<RelationType, "source_type_key" | "target_type_key">,
  nodeTypeKey: string,
  relationKey: string,
): boolean {
  const side = parseSideKey(relationKey);
  if (side.isSource !== undefined) return !side.isSource;
  return rt.target_type_key === nodeTypeKey && rt.source_type_key !== nodeTypeKey;
}

/** The verb of a hop as read from the node it leaves (`nodeTypeKey`). */
export function hopVerb(
  rt: RelationType | null | undefined,
  nodeTypeKey: string,
  locale: string | undefined,
  relationKey: string,
): string {
  if (!rt) return "";
  return relationLabel(rt, locale, hopIsReverse(rt, nodeTypeKey, relationKey));
}

/** The relation type a hop names, its `__out` / `__in` suffix stripped. */
export function hopRelationType(
  hop: Pick<CardQueryHop, "relation">,
  relationTypes: RelationType[],
): RelationType | undefined {
  const { key } = parseSideKey(hop.relation);
  return relationTypes.find((r) => r.key === key);
}

export interface CompactPathOptions {
  types: CardType[];
  relationTypes: RelationType[];
  locale?: string;
  /** Prefix for a negated hop (`inventory:queryView.hasNo`). */
  hasNo?: string;
}

/**
 * One line naming the chain: "Organization › uses Application › is affected
 * by Initiative". Each level shows its first hop; a level with several hops
 * adds "+N" for the others. A type or relation type missing from the
 * metamodel shows the query's own key — the only name there is for it.
 */
export function compactPath(query: CardQuery, opts: CompactPathOptions): string {
  const { types, relationTypes, locale, hasNo } = opts;
  const nameOf = (key: string) => typeLabel(types.find((t) => t.key === key), locale) || key;
  const parts = [nameOf(query.type)];
  let nodeType = query.type;
  let hops = query.related ?? [];
  while (hops.length > 0) {
    const hop = hops[0];
    const rt = hopRelationType(hop, relationTypes);
    const verb = hopVerb(rt, nodeType, locale, hop.relation) || hop.relation;
    const prefix = hop.negate && hasNo ? `${hasNo} ` : "";
    const more = hops.length > 1 ? ` +${hops.length - 1}` : "";
    parts.push(`${prefix}${verb} ${nameOf(hop.type)}${more}`);
    nodeType = hop.type;
    hops = hop.related ?? [];
  }
  return parts.join(PATH_SEPARATOR);
}
