import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SsoCallback from "./SsoCallback";
import { SSO_RETURN_PATH_KEY } from "@/lib/returnPath";
import type { User } from "@/types";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));

const onSsoCallback = vi.fn();

function userWith(permissions: Record<string, boolean>): User {
  return {
    id: "u1",
    email: "u@example.com",
    display_name: "U",
    role: "member",
    is_active: true,
    permissions,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

function renderCallback(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${query}`]}>
      <SsoCallback onSsoCallback={onSsoCallback} />
    </MemoryRouter>,
  );
}

describe("SsoCallback — normal login", () => {
  it("exchanges the code when the returned state matches the stored one", async () => {
    sessionStorage.setItem("sso_login_state", "expected-state");
    onSsoCallback.mockResolvedValueOnce(undefined);

    renderCallback("?code=auth-code-123&state=expected-state");

    await waitFor(() => {
      expect(onSsoCallback).toHaveBeenCalledWith(
        "auth-code-123",
        `${window.location.origin}/auth/callback`,
      );
    });
    // Single-use: the stored state is consumed on the callback.
    expect(sessionStorage.getItem("sso_login_state")).toBeNull();
  });

  it("rejects the callback when the returned state does not match", async () => {
    sessionStorage.setItem("sso_login_state", "expected-state");

    renderCallback("?code=auth-code-123&state=tampered-state");

    expect(await screen.findByText(/state mismatch/i)).toBeInTheDocument();
    expect(onSsoCallback).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("sso_login_state")).toBeNull();
  });

  it("rejects the callback when no state was stored (e.g. flow not started here)", async () => {
    renderCallback("?code=auth-code-123&state=some-state");

    expect(await screen.findByText(/state mismatch/i)).toBeInTheDocument();
    expect(onSsoCallback).not.toHaveBeenCalled();
  });

  it("shows the IdP error and consumes the stored state", async () => {
    sessionStorage.setItem("sso_login_state", "expected-state");

    renderCallback(
      "?error=access_denied&error_description=User+cancelled&state=expected-state",
    );

    expect(await screen.findByText("User cancelled")).toBeInTheDocument();
    expect(onSsoCallback).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("sso_login_state")).toBeNull();
  });
});

describe("SsoCallback — portal flow routing", () => {
  it("routes a portal-shaped state to the portal branch, not login validation", async () => {
    // A portal state is base64 JSON with t:"portal" — must never hit the
    // normal-login state check even when no login state is stored.
    const portalState = btoa(
      JSON.stringify({ t: "portal", slug: "myportal", nonce: "abc" }),
    );

    renderCallback(`?code=auth-code-123&state=${encodeURIComponent(portalState)}`);

    // The stored portal nonce is missing, so the portal branch flags the
    // silent-auth failure and bounces back to the portal page.
    await waitFor(() => {
      expect(sessionStorage.getItem("portal_silent_portal_myportal")).toBe("failed");
    });
    expect(onSsoCallback).not.toHaveBeenCalled();
    expect(screen.queryByText(/state mismatch/i)).not.toBeInTheDocument();
  });
});

describe("SsoCallback — where the user lands", () => {
  function signIn(returnPath: string | null, user: User | null) {
    sessionStorage.setItem("sso_login_state", "expected-state");
    if (returnPath) sessionStorage.setItem(SSO_RETURN_PATH_KEY, returnPath);
    onSsoCallback.mockResolvedValueOnce(user);
    renderCallback("?code=auth-code-123&state=expected-state");
  }

  it("goes to the dashboard when no deep link was stored", async () => {
    signIn(null, userWith({ "ppm.view": true }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("returns the user to the page they asked for", async () => {
    signIn("/ppm?tab=gantt", userWith({ "ppm.view": true }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/ppm?tab=gantt", { replace: true });
    });
  });

  it("falls back to the dashboard with an explanation when the role cannot open it", async () => {
    signIn("/ppm", userWith({ "inventory.view": true }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/", {
        replace: true,
        state: { deniedPath: "/ppm" },
      });
    });
  });

  it("is fail-closed when the sign-in resolves without a user", async () => {
    signIn("/ppm", null);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/", {
        replace: true,
        state: { deniedPath: "/ppm" },
      });
    });
  });

  it("ignores a hostile stored path entirely", async () => {
    signIn("//evil.com", userWith({ "*": true }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("consumes the stored path even when the state check fails", async () => {
    sessionStorage.setItem("sso_login_state", "expected-state");
    sessionStorage.setItem(SSO_RETURN_PATH_KEY, "/ppm");

    renderCallback("?code=auth-code-123&state=tampered-state");

    expect(await screen.findByText(/state mismatch/i)).toBeInTheDocument();
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBeNull();
  });

  it("leaves the stored path untouched on the portal branch", async () => {
    sessionStorage.setItem(SSO_RETURN_PATH_KEY, "/ppm");
    const portalState = btoa(
      JSON.stringify({ t: "portal", slug: "myportal", nonce: "abc" }),
    );

    renderCallback(`?code=auth-code-123&state=${encodeURIComponent(portalState)}`);

    await waitFor(() => {
      expect(sessionStorage.getItem("portal_silent_portal_myportal")).toBe("failed");
    });
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBe("/ppm");
  });
});
