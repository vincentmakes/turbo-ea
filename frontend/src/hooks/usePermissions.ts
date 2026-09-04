import { useState, useCallback, useMemo } from "react";
import { api } from "@/api/client";
import { hasTypePermission } from "@/components/RequirePermission";
import type { User, CardEffectivePermissions } from "@/types";

/**
 * Hook for checking user permissions at both app-level and card-level.
 *
 * App-level permissions come from the user's role (loaded via /auth/me).
 * Card-level permissions are loaded on demand via /cards/:id/my-permissions.
 */
export function usePermissions(user: User | null) {
  const [cardPermissions, setCardPermissions] = useState<
    Record<string, CardEffectivePermissions>
  >({});

  const permissions = useMemo(
    () => user?.permissions ?? {},
    [user?.permissions]
  );

  /**
   * Check a single app-level permission.
   * Returns true if the user's role grants the given permission key.
   */
  const can = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      if (permissions["*"]) return true;
      return !!permissions[permission];
    },
    [user, permissions]
  );

  /**
   * Check one of the four type-scoped inventory permissions for a specific
   * card type, honouring that type's per-role overrides. Falls back to the
   * role's landscape-wide grant when the type says nothing (discussion #1068).
   */
  const canForType = useCallback(
    (permission: string, typeKey: string | null | undefined): boolean =>
      hasTypePermission(user, permission, typeKey),
    [user]
  );

  /**
   * Check if the user has admin-level access (wildcard permission).
   */
  const isAdmin = useMemo(() => !!permissions["*"], [permissions]);

  /**
   * Whether the user can see cost-typed fields on cards landscape-wide.
   * For per-card stakeholder-aware checks (a viewer who is a stakeholder of
   * one card sees costs on that card only) use canOnCard(cardId, "can_view_costs").
   */
  const canViewCostsGlobally = useMemo(
    () => isAdmin || !!permissions["costs.view"],
    [isAdmin, permissions]
  );

  /**
   * Load effective permissions for a specific card.
   * Results are cached per card ID.
   */
  const loadCardPermissions = useCallback(
    async (cardId: string) => {
      if (cardPermissions[cardId]) return;
      try {
        const perms = await api.get<CardEffectivePermissions>(
          `/cards/${cardId}/my-permissions`
        );
        setCardPermissions((prev) => ({ ...prev, [cardId]: perms }));
      } catch {
        // Silently fail — permissions will default to false
      }
    },
    [cardPermissions]
  );

  /**
   * Check if user can perform an action on a specific card.
   * Checks both app-level and card-level permissions.
   */
  const canOnCard = useCallback(
    (cardId: string, effectiveKey: string): boolean => {
      if (isAdmin) return true;
      const cardPerms = cardPermissions[cardId];
      if (!cardPerms) return false;
      return !!(cardPerms.effective as Record<string, boolean>)[effectiveKey];
    },
    [isAdmin, cardPermissions]
  );

  /**
   * Invalidate cached card permissions (e.g. after a stakeholder change).
   */
  const invalidateCardPermissions = useCallback((cardId?: string) => {
    if (cardId) {
      setCardPermissions((prev) => {
        const next = { ...prev };
        delete next[cardId];
        return next;
      });
    } else {
      setCardPermissions({});
    }
  }, []);

  return {
    permissions,
    can,
    canForType,
    isAdmin,
    canViewCostsGlobally,
    cardPermissions,
    loadCardPermissions,
    canOnCard,
    invalidateCardPermissions,
  };
}
