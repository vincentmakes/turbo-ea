import { useMemo } from "react";
import { canReadType } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { User } from "@/types";

export type ReadMode = "inventory" | "module";

/**
 * The card types a user may see, for pickers, filters and relation groups.
 *
 * The metamodel itself stays complete — it is configuration, and a card the
 * user holds a stakeholder role on can be of a type they may not browse. This
 * only decides which types to *offer*: the server already omits the cards.
 * Outside an auth provider (no user) nothing is filtered.
 */
export function readableCardTypes<T extends { key: string }>(
  types: T[],
  user: User | null,
  mode: ReadMode = "inventory",
): T[] {
  if (!user) return types;
  return types.filter((t) => canReadType(user, t.key, mode));
}

/** `useMetamodel().types` narrowed to the types the signed-in user may see. */
export function useReadableCardTypes(mode: ReadMode = "inventory") {
  const { types } = useMetamodel();
  const user = useOptionalAuthUser();
  return useMemo(() => readableCardTypes(types, user, mode), [types, user, mode]);
}
