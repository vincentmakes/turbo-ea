/**
 * Self-lockout guards for the Users admin grid.
 *
 * An administrator who demotes or deactivates their own account loses the
 * admin UI in the same click, and only *another* administrator can undo it.
 * The backend refuses both (`PATCH /users/{id}` and `PATCH /users/bulk`);
 * these predicates are what keep the UI from offering the action in the first
 * place, so the API error stays a safety net rather than a dead end.
 *
 * Every predicate reads the **row** rather than the signed-in user's own
 * `role`: `GET /auth/me` reports the *effective* role during a role
 * impersonation session, whereas the row carries the stored one.
 */

export interface SelfGuardRow {
  id: string;
  role: string;
  is_active: boolean;
}

export const isSelfRow = (currentUserId: string | undefined, rowId: string): boolean =>
  !!currentUserId && currentUserId === rowId;

/** An administrator may not demote themselves — another administrator must. */
export const isOwnRoleLocked = (
  currentUserId: string | undefined,
  row: Pick<SelfGuardRow, "id" | "role">,
): boolean => isSelfRow(currentUserId, row.id) && row.role === "admin";

/** Nobody may deactivate their own account, whatever their role. */
export const isOwnDeactivateLocked = (
  currentUserId: string | undefined,
  row: Pick<SelfGuardRow, "id" | "is_active">,
): boolean => isSelfRow(currentUserId, row.id) && row.is_active;

/**
 * Ids to send for a bulk role change, minus the caller's own row when the
 * change would demote them. Selecting yourself alongside fifty others is an
 * ordinary thing to do, so the rest of the selection still goes through and
 * the caller is told what was left out.
 */
export const excludeSelfFromBulkRoleChange = (
  currentUserId: string | undefined,
  selectedIds: string[],
  rows: Pick<SelfGuardRow, "id" | "role">[],
  newRole: string,
): { ids: string[]; skippedSelf: boolean } => {
  const own = rows.find((r) => isSelfRow(currentUserId, r.id));
  const demotesSelf =
    !!own && selectedIds.includes(own.id) && own.role === "admin" && newRole !== "admin";
  return demotesSelf
    ? { ids: selectedIds.filter((id) => id !== own.id), skippedSelf: true }
    : { ids: selectedIds, skippedSelf: false };
};

/** Ids to send for a bulk deactivate, minus the caller's own row. */
export const excludeSelfFromBulkDeactivate = (
  currentUserId: string | undefined,
  selectedIds: string[],
): { ids: string[]; skippedSelf: boolean } => {
  if (!currentUserId || !selectedIds.includes(currentUserId)) {
    return { ids: selectedIds, skippedSelf: false };
  }
  return { ids: selectedIds.filter((id) => id !== currentUserId), skippedSelf: true };
};
