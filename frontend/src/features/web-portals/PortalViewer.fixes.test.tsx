/**
 * PortalViewer regressions for the bugs a mutation pass surfaced: English
 * fallbacks and "+s" plurals in the item count and the relation filter, an old
 * slug's silent sign-in still redirecting after an in-app slug change, the new
 * slug queried with the old portal's relation types, "No results found"
 * flashing before the first card query, the raw approval enum on tiles and in
 * the detail dialog, and a failed card query that said nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router";

vi.mock("@/api/client", () => {
  const boom = () => {
    throw new Error("A portal must never call the authenticated API client");
  };
  return { api: { get: boom, post: boom, patch: boom, put: boom, delete: boom } };
});
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({
    formatDate: (d: string) => d,
    formatDateTime: (d: string) => d,
    dateFormat: "iso",
  }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => {
    throw new Error("A portal must never read the metamodel");
  },
}));

const publicGet = vi.fn();
vi.mock("@/features/web-portals/publicApi", () => ({
  publicGet: (...a: unknown[]) => publicGet(...a),
}));
vi.mock("@/features/web-portals/PortalPpmPortfolio", () => ({ default: () => null }));
vi.mock("@/features/web-portals/PortalProcessNavigator", () => ({ default: () => null }));
vi.mock("@/components/TagPicker", () => ({ default: () => null }));

import PortalViewer from "./PortalViewer";
import type { PortalCard, PortalGate, PublicPortal } from "@/types";

const SLUG = "caps";

const REL_TYPES = [
  {
    key: "relAppToITC",
    label: "uses",
    reverse_label: "is used by",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    other_type_key: "ITComponent",
    other_type_label: "IT Component",
  },
  {
    key: "relAppToITCRuns",
    label: "runs on",
    reverse_label: "hosts",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    other_type_key: "ITComponent",
    other_type_label: "IT Component",
  },
];

const ORG_REL = {
  key: "relOrgToApp",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
  other_type_key: "Organization",
  other_type_label: "Organization",
};

function portal(overrides: Partial<PublicPortal> = {}): PublicPortal {
  return {
    id: "p1",
    name: "Capability Landscape",
    slug: SLUG,
    card_type: "BusinessCapability",
    view: "cards",
    card_config: {
      toggles: {
        approval_status: { card: true, detail: true },
        "rel:relAppToITC": { card: true, detail: true },
        "rel:relAppToITCRuns": { card: true, detail: true },
        "rel:relOrgToApp": { card: true, detail: true },
      },
    },
    type_info: {
      key: "BusinessCapability",
      label: "Business Capability",
      icon: "account_tree",
      color: "#003399",
      subtypes: [],
      fields_schema: [],
    },
    relation_types: REL_TYPES,
    tag_groups: [],
    ...overrides,
  } as unknown as PublicPortal;
}

function card(overrides: Partial<PortalCard> = {}): PortalCard {
  return {
    id: "c1",
    name: "Customer Management",
    type: "BusinessCapability",
    subtype: null,
    description: "",
    lifecycle: undefined,
    attributes: {},
    approval_status: "APPROVED",
    data_quality: 80,
    tags: [],
    relations: [],
    stakeholders: [],
    updated_at: "2026-09-01",
    logo_updated_at: null,
    ...overrides,
  } as unknown as PortalCard;
}

const PUBLIC_GATE: PortalGate = { access_mode: "public", name: "Capability Landscape" };
const SSO_GATE: PortalGate = {
  access_mode: "sso",
  name: "Restricted Portal",
  sso: {
    provider_name: "Entra ID",
    client_id: "client-1",
    authorization_endpoint: "https://idp.example.com/authorize",
  },
};

function httpError(status: number, message = `http ${status}`) {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

interface Site {
  gate?: unknown;
  portal?: unknown;
  cards?: unknown;
}

let sites: Record<string, Site> = {};

function serve(slug: string, site: Site = {}) {
  sites[slug] = site;
}

function reply(r: unknown): Promise<unknown> {
  return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
}

function handle(path: string): Promise<unknown> {
  for (const [slug, site] of Object.entries(sites)) {
    const base = `/web-portals/public/${slug}`;
    if (path === `${base}/gate`) return reply("gate" in site ? site.gate : PUBLIC_GATE);
    if (path === base) return reply("portal" in site ? site.portal : portal());
    if (path.startsWith(`${base}/cards?`)) {
      const c = "cards" in site ? site.cards : { items: [card()], total: 1 };
      return typeof c === "function" ? (c as () => Promise<unknown>)() : reply(c);
    }
    if (path.startsWith(`${base}/relation-options?type_key=`)) {
      return Promise.resolve([{ id: "i1", name: "HANA DB" }]);
    }
  }
  return Promise.reject(new Error(`unexpected request ${path}`));
}

function paths(): string[] {
  return publicGet.mock.calls.map((c) => c[0] as string);
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

let navigateTo: NavigateFunction;
function NavGrab() {
  navigateTo = useNavigate();
  return null;
}

function renderPortal(slug = SLUG) {
  return render(
    <MemoryRouter initialEntries={[`/portal/${slug}`]}>
      <NavGrab />
      <Routes>
        <Route path="/portal/:slug" element={<PortalViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sites = {};
  publicGet.mockReset();
  publicGet.mockImplementation(handle);
  serve(SLUG);
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("PortalViewer item count and labels", () => {
  it("names the item count without pluralising the type label", async () => {
    serve(SLUG, { cards: { items: [card(), card({ id: "c2", name: "Billing" })], total: 2 } });
    renderPortal();
    expect(await screen.findByText("Business Capability: 2")).toBeInTheDocument();
    expect(screen.queryByText(/Capabilitys/)).toBeNull();
  });

  it("names the items generically, and translated, when the portal carries no type info", async () => {
    serve(SLUG, { portal: portal({ type_info: null } as unknown as Partial<PublicPortal>) });
    renderPortal();
    expect(await screen.findByText("Items: 1")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search Items...")).toBeInTheDocument();
    expect(screen.queryByText(/ item$/)).toBeNull();
  });

  it("offers each relation filter's empty choice without pluralising its label", async () => {
    const user = userEvent.setup();
    renderPortal();
    await screen.findByText("Customer Management");
    await user.click(screen.getByRole("button", { name: "tune" }));
    await user.click(await screen.findByRole("combobox", { name: /IT Component · runs on/ }));
    expect(
      await screen.findByRole("option", { name: "IT Component · runs on: all", selected: true }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /ons$/ })).toBeNull();
  });
});

describe("PortalViewer slug change", () => {
  let originalLocation: Location;

  beforeEach(() => {
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

  it("never starts the old slug's silent sign-in once the visitor has moved on", async () => {
    const portalA = deferred();
    serve("a", { gate: SSO_GATE, portal: portalA.promise });
    serve("b", { portal: portal({ name: "Beta Portal" }) });
    renderPortal("a");
    await waitFor(() => expect(paths()).toContain("/web-portals/public/a"));
    act(() => {
      navigateTo("/portal/b");
    });
    await screen.findByText("Beta Portal");
    await act(async () => {
      portalA.reject(httpError(401));
      await settle();
    });
    expect(window.location.href).toBe("");
    expect(sessionStorage.getItem("portal_silent_portal_a")).toBeNull();
    expect(sessionStorage.getItem("portal_sso_nonce")).toBeNull();
  });

  it("queries nothing for the new slug until its own portal has loaded", async () => {
    const gateB = deferred();
    serve("a", { portal: portal({ name: "Alpha Portal" }) });
    serve("b", { gate: gateB.promise, portal: portal({ name: "Beta Portal", relation_types: [ORG_REL] }) });
    renderPortal("a");
    await screen.findByText("Alpha Portal");
    await waitFor(() => expect(paths().some((p) => p.includes("/a/relation-options"))).toBe(true));
    act(() => {
      navigateTo("/portal/b");
    });
    await waitFor(() => expect(paths()).toContain("/web-portals/public/b/gate"));
    await act(async () => {
      await settle();
    });
    expect(paths().filter((p) => p.startsWith("/web-portals/public/b/cards"))).toHaveLength(0);
    expect(paths().filter((p) => p.startsWith("/web-portals/public/b/relation-options"))).toHaveLength(0);
    await act(async () => {
      gateB.resolve(PUBLIC_GATE);
    });
    expect(await screen.findByText("Beta Portal")).toBeInTheDocument();
    await waitFor(() =>
      expect(paths().filter((p) => p.startsWith("/web-portals/public/b/cards"))).toHaveLength(1),
    );
    // Only the new portal's own relation types are asked about.
    await waitFor(() =>
      expect(paths().filter((p) => p.startsWith("/web-portals/public/b/relation-options"))).toEqual([
        "/web-portals/public/b/relation-options?type_key=Organization",
      ]),
    );
  });
});

describe("PortalViewer card grid", () => {
  it("never says 'no results' before the first card query has answered", async () => {
    const seen: string[] = [];
    const cards = deferred();
    serve(SLUG, {
      cards: () => {
        seen.push(document.body.textContent ?? "");
        return cards.promise;
      },
    });
    renderPortal();
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).not.toContain("No results found");
    await act(async () => {
      cards.resolve({ items: [], total: 0 });
    });
    expect(await screen.findByText("No results found")).toBeInTheDocument();
  });

  it("says the cards could not be loaded instead of 'no results'", async () => {
    serve(SLUG, { cards: new Error("cards exploded") });
    renderPortal();
    expect(await screen.findByText("cards exploded")).toBeInTheDocument();
    expect(screen.queryByText("No results found")).toBeNull();
    // In an error banner, spaced off the grid below it.
    const alert = screen.getByText("cards exploded").closest(".MuiAlert-root") as HTMLElement;
    expect(alert).toHaveClass("MuiAlert-standardError");
    expect(alert).toHaveStyle({ marginBottom: "16px" });
  });

  it("says something went wrong when the card query fails without a message", async () => {
    serve(SLUG, { cards: () => Promise.reject("offline") });
    renderPortal();
    const alert = (await screen.findByText("Something went wrong")).closest(".MuiAlert-root");
    expect(alert).toHaveClass("MuiAlert-standardError");
    expect(screen.queryByText("No results found")).toBeNull();
  });

  it("shows no error banner over the grid, from its first paint to its loaded cards", async () => {
    const alertsSeen: number[] = [];
    const cards = deferred();
    serve(SLUG, {
      cards: () => {
        alertsSeen.push(document.querySelectorAll(".MuiAlert-root").length);
        return cards.promise;
      },
    });
    renderPortal();
    await waitFor(() => expect(alertsSeen).toHaveLength(1));
    expect(alertsSeen[0]).toBe(0);
    await act(async () => {
      cards.resolve({ items: [card()], total: 1 });
    });
    expect(await screen.findByText("Customer Management")).toBeInTheDocument();
    expect(document.querySelectorAll(".MuiAlert-root")).toHaveLength(0);
  });

  it("names the approval status in words on the tile and in the detail dialog", async () => {
    const user = userEvent.setup();
    serve(SLUG, {
      cards: {
        items: [card(), card({ id: "c2", name: "Billing", approval_status: "BROKEN" })],
        total: 2,
      },
    });
    renderPortal();
    await screen.findByText("Customer Management");
    const tile = within(screen.getByText("Customer Management").closest(".MuiCard-root") as HTMLElement);
    expect(tile.getByText("Approved")).toBeInTheDocument();
    expect(tile.queryByText("APPROVED")).toBeNull();
    const broken = within(screen.getByText("Billing").closest(".MuiCard-root") as HTMLElement);
    expect(broken.getByText("Broken")).toBeInTheDocument();
    await user.click(screen.getByText("Customer Management"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Approved")).toBeInTheDocument();
    expect(dialog.queryByText("APPROVED")).toBeNull();
  });
});
