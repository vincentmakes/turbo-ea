/**
 * The colour of each link kind's card type, from the metamodel — so a type an
 * admin recoloured wears that colour on the canvas — with the seeded set as
 * the fallback for a type that is missing or carries no colour.
 *
 * Only the app calls this: a portal has no metamodel session, and its viewer
 * takes `LINK_TYPE_COLORS` as is. The result is memoised on the metamodel's
 * `types` array (stable while the cache holds), never on `getType`, which is a
 * fresh closure every render — a host keys a diagram-import effect on this
 * object, and a new identity per render would re-import the diagram per render.
 */
import { useMemo } from "react";

import { useMetamodel } from "@/hooks/useMetamodel";

import { LINK_KIND_ORDER, LINK_KIND_TYPE } from "./calledProcess";
import type { LinkKind } from "./calledProcess";
import { LINK_TYPE_COLORS } from "./linkDots";

export function useLinkTypeColors(): Record<LinkKind, string> {
  const { types, getType } = useMetamodel();
  return useMemo(() => {
    const colors = { ...LINK_TYPE_COLORS };
    for (const kind of LINK_KIND_ORDER) {
      const color = getType(LINK_KIND_TYPE[kind])?.color;
      if (color) colors[kind] = color;
    }
    return colors;
    // `getType` reads `types`; it is the closure that changes per render,
    // `types` the value that changes per metamodel refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types]);
}
