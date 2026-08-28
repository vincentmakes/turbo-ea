import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  // `api` is consumed by loadUiExtensions(), which useAuth fires and forgets
  // after login; without this export the extension host's property access
  // rejects as an unhandled error and fails the whole vitest run.
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    ssoCallback: vi.fn(),
    setPassword: vi.fn(),
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
  hasToken: vi.fn(),
  setAuthenticated: vi.fn(),
}));

import { auth, setToken, clearToken, setAuthenticated } from "@/api/client";
import { registerExtension, getRegisteredExtensions } from "@/lib/extensionHost";
import { useAuth } from "./useAuth";

beforeEach(() => {
  vi.clearAllMocks();
  // By default, auth.me rejects (no valid cookie)
  vi.mocked(auth.me).mockRejectedValue(new Error("Unauthorized"));
});

describe("useAuth", () => {
  it("initial state has null user when cookie is missing", async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });

  it("loads user on mount when cookie is present", async () => {
    vi.mocked(auth.me).mockResolvedValueOnce({
      id: "u1",
      email: "a@b.com",
      display_name: "Alice",
      role: "admin",
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(auth.me).toHaveBeenCalled();
    expect(setAuthenticated).toHaveBeenCalledWith(true);
    expect(result.current.user).toEqual(
      expect.objectContaining({ id: "u1", email: "a@b.com" }),
    );
  });

  it("login stores token and fetches user", async () => {
    vi.mocked(auth.login).mockResolvedValueOnce({
      access_token: "jwt-new",
    });
    vi.mocked(auth.me).mockResolvedValue({
      id: "u2",
      email: "b@c.com",
      display_name: "Bob",
      role: "member",
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.login("b@c.com", "pass123");
    });

    expect(auth.login).toHaveBeenCalledWith("b@c.com", "pass123");
    expect(setToken).toHaveBeenCalledWith("jwt-new");
  });

  it("logout clears auth state and calls backend", async () => {
    vi.mocked(auth.me).mockResolvedValueOnce({
      id: "u1",
      email: "a@b.com",
      display_name: "Alice",
      role: "admin",
    });
    vi.mocked(auth.logout).mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.user).not.toBeNull();
    });

    // Simulate the previous user's extension having registered a plugin.
    registerExtension("prev-user-ext", { key: "prev-user-ext", sdkVersion: "1.3" });
    expect(getRegisteredExtensions()).toHaveLength(1);

    await act(async () => {
      await result.current.logout();
    });

    expect(auth.logout).toHaveBeenCalled();
    expect(clearToken).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    // The extension host is reset so the next login re-loads its own bundles.
    expect(getRegisteredExtensions()).toHaveLength(0);
  });

  it("clears auth state when loadUser fails", async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(setAuthenticated).toHaveBeenCalledWith(false);
    expect(result.current.user).toBeNull();
  });
});

describe("useAuth — SSO landing support", () => {
  const USER = {
    id: "1",
    email: "sso@example.com",
    display_name: "SSO User",
    role: "member",
    permissions: { "ppm.view": true },
  };

  it("resolves ssoCallback with the signed-in user, so the caller can check permissions", async () => {
    vi.mocked(auth.ssoCallback).mockResolvedValue({ access_token: "tok" });
    vi.mocked(auth.me).mockResolvedValue(USER);

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let signedIn: unknown;
    await act(async () => {
      signedIn = await result.current.ssoCallback("code", "https://app/auth/callback");
    });

    expect(signedIn).toMatchObject({ id: "1", permissions: { "ppm.view": true } });
  });

  it("resolves ssoCallback with null when the profile fetch fails", async () => {
    vi.mocked(auth.ssoCallback).mockResolvedValue({ access_token: "tok" });
    vi.mocked(auth.me).mockRejectedValue(new Error("Unauthorized"));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let signedIn: unknown = "unset";
    await act(async () => {
      signedIn = await result.current.ssoCallback("code", "https://app/auth/callback");
    });

    expect(signedIn).toBeNull();
  });

  it("drops any remembered deep link on logout", async () => {
    vi.mocked(auth.me).mockResolvedValue(USER);
    sessionStorage.setItem("turboea_sso_return_path", "/ppm");

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });

    expect(sessionStorage.getItem("turboea_sso_return_path")).toBeNull();
  });
});
