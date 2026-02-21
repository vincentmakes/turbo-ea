import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    ssoCallback: vi.fn(),
    setPassword: vi.fn(),
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

import { auth, setToken, clearToken } from "@/api/client";
import { useAuth } from "./useAuth";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("useAuth", () => {
  it("initial state has null user when no token", async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });

  it("loads user on mount when token exists", async () => {
    sessionStorage.setItem("token", "existing-jwt");
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

  it("logout clears token and user", async () => {
    sessionStorage.setItem("token", "existing-jwt");
    vi.mocked(auth.me).mockResolvedValueOnce({
      id: "u1",
      email: "a@b.com",
      display_name: "Alice",
      role: "admin",
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.user).not.toBeNull();
    });

    act(() => {
      result.current.logout();
    });

    expect(clearToken).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it("clears token when loadUser fails", async () => {
    sessionStorage.setItem("token", "bad-jwt");
    vi.mocked(auth.me).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(clearToken).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });
});
