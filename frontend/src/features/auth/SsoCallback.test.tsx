import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("SsoCallback — diagram popup relay (#1126)", () => {
  const diagramState = (extra: Record<string, unknown> = {}) =>
    encodeURIComponent(
      btoa(JSON.stringify({ t: "diagram", slug: "abc", nonce: "n-1", popup: true, ...extra })),
    );

  let originalOpener: unknown;
  let originalClose: typeof window.close;

  beforeEach(() => {
    originalOpener = window.opener;
    originalClose = window.close;
    window.close = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  afterEach(() => {
    Object.defineProperty(window, "opener", { value: originalOpener, configurable: true });
    window.close = originalClose;
    vi.restoreAllMocks();
  });

  it("relays the code to the opener and closes, without exchanging or navigating", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });

    renderCallback(`?code=authz-code&state=${diagramState()}`);

    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "turboea:public-sso",
        t: "diagram",
        slug: "abc",
        nonce: "n-1",
        code: "authz-code",
        error: null,
      },
      window.location.origin,
    );
    expect(window.close).toHaveBeenCalled();
    // The opener verifies the nonce and does the exchange; this window must
    // not — its cookie would land in the wrong partition.
    expect(fetch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(onSsoCallback).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("portal_silent_diagram_abc")).toBeNull();
    expect(await screen.findByText(/you can close this window/i)).toBeInTheDocument();
  });

  it("relays an IdP error the same way", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });

    renderCallback(`?error=access_denied&state=${diagramState()}`);

    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls[0][0]).toMatchObject({ code: null, error: "access_denied" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to signing in right here when there is no opener", async () => {
    Object.defineProperty(window, "opener", { value: null, configurable: true });
    sessionStorage.setItem("portal_sso_nonce", "n-1");

    renderCallback(`?code=authz-code&state=${diagramState()}`);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/v1/diagrams/public/abc/sso/callback");
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/embed/diagram/abc", { replace: true }),
    );
    expect(window.close).not.toHaveBeenCalled();
  });

  it("sends a denied diagram visitor back to the diagram, not to a portal", async () => {
    Object.defineProperty(window, "opener", { value: null, configurable: true });
    sessionStorage.setItem("portal_sso_nonce", "n-1");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Your account is not allowed." }), { status: 403 }),
    );

    renderCallback(`?code=authz-code&state=${diagramState({ popup: false })}`);

    expect(await screen.findByText("Your account is not allowed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(navigate).toHaveBeenCalledWith("/embed/diagram/abc", { replace: true });
  });
});
