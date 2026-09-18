/**
 * The SSO vocabulary shared by the account-less public pages — a web portal
 * (`/portal/{slug}`) and a published diagram (`/embed/diagram/{slug}`) — and
 * the `/auth/callback` route they both return to.
 *
 * Both pages send a visitor to the org IdP with the app's ordinary login
 * redirect URI, so an SSO-gated resource needs no extra IdP registration; the
 * OAuth `state` is what tells the shared callback which resource the round
 * trip belongs to. Two pages and one callback used to each carry their own
 * copy of this, which is how they drifted (#1126) — one definition now.
 *
 * The published diagram is the one page that runs **inside another site's
 * iframe**, and that changes the mechanics entirely:
 *
 * - The frame must never navigate itself to the IdP: every major provider
 *   serves its authorize endpoint with `X-Frame-Options: DENY`, `prompt=none`
 *   included, so the visitor sees the browser's "refused to display" page and
 *   never comes back. The sign-in runs in a **popup** instead (`popup: true`
 *   in the state), and the callback page relays the result to `window.opener`
 *   with `postMessage` rather than exchanging the code itself.
 * - The frame is the one that exchanges the code. Its session cookie is
 *   `Partitioned` (see `set_access_cookie` on the backend), keyed by the
 *   embedding site, so a cookie set by the popup — a top-level window on this
 *   origin — would land in a different partition and never reach the frame.
 * - The CSRF nonce is held in the page's own memory, not `sessionStorage`:
 *   the popup opens directly on the IdP so it inherits no storage, and two
 *   diagrams embedded on one wiki page would share one key. The message comes
 *   back to the very document that started the flow, so nothing needs to
 *   persist.
 */

import type { PortalGate } from "@/types";

export type PublicResourceKind = "portal" | "diagram";

/** What rides in the OAuth `state` parameter, base64-JSON encoded. */
export interface PublicResourceState {
  t: PublicResourceKind;
  slug: string;
  nonce: string;
  /** A `prompt=none` attempt: completes without UI when the visitor already
   *  has an IdP session, otherwise bounces straight back with an error. */
  silent?: boolean;
  /** The round trip runs in a popup the resource page opened; the callback
   *  relays the outcome to `window.opener` instead of exchanging the code. */
  popup?: boolean;
}

export type PublicSsoConfig = NonNullable<PortalGate["sso"]>;

/** The app's login redirect URI, shared by every public resource. */
export const PUBLIC_SSO_CALLBACK_PATH = "/auth/callback";

/** True when this document is rendered inside another browsing context. A
 *  cross-origin `window.top` throws in some embedders; a throw is a frame. */
export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function newNonce(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function encodeState(state: PublicResourceState): string {
  return btoa(JSON.stringify(state));
}

/** Decode a `state` parameter; `null` for anything that is not a public-
 *  resource state (a normal login callback carries an opaque CSRF token). */
export function parseState(raw: string | null): PublicResourceState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw));
    if (
      parsed &&
      (parsed.t === "portal" || parsed.t === "diagram") &&
      typeof parsed.slug === "string" &&
      typeof parsed.nonce === "string"
    ) {
      return parsed as PublicResourceState;
    }
  } catch {
    // Not base64 JSON — a normal login state.
  }
  return null;
}

/**
 * The IdP authorize URL for one attempt, or `null` when the gate config is
 * incomplete (the page then shows "SSO unavailable" rather than a dead link).
 * Provider-specific `extra_auth_params` (Google's `hd`) are applied last so
 * they win over the defaults.
 */
export function buildAuthorizeUrl(sso: PublicSsoConfig, state: PublicResourceState): string | null {
  if (!sso.authorization_endpoint || !sso.client_id) return null;
  const params = new URLSearchParams({
    client_id: sso.client_id,
    response_type: "code",
    redirect_uri: `${window.location.origin}${PUBLIC_SSO_CALLBACK_PATH}`,
    scope: sso.scopes || "openid email profile",
    response_mode: "query",
    state: encodeState(state),
  });
  if (state.silent) params.set("prompt", "none");
  if (sso.extra_auth_params) {
    Object.entries(sso.extra_auth_params).forEach(([k, v]) => params.set(k, v));
  }
  return `${sso.authorization_endpoint}?${params.toString()}`;
}

/** The message the callback page posts to its opener at the end of a popup
 *  round trip. Carries the raw outcome only — the opener verifies the nonce
 *  and does the exchange. */
export const PUBLIC_SSO_MESSAGE_TYPE = "turboea:public-sso";

export interface PublicSsoMessage {
  type: typeof PUBLIC_SSO_MESSAGE_TYPE;
  t: PublicResourceKind;
  slug: string;
  nonce: string;
  code: string | null;
  error: string | null;
}

/** Shape-check a `message` event's payload; the listener never trusts raw
 *  `event.data`. */
export function parsePublicSsoMessage(data: unknown): PublicSsoMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type !== PUBLIC_SSO_MESSAGE_TYPE) return null;
  if (m.t !== "portal" && m.t !== "diagram") return null;
  if (typeof m.slug !== "string" || typeof m.nonce !== "string") return null;
  const code = typeof m.code === "string" ? m.code : null;
  const error = typeof m.error === "string" ? m.error : null;
  return { type: PUBLIC_SSO_MESSAGE_TYPE, t: m.t, slug: m.slug, nonce: m.nonce, code, error };
}
