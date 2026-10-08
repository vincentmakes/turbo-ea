/**
 * ProcessNavigator beyond what `ProcessNavigator.test.tsx` pins: the house
 * cards (leaf + container, search, overlays, drill, keyboard), admin drag and
 * row reorder, zoom breadcrumbs and deep links, the organization filter, the
 * matrix / dependencies views, every drawer tab — including the five step
 * links on the Steps tab — and the portal-shaped capability set the published
 * navigator renders with.
 *
 * Same seams as the sibling file (the bpmn-js viewer stubbed, `useNavigate`
 * captured); the API, metamodel and auth come from the shared test kit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));
vi.mock("./BpmnViewer", () => ({
  default: ({ bpmnXml, typeColors }: { bpmnXml: string; typeColors?: unknown }) => (
    <div data-testid="bpmn-viewer" data-has-colors={String(Boolean(typeColors))}>
      {bpmnXml ? "BPMN loaded" : ""}
    </div>
  ),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

import ProcessNavigator, { ProcessNavigatorBody } from "./ProcessNavigator";
import {
  FULL_CAPABILITIES,
  ProcessNavigatorProvider,
  type NavigatorCapabilities,
  type ProcessNavigatorSource,
} from "./ProcessNavigatorContext";
import { processTypeOptionsFrom } from "./useProcessTypeOptions";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeField, makeOption, makeSection, makeSubtype } from "@/test/fixtures/metamodel";
import { makeUser } from "@/test/render";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROCESS_TYPE_FIELD = makeField({
  key: "processType",
  type: "single_select",
  options: [
    makeOption({ key: "core", label: "Core", color: "#1976d2" }),
    makeOption({ key: "support", label: "Support", color: "#607d8b" }),
    makeOption({ key: "management", label: "Management", color: "#9c27b0" }),
    makeOption({ key: "innovation", label: "Innovation", color: "#ff8800" }),
  ],
});

const BP_TYPE = makeCardType({
  key: "BusinessProcess",
  icon: "route",
  color: "#028f00",
  subtypes: [makeSubtype({ key: "valueChain", label: "Value Chain" })],
  fields_schema: [makeSection({ section: "Classification", fields: [PROCESS_TYPE_FIELD] })],
});

const APP_TYPE = makeCardType({
  key: "Application",
  subtypes: [makeSubtype({ key: "businessApplication", label: "Business Application" })],
});

function proc(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    subtype: undefined,
    parent_id: null,
    attributes: { processType: "core" },
    lifecycle: {},
    app_count: 0,
    total_cost: 0,
    apps: [],
    data_objects: [],
    org_ids: [],
    ctx_ids: [],
    has_diagram: false,
    element_count: 0,
    ...overrides,
  };
}

const ITEMS = [
  proc("o2c", "Order to Cash", {
    subtype: "valueChain",
    attributes: {
      processType: "core",
      maturity: "defined",
      automationLevel: "manual",
      riskLevel: "high",
      sortOrder: 1,
    },
    has_diagram: true,
    element_count: 3,
    org_ids: ["org-1"],
    apps: [
      {
        id: "app-1",
        name: "SAP",
        subtype: "businessApplication",
        attributes: { costTotalAnnual: 100 },
        lifecycle: { endOfLife: "2030-01-01" },
      },
    ],
    data_objects: [{ id: "do-1", name: "Customer" }],
  }),
  proc("quote", "Quote", {
    parent_id: "o2c",
    attributes: { processType: "core", sortOrder: 1 },
    has_diagram: true,
    element_count: 2,
    apps: [{ id: "app-2", name: "CRM", attributes: { totalAnnualCost: 50 } }],
  }),
  proc("pricing", "Pricing", { parent_id: "quote" }),
  proc("billing", "Billing", {
    parent_id: "o2c",
    attributes: { processType: "core", sortOrder: 2 },
    element_count: 4,
  }),
  proc("p2p", "Procure to Pay", { attributes: { processType: "core", sortOrder: 2 } }),
  proc("hr", "Hire to Retire", { attributes: { processType: "support" }, org_ids: ["org-2"] }),
  proc("budget", "Budgeting", { attributes: { processType: "management" } }),
  // No processType: falls into the default ("core") row.
  proc("misc", "Misc Process", { attributes: {} }),
];

const ORGS = [
  { id: "org-1", name: "Finance" },
  { id: "org-2", name: "People" },
];

const STEPS = [
  {
    id: "s1",
    bpmn_element_id: "task_1",
    element_type: "userTask",
    name: "Receive Order",
    documentation: "See https://wiki.example.com/order",
    lane_name: "Sales",
    is_automated: true,
    sequence_order: 0,
    application_id: "app-1",
    application_name: "SAP",
    data_object_id: "do-1",
    data_object_name: "Customer",
    it_component_id: "itc-1",
    it_component_name: "Oracle DB",
    business_process_id: "callee-1",
    business_process_name: "Credit Check",
    organizations: [{ id: "org-1", name: "Finance" }],
  },
  {
    id: "s2",
    bpmn_element_id: "gw_1",
    element_type: "exclusiveGateway",
    lane_name: "Sales",
    is_automated: false,
    sequence_order: 1,
  },
  {
    id: "s3",
    bpmn_element_id: "end_1",
    element_type: "endEvent",
    name: "Done",
    is_automated: false,
    sequence_order: 2,
  },
];

interface Script {
  items?: unknown[];
  orgs?: unknown[];
  published?: unknown;
  steps?: unknown[];
  drafts?: unknown[];
  card?: unknown;
}

function script(s: Script = {}) {
  mockApi.on("get", "/reports/bpm/process-map", {
    items: s.items ?? ITEMS,
    organizations: s.orgs ?? ORGS,
  });
  mockApi.on("get", "/settings/bpm-row-order", { row_order: ["management", "core", "support"] });
  mockApi.on(
    "get",
    /\/flow\/published$/,
    "published" in s ? s.published : { bpmn_xml: "<xml/>", svg_thumbnail: null },
  );
  mockApi.on("get", /\/elements$/, s.steps ?? STEPS);
  mockApi.on("get", /\/flow\/drafts$/, s.drafts ?? []);
  mockApi.on(
    "get",
    /^\/cards\/[^/]+$/,
    s.card ?? {
      description: "Card description",
      lifecycle: { active: "2020-01-01", phaseOut: "" },
      data_quality: 75.4,
      approval_status: "BROKEN",
      tags: [
        { id: "t1", name: "Strategic", color: "#123456" },
        { id: "t2", name: "Plain" },
      ],
    },
  );
  mockApi.on("patch", "/cards/*", {});
  mockApi.on("patch", "/settings/bpm-row-order", {});
}

function renderNavigator(route = "/bpm") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ProcessNavigator />
    </MemoryRouter>,
  );
}

async function renderLoaded(route = "/bpm") {
  const user = userEvent.setup();
  renderNavigator(route);
  await screen.findByText("Procure to Pay");
  return user;
}

/** The card element (leaf or container) whose title is `name`. */
function cardOf(name: string): HTMLElement {
  const title = screen.getAllByText(name).find((el) => el.closest("[draggable]"));
  if (!title) throw new Error(`no card ${name}`);
  return title.closest("[draggable]") as HTMLElement;
}

