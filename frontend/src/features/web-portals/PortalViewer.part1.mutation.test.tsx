/**
 * PortalViewer — the public, account-less portal page — on what the first
 * two suites left unpinned: the first paint, the SSO gate's edge configs, a
 * slug change racing the previous slug's requests, the exact card query the
 * filter bar sends (and the page reset every filter owes), the relation
 * filter's verbs and option loading, and the field renderers on a card tile.
 *
 * Same seams as `PortalViewer.test.tsx`: `publicGet` is the page's only
 * network, and it answers EXACT paths only, so a request for the wrong path
 * fails loudly instead of being served a portal by a catch-all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
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
vi.mock("@/features/web-portals/PortalPpmPortfolio", () => ({
  default: ({ slug }: { slug: string }) => <div data-testid="ppm-board">{slug}</div>,
}));
vi.mock("@/features/web-portals/PortalProcessNavigator", () => ({
  default: ({ slug }: { slug: string }) => <div data-testid="navigator-board">{slug}</div>,
}));
// The tag filter is a shared component with its own tests; here it only has
// to hand back one or two picked ids.
vi.mock("@/components/TagPicker", () => ({
  default: ({ onChange, label }: { onChange: (ids: string[]) => void; label?: string }) => (
    <div>
      <button type="button" onClick={() => onChange(["t1"])}>
        pick-one:{label}
      </button>
      <button type="button" onClick={() => onChange(["t1", "t2"])}>
        pick-two:{label}
      </button>
    </div>
  ),
}));

import PortalViewer from "./PortalViewer";
import { todayIsoDate } from "@/lib/dates";
import type { PortalCard, PortalGate, PublicPortal } from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = "apps";

const FIELDS = [
  {
    key: "criticality",
    label: "Criticality",
    type: "single_select",
    options: [
      { key: "high", label: "High", color: "#c62828" },
      { key: "low", label: "Low" },
    ],
  },
  {
    key: "platforms",
    label: "Platforms",
    type: "multiple_select",
    options: [
      { key: "web", label: "Web" },
      { key: "mobile", label: "Mobile" },
    ],
  },
  { key: "cloud", label: "Cloud Native", type: "boolean" },
  { key: "homepage", label: "Homepage", type: "url" },
  { key: "notes", label: "Notes", type: "multiline_text" },
  { key: "owner", label: "Owner Contact", type: "text" },
  // A text field that kept an options list from an earlier type.
  {
    key: "legacyCode",
    label: "Legacy Code",
    type: "text",
    options: [{ key: "x", label: "X" }],
  },
  // A select whose definition lost its options list.
  { key: "tier", label: "Tier", type: "single_select" },
  {
    key: "region",
    label: "Region",
    type: "single_select",
    options: [{ key: "emea", label: "EMEA" }],
  },
  { key: "emptySel", label: "Empty Select", type: "single_select", options: [] },
  {
    key: "phase",
    label: "Delivery Phase",
    type: "single_select",
    options: [{ key: "build", label: "Build" }],
  },
];

const SELF_REL = {
  key: "relAppToApp",
  label: "calls",
  reverse_label: "is called by",
  source_type_key: "Application",
  target_type_key: "Application",
  other_type_key: "Application",
  other_type_label: "Application",
};

const TOGGLES = {
  "field:criticality": { card: true, detail: true },
  "field:platforms": { card: true, detail: true },
  "field:cloud": { card: true, detail: true },
  "field:homepage": { card: true, detail: true },
  "field:notes": { card: true, detail: true },
  "field:owner": { card: true, detail: true },
  "field:legacyCode": { card: true, detail: true },
  "field:tier": { card: true, detail: true },
  // Off everywhere: never offered as a filter.
  "field:region": { card: false, detail: false },
  "field:emptySel": { card: true, detail: true },
  // Detail-only: still a filter.
  "field:phase": { card: false, detail: true },
  "rel:relAppToApp": { card: true, detail: true },
};

function portal(overrides: Partial<PublicPortal> = {}): PublicPortal {
  return {
    id: "p1",
    name: "Application Landscape",
    slug: SLUG,
    card_type: "Application",
    view: "cards",
    card_config: { toggles: TOGGLES },
    type_info: {
      key: "Application",
      label: "Application",
      icon: "apps",
      color: "#0f7eb5",
      subtypes: [
        { key: "business", label: "Business Application" },
        { key: "micro", label: "Microservice" },
      ],
      fields_schema: [{ section: "Application Information", fields: FIELDS }],
    },
    relation_types: [SELF_REL],
    tag_groups: [
      {
        id: "g1",
        name: "Domain",
        tags: [
          { id: "t1", name: "Finance" },
          { id: "t2", name: "Core" },
        ],
      },
    ],
    ...overrides,
  } as unknown as PublicPortal;
}

function card(overrides: Partial<PortalCard> = {}): PortalCard {
  return {
    id: "c1",
    name: "SAP S/4HANA",
    type: "Application",
    subtype: "business",
    description: "<p>The ERP.</p>",
    lifecycle: undefined,
    attributes: { criticality: "high" },
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

const PUBLIC_GATE: PortalGate = { access_mode: "public", name: "Application Landscape" };
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

// ---------------------------------------------------------------------------
// The public API, by exact path
// ---------------------------------------------------------------------------

interface CardPage {
  items: PortalCard[];
  total: number;
}

interface Site {
  gate?: unknown;
  portal?: unknown;
  cards?: unknown;
  options?: Record<string, unknown>;
}

const DEFAULT_OPTIONS: Record<string, { id: string; name: string }[]> = {
  Application: [{ id: "a2", name: "CRM" }],
  ITComponent: [{ id: "i1", name: "HANA DB" }],
  Organization: [{ id: "o1", name: "Finance Dept" }],
};

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
      return reply("cards" in site ? site.cards : { items: [card()], total: 1 });
    }
    const opts = `${base}/relation-options?type_key=`;
    if (path.startsWith(opts)) {
      const type = path.slice(opts.length);
      return reply(site.options && type in site.options ? site.options[type] : (DEFAULT_OPTIONS[type] ?? []));
    }
  }
  return Promise.reject(new Error(`unexpected request ${path}`));
}

function paths(): string[] {
  return publicGet.mock.calls.map((c) => c[0] as string);
}

function cardQueries(slug = SLUG): URLSearchParams[] {
  return paths()
    .filter((p) => p.startsWith(`/web-portals/public/${slug}/cards?`))
    .map((p) => new URLSearchParams(p.split("?")[1]));
}

function lastCardParams(): URLSearchParams {
  const q = cardQueries();
  return q[q.length - 1];
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

/** Lets every queued microtask run, so a settled request has fully landed. */
const settle = () => new Promise((r) => setTimeout(r, 20));

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let navigateTo: NavigateFunction;
function NavGrab() {
  navigateTo = useNavigate();
  return null;
}

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <NavGrab />
      <Routes>
        <Route path="/portal/:slug" element={<PortalViewer />} />
        <Route path="/portal" element={<PortalViewer />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPortal(slug = SLUG) {
  return render(tree(`/portal/${slug}`));
}

async function renderLoaded(name = "SAP S/4HANA") {
  const user = userEvent.setup();
  renderPortal();
  await screen.findByText(name);
  return user;
}

function tileOf(name: string) {
  return within(screen.getByText(name).closest(".MuiCard-root") as HTMLElement);
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "tune" }));
}

