import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SsoCallback from "./SsoCallback";

const onSsoCallback = vi.fn();

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
      expect(sessionStorage.getItem("portal_silent_myportal")).toBe("failed");
    });
    expect(onSsoCallback).not.toHaveBeenCalled();
    expect(screen.queryByText(/state mismatch/i)).not.toBeInTheDocument();
  });
});
