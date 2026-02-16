import { useState, useCallback, useMemo } from "react";
import { api } from "@/api/client";
import type { User, CardEffectivePermissions } from "@/types";

/**
 * Hook for checking user permissions at both app-level and card-level.
 *
 * App-level permissions come from the user's role (loaded via /auth/me).
 * Fact-sheet-level permissions are loaded on demand via /cards/:id/my-permissions.
 */
export function usePermissions(user: User | null) {
  const [fsPermissions, setFsPermissions] = useState<
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
  const loadFsPermissions = useCallback(
    async (fsId: string) => {
      if (fsPermissions[fsId]) return;
      try {
        const perms = await api.get<CardEffectivePermissions>(
          `/cards/${fsId}/my-permissions`
        );
        setFsPermissions((prev) => ({ ...prev, [fsId]: perms }));
      } catch {
        // Silently fail — permissions will default to false
      }
    },
    [fsPermissions]
  );

  /**
   * Check if user can perform an action on a specific card.
   * Checks both app-level and FS-level permissions.
   */
  const canOnFs = useCallback(
    (fsId: string, effectiveKey: string): boolean => {
      if (isAdmin) return true;
      const fsPerms = fsPermissions[fsId];
      if (!fsPerms) return false;
      return !!(fsPerms.effective as Record<string, boolean>)[effectiveKey];
    },
    [isAdmin, fsPermissions]
  );

  /**
   * Invalidate cached FS permissions (e.g. after a stakeholder change).
   */
  const invalidateFsPermissions = useCallback((fsId?: string) => {
    if (fsId) {
      setFsPermissions((prev) => {
        const next = { ...prev };
        delete next[fsId];
        return next;
      });
    } else {
      setFsPermissions({});
    }
  }, []);

  return {
    permissions,
    can,
    isAdmin,
    fsPermissions,
    loadFsPermissions,
    canOnFs,
    invalidateFsPermissions,
  };
}
