const BASE = "/api/v1";

/**
 * Options accepted by the read helpers. Deliberately narrower than `RequestInit`
 * so call sites can't override method / credentials / headers.
 */
export interface GetOptions {
  signal?: AbortSignal;
}

/**
 * True for a fetch aborted via an AbortSignal. A superseded request is not an
 * error — never surface one to the user.
 *
 * Matches on `name` rather than `instanceof DOMException` so it also holds under
 * jsdom/undici and for anything a test double throws.
 */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/** Error with HTTP status and structured detail from the API. */
export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

// Authentication is handled via httpOnly cookies set by the backend.
// The cookie is sent automatically by the browser on same-origin requests.
// These lightweight helpers track auth state in memory for the UI only —
// they never touch the actual token.
let _authenticated = false;

export function setAuthenticated(value: boolean): void {
  _authenticated = value;
}

export function isAuthenticated(): boolean {
  return _authenticated;
}

// Legacy aliases kept for minimal diff in useAuth / useEventStream.
export const setToken = (_token: string): void => {
  _authenticated = true;
};
export const clearToken = (): void => {
  _authenticated = false;
};
export const hasToken = (): boolean => _authenticated;

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Tag every web-UI request so the backend's audit log can
    // distinguish browser-driven writes from direct API calls and
    // MCP-driven AI writes. The middleware whitelists `web` / `api` /
    // `mcp`; anything else is dropped silently.
    "X-Turbo-EA-Origin": "web",
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    // FastAPI 422 returns detail as array of validation error objects
    const detail = err.detail;
    const msg = Array.isArray(detail)
      ? detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join("; ")
      : typeof detail === "string"
        ? detail
        : typeof detail === "object" && detail?.message
          ? detail.message
          : res.statusText;
    throw new ApiError(msg, res.status, detail);
  }
  return res.json();
}

async function requestRaw(path: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "X-Turbo-EA-Origin": "web",
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const msg = Array.isArray(err.detail)
      ? err.detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join("; ")
      : err.detail || res.statusText;
    throw new Error(msg);
  }
  return res;
}

export const api = {
  // Passing a `signal` means you own the resulting AbortError rejection.
  // Prefer the request hooks in `src/hooks/` (`useApiQuery`,
  // `useAbortableEffect`, `useLatestRequest`) — they abort the predecessor,
  // discard superseded responses and swallow the abort for you.
  //
  // Deliberately not offered on the mutating helpers: aborting a POST/PATCH
  // does not undo it server-side, so exposing `signal` there would advertise a
  // cancellation guarantee we cannot make.
  get: <T>(path: string, opts?: GetOptions) => request<T>(path, opts),
  getRaw: (path: string, opts?: GetOptions) => requestRaw(path, opts),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  upload: <T>(
    path: string,
    file: File,
    fieldName = "file",
    extraFields?: Record<string, string>,
  ) => {
    const form = new FormData();
    form.append(fieldName, file);
    if (extraFields) {
      for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
    }
    return fetch(`${BASE}${path}`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: { "X-Turbo-EA-Origin": "web" },
    }).then(
      async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          const msg = Array.isArray(err.detail)
            ? err.detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join("; ")
            : err.detail || res.statusText;
          throw new Error(msg);
        }
        return res.json() as Promise<T>;
      },
    );
  },
};

// Auth helpers
export const auth = {
  login: (email: string, password: string) =>
    api.post<{ access_token: string }>("/auth/login", { email, password }),
  register: (email: string, display_name: string, password: string) =>
    api.post<{ access_token: string }>("/auth/register", { email, display_name, password }),
  me: () => api.get<{
    id: string; email: string; display_name: string; role: string;
    role_label?: string; role_color?: string; locale?: string;
    permissions?: Record<string, boolean>;
  }>("/auth/me"),
  refresh: () => api.post<{ access_token: string }>("/auth/refresh"),
  impersonate: (role: string) =>
    api.post<{ access_token: string }>("/auth/impersonate", { role }),
  stopImpersonating: () => api.post<{ access_token: string }>("/auth/stop-impersonating"),
  logout: () => api.post<{ ok: boolean }>("/auth/logout"),
  ssoConfig: () =>
    api.get<{
      enabled: boolean;
      provider?: string;
      provider_name?: string;
      client_id?: string;
      authorization_endpoint?: string;
      scopes?: string;
      extra_auth_params?: Record<string, string>;
      registration_enabled?: boolean;
      local_login_available?: boolean;
    }>("/auth/sso/config"),
  ssoCallback: (code: string, redirect_uri: string) =>
    api.post<{ access_token: string }>("/auth/sso/callback", { code, redirect_uri }),
  setPassword: (token: string, password: string) =>
    api.post<{ access_token: string }>("/auth/set-password", { token, password }),
  forgotPassword: (email: string) =>
    api.post<{ ok: boolean }>("/auth/forgot-password", { email }),
  validateResetToken: (token: string) =>
    api.get<{ email: string }>(
      `/auth/validate-reset-token?token=${encodeURIComponent(token)}`,
    ),
  resetPassword: (token: string, password: string) =>
    api.post<{ ok: boolean }>("/auth/reset-password", { token, password }),
};
