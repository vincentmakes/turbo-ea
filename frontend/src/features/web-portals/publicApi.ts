/**
 * The fetch helper for account-less portal endpoints.
 *
 * Deliberately not the app's `api` client: a portal visitor has no JWT, and the
 * public routes authenticate (when the portal is SSO-gated) with an httpOnly,
 * path-scoped session cookie instead. This lives in its own module so more than
 * one portal view can use it without importing `PortalViewer` — which would be a
 * cycle, since `PortalViewer` is what chooses between those views.
 */

const BASE = "/api/v1";

export type ApiError = Error & { status?: number };

/**
 * GET a public portal endpoint.
 *
 * `credentials: "same-origin"` so the httpOnly portal-session cookie is sent to
 * the path-scoped public endpoints of an SSO-gated portal. The thrown error
 * keeps `res.status`, which is what lets callers tell `401 portal_locked` (show
 * the sign-in gate) from a genuine failure.
 */
export async function publicGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const e = new Error(err.detail || res.statusText) as ApiError;
    e.status = res.status;
    throw e;
  }
  return res.json();
}
