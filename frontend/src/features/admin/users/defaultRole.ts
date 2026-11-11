/**
 * The role a newly created user starts on: the one flagged as default in
 * Admin → Users & Roles → Roles, or `member` when none is. Mirrors
 * `_default_role_key` in `backend/app/api/v1/auth.py`, which is what the API
 * applies when `POST /users` carries no role.
 */

export interface DefaultRoleCandidate {
  key: string;
  is_default: boolean;
  is_archived: boolean;
}

export const FALLBACK_ROLE_KEY = "member";

export function defaultRoleKey(roles: readonly DefaultRoleCandidate[]): string {
  return roles.find((r) => r.is_default && !r.is_archived)?.key ?? FALLBACK_ROLE_KEY;
}
