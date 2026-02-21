import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./LoginPage";

// ---------------------------------------------------------------------------
// Mock the API client — LoginPage calls auth.ssoConfig() on mount
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  auth: {
    ssoConfig: vi.fn(),
  },
}));

import { auth } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onLogin = vi.fn();
const onRegister = vi.fn();

function renderLogin() {
  return render(<LoginPage onLogin={onLogin} onRegister={onRegister} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  it("renders email and password fields", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });

    renderLogin();

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("shows Login/Register tabs when registration allowed", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({
      enabled: false,
      registration_enabled: true,
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /login/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /register/i })).toBeInTheDocument();
    });
  });

  it("hides Register tab when SSO is enabled", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({
      enabled: true,
      client_id: "abc",
      authorization_endpoint: "https://login.example.com/authorize",
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with microsoft/i)).toBeInTheDocument();
    });

    // Registration tabs should not be shown when SSO is enabled
    expect(screen.queryByRole("tab", { name: /register/i })).not.toBeInTheDocument();
  });

  it("calls onLogin with email and password on submit", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });
    onLogin.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    renderLogin();

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith("test@example.com", "secret123");
    });
  });

  it("calls onRegister with email, display name and password", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({
      enabled: false,
      registration_enabled: true,
    });
    onRegister.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    renderLogin();

    // Switch to register tab
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /register/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: /register/i }));

    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.type(screen.getByLabelText(/password/i), "pass456");
    await user.click(screen.getByRole("button", { name: /register/i }));

    await waitFor(() => {
      expect(onRegister).toHaveBeenCalledWith("new@example.com", "Alice", "pass456");
    });
  });

  it("shows error message when login fails", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });
    onLogin.mockRejectedValueOnce(new Error("Invalid credentials"));
    const user = userEvent.setup();

    renderLogin();

    await user.type(screen.getByLabelText(/email/i), "bad@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });
  });

  it("shows SSO button when SSO is configured", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({
      enabled: true,
      client_id: "my-client-id",
      authorization_endpoint: "https://login.microsoftonline.com/authorize",
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with microsoft/i)).toBeInTheDocument();
    });
    // Shows the divider text
    expect(screen.getByText(/or sign in with email/i)).toBeInTheDocument();
  });

  it("handles ssoConfig fetch failure gracefully", async () => {
    vi.mocked(auth.ssoConfig).mockRejectedValueOnce(new Error("network error"));

    renderLogin();

    // Should still render the login form despite SSO config failure
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
