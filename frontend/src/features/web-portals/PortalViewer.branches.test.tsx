/**
 * PortalViewer beyond the card row: the SSO gate (silent attempt, sign-in
 * button, unavailable), the error and board views, the filter bar (subtype,
 * select fields, relation filters, tags, sort, search, clear), pagination,
 * and every field / chip branch on the card tile and in the detail dialog.
 *
 * Same seams as `PortalViewer.test.tsx`: `publicGet` is the only network the
 * page has, and both the authenticated client and the metamodel must never be
 * reached from a portal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";

vi.mock("@/api/client", () => {
  const boom = () => {
    throw new Error("A portal must never call the authenticated API client");
  };
  return { api: { get: boom, post: boom, patch: boom, put: boom, delete: boom } };
});
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({
    formatDate: (d: string) => `fmt:${d}`,
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
vi.mock("./publicApi", () => ({ publicGet: (...a: unknown[]) => publicGet(...a) }));

// The two board views own their own tests; here only the routing matters.
vi.mock("./PortalPpmPortfolio", () => ({
  default: ({ slug }: { slug: string }) => <div data-testid="ppm-board">{slug}</div>,
}));
vi.mock("./PortalProcessNavigator", () => ({
  default: ({ slug }: { slug: string }) => <div data-testid="navigator-board">{slug}</div>,
}));
// The tag filter is a shared component with its own tests.
vi.mock("@/components/TagPicker", () => ({
  default: ({ onChange, label }: { onChange: (ids: string[]) => void; label?: string }) => (
    <button type="button" onClick={() => onChange(["t1"])}>
      pick-tag:{label}
    </button>
  ),
}));

import PortalViewer from "./PortalViewer";
import { parseState } from "@/lib/publicSso";
import { setViewportWidth } from "@/test/matchMedia";
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
      { key: "web", label: "Web", color: "#1976d2" },
      { key: "mobile", label: "Mobile" },
    ],
  },
  { key: "cloud", label: "Cloud Native", type: "boolean" },
  { key: "homepage", label: "Homepage", type: "url" },
  { key: "notes", label: "Notes", type: "multiline_text" },
  { key: "hidden", label: "Hidden Field", type: "text" },
];

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
  {
    key: "relOrgToApp",
    label: "owns",
    reverse_label: "is owned by",
    source_type_key: "Organization",
    target_type_key: "Application",
    other_type_key: "Organization",
    other_type_label: "Organization",
  },
  {
    key: "relAppToApp",
    label: "calls",
    reverse_label: "is called by",
    source_type_key: "Application",
    target_type_key: "Application",
    other_type_key: "Application",
    other_type_label: "Application",
  },
  {
    // Not toggled on: never offered as a filter nor rendered.
    key: "relHidden",
    label: "hidden",
    source_type_key: "Application",
    target_type_key: "DataObject",
    other_type_key: "DataObject",
    other_type_label: "Data Object",
  },
];

function portal(overrides: Partial<PublicPortal> = {}): PublicPortal {
  return {
    id: "p1",
    name: "Application Landscape",
    slug: SLUG,
    description: "All apps — see https://wiki.example.com",
    card_type: "Application",
    view: "cards",
    card_config: {
      toggles: {
        "field:criticality": { card: true, detail: true },
        "field:platforms": { card: true, detail: true },
        "field:cloud": { card: true, detail: true },
        "field:homepage": { card: true, detail: true },
        "field:notes": { card: false, detail: true },
        "field:hidden": { card: false, detail: false },
        approval_status: { card: true, detail: true },
        "rel:relAppToITC": { card: true, detail: true },
        "rel:relAppToITCRuns": { card: true, detail: true },
        "rel:relOrgToApp": { card: false, detail: true },
        "rel:relAppToApp": { card: true, detail: false },
      },
    },
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
    relation_types: REL_TYPES,
    tag_groups: [{ id: "g1", name: "Domain", tags: [{ id: "t1", name: "Finance" }] }],
    ...overrides,
  } as PublicPortal;
}

function card(overrides: Partial<PortalCard> = {}): PortalCard {
  return {
    id: "c1",
    name: "SAP S/4HANA",
    type: "Application",
    subtype: "business",
    description: "<p>The ERP.</p>",
    lifecycle: { plan: "2020-01-01", active: "2021-01-01", endOfLife: "2099-01-01" },
    attributes: {
      criticality: "high",
      platforms: ["web", "mobile", "desktop"],
      cloud: true,
      homepage: "https://sap.example.com",
      notes: "Line one\nLine two",
      hidden: "never shown",
    },
    approval_status: "APPROVED",
    data_quality: 91.4,
    tags: [
      { id: "t1", name: "Finance", color: "#2e7d32", group_name: "Domain" },
      { id: "t2", name: "Core" },
      { id: "t3", name: "ERP" },
      { id: "t4", name: "SAP" },
      { id: "t5", name: "Legacy" },
    ],
    relations: [
      { type: "relAppToITC", related_id: "i1", related_name: "HANA DB", related_type: "ITComponent", direction: "outgoing" },
      // Same card through a second relation type: one chip on the tile.
      { type: "relAppToITCRuns", related_id: "i1", related_name: "HANA DB", related_type: "ITComponent", direction: "outgoing" },
      { type: "relAppToITC", related_id: "i2", related_name: "Linux", related_type: "ITComponent", direction: "outgoing" },
      { type: "relAppToApp", related_id: "a2", related_name: "CRM", related_type: "Application", direction: "outgoing" },
      { type: "relAppToApp", related_id: "a3", related_name: "Billing", related_type: "Application", direction: "incoming" },
      { type: "relAppToApp", related_id: "a4", related_name: "Payroll", related_type: "Application", direction: "outgoing" },
      { type: "relOrgToApp", related_id: "o1", related_name: "Finance Dept", related_type: "Organization", direction: "incoming" },
      { type: "relGone", related_id: "x1", related_name: "Orphan", related_type: "Thing", direction: "incoming" },
    ],
    stakeholders: [
      { role: "responsible", display_name: "Ada Lovelace" },
      { role: "steward", display_name: "Grace Hopper" },
    ],
    updated_at: "2026-09-01",
    logo_updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as PortalCard;
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

function locked(status = 401) {
  const e = new Error("portal_locked") as Error & { status: number };
  e.status = status;
  return e;
}

interface Script {
  gate?: PortalGate | Error;
  portal?: PublicPortal | Error;
  cards?: PortalCard[];
  total?: number;
}

function script(s: Script = {}) {
  publicGet.mockImplementation((path: string) => {
    if (path.endsWith("/gate")) {
      const g = s.gate ?? PUBLIC_GATE;
      return g instanceof Error ? Promise.reject(g) : Promise.resolve(g);
    }
    if (path.includes("/relation-options")) {
      const type = new URLSearchParams(path.split("?")[1]).get("type_key");
      if (type === "ITComponent")
        return Promise.resolve([
          { id: "i1", name: "HANA DB" },
          { id: "i2", name: "Linux" },
        ]);
      if (type === "Application") return Promise.resolve([{ id: "a2", name: "CRM" }]);
      return Promise.resolve([]);
    }
    if (path.includes("/cards")) {
      const items = s.cards ?? [card()];
      return Promise.resolve({ items, total: s.total ?? items.length, page: 1, page_size: 24 });
    }
    const p = s.portal ?? portal();
    return p instanceof Error ? Promise.reject(p) : Promise.resolve(p);
  });
}

/** The sort select, whose accessible name is its current value. */
function sortSelect(value = "Name A-Z"): HTMLElement {
  const el = screen.getAllByRole("combobox").find((c) => c.textContent === value);
  if (!el) throw new Error(`no sort select reading ${value}`);
  return el;
}

