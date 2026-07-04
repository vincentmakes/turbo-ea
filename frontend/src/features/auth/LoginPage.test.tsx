import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "./LoginPage";
import { _resetLoginBrandingCache, invalidateLoginBranding } from "@/hooks/useLoginBranding";

// ---------------------------------------------------------------------------
// Mock the API client — LoginPage calls auth.ssoConfig() on mount
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  auth: {
    ssoConfig: vi.fn(),
  },
  api: {
    get: vi.fn().mockResolvedValue({ app_title: "Turbo EA" }),
  },
}));

import { auth } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  _resetLoginBrandingCache();
  // LoginPage caches the resolved SSO config in sessionStorage; clear it so
  // each test starts from a cold "loading" state and doesn't inherit another
  // test's config.
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onLogin = vi.fn();
const onRegister = vi.fn();

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage onLogin={onLogin} onRegister={onRegister} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  it("renders email and password fields", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });

    renderLogin();

    // The form appears once the SSO config resolves (a spinner shows first).
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
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
      provider: "microsoft",
      provider_name: "Microsoft",
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

    await user.type(await screen.findByLabelText(/email/i), "test@example.com");
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

    await user.type(await screen.findByLabelText(/email/i), "bad@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });
  });

  it("shows SSO button when SSO is configured", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({
      enabled: true,
      provider: "microsoft",
      provider_name: "Microsoft",
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

  // ---------------------------------------------------------------------
  // Login-page branding customizations
  // ---------------------------------------------------------------------

  it("hides the 'Forgot password?' link when SMTP is not configured", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });
    invalidateLoginBranding({
      tagline: "",
      taglineHidden: false,
      helpText: "",
      helpLink: "",
      smtpConfigured: false,
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
  });

  it("shows the 'Forgot password?' link when SMTP is configured", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });
    invalidateLoginBranding({
      tagline: "",
      taglineHidden: false,
      helpText: "",
      helpLink: "",
      smtpConfigured: true,
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
    });
  });

  it("renders the admin tagline override instead of the translated default", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });
    invalidateLoginBranding({
      tagline: "Our internal EA platform",
      taglineHidden: false,
      helpText: "",
      helpLink: "",
      smtpConfigured: false,
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByText("Our internal EA platform")).toBeInTheDocument();
    });
    // The default translated tagline must not appear when an override is set.
    expect(
      screen.queryByText("Enterprise Architecture Management"),
    ).not.toBeInTheDocument();
  });

  it("hides the tagline entirely when taglineHidden is true", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });
    invalidateLoginBranding({
      tagline: "Should not appear",
      taglineHidden: true,
      helpText: "",
      helpLink: "",
      smtpConfigured: false,
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Should not appear")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Enterprise Architecture Management"),
    ).not.toBeInTheDocument();
  });

  it("renders the help text and turns a bare email into a mailto: link", async () => {
    vi.mocked(auth.ssoConfig).mockResolvedValueOnce({ enabled: false });
    invalidateLoginBranding({
      tagline: "",
      taglineHidden: false,
      helpText: "Trouble signing in? Contact IT support.",
      helpLink: "support@example.com",
      smtpConfigured: false,
    });

    renderLogin();

    await waitFor(() => {
      expect(
        screen.getByText("Trouble signing in? Contact IT support."),
      ).toBeInTheDocument();
    });
    const link = screen.getByText("support@example.com").closest("a")!;
    expect(link).toHaveAttribute("href", "mailto:support@example.com");
  });
});
