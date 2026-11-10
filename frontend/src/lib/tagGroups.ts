/** Tag group helpers shared by the tag picker and the inventory's query builder. */
import type { TagGroup } from "@/types";

/** Does a tag group apply to cards of `typeKey`? A null or empty restriction = every type. */
export function tagGroupApplies(
  group: Pick<TagGroup, "restrict_to_types">,
  typeKey: string,
): boolean {
  return (
    !group.restrict_to_types ||
    group.restrict_to_types.length === 0 ||
    group.restrict_to_types.includes(typeKey)
  );
}
