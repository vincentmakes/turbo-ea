/**
 * Pure helpers that read a `CardQuery` (a multi-hop condition authored through
 * the MCP server) as a sentence: card types by their label and each hop by its
 * relation verb, read from the side under view (UI_GUIDELINES §3.13).
 */
import { relationLabel, typeLabel } from "@/hooks/useResolveLabel";
import { parseSideKey } from "@/lib/relationSort";
import type {
  CardQuery,
  CardQueryHop,
  CardQuerySet,
  CardQueryWhere,
  CardType,
  RelationType,
} from "@/types";
import { linesOf } from "./querySet";

/** Separator between the steps of a compact path. */
export const PATH_SEPARATOR = " › ";

/** Separator between a compact path and its condition count. */
export const CONDITIONS_SEPARATOR = " · ";

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
  /** The word joining the lines of a group (`inventory:queryView.connectiveAnd`). */
  and: string;
  /** The word joining groups (`inventory:queryView.connectiveOr`). */
  or: string;
  /** The condition count, worded (`inventory:queryView.conditionCount`). */
  conditions: (count: number) => string;
}

/** The conditions one `where` sets: each list it holds, each attribute apart. */
function whereConditionCount(where: CardQueryWhere | undefined): number {
  if (!where) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(where)) {
    if (key === "attributes") count += Object.keys(value ?? {}).length;
    else if (Array.isArray(value)) count += 1;
  }
  return count;
}

function nodeConditionCount(node: { where?: CardQueryWhere; related?: CardQueryHop[] }): number {
  let count = whereConditionCount(node.where);
  for (const hop of node.related ?? []) count += nodeConditionCount(hop);
  return count;
}

/**
 * How many conditions the query sets, over the start card and every hop of
 * every line: one per condition kind on a node (lifecycle phase, subtype,
 * approval status, data quality, end of life, tags, picked cards), one per
 * attribute. "Include sub-cards" qualifies the picked cards and is not one.
 */
export function conditionCount(query: CardQuerySet): number {
  return linesOf(query).reduce((sum, line) => sum + nodeConditionCount(line.query), 0);
}

/** The most lines `compactPath` spells out before "+N". */
const SPELLED_LINES = 2;

/**
 * One line naming the chain: "Organization › uses Application › is affected
 * by Initiative". Each level shows its first hop; a level with several hops
 * adds "+N" for the others. A type or relation type missing from the
 * metamodel shows the query's own key — the only name there is for it.
 */
function linePath(query: CardQuery, opts: CompactPathOptions): string {
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

/**
 * A view's query in one line: a single query reads as its chain (`linePath`);
 * a stack joins its lines with the AND word inside a group and the OR word
 * between groups, spelling out the first two lines and "+N" for the rest.
 * The path names no condition, so a query holding any ends with their count
 * ("Application · 2 conditions"): it never reads like the bare type.
 */
export function compactPath(query: CardQuerySet, opts: CompactPathOptions): string {
  const lines = linesOf(query);
  let text = "";
  for (const line of lines.slice(0, SPELLED_LINES)) {
    if (line.connective) text += ` ${line.connective === "or" ? opts.or : opts.and} `;
    text += linePath(line.query, opts);
  }
  if (lines.length > SPELLED_LINES) text += ` +${lines.length - SPELLED_LINES}`;
  const count = conditionCount(query);
  if (count > 0) text += `${CONDITIONS_SEPARATOR}${opts.conditions(count)}`;
  return text;
}
