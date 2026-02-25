const BASE = "/api/v1";

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
  get: <T>(path: string) => request<T>(path),
  getRaw: (path: string) => requestRaw(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, file: File, fieldName = "file") => {
    const form = new FormData();
    form.append(fieldName, file);
    return fetch(`${BASE}${path}`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
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
  logout: () => api.post<{ ok: boolean }>("/auth/logout"),
  ssoConfig: () =>
    api.get<{
      enabled: boolean;
      client_id?: string;
      tenant_id?: string;
      authorization_endpoint?: string;
    }>("/auth/sso/config"),
  ssoCallback: (code: string, redirect_uri: string) =>
    api.post<{ access_token: string }>("/auth/sso/callback", { code, redirect_uri }),
  setPassword: (token: string, password: string) =>
    api.post<{ access_token: string }>("/auth/set-password", { token, password }),
};