/** Query-string params of the most recent card query. */
function lastCardParams(): URLSearchParams {
  const paths = publicGet.mock.calls.map((c) => c[0] as string).filter((p) => p.includes("/cards?"));
  return new URLSearchParams(paths[paths.length - 1].split("?")[1]);
}

function renderPortal() {
  return render(
    <MemoryRouter initialEntries={[`/portal/${SLUG}`]}>
      <Routes>
        <Route path="/portal/:slug" element={<PortalViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded() {
  const user = userEvent.setup();
  renderPortal();
  await screen.findByText("SAP S/4HANA");
  return user;
}

beforeEach(() => {
  publicGet.mockReset();
  script();
});

// ---------------------------------------------------------------------------
// Gate + error states
// ---------------------------------------------------------------------------

describe("PortalViewer SSO gate", () => {
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

  it("tries a silent sign-in once and shows the signing-in spinner", async () => {
    script({ gate: SSO_GATE, portal: locked() });
    renderPortal();
    expect(await screen.findByText("Signing you in…")).toBeInTheDocument();
    await waitFor(() => expect(window.location.href).not.toBe(""));
    const url = new URL(window.location.href);
    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
    expect(url.searchParams.get("prompt")).toBe("none");
    const state = parseState(url.searchParams.get("state"))!;
    expect(state).toMatchObject({ t: "portal", slug: SLUG, silent: true });
    expect(sessionStorage.getItem(`portal_silent_portal_${SLUG}`)).toBe("pending");
    expect(sessionStorage.getItem("portal_sso_nonce")).toBe(state.nonce);
  });

  it("shows the sign-in gate once the silent attempt was tried, and signs in by button", async () => {
    sessionStorage.setItem(`portal_silent_portal_${SLUG}`, "failed");
    script({ gate: SSO_GATE, portal: locked() });
    const user = userEvent.setup();
    renderPortal();
    expect(await screen.findByText("Restricted Portal")).toBeInTheDocument();
    expect(screen.getByText(/this portal is restricted/i)).toBeInTheDocument();
    expect(window.location.href).toBe("");

    await user.click(screen.getByRole("button", { name: /sign in with entra id/i }));
    const url = new URL(window.location.href);
    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
    expect(url.searchParams.has("prompt")).toBe(false);
  });

  it("says single sign-on is unavailable when the gate carries no usable config", async () => {
    script({ gate: { access_mode: "sso", name: "Locked", sso: {} }, portal: locked() });
    renderPortal();
    expect(await screen.findByText(/single sign-on isn't available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
    expect(window.location.href).toBe("");
  });
});

describe("PortalViewer error states", () => {
  it("shows the error of a portal that fails for another reason", async () => {
    script({ portal: locked(500) });
    renderPortal();
    expect(await screen.findByText("portal_locked")).toBeInTheDocument();
    expect(screen.getByText(/may not exist or may not be published/i)).toBeInTheDocument();
  });

  it("shows the gate's error when the portal does not exist", async () => {
    script({ gate: new Error("Not found") });
    renderPortal();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });

  it("a 401 from a public portal is an error, not a gate", async () => {
    script({ portal: locked(401) });
    renderPortal();
    expect(await screen.findByText("portal_locked")).toBeInTheDocument();
  });
});

describe("PortalViewer board views", () => {
  it("renders the PPM portfolio board and never queries cards", async () => {
    script({ portal: portal({ view: "ppm_portfolio", description: undefined }) });
    renderPortal();
    expect(await screen.findByTestId("ppm-board")).toHaveTextContent(SLUG);
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    expect(publicGet.mock.calls.some((c) => String(c[0]).includes("/cards?"))).toBe(false);
  });

  it("renders the process navigator board", async () => {
    script({ portal: portal({ view: "process_navigator" }) });
    renderPortal();
    expect(await screen.findByTestId("navigator-board")).toHaveTextContent(SLUG);
  });

  it("falls back to the cards view, generic labels and no logo when told so", async () => {
    script({
      portal: portal({
        view: undefined,
        type_info: null,
        card_config: { show_logo: false },
        relation_types: [],
        tag_groups: [],
      }),
      cards: [],
    });
    const { container } = renderPortal();
    expect(await screen.findByText("No results found")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search items...")).toBeInTheDocument();
    expect(container.querySelector("img[src='/api/v1/settings/logo']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Header, filters, sort, search, pagination
// ---------------------------------------------------------------------------

describe("PortalViewer header and toolbar", () => {
  it("shows the linkified description, item count and logo", async () => {
    renderPortal();
    await screen.findByText("SAP S/4HANA");
    expect(screen.getByRole("link", { name: "https://wiki.example.com" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByText("1 Application")).toBeInTheDocument();
    expect(document.querySelector("img[src='/api/v1/settings/logo']")).not.toBeNull();
  });

  it("filters by subtype, select field, relation and tag, then clears them all", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "tune" }));

    // Subtype
    await user.click(screen.getByRole("combobox", { name: "Subtype" }));
    await user.click(await screen.findByRole("option", { name: "Microservice" }));
    await waitFor(() => expect(lastCardParams().get("subtype")).toBe("micro"));

    // Select-type field (single + multiple are both filterable)
    expect(screen.getByRole("combobox", { name: "Platforms" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Criticality" }));
    await user.click(await screen.findByRole("option", { name: "High" }));
    await waitFor(() =>
      expect(JSON.parse(lastCardParams().get("attr_filters")!)).toEqual({ criticality: "high" }),
    );

    // Two relation types reach IT Component, so each label carries its verb.
    await user.click(await screen.findByRole("combobox", { name: "IT Component · runs on" }));
    await user.click(await screen.findByRole("option", { name: "Linux" }));
    await waitFor(() =>
      expect(JSON.parse(lastCardParams().get("relation_filters")!)).toEqual({
        relAppToITCRuns: "i2",
      }),
    );
    expect(screen.getByRole("combobox", { name: "IT Component · uses" })).toBeInTheDocument();
    // A self-referencing type unions both directions, so it names both verbs —
    // but only when another relation type shares its pair; alone it keeps the
    // plain type label. An organization with no options offers no filter.
    expect(screen.getByRole("combobox", { name: "Application" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /organization/i })).toBeNull();

    // Tags
    await user.click(screen.getByRole("button", { name: "pick-tag:Tags" }));
    await waitFor(() => expect(lastCardParams().get("tag_ids")).toBe("t1"));

    // Clear all
    const clear = screen.getByRole("button", { name: "Clear Filters" });
    await user.click(within(clear).getByTestId("CancelIcon"));
    await waitFor(() => {
      const p = lastCardParams();
      expect(p.get("subtype")).toBeNull();
      expect(p.get("attr_filters")).toBeNull();
      expect(p.get("relation_filters")).toBeNull();
      expect(p.get("tag_ids")).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Clear Filters" })).toBeNull();
  });

  it("names both verbs on a self-referencing type that shares its pair", async () => {
    const second = { ...REL_TYPES[3], key: "relAppToAppFeeds", label: "feeds", reverse_label: "is fed by" };
    script({
      portal: portal({
        relation_types: [...REL_TYPES, second],
        card_config: {
          toggles: {
            ...((portal().card_config as { toggles: Record<string, unknown> }).toggles),
            "rel:relAppToAppFeeds": { card: false, detail: true },
          },
        },
      }),
    });
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "tune" }));
    expect(
      await screen.findByRole("combobox", { name: "Application · calls / is called by" }),
    ).toBeInTheDocument();
    // A relation type whose portal type is the TARGET reads its reverse verb.
    expect(screen.queryByText(/is owned by/)).toBeNull();
  });

  it("sorts, searches (debounced) and pages", async () => {
    script({ total: 60 });
    const user = await renderLoaded();

    await user.click(sortSelect());
    await user.click(await screen.findByRole("option", { name: "Lowest Data Quality" }));
    await waitFor(() => {
      expect(lastCardParams().get("sort_by")).toBe("data_quality");
      expect(lastCardParams().get("sort_dir")).toBe("asc");
    });

    await user.type(screen.getByPlaceholderText("Search Application..."), "hana");
    await waitFor(() => expect(lastCardParams().get("search")).toBe("hana"));

    await user.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => expect(lastCardParams().get("page")).toBe("2"));
    expect(screen.getByRole("button", { name: "Go to page 3" })).toBeInTheDocument();
  });

  it("keeps the previous rows when a card query fails", async () => {
    const user = await renderLoaded();
    publicGet.mockImplementation((path: string) =>
      path.includes("/cards?") ? Promise.reject(new Error("down")) : Promise.resolve([]),
    );
    await user.click(sortSelect());
    await user.click(await screen.findByRole("option", { name: "Name Z-A" }));
    await waitFor(() => expect(lastCardParams().get("sort_dir")).toBe("desc"));
    expect(screen.getByText("SAP S/4HANA")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Card tile
// ---------------------------------------------------------------------------

describe("PortalViewer card tile", () => {
  it("renders subtype, field values, approval, tags, relations, stakeholders and the logo", async () => {
    renderPortal();
    const name = await screen.findByText("SAP S/4HANA");
    const tile = name.closest(".MuiCard-root") as HTMLElement;
    const inTile = within(tile);

    expect(inTile.getByText("Business Application")).toBeInTheDocument();
    expect(inTile.getByText("The ERP.")).toBeInTheDocument();
    // single_select chip, multiple_select chips (unknown key falls back to raw)
    expect(inTile.getByText("High")).toBeInTheDocument();
    expect(inTile.getByText("Web")).toBeInTheDocument();
    expect(inTile.getByText("Mobile")).toBeInTheDocument();
    expect(inTile.getByText("desktop")).toBeInTheDocument();
    // boolean → icon, url → link
    expect(inTile.getByText("check_circle")).toBeInTheDocument();
    expect(inTile.getByRole("link", { name: "https://sap.example.com" })).toHaveAttribute(
      "href",
      "https://sap.example.com",
    );
    // Notes is detail-only; Hidden is off everywhere.
    expect(inTile.queryByText("Notes")).toBeNull();
    expect(inTile.queryByText("Hidden Field")).toBeNull();
    // Approval status chip is on (toggle), tags cap at four, +1 overflow.
    expect(inTile.getByText("APPROVED")).toBeInTheDocument();
    expect(inTile.getByText("SAP")).toBeInTheDocument();
    expect(inTile.queryByText("Legacy")).toBeNull();
    // +1 tag and +1 related card (five distinct related cards, four shown).
    expect(inTile.getAllByText("+1")).toHaveLength(2);
    // Relations: one chip per related card, detail-only types left out.
    expect(inTile.getAllByText("HANA DB")).toHaveLength(1);
    expect(inTile.getByText("Linux")).toBeInTheDocument();
    expect(inTile.queryByText("Finance Dept")).toBeNull();
    expect(inTile.getByText("Billing")).toBeInTheDocument();
    expect(inTile.queryByText("Payroll")).toBeNull();
    // Stakeholders as initials
    expect(inTile.getByText("AL")).toBeInTheDocument();
    expect(inTile.getByText("GH")).toBeInTheDocument();
    // Logo comes from the unauthenticated card logo route.
    expect(tile.querySelector("img[src^='/api/v1/cards/c1/logo']")).not.toBeNull();
    expect(inTile.getByText("91% data quality")).toBeInTheDocument();
  });

  it("caps related cards at four with an overflow chip and shows rejected approval", async () => {
    const many = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => ({
      type: "relAppToITC",
      related_id: id,
      related_name: `Comp ${id}`,
      related_type: "ITComponent",
      direction: "outgoing",
    }));
    script({
      cards: [
        card({
          relations: many,
          approval_status: "REJECTED",
          subtype: "unknown-sub",
          logo_updated_at: null,
          tags: [],
          stakeholders: [],
        }),
      ],
    });
    renderPortal();
    const name = await screen.findByText("SAP S/4HANA");
    const tile = within(name.closest(".MuiCard-root") as HTMLElement);
    expect(tile.getByText("+2")).toBeInTheDocument();
    expect(tile.getByText("REJECTED")).toBeInTheDocument();
    expect(tile.getByText("unknown-sub")).toBeInTheDocument();
    expect(tile.getByText("apps")).toBeInTheDocument(); // type icon instead of a logo
  });

  it("hides the relation strip when no card-visible relation remains", async () => {
    script({
      cards: [
        card({
          relations: [
            { type: "relOrgToApp", related_id: "o1", related_name: "Finance Dept", related_type: "Organization", direction: "incoming" },
          ],
          approval_status: "SUBMITTED",
        }),
      ],
    });
    renderPortal();
    const name = await screen.findByText("SAP S/4HANA");
    const tile = within(name.closest(".MuiCard-root") as HTMLElement);
    expect(tile.queryByText("Finance Dept")).toBeNull();
    expect(tile.getByText("SUBMITTED")).toBeInTheDocument();
  });

  it("uses the default toggles and the first three fields when the portal sets none", async () => {
    script({
      portal: portal({ card_config: {} }),
      cards: [card({ approval_status: "APPROVED", lifecycle: undefined })],
    });
    renderPortal();
    const name = await screen.findByText("SAP S/4HANA");
    const tile = within(name.closest(".MuiCard-root") as HTMLElement);
    // First three fields only
    expect(tile.getByText("High")).toBeInTheDocument();
    expect(tile.queryByRole("link", { name: "https://sap.example.com" })).toBeNull();
    // Approval status is off on the tile by default.
    expect(tile.queryByText("APPROVED")).toBeNull();
    // No relation filters without rel: toggles.
    expect(publicGet.mock.calls.some((c) => String(c[0]).includes("relation-options"))).toBe(false);
  });

  it("renders a lifecycle bar only when a phase has a date", async () => {
    script({ cards: [card({ lifecycle: {} }), card({ id: "c2", name: "Other App" })] });
    renderPortal();
    const dated = (await screen.findByText("Other App")).closest(".MuiCard-root") as HTMLElement;
    const empty = screen.getByText("SAP S/4HANA").closest(".MuiCard-root") as HTMLElement;
    // Five phase segments, each tooltip naming its date when it has one.
    expect(dated.querySelector("[aria-label='Plan: 2020-01-01']")).not.toBeNull();
    expect(dated.querySelector("[aria-label='Phase In']")).not.toBeNull();
    expect(dated.querySelector("[aria-label='End of Life: 2099-01-01']")).not.toBeNull();
    expect(empty.querySelector("[aria-label^='Plan']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

describe("PortalViewer detail dialog", () => {
  it("shows chips, attributes, stakeholders, tags, grouped relations and last update", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByText("SAP S/4HANA"));
    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.getByText("Application")).toBeInTheDocument();
    expect(dialog.getByText("Business Application")).toBeInTheDocument();
    expect(dialog.getByText("91% data quality")).toBeInTheDocument();
    expect(dialog.getByText("APPROVED")).toBeInTheDocument();
    expect(dialog.getByText("The ERP.")).toBeInTheDocument();

    // Attributes: the detail-only multiline field joins, the hidden one never.
    expect(dialog.getByText("Application Information")).toBeInTheDocument();
    expect(dialog.getByText("Notes")).toBeInTheDocument();
    expect(dialog.getByText(/Line one\s+Line two/)).toBeInTheDocument();
    expect(dialog.queryByText("never shown")).toBeNull();

    // Stakeholders with translated and raw roles
    expect(dialog.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(dialog.getByText("Responsible")).toBeInTheDocument();
    expect(dialog.getByText("steward")).toBeInTheDocument();

    // Tags carry their group
    expect(dialog.getByText("Domain: Finance")).toBeInTheDocument();
    expect(dialog.getByText("Legacy")).toBeInTheDocument();

    // Relations grouped per type + direction, labelled by the verb read from
    // this card's side; types not toggled for detail stay out.
    expect(dialog.getByText("Related Items")).toBeInTheDocument();
    expect(dialog.getByText("uses")).toBeInTheDocument();
    expect(dialog.getByText("runs on")).toBeInTheDocument();
    expect(dialog.getByText("is owned by")).toBeInTheDocument();
    expect(dialog.getByText("Finance Dept")).toBeInTheDocument();
    expect(dialog.queryByText("CRM")).toBeNull();
    expect(dialog.queryByText("Orphan")).toBeNull();

    expect(dialog.getByText("Last updated: fmt:2026-09-01")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("falls back to raw relation keys and type names the portal does not describe", async () => {
    script({
      portal: portal({
        relation_types: REL_TYPES.filter((r) => r.key !== "relOrgToApp"),
        card_config: {
          toggles: {
            "rel:relAppToITC": { card: false, detail: true },
            "rel:relOrgToApp": { card: false, detail: true },
          },
        },
      }),
      cards: [
        card({
          subtype: "mystery",
          approval_status: "SUBMITTED",
          description: undefined,
          updated_at: undefined,
          logo_updated_at: null,
          stakeholders: [],
          tags: [],
          attributes: {},
          relations: [
            { type: "relAppToITC", related_id: "i9", related_name: "Kafka", related_type: "ITComponent", direction: "incoming" },
          ],
        }),
      ],
    });
    const user = await renderLoaded();
    await user.click(screen.getByText("SAP S/4HANA"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("mystery")).toBeInTheDocument();
    expect(dialog.getByText("SUBMITTED")).toBeInTheDocument();
    // Incoming side reads the reverse verb.
    expect(dialog.getByText("is used by")).toBeInTheDocument();
    expect(dialog.getByText("Kafka")).toBeInTheDocument();
    expect(dialog.queryByText("Description")).toBeNull();
    expect(dialog.queryByText("Stakeholders")).toBeNull();
    expect(dialog.queryByText(/last updated/i)).toBeNull();
  });

  it("drops the relations block when none of the card's relations is detail-visible", async () => {
    script({
      cards: [
        card({
          relations: [
            { type: "relAppToApp", related_id: "a2", related_name: "CRM", related_type: "Application", direction: "outgoing" },
          ],
          approval_status: "REJECTED",
        }),
      ],
    });
    const user = await renderLoaded();
    await user.click(screen.getByText("SAP S/4HANA"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByText("Related Items")).toBeNull();
    expect(dialog.getByText("REJECTED")).toBeInTheDocument();
  });

  it("renders the dialog full-screen with a compact pager on a phone", async () => {
    setViewportWidth(375);
    script({ total: 48, cards: [card({ type: "Application" })], portal: portal({ type_info: null }) });
    const user = await renderLoaded();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    await user.click(screen.getByText("SAP S/4HANA"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toMatch(/fullScreen/i);
    // Without type info the chip shows the card's own type key.
    expect(within(dialog).getByText("Application")).toBeInTheDocument();
  });
});
