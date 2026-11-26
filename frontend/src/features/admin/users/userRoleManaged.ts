/**
 * Directory-managed roles in the Users admin.
 *
 * While an SSO role map is in force, the identity provider sets an SSO
 * account's role at every sign-in, and the API refuses a manual change to it
 * (`PATCH /users/{id}`, `PATCH /users/bulk`). The admin payloads flag such an
 * account with `role_managed_externally`; these helpers keep the UI from
 * offering the change, so the API error stays a safety net.
 */
import type { User } from "@/types";

type ManagedRow = Pick<User, "id" | "role" | "role_managed_externally">;

/** Whether the directory sets this account's role. */
export const isRoleManagedExternally = (
  row: Pick<User, "role_managed_externally">,
): boolean => row.role_managed_externally === true;

/**
 * The role lock in the edit dialog. The server judges the account's sign-in
 * method after the edit, so switching a managed account to local sign-in
 * lifts the lock in the same save.
 */
export const isRoleLockedInEdit = (
  row: Pick<User, "role_managed_externally"> | null,
  formAuthProvider: string,
): boolean => !!row && isRoleManagedExternally(row) && formAuthProvider === "sso";

/**
 * Ids to send for a bulk role change, minus the directory-managed accounts
 * whose role it would change (the API refuses the whole batch otherwise). A
 * managed account that already holds the role is no change and stays in.
 */
export const excludeManagedFromBulkRoleChange = (
  selectedIds: string[],
  rows: ManagedRow[],
  newRole: string,
): { ids: string[]; skippedManaged: number } => {
  const blocked = new Set(
    rows.filter((r) => isRoleManagedExternally(r) && r.role !== newRole).map((r) => r.id),
  );
  const ids = selectedIds.filter((id) => !blocked.has(id));
  return { ids, skippedManaged: selectedIds.length - ids.length };
};
