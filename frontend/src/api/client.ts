const BASE = "/api/v1";

function getToken(): string | null {
  return localStorage.getItem("token");
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
    const msg = Array.isArray(err.detail)
      ? err.detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join("; ")
      : err.detail || res.statusText;
    throw new Error(msg);
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
  me: () => api.get<{ id: string; email: string; display_name: string; role: string }>("/auth/me"),
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
