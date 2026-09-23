/**
 * The published-diagram page's sign-in gate (#1126). Inside another site's
 * frame it must never navigate itself to the IdP — the sign-in is a popup
 * whose outcome comes back by `postMessage`, and the exchange is made from
 * the frame. Top-level it keeps the portal-style redirect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";

const publicGet = vi.fn();
const publicPost = vi.fn();
vi.mock("@/features/web-portals/publicApi", () => ({
  publicGet: (...a: unknown[]) => publicGet(...a),
  publicPost: (...a: unknown[]) => publicPost(...a),
}));

const framed = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/publicSso", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publicSso")>()),
  isFramed: () => framed.value,
}));

import PublicDiagramPage from "./PublicDiagramPage";
import { parseState, PUBLIC_SSO_MESSAGE_TYPE } from "@/lib/publicSso";

const SLUG = "abc123";
const GATE = {
  access_mode: "sso",
  name: "Landscape",
  sso: {
    provider: "microsoft",
    provider_name: "Microsoft",
    client_id: "client-1",
    authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    scopes: "openid email profile",
  },
};
const DIAGRAM = { name: "Landscape", xml: "<mxGraphModel/>" };

function locked() {
  return Object.assign(new Error("portal_locked"), { status: 401 });
}

/** gate → 401 on the diagram, then whatever `after` says on the next fetch. */
function mockLockedThen(after: () => Promise<unknown> = () => Promise.resolve(DIAGRAM)) {
  publicGet.mockImplementation((path: string) => {
    if (path.endsWith("/gate")) return Promise.resolve(GATE);
    if (publicGet.mock.calls.filter(([p]) => p === `/diagrams/public/${SLUG}`).length <= 1) {
      return Promise.reject(locked());
    }
    return after();
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/embed/diagram/${SLUG}`]}>
      <Routes>
        <Route path="/embed/diagram/:slug" element={<PublicDiagramPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openedUrl(): URL {
  const [url] = vi.mocked(window.open).mock.calls[0];
  return new URL(String(url));
}

function relay(overrides: Record<string, unknown> = {}, init: Partial<MessageEventInit> = {}) {
  const state = parseState(openedUrl().searchParams.get("state"))!;
  const data = {
    type: PUBLIC_SSO_MESSAGE_TYPE,
    t: "diagram",
    slug: SLUG,
    nonce: state.nonce,
    code: "authz-code",
    error: null,
    ...overrides,
  };
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: window,
        ...init,
      }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  framed.value = true;
  vi.spyOn(window, "open").mockReturnValue(window);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PublicDiagramPage — framed, SSO-gated", () => {
  it("shows the sign-in gate at once and never navigates the frame to the IdP", async () => {
    mockLockedThen();
    renderPage();

    expect(await screen.findByRole("button", { name: /sign in with microsoft/i })).toBeVisible();
    expect(screen.getByText("Landscape")).toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
    // No silent attempt was started, so nothing was flagged.
    expect(sessionStorage.getItem(`portal_silent_diagram_${SLUG}`)).toBeNull();
  });

  it("opens the IdP in a popup with a non-silent, popup-flagged state", async () => {
    mockLockedThen();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    expect(window.open).toHaveBeenCalledTimes(1);
    const url = openedUrl();
    expect(url.origin + url.pathname).toBe(GATE.sso.authorization_endpoint);
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.get("redirect_uri")).toBe(`${window.location.origin}/auth/callback`);
    const state = parseState(url.searchParams.get("state"))!;
    expect(state).toMatchObject({ t: "diagram", slug: SLUG, popup: true });
    expect(state.nonce).toBeTruthy();
    expect(await screen.findByText(/waiting for you to finish signing in/i)).toBeVisible();
  });

  it("exchanges the relayed code from the frame and renders the diagram", async () => {
    mockLockedThen();
    publicPost.mockResolvedValue({ ok: true });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    relay();

    await waitFor(() => {
      expect(publicPost).toHaveBeenCalledWith(`/diagrams/public/${SLUG}/sso/callback`, {
        code: "authz-code",
        redirect_uri: `${window.location.origin}/auth/callback`,
      });
    });
    expect(await screen.findByTitle("Landscape")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("ignores a relay from another origin, another window, or with the wrong nonce", async () => {
    mockLockedThen();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    relay({}, { origin: "https://evil.example" });
    relay({ nonce: "not-ours" });
    relay({ slug: "other" });
    relay({ type: "something-else" });
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    relay({}, { source: frame.contentWindow });
    frame.remove();

    // Still waiting on the popup — nothing was exchanged.
    expect(publicPost).not.toHaveBeenCalled();
    expect(screen.getByText(/waiting for you to finish signing in/i)).toBeVisible();
  });

  it("runs one exchange per popup, even if the message is replayed", async () => {
    mockLockedThen();
    publicPost.mockResolvedValue({ ok: true });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    relay();
    relay();

    await waitFor(() => expect(publicPost).toHaveBeenCalledTimes(1));
    await screen.findByTitle("Landscape");
    expect(publicPost).toHaveBeenCalledTimes(1);
  });

  it("returns to the button when the visitor cancels at the IdP", async () => {
    mockLockedThen();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    relay({ code: null, error: "access_denied" });

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeVisible();
    expect(publicPost).not.toHaveBeenCalled();
  });

  it("shows a refusal from the exchange instead of looping", async () => {
    mockLockedThen();
    publicPost.mockRejectedValue(
      Object.assign(new Error("Your account is not allowed to access this diagram."), {
        status: 403,
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    relay();

    expect(await screen.findByText(/not allowed to access this diagram/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  it("offers a new tab when the browser blocks the popup", async () => {
    mockLockedThen();
    vi.mocked(window.open).mockReturnValue(null);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/blocked the sign-in window/i)).toBeVisible();
    const link = screen.getByRole("link", { name: /open the diagram in a new tab/i });
    expect(link).toHaveAttribute("href", `/embed/diagram/${SLUG}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    // The button stays usable for a second try once popups are allowed.
    expect(screen.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  it("re-enables the button when the popup is closed without signing in", async () => {
    mockLockedThen();
    const popup = { closed: false } as Window;
    vi.mocked(window.open).mockReturnValue(popup);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/waiting for you to finish signing in/i)).toBeVisible();

    popup.closed = true;

    expect(
      await screen.findByRole("button", { name: /sign in/i }, { timeout: 2000 }),
    ).toBeVisible();
    expect(publicPost).not.toHaveBeenCalled();
  });
});

