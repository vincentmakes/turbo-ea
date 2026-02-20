import { useState, useCallback, useMemo } from "react";
import { api } from "@/api/client";
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
   * Check if the user has admin-level access (wildcard permission).
   */
  const isAdmin = useMemo(() => !!permissions["*"], [permissions]);

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
    isAdmin,
    cardPermissions,
    loadCardPermissions,
    canOnCard,
    invalidateCardPermissions,
  };
}
