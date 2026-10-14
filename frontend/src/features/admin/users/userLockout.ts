/**
 * Account-lockout state for the Users admin grid.
 *
 * Five failed passwords lock a local account for a while (`locked_until`, set
 * by the backend). The lock lapses on its own, so a stored timestamp in the
 * past is not a lock: only a future one shows the Locked chip and offers
 * Unlock (`POST /users/{id}/unlock`).
 */
export interface LockoutRow {
  locked_until?: string | null;
}

export function isLocked(row: LockoutRow, now: number = Date.now()): boolean {
  if (!row.locked_until) return false;
  const until = Date.parse(row.locked_until);
  return Number.isFinite(until) && until > now;
}