async function goToPage2(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Go to page 2" }));
  await waitFor(() => expect(lastCardParams().get("page")).toBe("2"));
}

/** The indeterminate bar of a running card query — not a tile's quality bar. */
function loadingBar(): HTMLElement | undefined {
  return screen.queryAllByRole("progressbar").find((el) => !el.hasAttribute("aria-valuenow"));
}

function clearChip() {
  return screen.queryByRole("button", { name: "Clear Filters" });
}

beforeEach(() => {
  sites = {};
  publicGet.mockReset();
  publicGet.mockImplementation(handle);
  serve(SLUG);
});

// ---------------------------------------------------------------------------
// First paint and the gate
// ---------------------------------------------------------------------------

describe("PortalViewer first paint", () => {
  it("opens on a plain spinner, before any request has answered", () => {
    const html = renderToStaticMarkup(tree(`/portal/${SLUG}`));
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("Signing you in");
    expect(html).not.toContain("Portal not found");
  });

  it("sends no request when the route carries no slug", () => {
    render(tree("/portal"));
    expect(publicGet).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("asks for the gate and then the portal, by their exact paths", async () => {
    renderPortal();
    expect(await screen.findByText("SAP S/4HANA")).toBeInTheDocument();
    expect(paths().slice(0, 2)).toEqual([
      `/web-portals/public/${SLUG}/gate`,
      `/web-portals/public/${SLUG}`,
    ]);
  });

  it("says the portal was not found when the portal endpoint answers nothing", async () => {
    serve(SLUG, { portal: null });
    renderPortal();
    expect(await screen.findByText("Portal not found")).toBeInTheDocument();
    expect(
      screen.getByText("This portal may not exist or may not be published yet."),
    ).toBeInTheDocument();
  });
});

describe("PortalViewer SSO gate edge configs", () => {
  it("an SSO gate with no sso block shows the unavailable notice", async () => {
    serve(SLUG, { gate: { access_mode: "sso", name: "Locked Portal" }, portal: httpError(401) });
    renderPortal();
    expect(await screen.findByText(/single sign-on isn't available/i)).toBeInTheDocument();
    expect(screen.getByText("Locked Portal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
  });

  it("an endpoint without a client id never starts a sign-in", async () => {
    serve(SLUG, {
      gate: {
        access_mode: "sso",
        name: "Half Configured",
        sso: { provider_name: "Okta", authorization_endpoint: "https://idp.example.com/authorize" },
      },
      portal: httpError(401),
    });
    renderPortal();
    expect(await screen.findByText(/single sign-on isn't available/i)).toBeInTheDocument();
    expect(screen.queryByText("Signing you in…")).toBeNull();
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
    expect(sessionStorage.getItem(`portal_silent_portal_${SLUG}`)).toBeNull();
  });

  it("names the provider generically when the gate carries no provider name", async () => {
    sessionStorage.setItem(`portal_silent_portal_${SLUG}`, "failed");
    serve(SLUG, {
      gate: {
        access_mode: "sso",
        name: "Restricted Portal",
        sso: { client_id: "c1", authorization_endpoint: "https://idp.example.com/authorize" },
      },
      portal: httpError(401),
    });
    renderPortal();
    expect(await screen.findByRole("button", { name: /Sign in with SSO$/ })).toBeInTheDocument();
  });

  it("an SSO portal failing with anything but 401 is an error, not a sign-in gate", async () => {
    sessionStorage.setItem(`portal_silent_portal_${SLUG}`, "failed");
    serve(SLUG, { gate: SSO_GATE, portal: httpError(500, "server exploded") });
    renderPortal();
    expect(await screen.findByText("server exploded")).toBeInTheDocument();
    expect(screen.queryByText(/this portal is restricted/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Slug changes: the previous slug's late answers are dropped
// ---------------------------------------------------------------------------

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

  it("reloads for the new slug and shows its error over the old portal", async () => {
    serve("a", { portal: portal({ name: "Alpha Portal" }) });
    serve("b", { gate: new Error("Beta is gone") });
    renderPortal("a");
    await screen.findByText("Alpha Portal");
    act(() => {
      navigateTo("/portal/b");
    });
    expect(await screen.findByText("Beta is gone")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Portal")).toBeNull();
  });

  it("shows the spinner again while the new slug loads", async () => {
    const gateB = deferred();
    serve("a", { portal: portal({ name: "Alpha Portal" }) });
    serve("b", { gate: gateB.promise, portal: portal({ name: "Beta Portal" }) });
    renderPortal("a");
    await screen.findByText("Alpha Portal");
    act(() => {
      navigateTo("/portal/b");
    });
    await waitFor(() => expect(screen.queryByText("Alpha Portal")).toBeNull());
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await act(async () => {
      gateB.resolve(PUBLIC_GATE);
    });
    expect(await screen.findByText("Beta Portal")).toBeInTheDocument();
  });

  it("drops the old slug's gate when it answers late", async () => {
    const gateA = deferred();
    serve("a", { gate: gateA.promise, portal: portal({ name: "Alpha Portal" }) });
    serve("b", { portal: portal({ name: "Beta Portal" }) });
    renderPortal("a");
    await waitFor(() => expect(paths()).toContain("/web-portals/public/a/gate"));
    act(() => {
      navigateTo("/portal/b");
    });
    await screen.findByText("Beta Portal");
    await act(async () => {
      gateA.resolve(PUBLIC_GATE);
      await settle();
    });
    expect(paths()).not.toContain("/web-portals/public/a");
    expect(screen.getByText("Beta Portal")).toBeInTheDocument();
  });

  it("ignores the old slug's failure: no error, and the spinner stays up", async () => {
    const gateA = deferred();
    const gateB = deferred();
    serve("a", { gate: gateA.promise });
    serve("b", { gate: gateB.promise, portal: portal({ name: "Beta Portal" }) });
    renderPortal("a");
    await waitFor(() => expect(paths()).toContain("/web-portals/public/a/gate"));
    act(() => {
      navigateTo("/portal/b");
    });
    await waitFor(() => expect(paths()).toContain("/web-portals/public/b/gate"));
    await act(async () => {
      gateA.reject(new Error("Alpha failed"));
      await settle();
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Portal not found")).toBeNull();
    expect(screen.queryByText("Alpha failed")).toBeNull();
    await act(async () => {
      gateB.resolve(PUBLIC_GATE);
    });
    expect(await screen.findByText("Beta Portal")).toBeInTheDocument();
    expect(screen.queryByText("Alpha failed")).toBeNull();
  });

  it("never applies the old slug's portal, so no card query runs for the new one", async () => {
    const portalA = deferred();
    const gateB = deferred();
    serve("a", { portal: portalA.promise });
    serve("b", { gate: gateB.promise });
    renderPortal("a");
    await waitFor(() => expect(paths()).toContain("/web-portals/public/a"));
    act(() => {
      navigateTo("/portal/b");
    });
    await waitFor(() => expect(paths()).toContain("/web-portals/public/b/gate"));
    await act(async () => {
      portalA.resolve(portal({ name: "Alpha Portal" }));
      await settle();
    });
    await act(async () => {
      gateB.reject(new Error("Beta is gone"));
      await settle();
    });
    expect(await screen.findByText("Beta is gone")).toBeInTheDocument();
    expect(cardQueries("b")).toHaveLength(0);
    expect(cardQueries("a")).toHaveLength(0);
  });

  it("a late 401 for the old slug does not put the new portal into signing-in", async () => {
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
    expect(screen.getByText("Beta Portal")).toBeInTheDocument();
    expect(screen.queryByText("Signing you in…")).toBeNull();
  });

  it("a late 401 for the old slug does not lock the new portal", async () => {
    sessionStorage.setItem("portal_silent_portal_a", "failed");
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
    expect(screen.getByText("Beta Portal")).toBeInTheDocument();
    expect(screen.queryByText(/this portal is restricted/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Header and view selection
// ---------------------------------------------------------------------------

describe("PortalViewer header", () => {
  it("shows the type icon beside the title", async () => {
    renderPortal();
    const heading = await screen.findByRole("heading", { level: 4, name: "Application Landscape" });
    expect(within(heading.parentElement as HTMLElement).getByText("apps")).toBeInTheDocument();
  });

  it("falls back to a generic icon without type info", async () => {
    serve(SLUG, { portal: portal({ type_info: null }) });
    renderPortal();
    const heading = await screen.findByRole("heading", { level: 4, name: "Application Landscape" });
    expect(within(heading.parentElement as HTMLElement).getByText("language")).toBeInTheDocument();
  });

  it("a board view gets the compact title and no item count", async () => {
    serve(SLUG, { portal: portal({ view: "ppm_portfolio" }) });
    renderPortal();
    expect(await screen.findByTestId("ppm-board")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 5, name: "Application Landscape" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ Application$/)).toBeNull();
  });

  it("a portal with no view set still loads its cards", async () => {
    serve(SLUG, { portal: portal({ view: undefined }) });
    renderPortal();
    expect(await screen.findByText("SAP S/4HANA")).toBeInTheDocument();
    expect(cardQueries()).toHaveLength(1);
  });

  it("copes with type info that has no fields schema", async () => {
    serve(SLUG, {
      portal: portal({
        type_info: { key: "Application", label: "Application", icon: "apps", color: "#0f7eb5" },
      } as Partial<PublicPortal>),
    });
    renderPortal();
    expect(await screen.findByText("SAP S/4HANA")).toBeInTheDocument();
  });

  it("copes with a portal that has no card config, and shows the logo", async () => {
    serve(SLUG, { portal: portal({ card_config: null } as unknown as Partial<PublicPortal>) });
    renderPortal();
    expect(await screen.findByText("SAP S/4HANA")).toBeInTheDocument();
    expect(document.querySelector("img[src='/api/v1/settings/logo']")).not.toBeNull();
  });

  it("puts a search icon in the search box", async () => {
    await renderLoaded();
    const input = screen.getByPlaceholderText("Search Application...");
    expect(within(input.parentElement as HTMLElement).getByText("search")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The card query
// ---------------------------------------------------------------------------

describe("PortalViewer card query", () => {
  it("starts unfiltered on page one of 24, sorted by name", async () => {
    await renderLoaded();
    const first = cardQueries()[0];
    expect(first.has("search")).toBe(false);
    expect(first.has("subtype")).toBe(false);
    expect(first.has("tag_ids")).toBe(false);
    expect(first.has("attr_filters")).toBe(false);
    expect(first.has("relation_filters")).toBe(false);
    expect(first.get("page")).toBe("1");
    expect(first.get("page_size")).toBe("24");
    expect(first.get("sort_by")).toBe("name");
    expect(first.get("sort_dir")).toBe("asc");
    expect(clearChip()).toBeNull();
  });

  it("shows a progress bar, not 'no results', while the query runs", async () => {
    const cards = deferred();
    serve(SLUG, { cards: cards.promise });
    renderPortal();
    await screen.findByPlaceholderText("Search Application...");
    expect(loadingBar()).toBeDefined();
    expect(screen.queryByText("No results found")).toBeNull();
    await act(async () => {
      cards.resolve({ items: [], total: 0 });
    });
    expect(await screen.findByText("No results found")).toBeInTheDocument();
    expect(screen.getByText("Try adjusting your search or filters.")).toBeInTheDocument();
    expect(loadingBar()).toBeUndefined();
  });

  it("does not say 'no results' once cards are listed", async () => {
    await renderLoaded();
    await waitFor(() => expect(loadingBar()).toBeUndefined());
    expect(screen.queryByText("No results found")).toBeNull();
  });

  it("counts pages from the total and the page size", async () => {
    serve(SLUG, { cards: { items: [card()], total: 30 } as CardPage });
    renderPortal();
    expect(await screen.findByRole("button", { name: "Go to page 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to page 3" })).toBeNull();
  });

  it("debounces the search to the last keystroke and goes back to page one", async () => {
    serve(SLUG, { cards: { items: [card()], total: 60 } as CardPage });
    const user = await renderLoaded();
    await goToPage2(user);
    // Keystrokes 120ms apart: each would fire its own query if the previous
    // keystroke's timer were not cancelled.
    const typist = userEvent.setup({ delay: 120 });
    await typist.type(screen.getByPlaceholderText("Search Application..."), "ab");
    await waitFor(() => expect(lastCardParams().get("search")).toBe("ab"));
    expect(lastCardParams().get("page")).toBe("1");
    expect(cardQueries().filter((p) => p.has("search")).map((p) => p.get("search"))).toEqual([
      "ab",
    ]);
  });

  it("offers every sort and goes back to page one on a new sort", async () => {
    serve(SLUG, { cards: { items: [card()], total: 60 } as CardPage });
    const user = await renderLoaded();
    await goToPage2(user);
    const sort = screen.getAllByRole("combobox").find((c) => c.textContent === "Name A-Z")!;
    await user.click(sort);
    expect(await screen.findByRole("option", { name: "Highest Data Quality" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Recently Updated" }));
    await waitFor(() => {
      const p = lastCardParams();
      expect(p.get("sort_by")).toBe("updated_at");
      expect(p.get("sort_dir")).toBe("desc");
      expect(p.get("page")).toBe("1");
    });
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe("PortalViewer filter bar", () => {
  it("offers only visible select fields that have options", async () => {
    const user = await renderLoaded();
    await openFilters(user);
    expect(screen.getByRole("combobox", { name: "Criticality" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Platforms" })).toBeInTheDocument();
    // Detail-only still counts as visible.
    expect(screen.getByRole("combobox", { name: "Delivery Phase" })).toBeInTheDocument();
    // Off everywhere, no options at all, or an empty options list: no filter.
    expect(screen.queryByRole("combobox", { name: "Region" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Tier" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Empty Select" })).toBeNull();
    // Text fields are never filters, even one still carrying options.
    expect(screen.queryByRole("combobox", { name: "Owner Contact" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Legacy Code" })).toBeNull();
  });

  it("filters by subtype alone, then clears back to page one", async () => {
    serve(SLUG, { cards: { items: [card()], total: 60 } as CardPage });
    const user = await renderLoaded();
    await goToPage2(user);
    await openFilters(user);
    await user.click(screen.getByRole("combobox", { name: "Subtype" }));
    expect(
      await screen.findByRole("option", { name: "All Subtypes", selected: true }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Microservice" }));
    await waitFor(() => {
      const p = lastCardParams();
      expect(p.get("subtype")).toBe("micro");
      expect(p.get("page")).toBe("1");
    });
    // The subtype alone makes the filters "active".
    expect(clearChip()).toBeInTheDocument();

    await goToPage2(user);
    await user.click(within(clearChip()!).getByTestId("CancelIcon"));
    await waitFor(() => {
      const p = lastCardParams();
      expect(p.has("subtype")).toBe(false);
      expect(p.get("page")).toBe("1");
    });
    expect(clearChip()).toBeNull();
  });

  it("offers no subtype filter when the type has no subtypes", async () => {
    serve(SLUG, {
      portal: portal({
        type_info: { ...portal().type_info!, subtypes: [] },
      }),
    });
    const user = await renderLoaded();
    await openFilters(user);
    expect(screen.getByRole("combobox", { name: "Criticality" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Subtype" })).toBeNull();
  });

  it("filters by a select field alone, and 'All' takes the filter off again", async () => {
    serve(SLUG, { cards: { items: [card()], total: 60 } as CardPage });
    const user = await renderLoaded();
    await goToPage2(user);
    await openFilters(user);
    await user.click(screen.getByRole("combobox", { name: "Criticality" }));
    expect(await screen.findByRole("option", { name: "All", selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "High" }));
    await waitFor(() => {
      const p = lastCardParams();
      expect(JSON.parse(p.get("attr_filters")!)).toEqual({ criticality: "high" });
      expect(p.get("page")).toBe("1");
    });
    expect(screen.getByRole("combobox", { name: "Criticality" })).toHaveTextContent("High");
    expect(clearChip()).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Criticality" }));
    await user.click(await screen.findByRole("option", { name: "All" }));
    await waitFor(() => expect(lastCardParams().has("attr_filters")).toBe(false));
    expect(clearChip()).toBeNull();
  });

  it("filters by a relation alone, and 'All' takes the filter off again", async () => {
    serve(SLUG, { cards: { items: [card()], total: 60 } as CardPage });
    const user = await renderLoaded();
    await goToPage2(user);
    await openFilters(user);
    await user.click(await screen.findByRole("combobox", { name: "Application" }));
    expect(
      await screen.findByRole("option", { name: "All Application", selected: true }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "CRM" }));
    await waitFor(() => {
      const p = lastCardParams();
      expect(JSON.parse(p.get("relation_filters")!)).toEqual({ relAppToApp: "a2" });
      expect(p.get("page")).toBe("1");
    });
    expect(screen.getByRole("combobox", { name: "Application" })).toHaveTextContent("CRM");
    expect(clearChip()).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Application" }));
    await user.click(await screen.findByRole("option", { name: "All Application" }));
    await waitFor(() => expect(lastCardParams().has("relation_filters")).toBe(false));
    expect(clearChip()).toBeNull();
  });

  it("filters by several tags alone, joined by commas, back on page one", async () => {
    serve(SLUG, { cards: { items: [card()], total: 60 } as CardPage });
    const user = await renderLoaded();
    await goToPage2(user);
    await openFilters(user);
    await user.click(screen.getByRole("button", { name: "pick-two:Tags" }));
    await waitFor(() => {
      const p = lastCardParams();
      expect(p.get("tag_ids")).toBe("t1,t2");
      expect(p.get("page")).toBe("1");
    });
    expect(clearChip()).toBeInTheDocument();
  });

  it("offers the tag filter when any one group has tags", async () => {
    serve(SLUG, {
      portal: portal({
        tag_groups: [
          { id: "g0", name: "Empty", tags: [] },
          { id: "g1", name: "Domain", tags: [{ id: "t1", name: "Finance" }] },
        ],
      } as unknown as Partial<PublicPortal>),
    });
    await renderLoaded();
    expect(screen.getByText("pick-one:Tags")).toBeInTheDocument();
  });

  it("offers no tag filter when no group has tags", async () => {
    serve(SLUG, {
      portal: portal({
        tag_groups: [
          { id: "g0", name: "Empty", tags: [] },
          { id: "g1", name: "Bare" },
        ],
      } as unknown as Partial<PublicPortal>),
    });
    await renderLoaded();
    expect(screen.queryByText("pick-one:Tags")).toBeNull();
  });
});

describe("PortalViewer relation filters", () => {
  const ORG_OWNS = {
    key: "relOrgToApp",
    label: "owns",
    reverse_label: "is owned by",
    source_type_key: "Organization",
    target_type_key: "Application",
    other_type_key: "Organization",
    other_type_label: "Organization",
  };
  const ORG_USES = { ...ORG_OWNS, key: "relOrgToAppUses", label: "uses", reverse_label: "is used by" };
  const ITC_USES = {
    key: "relAppToITC",
    label: "uses",
    reverse_label: "is used by",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    other_type_key: "ITComponent",
    other_type_label: "IT Component",
  };
  const ITC_RUNS = { ...ITC_USES, key: "relAppToITCRuns", label: "runs on", reverse_label: "hosts" };
  const DATA = {
    key: "relAppToData",
    label: "reads",
    reverse_label: "is read by",
    source_type_key: "Application",
    target_type_key: "DataObject",
    other_type_key: "DataObject",
    other_type_label: "Data Object",
  };

  const optionRequests = (type: string) =>
    paths().filter((p) => p === `/web-portals/public/${SLUG}/relation-options?type_key=${type}`);

  it("loads the options of a portal's single visible relation type", async () => {
    const user = await renderLoaded();
    await openFilters(user);
    expect(await screen.findByRole("combobox", { name: "Application" })).toBeInTheDocument();
    expect(optionRequests("Application")).toHaveLength(1);
  });

  it("never loads options for a relation type switched off on card and detail", async () => {
    serve(SLUG, {
      portal: portal({
        relation_types: [SELF_REL, DATA],
        card_config: {
          toggles: { ...TOGGLES, "rel:relAppToData": { card: false, detail: false } },
        },
      } as unknown as Partial<PublicPortal>),
    });
    await renderLoaded();
    await waitFor(() => expect(optionRequests("Application")).toHaveLength(1));
    expect(optionRequests("DataObject")).toHaveLength(0);
  });

  it("loads one option list per related card type, however many relation types reach it", async () => {
    serve(SLUG, {
      portal: portal({
        relation_types: [ITC_USES, ITC_RUNS],
        card_config: {
          toggles: {
            ...TOGGLES,
            "rel:relAppToITC": { card: true, detail: true },
            "rel:relAppToITCRuns": { card: false, detail: true },
          },
        },
      } as unknown as Partial<PublicPortal>),
    });
    await renderLoaded();
    await waitFor(() => expect(optionRequests("ITComponent")).toHaveLength(1));
    expect(optionRequests("ITComponent")).toHaveLength(1);
  });

  it("offers no relation filter until its options have arrived", async () => {
    const opts = deferred();
    serve(SLUG, { options: { Application: opts.promise } });
    const user = await renderLoaded();
    await openFilters(user);
    await waitFor(() => expect(optionRequests("Application")).toHaveLength(1));
    expect(screen.queryByRole("combobox", { name: "Application" })).toBeNull();
    await act(async () => {
      opts.resolve([{ id: "a2", name: "CRM" }]);
    });
    expect(await screen.findByRole("combobox", { name: "Application" })).toBeInTheDocument();
  });

  it("reads the reverse verb when the portal type is the relation's target", async () => {
    serve(SLUG, {
      portal: portal({
        relation_types: [ORG_OWNS, ORG_USES],
        card_config: {
          toggles: {
            ...TOGGLES,
            "rel:relOrgToApp": { card: false, detail: true },
            "rel:relOrgToAppUses": { card: false, detail: true },
          },
        },
      } as unknown as Partial<PublicPortal>),
    });
    const user = await renderLoaded();
    await openFilters(user);
    expect(
      await screen.findByRole("combobox", { name: "Organization · is owned by" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Organization · is used by" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Field values and the lifecycle bar on a tile
// ---------------------------------------------------------------------------

describe("PortalViewer field values", () => {
  it("renders each field type the way its type says", async () => {
    serve(SLUG, {
      cards: {
        items: [
          card({
            id: "c1",
            name: "Value Card",
            attributes: {
              criticality: "low",
              cloud: false,
              homepage: "mailto:team@example.com",
              notes: "Line one\nLine two",
              owner: "mailto:owner@example.com",
              tier: "gold",
            },
          }),
          card({
            id: "c2",
            name: "Odd Card",
            attributes: {
              criticality: "medium",
              platforms: "web",
              homepage: "  https://docs.example.com/guide  ",
            },
          }),
          card({ id: "c3", name: "Number Card", attributes: { homepage: 42 } }),
        ],
        total: 3,
      } as CardPage,
    });
    await renderLoaded("Value Card");

    const value = tileOf("Value Card");
    // The second option resolves to its own label.
    expect(value.getByText("Low")).toBeInTheDocument();
    expect(value.queryByText("High")).toBeNull();
    // A false boolean is a "cancel" mark, not a blank.
    expect(value.getByText("cancel")).toBeInTheDocument();
    // A url field is one whole link, mailto included.
    expect(value.getByRole("link", { name: "mailto:team@example.com" })).toHaveAttribute(
      "href",
      "mailto:team@example.com",
    );
    // A text field is never turned into a link by an address-looking value.
    expect(value.getByText("mailto:owner@example.com")).toBeInTheDocument();
    expect(value.queryByRole("link", { name: "mailto:owner@example.com" })).toBeNull();
    // A select whose options went missing shows its stored value.
    expect(value.getByText("gold")).toBeInTheDocument();
    // A multi-line note keeps the line breaks it was typed with.
    expect(getComputedStyle(value.getByText(/Line one/)).whiteSpace).toBe("pre-wrap");

    // A value the field's options do not know is still shown, not a crash.
    const odd = tileOf("Odd Card");
    expect(odd.getByText(/^medium$/i)).toBeInTheDocument();
    expect(odd.getByText(/^web$/i)).toBeInTheDocument();
    // The link target is the trimmed address.
    expect(odd.getByRole("link", { name: /docs\.example\.com/ })).toHaveAttribute(
      "href",
      "https://docs.example.com/guide",
    );

    expect(tileOf("Number Card").getByText("42")).toBeInTheDocument();
  });

  it("shows a field beyond the first three in the detail dialog when the portal sets no toggles", async () => {
    serve(SLUG, {
      portal: portal({ card_config: {} }),
      cards: {
        items: [card({ attributes: { criticality: "high", homepage: "https://sap.example.com" } })],
        total: 1,
      } as CardPage,
    });
    const user = await renderLoaded();
    await user.click(screen.getByText("SAP S/4HANA"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Homepage")).toBeInTheDocument();
  });

  it("shows two initials for a stakeholder with three names", async () => {
    serve(SLUG, {
      cards: {
        items: [card({ stakeholders: [{ role: "responsible", display_name: "Ada Byron Lovelace" }] })],
        total: 1,
      } as CardPage,
    });
    await renderLoaded();
    expect(tileOf("SAP S/4HANA").getByText("AB")).toBeInTheDocument();
  });
});

describe("PortalViewer lifecycle bar", () => {
  const segment = (tile: HTMLElement, label: string) =>
    tile.querySelector(`[aria-label='${label}']`) as HTMLElement;
  const bg = (el: HTMLElement) => getComputedStyle(el).backgroundColor;

  it("highlights the phase the card is in today and tints the others", async () => {
    const today = todayIsoDate();
    serve(SLUG, {
      cards: {
        items: [
          card({
            lifecycle: { plan: "2020-01-01", active: today, phaseOut: "2099-01-01" },
          }),
        ],
        total: 1,
      } as CardPage,
    });
    await renderLoaded();
    const tile = screen.getByText("SAP S/4HANA").closest(".MuiCard-root") as HTMLElement;
    // Active started today, so it is the current phase.
    expect(bg(segment(tile, `Active: ${today}`))).toBe("rgb(76, 175, 80)");
    // Dated phases that are not current are tinted.
    expect(bg(segment(tile, "Plan: 2020-01-01"))).toBe("rgba(144, 202, 249, 0.25)");
    expect(bg(segment(tile, "Phase Out: 2099-01-01"))).toBe("rgba(255, 152, 0, 0.25)");
    // Undated phases are grey.
    expect(bg(segment(tile, "Phase In"))).toBe("rgb(224, 224, 224)");
    expect(bg(segment(tile, "End of Life"))).toBe("rgb(224, 224, 224)");
  });

  it("names every phase with its date", async () => {
    serve(SLUG, {
      cards: {
        items: [
          card({
            lifecycle: {
              plan: "2019-01-01",
              phaseIn: "2019-06-01",
              active: "2020-01-01",
              phaseOut: "2021-01-01",
              endOfLife: "2022-01-01",
            },
          }),
        ],
        total: 1,
      } as CardPage,
    });
    await renderLoaded();
    const tile = screen.getByText("SAP S/4HANA").closest(".MuiCard-root") as HTMLElement;
    expect(bg(segment(tile, "Phase In: 2019-06-01"))).toBe("rgba(102, 187, 106, 0.25)");
    expect(segment(tile, "Active: 2020-01-01")).not.toBeNull();
    expect(segment(tile, "Phase Out: 2021-01-01")).not.toBeNull();
    // Every date is past, so End of Life is the current phase.
    expect(bg(segment(tile, "End of Life: 2022-01-01"))).toBe("rgb(244, 67, 54)");
  });
});
