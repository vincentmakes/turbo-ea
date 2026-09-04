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

/**
 * Check one of the four type-scoped inventory permissions
 * (`inventory.create` / `edit` / `archive` / `delete`) for a specific card type.
 *
 * A card type may override the role's landscape-wide grant either way, so the
 * order is: admin wildcard wins, then the type's stored cell, then the role's
 * global permission. An absent cell inherits — which is why every non-scoped
 * permission and every un-overridden type behaves exactly as before.
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
    const cell = user.type_permissions?.[typeKey]?.[permission];
    if (cell !== undefined) return cell;
  }
  return hasPermission(user.permissions, permission);
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
 * is answered by `type_permissions` alone, with no list needed.
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
    (cells) => cells["inventory.create"] === true,
  );
}

export default function RequirePermission({ permission, children }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { user } = useAuthContext();

  if (hasPermission(user?.permissions, permission)) {
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