/** The drawer's paper, once open. */
async function drawer() {
  const tab = await screen.findByRole("tab", { name: /Overview/ });
  return within(tab.closest(".MuiDrawer-paper") as HTMLElement);
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([BP_TYPE, APP_TYPE]);
  hookState.auth.user = makeUser({ role: "member" });
  mockNavigate.mockReset();
  localStorage.clear();
  script();
});

// ---------------------------------------------------------------------------
// House view
// ---------------------------------------------------------------------------

describe("ProcessNavigator house view", () => {
  it("renders containers with their nested children, counts and the default row", async () => {
    await renderLoaded();
    // o2c is a container at the default depth 2: its children render inside it.
    expect(screen.getByText("Quote")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    // Its meta row: the subtype label, the flow button with the element count.
    const container = cardOf("Order to Cash");
    expect(within(container).getByText("Value Chain")).toBeInTheDocument();
    expect(within(container).getAllByRole("button", { name: "View Flow" }).length).toBeGreaterThan(0);
    expect(within(container).getByText("3")).toBeInTheDocument();
    // A process with no processType sits in the default (core) row.
    expect(screen.getByText("Misc Process")).toBeInTheDocument();
    expect(screen.getByText("8 processes")).toBeInTheDocument();
    // An option nobody uses still gets a (placeholder) row.
    expect(screen.getByText("No Innovation Processes defined")).toBeInTheDocument();
  });

  it("dims non-matches while searching, hides empty rows, and clears", async () => {
    const user = await renderLoaded();
    await user.type(screen.getByPlaceholderText("Search processes..."), "pric");
    // Pricing matches; its ancestors are kept for context.
    expect(screen.getByText("3 of 8 processes")).toBeInTheDocument();
    expect(screen.queryByText("No Innovation Processes defined")).toBeNull();
    // Non-matches fade.
    expect(getComputedStyle(cardOf("Procure to Pay")).opacity).toBe("0.3");
    const searchBox = screen.getByPlaceholderText("Search processes...");
    await user.clear(searchBox);
    await user.type(searchBox, "procure");
    expect(screen.getByText("1 of 8 processes")).toBeInTheDocument();
    expect(getComputedStyle(cardOf("Procure to Pay")).opacity).toBe("1");
    await user.click(within(searchBox.closest(".MuiInputBase-root") as HTMLElement).getByRole("button"));
    expect(searchBox).toHaveValue("");
    expect(screen.getByText("8 processes")).toBeInTheDocument();
  });

  it("switches the colour overlay and its legend", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: /Maturity/ }));
    expect(screen.getByText("3-Defined")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Automation/ }));
    expect(screen.getByText("Fully Auto")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Risk/ }));
    expect(screen.getByText("Critical")).toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("turboea-report:process-navigator")!)).toMatchObject({
        overlay: "riskLevel",
      }),
    );
  });

  it("drills from a leaf's +N chip at depth 1, and walks back by breadcrumb", async () => {
    const user = await renderLoaded("/bpm?level=1");
    // At depth 1 every root is a leaf; o2c offers its two sub-processes.
    await user.click(screen.getByText("+2"));
    // Zoomed: o2c's children are the roots now.
    expect(await screen.findByRole("button", { name: "All Processes" })).toBeInTheDocument();
    expect(screen.queryByText("Procure to Pay")).toBeNull();
    expect(screen.getByText("Quote")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All Processes" }));
    expect(await screen.findByText("Procure to Pay")).toBeInTheDocument();
  });

  it("navigates a leaf by keyboard: Enter opens, ArrowRight drills", async () => {
    await renderLoaded("/bpm?level=1");
    const o2c = cardOf("Order to Cash");
    fireEvent.keyDown(o2c, { key: "ArrowRight" });
    expect(await screen.findByRole("button", { name: "All Processes" })).toBeInTheDocument();
    fireEvent.keyDown(cardOf("Billing"), { key: "Enter" });
    expect(await screen.findByRole("tab", { name: /Overview/ })).toBeInTheDocument();
  });

  it("drills into a container with its zoom button and through a middle breadcrumb", async () => {
    const user = await renderLoaded("/bpm?level=3");
    const container = cardOf("Order to Cash");
    await user.click(within(container).getAllByRole("button", { name: "Drill down into this process" })[0]);
    expect(await screen.findByRole("button", { name: "All Processes" })).toBeInTheDocument();

    // Zoom one level deeper via the URL-style state: Quote → Pricing.
    // Quote is nested, so it has no drill button; drill from its drawer instead.
    fireEvent.keyDown(screen.getByText("Quote").closest("[tabindex='0']")!, { key: "Enter" });
    const d = await drawer();
    await user.click(d.getByRole("button", { name: /Drill down into this process/ }));
    // Breadcrumbs: All Processes › Order to Cash › Quote
    const crumbs = within(screen.getByRole("navigation"));
    await user.click(crumbs.getByRole("button", { name: "Order to Cash" }));
    expect(crumbs.queryByText("Quote")).toBeNull();
  });

  it("opens a container's drawer by keyboard and its flow by keyboard", async () => {
    await renderLoaded();
    const header = screen.getByText("Order to Cash").closest("[tabindex='0']") as HTMLElement;
    fireEvent.keyDown(header, { key: "Enter" });
    expect(await screen.findByRole("tab", { name: /Overview/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull());

    const [flowButton] = within(cardOf("Order to Cash")).getAllByRole("button", { name: "View Flow" });
    fireEvent.keyDown(flowButton, { key: " " });
    expect(await screen.findByTestId("bpmn-viewer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("bpmn-viewer")).toBeNull());
  });

  it("shows an element-count badge on a container with steps but no flow", async () => {
    script({
      items: [
        proc("root", "Root Process", { element_count: 5 }),
        proc("kid", "Kid Process", { parent_id: "root" }),
      ],
    });
    renderNavigator();
    await screen.findByText("Kid Process");
    const root = cardOf("Root Process");
    expect(within(root).getByText("5")).toBeInTheDocument();
    expect(within(root).queryByRole("button", { name: "View Flow" })).toBeNull();
  });

  it("changes depth with the slider", async () => {
    await renderLoaded();
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "End" });
    // "All" depth reveals the third level inside its container.
    expect(await screen.findByText("Pricing")).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: "Home" });
    await waitFor(() => expect(screen.queryByText("Quote")).toBeNull());
  });

  it("filters by organization", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByPlaceholderText("Filter by Organization..."));
    await user.click(await screen.findByRole("option", { name: "Finance" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Procure to Pay")).toBeNull());
    expect(screen.getByText("Order to Cash")).toBeInTheDocument();
    expect(screen.getByText("8 total, showing filtered")).toBeInTheDocument();
  });

  it("resets every parameter to its default", async () => {
    const user = await renderLoaded("/bpm?level=1&overlay=maturity&search=bill");
    expect(screen.getByPlaceholderText("Search processes...")).toHaveValue("bill");
    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByPlaceholderText("Search processes...")).toHaveValue("");
    // Back at depth 2: o2c is a container again.
    expect(screen.getByText("Quote")).toBeInTheDocument();
  });

  it("shows the empty state when there are no processes", async () => {
    script({ items: [] });
    renderNavigator();
    expect(await screen.findByText(/No Business Processes found/)).toBeInTheDocument();
  });

  it("closes the drawer with Escape first, then leaves the zoom", async () => {
    // NB: `?open=<id>` is not exercised here — the URL-sync effect rewrites the
    // query on mount (drawer still closed) before the map has loaded, so the
    // deep-link drawer never opens. Reported as a source bug.
    const user = userEvent.setup();
    renderNavigator("/bpm?zoom=o2c");
    await user.click(await screen.findByText("Billing"));
    expect(await screen.findByRole("tab", { name: /Overview/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull());
    expect(screen.getByRole("button", { name: "All Processes" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "All Processes" })).toBeNull());
    expect(screen.getByText("Procure to Pay")).toBeInTheDocument();
  });

  it("shows the whole tree when the zoom target does not exist, and a leaf zoom shows the leaf", async () => {
    const { unmount } = renderNavigator("/bpm?zoom=nope");
    await screen.findByText("Procure to Pay");
    expect(screen.queryByRole("button", { name: "All Processes" })).toBeNull();
    unmount();

    renderNavigator("/bpm?zoom=p2p");
    // A leaf zoom shows the leaf itself (and names it in the breadcrumbs).
    await waitFor(() => expect(screen.getAllByText("Procure to Pay")).toHaveLength(2));
    expect(screen.queryByText("Hire to Retire")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Admin reordering
// ---------------------------------------------------------------------------

describe("ProcessNavigator admin reordering", () => {
  beforeEach(() => {
    hookState.auth.user = makeUser({ role: "admin" });
  });

  it("moves a row down and persists the order", async () => {
    const user = await renderLoaded();
    const ups = screen.getAllByRole("button", { name: "arrow_upward" });
    expect(ups[0]).toBeDisabled();
    const downs = screen.getAllByRole("button", { name: "arrow_downward" });
    expect(downs[downs.length - 1]).toBeDisabled();
    await user.click(downs[0]);
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/settings/bpm-row-order")[0].body).toEqual({
        row_order: ["core", "management", "support", "innovation"],
      }),
    );
    await user.click(screen.getAllByRole("button", { name: "arrow_upward" })[1]);
    await waitFor(() => expect(mockApi.callsOf("patch", "/settings/bpm-row-order")).toHaveLength(2));
  });

  it("keeps the new row order when saving it fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("patch", "/settings/bpm-row-order");
    const user = await renderLoaded();
    await user.click(screen.getAllByRole("button", { name: "arrow_downward" })[0]);
    await waitFor(() => expect(error).toHaveBeenCalledWith("Failed to save row order", expect.anything()));
    error.mockRestore();
  });

  it("drags a top-level leaf onto a sibling and saves both sort orders", async () => {
    await renderLoaded("/bpm?level=1");
    const o2c = cardOf("Order to Cash");
    const p2p = cardOf("Procure to Pay");
    expect(o2c).toHaveAttribute("draggable", "true");

    // Without grabbing the handle the drag is refused.
    fireEvent.dragStart(o2c, { dataTransfer: {} });
    fireEvent.drop(p2p, { dataTransfer: {} });
    expect(mockApi.callsOf("patch")).toHaveLength(0);

    fireEvent.mouseDown(within(o2c).getByText("drag_indicator"));
    fireEvent.dragStart(o2c, { dataTransfer: {} });
    fireEvent.dragOver(p2p, { dataTransfer: {} });
    fireEvent.dragLeave(p2p, { dataTransfer: {} });
    fireEvent.dragOver(p2p, { dataTransfer: {} });
    fireEvent.drop(p2p, { dataTransfer: {} });
    fireEvent.dragEnd(o2c, { dataTransfer: {} });
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/*")).toHaveLength(3));
    const bodies = Object.fromEntries(
      mockApi.callsOf("patch", "/cards/*").map((c) => [c.path, c.body]),
    );
    // Core row roots sorted: o2c(1), p2p(2), misc(999) → p2p, o2c, misc.
    expect(bodies["/cards/p2p"]).toEqual({ attributes: { sortOrder: 0 } });
    expect(bodies["/cards/o2c"]).toEqual({ attributes: { sortOrder: 1 } });
    expect(bodies["/cards/misc"]).toEqual({ attributes: { sortOrder: 2 } });
    // The map reloads after a reorder.
    await waitFor(() => expect(mockApi.callsOf("get", "/reports/bpm/process-map")).toHaveLength(2));
  });

  it("drags nested cards within their parent, and logs a failed reorder", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("patch", "/cards/*");
    await renderLoaded("/bpm?level=3");
    const quote = cardOf("Quote");
    const billing = cardOf("Billing");
    // Quote is a nested container, Billing a nested leaf: both draggable.
    // Quote's own handle comes first; its child Pricing carries another.
    const quoteHandle = within(quote).getAllByText("drag_indicator")[0];
    fireEvent.mouseDown(quoteHandle);
    fireEvent.mouseUp(quoteHandle);
    fireEvent.mouseDown(quoteHandle);
    fireEvent.dragStart(quote, { dataTransfer: {} });
    fireEvent.dragOver(billing, { dataTransfer: {} });
    fireEvent.drop(billing, { dataTransfer: {} });
    fireEvent.dragEnd(quote, { dataTransfer: {} });
    await waitFor(() => expect(error).toHaveBeenCalledWith("Drag reorder failed", expect.anything()));
    expect(mockApi.callsOf("patch", "/cards/quote")[0].body).toEqual({ attributes: { sortOrder: 1 } });

    // A nested leaf can be dropped onto a nested container in the same parent.
    fireEvent.mouseDown(within(billing).getByText("drag_indicator"));
    fireEvent.dragStart(billing, { dataTransfer: {} });
    fireEvent.dragOver(quote, { dataTransfer: {} });
    fireEvent.dragLeave(quote, { dataTransfer: {} });
    fireEvent.drop(quote, { dataTransfer: {} });
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/*").length).toBeGreaterThan(2));
    error.mockRestore();
  });

  it("ignores a drop across rows", async () => {
    await renderLoaded("/bpm?level=1");
    const o2c = cardOf("Order to Cash");
    fireEvent.mouseDown(within(o2c).getByText("drag_indicator"));
    fireEvent.dragStart(o2c, { dataTransfer: {} });
    fireEvent.drop(cardOf("Hire to Retire"), { dataTransfer: {} });
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Drawer tabs
// ---------------------------------------------------------------------------

describe("ProcessNavigator drawer", () => {
  async function openDrawer(name = "Order to Cash", route = "/bpm") {
    const user = await renderLoaded(route);
    await user.click(screen.getByText(name));
    return { user, d: await drawer() };
  }

  it("Overview: attribute chips, KPIs, card details, sub-processes and actions", async () => {
    const { user, d } = await openDrawer();
    expect(d.getByText("Type: Core")).toBeInTheDocument();
    expect(d.getByText("Maturity: 3-Defined")).toBeInTheDocument();
    expect(d.getByText("Automation: Manual")).toBeInTheDocument();
    expect(d.getByText("Risk: High")).toBeInTheDocument();
    expect(d.getByText("Value Chain")).toBeInTheDocument();
    // From the card fetch
    expect(await d.findByText("Card description")).toBeInTheDocument();
    expect(d.getByText("active: 2020-01-01")).toBeInTheDocument();
    expect(d.queryByText(/phaseOut/)).toBeNull();
    expect(d.getByText("75%")).toBeInTheDocument();
    expect(d.getByText("BROKEN")).toBeInTheDocument();
    expect(d.getByText("Strategic")).toBeInTheDocument();
    expect(d.getByText("Plain")).toBeInTheDocument();
    // Sub-processes: Quote has a child and an app.
    expect(d.getByText("Sub-Processes (2)")).toBeInTheDocument();
    expect(d.getByText("+1")).toBeInTheDocument();
    expect(d.getByText("1 app")).toBeInTheDocument();

    await user.click(d.getByText("View Flow"));
    expect(mockNavigate).toHaveBeenCalledWith("/cards/o2c?tab=1");
    await user.click(d.getByRole("button", { name: "Open Card" }));
    expect(mockNavigate).toHaveBeenCalledWith("/cards/o2c");

    // Switch to a sub-process in place.
    await user.click(d.getByText("Billing"));
    expect(await d.findByText("Billing", { selector: "h6" })).toBeInTheDocument();
  });

  it("Overview: approval colours and a failed card fetch", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    script({ card: { approval_status: "APPROVED", tags: [] } });
    const { d, user } = await openDrawer("Procure to Pay");
    expect(await d.findByText("APPROVED")).toBeInTheDocument();
    // No data quality number and no description.
    expect(d.queryByText("Completion")).toBeNull();
    expect(d.queryByText("Description")).toBeNull();
    await user.click(d.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull());

    mockApi.fail("get", /^\/cards\/[^/]+$/);
    await user.click(screen.getByText("Hire to Retire"));
    await drawer();
    await waitFor(() => expect(error).toHaveBeenCalled());
    error.mockRestore();
  });

  it.each([
    ["REJECTED", "error"],
    ["PENDING", "default"],
  ])("Overview: %s approval renders with the %s colour", async (status, colour) => {
    script({ card: { approval_status: status } });
    const { d } = await openDrawer("Procure to Pay");
    const chip = (await d.findByText(status)).closest(".MuiChip-root") as HTMLElement;
    expect(chip.className).toContain(`MuiChip-color${colour.charAt(0).toUpperCase()}${colour.slice(1)}`);
  });

  it("Steps: lanes, automation, documentation and the five step links", async () => {
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Steps \(3\)/ }));
    expect(await d.findByText("Receive Order")).toBeInTheDocument();
    // Two lanes → lane headers, the unlaned step under the default lane.
    expect(d.getByText("Sales")).toBeInTheDocument();
    expect(d.getByText("(Default)")).toBeInTheDocument();
    expect(d.getByText("Auto")).toBeInTheDocument();
    expect(d.getByText("(unnamed)")).toBeInTheDocument();
    expect(d.getByRole("link", { name: "https://wiki.example.com/order" })).toBeInTheDocument();

    await user.click(d.getByText("SAP"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/app-1");
    await user.click(d.getByText("Customer"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/do-1");
    await user.click(d.getByText("Oracle DB"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/itc-1");
    await user.click(d.getByText("Credit Check"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/callee-1?tab=1");
    await user.click(d.getByText("Finance"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/org-1");
  });

  it("Steps: empty state, and a single lane carries no header", async () => {
    script({ steps: [] });
    const { user, d } = await openDrawer("Procure to Pay");
    await user.click(d.getByRole("tab", { name: /Steps/ }));
    expect(await d.findByText(/No BPMN elements found/)).toBeInTheDocument();
  });

  it("Flow: the published thumbnail opens the flow tab", async () => {
    script({ published: { bpmn_xml: "<xml/>", svg_thumbnail: "<svg data-testid='thumb'></svg>" } });
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    const thumb = await d.findByTestId("thumb");
    await user.click(thumb.parentElement!);
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/o2c?tab=1");
    await user.click(d.getByText("View Published Flow"));
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  it("Flow: published without a thumbnail", async () => {
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    expect(await d.findByText("Published flow available.")).toBeInTheDocument();
    await user.click(d.getByText("View Published Flow"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/o2c?tab=1");
  });

  it("Flow: drafts only point at the drafts tab", async () => {
    script({ published: null, drafts: [{ id: "d1" }] });
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    await user.click(await d.findByText("View Drafts"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/o2c?tab=1&subtab=1");
  });

  it("Flow: nothing at all offers the editor", async () => {
    mockApi.fail("get", /\/flow\/published$/);
    mockApi.fail("get", /\/flow\/drafts$/);
    const { user, d } = await openDrawer("Procure to Pay");
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    await user.click(await d.findByText("Go to Process Flow"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/p2p?tab=1");
  });

  it("Apps and Data tabs list the rolled-up landscape, or say there is none", async () => {
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Apps \(2\)/ }));
    expect(d.getByText("CRM")).toBeInTheDocument();
    expect(d.getByText("Business Application")).toBeInTheDocument();
    expect(d.getByLabelText("End of Life")).toBeInTheDocument();
    await user.click(d.getByText("SAP"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/app-1");

    await user.click(d.getByRole("tab", { name: /Data \(1\)/ }));
    await user.click(d.getByText("Customer"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/do-1");

    // A process with nothing linked.
    await user.click(d.getByRole("tab", { name: /Overview/ }));
    await user.click(d.getByText("Billing"));
    await user.click(d.getByRole("tab", { name: /Apps \(0\)/ }));
    expect(d.getByText("No applications linked to this process.")).toBeInTheDocument();
    await user.click(d.getByRole("tab", { name: /Data \(0\)/ }));
    expect(d.getByText("No data objects linked to this process.")).toBeInTheDocument();
  });

  it("drills from the drawer's chip", async () => {
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("button", { name: /Drill down into this process/ }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull());
    expect(screen.getByRole("button", { name: "All Processes" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Matrix + dependencies
// ---------------------------------------------------------------------------

describe("ProcessNavigator matrix and dependency views", () => {
  it("shows the process × application matrix with element and relation chips", async () => {
    mockApi.on("get", "/reports/bpm/process-application-matrix", {
      rows: [{ id: "o2c", name: "Order to Cash" }],
      columns: [
        { id: "app-1", name: "SAP" },
        { id: "app-2", name: "CRM" },
        { id: "app-3", name: "Unused" },
      ],
      cells: [
        { process_id: "o2c", application_id: "app-1", source: "element", element_name: "Receive" },
        { process_id: "o2c", application_id: "app-2", source: "relation" },
      ],
    });
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Process × App Matrix" }));
    expect(await screen.findByText("E")).toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
    expect(screen.getByLabelText("Element: Receive")).toBeInTheDocument();
    await user.click(screen.getByRole("cell", { name: "Order to Cash" }));
    expect(mockNavigate).toHaveBeenCalledWith("/cards/o2c");
  });

  it("says the matrix is empty", async () => {
    mockApi.on("get", "/reports/bpm/process-application-matrix", { rows: [], columns: [], cells: [] });
    renderNavigator("/bpm?view=matrix");
    expect(await screen.findByText("No data. Link processes to applications first.")).toBeInTheDocument();
  });

  it("lists process dependencies and opens either end", async () => {
    mockApi.on("get", "/reports/bpm/process-dependencies", {
      nodes: [
        { id: "o2c", name: "Order to Cash" },
        { id: "p2p", name: "Procure to Pay" },
      ],
      edges: [
        { id: "e1", source: "o2c", target: "p2p" },
        { id: "e2", source: "ghost", target: "o2c" },
      ],
    });
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Process Dependencies" }));
    expect(await screen.findByText("2 processes, 2 dependencies")).toBeInTheDocument();
    // An edge to a node the payload lacks falls back to its id.
    expect(screen.getByText("ghost")).toBeInTheDocument();
    await user.click(screen.getAllByRole("cell", { name: "Procure to Pay" })[0]);
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/p2p");
    await user.click(screen.getAllByRole("cell", { name: "Order to Cash" })[0]);
    expect(mockNavigate).toHaveBeenLastCalledWith("/cards/o2c");
  });

  it("logs a failed dependencies load and stops loading", async () => {
    // Only the correct half is pinned: the page currently shows the "no
    // dependencies" empty state on a failed load, which is a bug (a failure
    // should say so) — not something to lock in.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("get", "/reports/bpm/process-dependencies");
    renderNavigator("/bpm?view=dependencies");
    await waitFor(() => expect(error).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    error.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Portal-shaped capabilities (the published navigator's contract)
// ---------------------------------------------------------------------------

describe("ProcessNavigatorBody with a restricted capability set", () => {
  const PORTAL_CAPS: NavigatorCapabilities = {
    viewModes: ["house"],
    drawerTabs: ["overview", "steps", "flow"],
    canOpenCard: false,
    canReorder: false,
    showRollups: false,
    persistPreferences: false,
    initial: { level: 1, overlay: "maturity", columns: 2 },
  };

  function renderBody(
    source: Partial<ProcessNavigatorSource> = {},
    caps: NavigatorCapabilities = PORTAL_CAPS,
  ) {
    const full: ProcessNavigatorSource = {
      loadMap: async () => ({
        items: [
          proc("o2c", "Order to Cash", {
            description: "Published description",
            lifecycle: { active: "2021-01-01" },
            has_diagram: true,
            element_count: 1,
            apps: [{ id: "app-1", name: "SAP" }],
          }),
          proc("quote", "Quote", { parent_id: "o2c" }),
        ],
        organizations: [],
        rowOrder: [],
      }),
      loadFlow: async () => ({
        bpmnXml: null,
        svgThumbnail: null,
        steps: [STEPS[0]],
        hasDrafts: false,
      }),
      ...source,
    };
    const meta = {
      typeIcon: "route",
      typeColor: "#028f00",
      subtypes: [],
      processTypes: processTypeOptionsFrom(BP_TYPE.fields_schema, (o) => o.label ?? o.key, false),
    };
    return render(
      <MemoryRouter initialEntries={["/portal/p"]}>
        <ProcessNavigatorProvider value={{ source: full, capabilities: caps, meta }}>
          <ProcessNavigatorBody />
        </ProcessNavigatorProvider>
      </MemoryRouter>,
    );
  }

  afterEach(() => {
    localStorage.clear();
  });

  it("opens at the configured state, offers only the house, and never persists", async () => {
    const user = userEvent.setup();
    renderBody();
    expect(await screen.findByText("Order to Cash")).toBeInTheDocument();
    // Level 1 → o2c is a leaf with a +1 chip; maturity legend is on.
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("1-Initial")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Process × App Matrix" })).toBeNull();
    // No rollup badge for the app count.
    expect(within(cardOf("Order to Cash")).queryByLabelText(/application/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Risk/ }));
    expect(localStorage.getItem("turboea-report:process-navigator")).toBeNull();
  });

  it("renders the drawer from the map alone, with no card links", async () => {
    const user = userEvent.setup();
    renderBody();
    await user.click(await screen.findByText("Order to Cash"));
    const d = await drawer();
    expect(d.getByText("Published description")).toBeInTheDocument();
    expect(d.getByText("active: 2021-01-01")).toBeInTheDocument();
    expect(d.queryByRole("button", { name: "Open Card" })).toBeNull();
    expect(d.queryByText("View Flow")).toBeNull();
    expect(d.queryByRole("tab", { name: /Apps/ })).toBeNull();

    // Step links render but go nowhere.
    await user.click(d.getByRole("tab", { name: /Steps/ }));
    await user.click(await d.findByText("SAP"));
    await user.click(d.getByText("Credit Check"));
    await user.click(d.getByText("Finance"));
    expect(mockNavigate).not.toHaveBeenCalled();

    // Flow tab: nothing published, and no way into the editor.
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    expect(await d.findByText("No process flow available.")).toBeInTheDocument();
    expect(d.queryByText("Go to Process Flow")).toBeNull();
  });

  it("shows a published flow without an editor link, and a step load failure", async () => {
    const user = userEvent.setup();
    renderBody({
      loadFlow: vi
        .fn()
        .mockResolvedValueOnce({ bpmnXml: "<xml/>", svgThumbnail: "<svg data-testid='pthumb'></svg>", steps: [], hasDrafts: false })
        .mockRejectedValueOnce(new Error("Steps exploded"))
        .mockResolvedValue({ bpmnXml: "<xml/>", svgThumbnail: null, steps: [], hasDrafts: false }),
    });
    await user.click(await screen.findByText("Order to Cash"));
    const d = await drawer();
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    expect(await d.findByTestId("pthumb")).toBeInTheDocument();
    expect(d.queryByText("View Published Flow")).toBeNull();

    await user.click(d.getByRole("tab", { name: /Steps/ }));
    expect(await d.findByText("Steps exploded")).toBeInTheDocument();

    await user.click(d.getByRole("tab", { name: /Flow/ }));
    expect(await d.findByText("Published flow available.")).toBeInTheDocument();
    expect(d.queryByText("View Published Flow")).toBeNull();
  });

  it("opens the fullscreen preview without the editor action, and shows its empty state", async () => {
    const user = userEvent.setup();
    renderBody();
    await screen.findByText("Order to Cash");
    await user.click(screen.getByRole("button", { name: "View Flow" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("No process flow available.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /View Flow/ })).toBeNull();
    expect(dialog.queryByText("Go to Process Flow")).toBeNull();
  });

  it("falls back to the generic message when a step load rejects without one", async () => {
    const user = userEvent.setup();
    renderBody({ loadFlow: () => Promise.reject({}) });
    await user.click(await screen.findByText("Order to Cash"));
    const d = await drawer();
    await user.click(d.getByRole("tab", { name: /Steps/ }));
    expect(await d.findByText("Failed to load elements")).toBeInTheDocument();
  });

  it("starts from defaults when no initial state is configured", async () => {
    renderBody({}, { ...PORTAL_CAPS, initial: undefined });
    expect(await screen.findByText("Quote")).toBeInTheDocument();
  });

  it("logs a failed map load and stops loading", async () => {
    // Only the correct half is pinned: the page currently shows the empty
    // house ("No Business Processes found") on a failed load, which is a bug
    // (a failure should say so) — not something to lock in.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBody({ loadMap: () => Promise.reject(new Error("map down")) }, FULL_CAPABILITIES);
    await waitFor(() => expect(error).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelectorAll(".MuiSkeleton-root")).toHaveLength(0));
    error.mockRestore();
  });
});

describe("ProcessNavigator fullscreen preview", () => {
  it("routes from the empty preview to the editor", async () => {
    script({ published: null });
    const user = await renderLoaded();
    const [flow] = within(cardOf("Order to Cash")).getAllByRole("button", { name: "View Flow" });
    await user.click(flow);
    await user.click(await screen.findByText("Go to Process Flow"));
    expect(mockNavigate).toHaveBeenCalledWith("/cards/o2c?tab=1");
  });

  it("hands the viewer the metamodel's link colours", async () => {
    const user = await renderLoaded();
    const [flow] = within(cardOf("Order to Cash")).getAllByRole("button", { name: "View Flow" });
    await act(async () => {
      await user.click(flow);
    });
    await waitFor(() =>
      expect(screen.getByTestId("bpmn-viewer")).toHaveAttribute("data-has-colors", "true"),
    );
  });
});