describe("PublicDiagramPage — top-level, SSO-gated", () => {
  let originalLocation: Location;

  beforeEach(() => {
    framed.value = false;
    // Stub window.location so the redirect assignment is capturable in jsdom.
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, origin: originalLocation.origin, href: "" },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("flags the silent attempt before leaving for the IdP", async () => {
    mockLockedThen();
    renderPage();

    await waitFor(() => expect(window.location.href).not.toBe(""));
    const url = new URL(window.location.href);
    expect(url.origin + url.pathname).toBe(GATE.sso.authorization_endpoint);
    expect(url.searchParams.get("prompt")).toBe("none");
    const state = parseState(url.searchParams.get("state"))!;
    expect(state).toMatchObject({ t: "diagram", slug: SLUG, silent: true });
    expect(state.popup).toBeUndefined();
    // Written before the navigation, so an attempt that never returns cannot
    // loop the page — and the callback can verify the nonce.
    expect(sessionStorage.getItem(`portal_silent_diagram_${SLUG}`)).toBe("pending");
    expect(sessionStorage.getItem("portal_sso_nonce")).toBe(state.nonce);
    expect(window.open).not.toHaveBeenCalled();
  });

  it("shows the gate instead of a second silent attempt once one has been tried", async () => {
    sessionStorage.setItem(`portal_silent_diagram_${SLUG}`, "failed");
    mockLockedThen();
    renderPage();

    expect(await screen.findByRole("button", { name: /sign in with microsoft/i })).toBeVisible();
    expect(window.location.href).toBe("");
  });

  it("signs in by navigation from the button", async () => {
    sessionStorage.setItem(`portal_silent_diagram_${SLUG}`, "failed");
    mockLockedThen();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));

    const url = new URL(window.location.href);
    expect(url.origin + url.pathname).toBe(GATE.sso.authorization_endpoint);
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(parseState(url.searchParams.get("state"))!.popup).toBeUndefined();
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe("PublicDiagramPage — public", () => {
  it("renders a public diagram with no gate at all", async () => {
    publicGet.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/gate") ? { access_mode: "public", name: "Open" } : DIAGRAM),
    );
    renderPage();
    expect(await screen.findByTitle("Landscape")).toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe("PublicDiagramPage — colour legend", () => {
  const CRITICALITY_TYPE = {
    key: "Application",
    label: "Application",
    translations: {},
    fields_schema: [
      {
        section: "",
        fields: [
          {
            key: "criticality",
            label: "Criticality",
            type: "single_select",
            translations: {},
            options: [
              {
                key: "high",
                label: "Highly critical",
                color: "#ff0000",
                translations: {},
              },
              {
                key: "low",
                label: "Barely critical",
                color: "#00ff00",
                translations: {},
              },
            ],
          },
        ],
      },
    ],
  };

  function mockPublic(legend: unknown) {
    publicGet.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("/gate")
          ? { access_mode: "public", name: "Open" }
          : { ...DIAGRAM, legend },
      ),
    );
  }

  it("renders the server's legend, read-only", async () => {
    mockPublic({
      kind: "card_fields",
      coloured: 3,
      rules: [
        {
          type_key: "Application",
          field_key: "criticality",
          has_missing: true,
        },
      ],
      types: [CRITICALITY_TYPE],
    });
    renderPage();
    expect(
      await screen.findByText("Application · Criticality"),
    ).toBeInTheDocument();
    expect(screen.getByText("Highly critical")).toBeInTheDocument();
    expect(screen.getByText("Barely critical")).toBeInTheDocument();
    expect(screen.getByText("No value")).toBeInTheDocument();
    expect(screen.getByText("3 cells colored")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows no 'no value' swatch when every card has a value", async () => {
    mockPublic({
      kind: "card_fields",
      coloured: 2,
      rules: [
        {
          type_key: "Application",
          field_key: "criticality",
          has_missing: false,
        },
      ],
      types: [CRITICALITY_TYPE],
    });
    renderPage();
    expect(await screen.findByText("Highly critical")).toBeInTheDocument();
    expect(screen.queryByText("No value")).toBeNull();
  });

  it("renders the approval-status scale", async () => {
    mockPublic({ kind: "approval_status", coloured: 4 });
    renderPage();
    expect(await screen.findByText("4 cells colored")).toBeInTheDocument();
  });

  it("renders no legend when the diagram is coloured by card type", async () => {
    mockPublic(null);
    renderPage();
    expect(await screen.findByTitle("Landscape")).toBeInTheDocument();
    expect(screen.queryByText(/cells? colored/)).toBeNull();
  });
});
