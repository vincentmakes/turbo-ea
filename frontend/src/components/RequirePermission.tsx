import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";

interface Props {
  /**
   * Permission key, or a list any ONE of which grants access. The OR reading is
   * the documented contract for permissions declared in extension manifests, so
   * it must not change — see the regression test in RequirePermission.test.tsx.
   */
  permission: string | string[];
  children: React.ReactNode;
}

export function hasPermission(
  perms: Record<string, boolean> | undefined,
  permission: string | string[],
): boolean {
  if (!perms) return false;
  if (perms["*"]) return true;
  if (Array.isArray(permission)) return permission.some((p) => !!perms[p]);
  return !!perms[permission];
}

/** Minimal user shape a per-card-type permission check needs. */
export type TypePermissionUser =
  | {
      permissions?: Record<string, boolean>;
      type_permissions?: Record<string, Record<string, boolean>>;
    }
  | null
  | undefined;

/** The per-card-type permission that decides whether a role may see a type's cards. */
export const VIEW_PERMISSION = "inventory.view";

/**
 * Check a permission for a specific card type, honouring that type's per-role
 * overrides — the frontend mirror of `type_cell_decision`
 * (`backend/app/core/permissions.py`), so the two can never disagree.
 *
 * Order: admin wildcard wins; then an explicit View *deny* on the type, which
 * takes every permission on it away (a role that may not see a type's cards
 * holds no landscape-wide authority over them); then the type's own stored
 * cell for this permission (View, Create, Edit, Archive, Delete); then the
 * role's global permission. An absent cell inherits — which is why every
 * un-overridden type behaves exactly as before.
 *
 * A pure function rather than a hook method because the callers are split:
 * `usePermissions` exposes it as `canForType`, while `AppLayout` and
 * `InventoryPage` read `user.permissions` inline and would otherwise need a
 * second copy of the rule.
 */
export function hasTypePermission(
  user: TypePermissionUser,
  permission: string,
  typeKey: string | null | undefined,
): boolean {
  if (!user) return false;
  if (user.permissions?.["*"]) return true;
  if (typeKey) {
    const cells = user.type_permissions?.[typeKey];
    if (cells?.[VIEW_PERMISSION] === false) return false;
    const cell = cells?.[permission];
    if (cell !== undefined) return cell;
  }
  return hasPermission(user.permissions, permission);
}

/**
 * May the user see cards of this type landscape-wide?
 *
 * Mirrors the backend card read scope's two modes. `inventory` (the default)
 * is the inventory reading: a View allow opens the type to a role without the
 * global grant, a deny hides it from one with it. `module` is the reading of
 * surfaces gated by their own permission (reports, BPM, PPM…): only an
 * explicit deny subtracts. A stakeholder can still open the one card they
 * hold a role on — that is answered per card by the server, not here.
 */
export function canReadType(
  user: TypePermissionUser,
  typeKey: string | null | undefined,
  mode: "inventory" | "module" = "inventory",
): boolean {
  if (mode === "module") {
    // Module surfaces (reports, BPM, PPM…) are gated by their own permission;
    // only an explicit View deny subtracts a type there.
    if (!user) return false;
    if (user.permissions?.["*"]) return true;
    return !(typeKey && user.type_permissions?.[typeKey]?.[VIEW_PERMISSION] === false);
  }
  return hasTypePermission(user, VIEW_PERMISSION, typeKey);
}

/**
 * May the user open the inventory at all — the global `inventory.view`, or a
 * View allow on at least one card type. Mirrors `can_browse_inventory` on the
 * backend's card read scope. Answered from `type_permissions` alone, so it
 * holds on first paint before the metamodel arrives.
 */
export function canReadAnyCardType(user: TypePermissionUser): boolean {
  if (!user) return false;
  if (user.permissions?.["*"]) return true;
  if (hasPermission(user.permissions, VIEW_PERMISSION)) return true;
  return Object.values(user.type_permissions ?? {}).some(
    (cells) => cells[VIEW_PERMISSION] === true,
  );
}

/**
 * The permission map route gating reads: `user.permissions` with
 * `inventory.view` widened to "may read some card type", so a role whose only
 * inventory access is a per-type View allow still reaches `/inventory` and
 * `/cards/:id`. Every `canAccessPath` caller and `RequirePermission` go
 * through this, so a typed URL and the nav entry agree.
 */
export function routePermissionsFor(user: TypePermissionUser): Record<string, boolean> {
  const perms = { ...(user?.permissions ?? {}) };
  if (canReadAnyCardType(user)) perms[VIEW_PERMISSION] = true;
  return perms;
}

/**
 * Whether the user may create *some* card type — the rule behind a bare
 * "New card" button that is not tied to one type.
 *
 * Deliberately not `types.some(...)`: the metamodel list arrives
 * asynchronously, so keying purely off it would hide the button on first
 * paint for every user. Instead, a role holding the global grant keeps it
 * unless the loaded metamodel says every visible type denies them, and a role
 * without the global grant gets it as soon as any card type grants it — which
 * is answered by `type_permissions` alone, with no list needed. A type whose
 * View is denied never grants creation (`hasTypePermission`).
 */
export function canCreateAnyCardType(
  user: TypePermissionUser,
  types: { key: string; is_hidden?: boolean }[],
): boolean {
  if (!user) return false;
  if (user.permissions?.["*"]) return true;
  if (hasPermission(user.permissions, "inventory.create")) {
    const visible = types.filter((t) => !t.is_hidden);
    if (visible.length === 0) return true; // not loaded yet — no flicker
    return visible.some((t) => hasTypePermission(user, "inventory.create", t.key));
  }
  return Object.values(user.type_permissions ?? {}).some(
    (cells) => cells["inventory.create"] === true && cells[VIEW_PERMISSION] !== false,
  );
}

export default function RequirePermission({ permission, children }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { user } = useAuthContext();

  if (hasPermission(routePermissionsFor(user), permission)) {
    return <>{children}</>;
  }

  return (
    <Box sx={{ maxWidth: 640, mx: "auto", mt: { xs: 4, sm: 8 }, px: 2 }}>
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Stack alignItems="center" spacing={2}>
          <MaterialSymbol icon="block" size={56} color="#888" />
          <Typography variant="h5" fontWeight={600}>
            {t("accessDenied.title")}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t("accessDenied.body")}
          </Typography>
          <Button variant="contained" onClick={() => navigate("/")} sx={{ mt: 1 }}>
            {t("moduleDisabled.backToDashboard")}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
