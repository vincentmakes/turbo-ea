import { useMemo } from "react";

import { hasPermission } from "@/components/RequirePermission";
import { useAuthContext } from "@/hooks/AuthContext";
import type { ArtefactKind } from "./initiatives/NewArtefactSplitButton";

/**
 * What the signed-in role may see and start on the EA Delivery page.
 *
 * The page lists three kinds of artefact, each behind its own permission, and
 * opens for a role that holds only one of them (a decision reader without
 * `soaw.view`, issue #1400). So nothing on it may assume the others: a kind
 * the role cannot view is neither requested nor rendered, and a kind it cannot
 * create is not offered. These mirror what the API checks (`GET` and `POST` on
 * `/soaw`, `/diagrams`, `/adr`); the server stays the authority.
 */
export const ARTEFACT_KINDS: readonly ArtefactKind[] = ["soaw", "diagram", "adr"];

const VIEW_PERMISSION: Record<ArtefactKind, string> = {
  soaw: "soaw.view",
  diagram: "diagrams.view",
  adr: "adr.view",
};

const CREATE_PERMISSION: Record<ArtefactKind, string> = {
  soaw: "soaw.manage",
  diagram: "diagrams.manage",
  adr: "adr.manage",
};

export interface DeliveryAccess {
  /** Kinds the role may read, in display order. */
  viewable: ArtefactKind[];
  /** Kinds the role may create. A kind it cannot open afterwards is left out. */
  creatable: ArtefactKind[];
}

export function deliveryAccess(perms: Record<string, boolean> | undefined): DeliveryAccess {
  const viewable = ARTEFACT_KINDS.filter((kind) => hasPermission(perms, VIEW_PERMISSION[kind]));
  return {
    viewable,
    creatable: viewable.filter((kind) => hasPermission(perms, CREATE_PERMISSION[kind])),
  };
}

export function useDeliveryAccess(): DeliveryAccess {
  const { user } = useAuthContext();
  const perms = user?.permissions;
  return useMemo(() => deliveryAccess(perms), [perms]);
}
