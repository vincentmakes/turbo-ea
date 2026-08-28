/**
 * Where the user was heading before they had to sign in.
 *
 * The login form renders *in place* at the requested URL (`App.tsx`'s
 * unauthenticated catch-all `path="*"`), so an email/password sign-in already
 * lands the user where they asked to go. SSO does not: it navigates the whole
 * document away to the identity provider and comes back at `/auth/callback`,
 * losing the original path. This module carries that path across the round
 * trip.
 *
 * The path is kept in `sessionStorage`, deliberately NOT in the OAuth `state`
 * parameter. `state` round-trips through the IdP and comes back
 * attacker-influenceable, which would make it an open-redirect vector; it also
 * lands in IdP request logs and in browser history. sessionStorage is
 * same-origin, same-tab, survives the full-page navigation, and is already the
 * established pattern here (`sso_login_state`, `portal_sso_nonce`,
 * `PROXY_SIGNOUT_KEY`).
 */

export const SSO_RETURN_PATH_KEY = "turboea_sso_return_path";

/** Longest path we are willing to round-trip. */
const MAX_LENGTH = 2048;

/**
 * Reduce an arbitrary string to a same-origin relative path, or `null`.
 *
 * Returning `null` is also the "no deep link" sentinel: `"/"` maps to `null`
 * so the dashboard case needs no separate branch at the call sites.
 */
export function sanitizeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null;
  // Must be a rooted relative path. Rejects "http(s)://…", "javascript:…",
  // "mailto:…" and bare "ppm" in one check.
  if (!raw.startsWith("/")) return null;
  // "//evil.com" is protocol-relative — a foreign origin.
  if (raw.startsWith("//")) return null;
  // Browsers normalise a backslash to a slash, so "/\evil.com" is "//evil.com".
  if (raw.includes("\\")) return null;
  // CR / LF / NUL and friends.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  // Belt and braces: `new URL` has now collapsed any "../" segments, so
  // re-check the origin it actually resolved to.
  if (url.origin !== window.location.origin) return null;

  const path = url.pathname + url.search + url.hash;

  // The dashboard is where we would send them anyway.
  if (path === "/") return null;
  // Redirecting back into the sign-in flow would loop it.
  if (path.startsWith("/auth/")) return null;
  // Published portals and diagrams run their own SSO gate; bouncing a user
  // login into one of them would be confusing, and they are reachable without
  // an app session anyway.
  if (path.startsWith("/portal/") || path.startsWith("/embed/")) return null;

  return path;
}

/**
 * Remember where to return to after the SSO round trip.
 *
 * Always writes or clears — never leaves a previous value in place. Otherwise
 * a user who opens `/ppm`, bounces to the IdP, cancels, navigates to `/` and
 * signs in again would be sent back to `/ppm` they had already abandoned.
 */
export function stashReturnPath(raw: string | null | undefined): void {
  const path = sanitizeReturnPath(raw);
  try {
    if (path) sessionStorage.setItem(SSO_RETURN_PATH_KEY, path);
    else sessionStorage.removeItem(SSO_RETURN_PATH_KEY);
  } catch {
    // sessionStorage can throw in private browsing modes — the deep link is a
    // convenience, never a requirement.
  }
}

/**
 * Read the stored return path and remove it, single-use like the CSRF nonce
 * it travels with.
 *
 * Re-sanitises on read so a value written by an older build is re-validated
 * against the current rules.
 */
export function consumeReturnPath(): string | null {
  try {
    const raw = sessionStorage.getItem(SSO_RETURN_PATH_KEY);
    sessionStorage.removeItem(SSO_RETURN_PATH_KEY);
    return sanitizeReturnPath(raw);
  } catch {
    return null;
  }
}

/** Drop any stored return path (used on sign-out). */
export function clearReturnPath(): void {
  try {
    sessionStorage.removeItem(SSO_RETURN_PATH_KEY);
  } catch {
    // See stashReturnPath.
  }
}
