import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end pin for where an unauthenticated deep link lands.
 *
 * The whole deep-link feature rests on a contract that was previously
 * untested: `App`'s unauthenticated catch-all renders `LoginPage` *in place*,
 * without navigating, so the URL the user asked for survives an email/password
 * sign-in. These tests fail if anyone turns that catch-all into a redirect.
 */

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    ssoConfig: vi.fn().mockResolvedValue({ enabled: false }),
    ssoCallback: vi.fn(),
    setPassword: vi.fn(),
    proxySession: vi.fn().mockRejectedValue(new Error("no proxy")),
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
  hasToken: vi.fn(),
  setAuthenticated: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(false),
  getRaw: vi.fn(),
  upload: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/api/bootstrap", () => ({
  primeBootstrap: vi.fn().mockResolvedValue(undefined),
  resetBootstrap: vi.fn(),
}));

// Module flags are irrelevant here — permission gating is what is under test,
// and ModuleGate would otherwise sit on its loading spinner forever.
vi.mock("@/components/ModuleGate", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stub the two lazy pages these tests reach, so AG Grid / Recharts stay out of
// the suite.
vi.mock("@/features/dashboard/Dashboard", () => ({
  default: () => <div>dashboard page</div>,
}));
vi.mock("@/features/ppm/PpmHome", () => ({
  default: () => <div>ppm page</div>,
}));

import { auth } from "@/api/client";

import App from "./App";

const MEMBER = {
  id: "u1",
  email: "member@example.com",
  display_name: "Member",
  role: "member",
  is_active: true,
  permissions: { "ppm.view": true, "inventory.view": true },
};

const NO_PPM = { ...MEMBER, permissions: { "inventory.view": true } };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.pushState({}, "", "/ppm");
});

describe("deep link through sign-in", () => {
  it("shows the login form at the requested URL, without redirecting", async () => {
    vi.mocked(auth.me).mockRejectedValue(new Error("Unauthorized"));

    render(<App />);

    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/ppm");
  });

  it("lands on the requested page after an email/password sign-in", async () => {
    vi.mocked(auth.me).mockRejectedValueOnce(new Error("Unauthorized"));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByLabelText(/email/i);

    vi.mocked(auth.login).mockResolvedValue({ access_token: "tok" });
    vi.mocked(auth.me).mockResolvedValue(MEMBER);

    await user.type(screen.getByLabelText(/email/i), "member@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /^login$/i }));

    expect(await screen.findByText("ppm page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/ppm");
  });

  it("shows Access denied at that URL when the role cannot open the page", async () => {
    vi.mocked(auth.me).mockRejectedValueOnce(new Error("Unauthorized"));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByLabelText(/email/i);

    vi.mocked(auth.login).mockResolvedValue({ access_token: "tok" });
    vi.mocked(auth.me).mockResolvedValue(NO_PPM);

    await user.type(screen.getByLabelText(/email/i), "member@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /^login$/i }));

    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("ppm page")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/ppm");
  });

  it("still renders an ungated page for a role with nothing granted", async () => {
    window.history.pushState({}, "", "/");
    vi.mocked(auth.me).mockResolvedValue({ ...MEMBER, permissions: {} });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("dashboard page")).toBeInTheDocument();
    });
  });
});
