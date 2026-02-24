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

// Token persisted in sessionStorage — scoped to the browser tab and cleared
// on tab close.  This survives page refreshes while still limiting exposure
// compared to localStorage.
const TOKEN_KEY = "token";

let _token: string | null = sessionStorage.getItem(TOKEN_KEY);

export function getToken(): string | null {
  return _token;
}

export function setToken(token: string): void {
  _token = token;
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  _token = null;
  sessionStorage.removeItem(TOKEN_KEY);
}

export function hasToken(): boolean {
  return _token !== null;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
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
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
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
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, { method: "POST", headers, body: form }).then(
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
