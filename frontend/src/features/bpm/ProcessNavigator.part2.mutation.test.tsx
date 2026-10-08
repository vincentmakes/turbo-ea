/**
 * ProcessNavigator, second half of the module (fullscreen flow preview, the
 * drawer's Apps / Data tabs, the drawer shell, the matrix and dependency
 * views, the depth slider, the overlay legend, and the navigator body's
 * state, URL sync, persistence, reordering and the in-app container).
 *
 * Written against surviving mutants: every assertion here pins an observable
 * outcome the sibling suites (`ProcessNavigator.test.tsx`,
 * `ProcessNavigator.branches.test.tsx`) exercise without checking. Mocks use
 * the `@/…` alias paths so the file also runs from an out-of-tree copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));
vi.mock("@/features/bpm/BpmnViewer", () => ({
  default: ({ bpmnXml }: { bpmnXml: string }) => <div data-testid="bpmn-viewer">{bpmnXml}</div>,
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
  type NavigatorMapPayload,
  type NavigatorMeta,
  type ProcessFlowPayload,
  type ProcessNavigatorSource,
} from "@/features/bpm/ProcessNavigatorContext";
import { processTypeOptionsFrom } from "@/features/bpm/useProcessTypeOptions";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeField, makeOption, makeSection, makeSubtype } from "@/test/fixtures/metamodel";
import { makeUser } from "@/test/render";
import type { CardType, FieldOption } from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STORAGE_KEY = "turboea-report:process-navigator";
const MATRIX = "/reports/bpm/process-application-matrix";
const DEPENDENCIES = "/reports/bpm/process-dependencies";

function processTypeField(options: FieldOption[]) {
  return makeField({ key: "processType", type: "single_select", options });
}

const DEFAULT_OPTIONS = [
  makeOption({ key: "core", label: "Core", color: "#1976d2" }),
  makeOption({ key: "support", label: "Support", color: "#607d8b" }),
  makeOption({ key: "management", label: "Management", color: "#9c27b0" }),
  makeOption({ key: "innovation", label: "Innovation", color: "#ff8800" }),
];

/** Innovation first: no prefix of the default row order lines up with it. */
const SHUFFLED_OPTIONS = [
  makeOption({ key: "innovation", label: "Innovation", color: "#ff8800" }),
  makeOption({ key: "core", label: "Core", color: "#1976d2" }),
  makeOption({ key: "support", label: "Support", color: "#607d8b" }),
  makeOption({ key: "management", label: "Management", color: "#9c27b0" }),
];

function bpType(options: FieldOption[] = DEFAULT_OPTIONS, overrides: Partial<CardType> = {}) {
  return makeCardType({
    key: "BusinessProcess",
    icon: "route",
    color: "#028f00",
    subtypes: [makeSubtype({ key: "valueChain", label: "Value Chain" })],
    fields_schema: [makeSection({ section: "Classification", fields: [processTypeField(options)] })],
    ...overrides,
  });
}

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
    attributes: { processType: "core", sortOrder: 1 },
    has_diagram: true,
    element_count: 3,
    org_ids: ["org-1"],
    // Deliberately out of alphabetical order: the drawer sorts them.
    apps: [
      {
        id: "app-z",
        name: "Zeta App",
        subtype: "businessApplication",
        lifecycle: { endOfLife: "2030-01-01" },
      },
      { id: "app-a", name: "Alpha App" },
    ],
    data_objects: [
      { id: "do-z", name: "Zebra Data" },
      { id: "do-a", name: "Apple Data" },
    ],
  }),
  proc("quote", "Quote", { parent_id: "o2c", attributes: { processType: "core", sortOrder: 1 } }),
  proc("pricing", "Pricing", { parent_id: "quote" }),
  proc("billing", "Billing", { parent_id: "o2c", attributes: { processType: "core", sortOrder: 2 } }),
  proc("p2p", "Procure to Pay", { attributes: { processType: "core", sortOrder: 2 } }),
  proc("hr", "Hire to Retire", { attributes: { processType: "support" }, org_ids: ["org-2"] }),
  proc("budget", "Budgeting", { attributes: { processType: "management" } }),
];

const ORGS = [
  { id: "org-1", name: "Finance" },
  { id: "org-2", name: "People" },
];

interface Script {
  items?: unknown[];
  orgs?: unknown[] | null;
  rowOrder?: unknown;
  published?: unknown;
}

function script(s: Script = {}) {
  const map: Record<string, unknown> = { items: s.items ?? ITEMS };
  if (s.orgs !== null) map.organizations = s.orgs ?? ORGS;
  mockApi.on("get", "/reports/bpm/process-map", map);
  mockApi.on(
    "get",
    "/settings/bpm-row-order",
    "rowOrder" in s ? s.rowOrder : { row_order: ["management", "core", "support"] },
  );
  mockApi.on(
    "get",
    /\/flow\/published$/,
    "published" in s ? s.published : { bpmn_xml: "<xml/>", svg_thumbnail: null },
  );
  mockApi.on("get", /\/elements$/, []);
  mockApi.on("get", /\/flow\/drafts$/, []);
  mockApi.on("get", /^\/cards\/[^/]+$/, { description: "", tags: [] });
  mockApi.on("patch", "/cards/*", {});
  mockApi.on("patch", "/settings/bpm-row-order", {});
}

/** The router's current query string and how it got there. */
function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <div data-testid="location" data-type={type}>
      {new URLSearchParams(location.search).toString()}
    </div>
  );
}

const locationText = () => screen.getByTestId("location").textContent;

function renderNavigator(route = "/bpm") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ProcessNavigator />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function renderLoaded(route = "/bpm", waitFor = "Procure to Pay") {
  const user = userEvent.setup();
  const utils = renderNavigator(route);
  await screen.findByText(waitFor);
  return { user, ...utils };
}

function meta(options: FieldOption[] = DEFAULT_OPTIONS, overrides: Partial<NavigatorMeta> = {}): NavigatorMeta {
  return {
    typeIcon: "route",
    typeColor: "#028f00",
    subtypes: [],
    processTypes: processTypeOptionsFrom(
      bpType(options).fields_schema,
      (o) => o.label ?? o.key,
      false,
    ),
    ...overrides,
  };
}

function mapPayload(overrides: Partial<NavigatorMapPayload> = {}): NavigatorMapPayload {
  return { items: ITEMS, organizations: ORGS, rowOrder: [], ...overrides };
}

const EMPTY_FLOW: ProcessFlowPayload = { bpmnXml: null, svgThumbnail: null, steps: [], hasDrafts: false };

function bodySource(overrides: Partial<ProcessNavigatorSource> = {}): ProcessNavigatorSource {
  return {
    loadMap: async () => mapPayload(),
    loadFlow: async () => EMPTY_FLOW,
    ...overrides,
  };
}

function bodyTree(
  source: ProcessNavigatorSource,
  caps: NavigatorCapabilities = FULL_CAPABILITIES,
  m: NavigatorMeta = meta(),
  route = "/portal/p",
) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <ProcessNavigatorProvider value={{ source, capabilities: caps, meta: m }}>
        <ProcessNavigatorBody />
      </ProcessNavigatorProvider>
      <LocationProbe />
    </MemoryRouter>
  );
}

function renderBody(
  source: ProcessNavigatorSource = bodySource(),
  caps: NavigatorCapabilities = FULL_CAPABILITIES,
  m: NavigatorMeta = meta(),
  route = "/portal/p",
) {
  return render(bodyTree(source, caps, m, route));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

/** Row headers of the Process House, top to bottom. */
function rowHeaders(): string[] {
  return screen
    .getAllByText(/^\S+ Processes$/)
    .filter((el) => el.tagName !== "BUTTON")
    .map((el) => el.textContent ?? "");
}

/** Drag `from` onto `to` through the handle, the way the house cards expect. */
function dragOnto(from: HTMLElement, to: HTMLElement) {
  fireEvent.mouseDown(within(from).getAllByText("drag_indicator")[0]);
  fireEvent.dragStart(from, { dataTransfer: {} });
  fireEvent.dragOver(to, { dataTransfer: {} });
  fireEvent.drop(to, { dataTransfer: {} });
  fireEvent.dragEnd(from, { dataTransfer: {} });
}

function sortOrderBodies() {
  return Object.fromEntries(
    mockApi
      .callsOf("patch", "/cards/*")
      .map((c) => [c.path.replace("/cards/", ""), (c.body as { attributes: { sortOrder: number } }).attributes.sortOrder]),
  );
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([bpType(), APP_TYPE]);
  hookState.auth.user = makeUser({ role: "member" });
  mockNavigate.mockReset();
  localStorage.clear();
  script();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fullscreen flow preview
// ---------------------------------------------------------------------------

describe("FlowPreviewDialog", () => {
  it("names the process and the flow in its app bar", async () => {
    const { user } = await renderLoaded();
    const [flow] = within(cardOf("Order to Cash")).getAllByRole("button", { name: "View Flow" });
    await user.click(flow);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Order to Cash — Flow")).toBeInTheDocument();
    expect(await dialog.findByTestId("bpmn-viewer")).toHaveTextContent("<xml/>");
  });

  it("reloads for a new process and ignores the answer for the one it left", async () => {
    const flows: Record<string, ReturnType<typeof deferred<ProcessFlowPayload>>> = {
      a: deferred<ProcessFlowPayload>(),
      b: deferred<ProcessFlowPayload>(),
    };
    const loadFlow = vi.fn((id: string) => flows[id].promise);
    renderBody(
      bodySource({
        loadMap: async () =>
          mapPayload({
            items: [
              proc("a", "Alpha Flow", { has_diagram: true }),
              proc("b", "Beta Flow", { has_diagram: true }),
            ],
          }),
        loadFlow,
      }),
    );
    await screen.findByText("Beta Flow");
    fireEvent.click(within(cardOf("Alpha Flow")).getByRole("button", { name: "View Flow" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("progressbar")).toBeInTheDocument();

    // The house sits behind the modal; switch the preview to Beta from there.
    fireEvent.click(within(cardOf("Beta Flow")).getByRole("button", { name: "View Flow", hidden: true }));
    expect(within(dialog).getByText("Beta Flow — Flow")).toBeInTheDocument();
    await waitFor(() => expect(loadFlow).toHaveBeenLastCalledWith("b"));

    await act(async () => {
      flows.b.resolve({ ...EMPTY_FLOW, bpmnXml: "XML-B" });
    });
    expect(await within(dialog).findByTestId("bpmn-viewer")).toHaveTextContent("XML-B");

    // Alpha's late answer must not overwrite Beta's diagram.
    await act(async () => {
      flows.a.resolve({ ...EMPTY_FLOW, bpmnXml: "XML-A" });
    });
    expect(within(dialog).getByTestId("bpmn-viewer")).toHaveTextContent("XML-B");
  });

  it("drops an answer that lands after the preview closed", async () => {
    const pending = deferred<ProcessFlowPayload>();
    renderBody(
      bodySource({
        loadMap: async () => mapPayload({ items: [proc("a", "Alpha Flow", { has_diagram: true })] }),
        loadFlow: () => pending.promise,
      }),
    );
    await screen.findByText("Alpha Flow");
    fireEvent.click(within(cardOf("Alpha Flow")).getByRole("button", { name: "View Flow" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      pending.resolve({ ...EMPTY_FLOW, bpmnXml: "XML-A" });
    });
    expect(screen.queryByTestId("bpmn-viewer")).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

describe("ProcessDrawer", () => {
  async function openDrawer(name = "Order to Cash") {
    const loaded = await renderLoaded();
    await loaded.user.click(screen.getByText(name));
    return { ...loaded, d: await drawer() };
  }

  it("titles its tabs, Steps with the element count", async () => {
    const { d } = await openDrawer();
    expect(d.getByRole("tab", { name: /Overview/ })).toHaveAttribute("aria-selected", "true");
    expect(d.getByRole("tab", { name: /Steps \(3\)/ })).toBeInTheDocument();
    expect(d.getByRole("tab", { name: /Flow/ })).toBeInTheDocument();
    expect(d.getByRole("tab", { name: /Apps \(2\)/ })).toBeInTheDocument();
    expect(d.getByRole("tab", { name: /Data \(2\)/ })).toBeInTheDocument();
  });

  it("explains the Open Card action in a tooltip", async () => {
    const { user, d } = await openDrawer();
    await user.hover(d.getByRole("button", { name: "Open Card" }));
    expect(await screen.findByRole("tooltip", {}, { timeout: 3000 })).toHaveTextContent("Open Card");
  });

  it("lists apps alphabetically and flags only the end-of-life one", async () => {
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Apps/ }));
    expect(d.getAllByText(/^(Alpha|Zeta) App$/).map((el) => el.textContent)).toEqual([
      "Alpha App",
      "Zeta App",
    ]);
    expect(d.getAllByLabelText("End of Life")).toHaveLength(1);
    expect(d.queryByText("2030-01-01")).toBeNull();
    // The Overview content belongs to its own tab only.
    expect(d.queryByText("Type: Core")).toBeNull();
  });

  it("lists data objects alphabetically", async () => {
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Data/ }));
    expect(d.getAllByText(/^(Apple|Zebra) Data$/).map((el) => el.textContent)).toEqual([
      "Apple Data",
      "Zebra Data",
    ]);
  });

  it("says when nothing is linked", async () => {
    const { user, d } = await openDrawer("Procure to Pay");
    // No elements: the Steps tab carries no count.
    expect(d.getByRole("tab", { name: /Steps$/ })).toBeInTheDocument();
    await user.click(d.getByRole("tab", { name: /Apps \(0\)/ }));
    expect(d.getByText("No applications linked to this process.")).toBeInTheDocument();
    await user.click(d.getByRole("tab", { name: /Data \(0\)/ }));
    expect(d.getByText("No data objects linked to this process.")).toBeInTheDocument();
  });

  it("returns to Overview when another process is opened", async () => {
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("tab", { name: /Apps/ }));
    expect(d.getByRole("tab", { name: /Apps/ })).toHaveAttribute("aria-selected", "true");
    // The house is behind the drawer: open another process from there.
    fireEvent.click(screen.getByText("Procure to Pay"));
    expect(await d.findByText("Procure to Pay", { selector: "h6" })).toBeInTheDocument();
    await waitFor(() =>
      expect(d.getByRole("tab", { name: /Overview/ })).toHaveAttribute("aria-selected", "true"),
    );
    expect(d.getByText("Type: Core")).toBeInTheDocument();
  });

  it("closes on a backdrop click", async () => {
    await openDrawer();
    fireEvent.click(document.querySelector(".MuiBackdrop-root")!);
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull());
  });

  it("stays open on a key that is not Escape", async () => {
    await openDrawer();
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByRole("tab", { name: /Overview/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// Matrix view
// ---------------------------------------------------------------------------

describe("MatrixView", () => {
  const DATA = {
    rows: [
      { id: "o2c", name: "Order to Cash" },
      { id: "p2p", name: "Procure to Pay" },
    ],
    columns: [
      { id: "app-1", name: "SAP" },
      { id: "app-2", name: "CRM" },
      { id: "app-3", name: "Unused" },
    ],
    cells: [
      { process_id: "o2c", application_id: "app-1", source: "element", element_name: "Receive" },
      { process_id: "o2c", application_id: "app-2", source: "relation" },
      { process_id: "p2p", application_id: "app-1", source: "relation" },
      { process_id: "p2p", application_id: "app-1", source: "element", element_name: "Pay" },
    ],
  };

  it("shows progress, not the empty state, while the matrix loads", async () => {
    const pending = deferred<unknown>();
    mockApi.on("get", MATRIX, () => pending.promise);
    renderNavigator("/bpm?view=matrix");
    await waitFor(() => expect(mockApi.callsOf("get", MATRIX)).toHaveLength(1));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("No data. Link processes to applications first.")).toBeNull();
    await act(async () => {
      pending.resolve(DATA);
    });
    expect(await screen.findByRole("columnheader", { name: "Process" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders one chip per linked cell, typed and explained", async () => {
    mockApi.on("get", MATRIX, DATA);
    renderNavigator("/bpm?view=matrix");
    await screen.findByRole("columnheader", { name: "SAP" });
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Process",
      "SAP",
      "CRM",
      "Unused",
    ]);
    const [, o2c, p2p] = screen.getAllByRole("row");
    expect(within(o2c).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Order to Cash",
      "E",
      "R",
      "",
    ]);
    // A cell with both an element link and a relation reads as an element.
    expect(within(p2p).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Procure to Pay",
      "E",
      "",
      "",
    ]);

    const elementChip = screen.getByLabelText("Element: Receive");
    const relationChip = screen.getByLabelText("Relation");
    const mixedChip = screen.getByLabelText("Relation, Element: Pay");
    expect(elementChip).toHaveClass("MuiChip-colorSecondary");
    expect(relationChip).toHaveClass("MuiChip-colorPrimary");
    expect(mixedChip).toHaveClass("MuiChip-colorSecondary");
  });

  it("says the matrix is empty", async () => {
    mockApi.on("get", MATRIX, { rows: [], columns: [], cells: [] });
    renderNavigator("/bpm?view=matrix");
    expect(await screen.findByText("No data. Link processes to applications first.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dependencies view
// ---------------------------------------------------------------------------

describe("DependenciesView", () => {
  it("shows progress, not the empty state, while dependencies load", async () => {
    const pending = deferred<unknown>();
    mockApi.on("get", DEPENDENCIES, () => pending.promise);
    renderNavigator("/bpm?view=dependencies");
    await waitFor(() => expect(mockApi.callsOf("get", DEPENDENCIES)).toHaveLength(1));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("No process dependencies defined yet.")).toBeNull();
    await act(async () => {
      pending.resolve({ nodes: [], edges: [] });
    });
    expect(await screen.findByText("No process dependencies defined yet.")).toBeInTheDocument();
  });

  it("names both ends of each edge, falling back to the id on either side", async () => {
    mockApi.on("get", DEPENDENCIES, {
      nodes: [
        { id: "o2c", name: "Order to Cash" },
        { id: "p2p", name: "Procure to Pay" },
      ],
      edges: [
        { id: "e1", source: "o2c", target: "p2p" },
        { id: "e2", source: "ghost", target: "o2c" },
        { id: "e3", source: "p2p", target: "ghost-target" },
      ],
    });
    renderNavigator("/bpm?view=dependencies");
    expect(await screen.findByText("2 processes, 3 dependencies")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "From Process",
      "depends on",
      "To Process",
    ]);
    const [, e1, e2, e3] = screen.getAllByRole("row");
    const ends = (row: HTMLElement) => {
      const cells = within(row).getAllByRole("cell");
      return [cells[0].textContent, cells[2].textContent];
    };
    expect(ends(e1)).toEqual(["Order to Cash", "Procure to Pay"]);
    expect(ends(e2)).toEqual(["ghost", "Order to Cash"]);
    expect(ends(e3)).toEqual(["Procure to Pay", "ghost-target"]);
  });
});

// ---------------------------------------------------------------------------
// Depth slider
// ---------------------------------------------------------------------------

describe("LevelIndicator", () => {
  const markLabels = () =>
    Array.from(document.querySelectorAll<HTMLElement>(".MuiSlider-markLabel"));

  it("labels one mark per level plus All at the end of the track", async () => {
    await renderLoaded();
    expect(screen.getByText("Depth")).toBeInTheDocument();
    expect(markLabels().map((m) => m.textContent)).toEqual(["L1", "L2", "L3", "All"]);
    expect(markLabels()[3].style.left).toBe("100%");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "2");
  });

  it("maps the All stop to every level, and the deepest level to itself", async () => {
    await renderLoaded();
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await waitFor(() => expect(locationText()).toBe("level=3"));
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    fireEvent.keyDown(slider, { key: "End" });
    await waitFor(() => expect(locationText()).toBe("level=99"));
    expect(slider).toHaveAttribute("aria-valuenow", "4");
  });

  it("is not offered for a single-level house", async () => {
    script({ items: [proc("p2p", "Procure to Pay"), proc("hr", "Hire to Retire")] });
    await renderLoaded();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByText("Depth")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Overlay legend
// ---------------------------------------------------------------------------

describe("OverlayLegend", () => {
  it("lists the process types and the not-set swatch", async () => {
    await renderLoaded();
    for (const label of ["Core", "Support", "Management", "Innovation", "Not set"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders nothing when no process type is visible", async () => {
    withMetamodel([
      bpType([
        makeOption({ key: "core", label: "Core", hidden: true }),
        makeOption({ key: "support", label: "Support", hidden: true }),
      ]),
      APP_TYPE,
    ]);
    script({ items: [proc("hr", "Hire to Retire", { attributes: { processType: "support" } })] });
    await renderLoaded("/bpm", "Hire to Retire");
    expect(screen.queryByText("Not set")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Body: loading, organisations, row order
// ---------------------------------------------------------------------------

describe("ProcessNavigatorBody loading", () => {
  it("shows the skeleton house, not the empty state, until the map arrives", async () => {
    const pending = deferred<NavigatorMapPayload>();
    renderBody(bodySource({ loadMap: () => pending.promise }));
    expect(document.querySelectorAll(".MuiSkeleton-root")).toHaveLength(11);
    expect(screen.queryByText(/No Business Processes found/)).toBeNull();
    await act(async () => {
      pending.resolve(mapPayload());
    });
    expect(await screen.findByText("Procure to Pay")).toBeInTheDocument();
    expect(document.querySelectorAll(".MuiSkeleton-root")).toHaveLength(0);
  });

  it("says the map failed to load, and offers no organization filter", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBody(bodySource({ loadMap: () => Promise.reject(new Error("down")) }));
    expect(await screen.findByText("down")).toBeInTheDocument();
    expect(screen.queryByText(/No Business Processes found/)).toBeNull();
    expect(error).toHaveBeenCalled();
    expect(document.querySelectorAll(".MuiSkeleton-root")).toHaveLength(0);
    expect(screen.queryByPlaceholderText("Filter by Organization...")).toBeNull();
  });

  it("offers no organization filter when the source sends none", async () => {
    const payload = mapPayload();
    delete (payload as Partial<NavigatorMapPayload>).organizations;
    renderBody(bodySource({ loadMap: async () => payload }));
    await screen.findByText("Procure to Pay");
    expect(screen.queryByPlaceholderText("Filter by Organization...")).toBeNull();
  });

  it("reloads from a new source", async () => {
    const { rerender } = renderBody();
    await screen.findByText("Procure to Pay");
    rerender(
      bodyTree(bodySource({ loadMap: async () => mapPayload({ items: [proc("new", "Fresh Process")] }) })),
    );
    expect(await screen.findByText("Fresh Process")).toBeInTheDocument();
    expect(screen.queryByText("Procure to Pay")).toBeNull();
  });
});

describe("ProcessNavigatorBody row order", () => {
  it("follows the persisted order", async () => {
    renderBody(bodySource({ loadMap: async () => mapPayload({ rowOrder: ["support", "core", "management"] }) }));
    await screen.findByText("Procure to Pay");
    expect(rowHeaders()).toEqual([
      "Support Processes",
      "Core Processes",
      "Management Processes",
      "Innovation Processes",
    ]);
  });

  it("falls back to management, core, support when nothing is persisted", async () => {
    renderBody(bodySource(), FULL_CAPABILITIES, meta(SHUFFLED_OPTIONS));
    await screen.findByText("Procure to Pay");
    expect(rowHeaders()).toEqual([
      "Management Processes",
      "Core Processes",
      "Support Processes",
      "Innovation Processes",
    ]);
  });

  it("tolerates a source that sends no row order", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = mapPayload();
    delete (payload as Partial<NavigatorMapPayload>).rowOrder;
    renderBody(bodySource({ loadMap: async () => payload }));
    await screen.findByText("Procure to Pay");
    expect(rowHeaders()[0]).toBe("Management Processes");
    expect(error).not.toHaveBeenCalled();
  });
});

describe("ProcessNavigator row order from the API", () => {
  it("uses the stored order", async () => {
    script({ rowOrder: { row_order: ["support", "management", "core"] } });
    await renderLoaded();
    expect(rowHeaders()).toEqual([
      "Support Processes",
      "Management Processes",
      "Core Processes",
      "Innovation Processes",
    ]);
  });

  it("keeps the default order when the setting carries none", async () => {
    script({ rowOrder: {} });
    await renderLoaded();
    expect(rowHeaders()).toEqual([
      "Management Processes",
      "Core Processes",
      "Support Processes",
      "Innovation Processes",
    ]);
  });

  it("falls back to the default order when the setting cannot be read", async () => {
    withMetamodel([bpType(SHUFFLED_OPTIONS), APP_TYPE]);
    mockApi.fail("get", "/settings/bpm-row-order");
    await renderLoaded();
    expect(rowHeaders()).toEqual([
      "Management Processes",
      "Core Processes",
      "Support Processes",
      "Innovation Processes",
    ]);
  });

  it("shows no organization filter when the map carries no organizations", async () => {
    script({ orgs: null });
    await renderLoaded();
    expect(screen.queryByPlaceholderText("Filter by Organization...")).toBeNull();
  });

  it("shows no organization filter for an empty organization list", async () => {
    script({ orgs: [] });
    await renderLoaded();
    expect(screen.queryByPlaceholderText("Filter by Organization...")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Body: defaults, URL and persistence
// ---------------------------------------------------------------------------

describe("ProcessNavigatorBody defaults and URL", () => {
  it("opens at depth 2 with the process-type overlay and a clean URL", async () => {
    await renderLoaded();
    // Depth 2: o2c's children show, its grandchild does not.
    expect(screen.getByText("Quote")).toBeInTheDocument();
    expect(screen.queryByText("Pricing")).toBeNull();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveAttribute("data-type", "REPLACE"));
    expect(locationText()).toBe("");
    expect(screen.getByRole("button", { name: "Process House" })).toBeInTheDocument();
  });

  it("marks the active overlay chip", async () => {
    const { user } = await renderLoaded();
    const type = screen.getByRole("button", { name: /Type/ });
    const maturity = screen.getByRole("button", { name: /Maturity/ });
    expect(type).toHaveClass("MuiChip-filled", "MuiChip-colorPrimary");
    expect(maturity).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
    await user.click(maturity);
    expect(maturity).toHaveClass("MuiChip-filled", "MuiChip-colorPrimary");
    expect(type).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
  });

  it("restores the stored view when the URL is bare", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewMode: "matrix" }));
    mockApi.on("get", MATRIX, { rows: [], columns: [], cells: [] });
    renderNavigator();
    expect(await screen.findByText("No data. Link processes to applications first.")).toBeInTheDocument();
  });

  it("ignores stored preferences when the URL carries any parameter", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ overlay: "maturity", viewMode: "matrix" }));
    await renderLoaded("/bpm?search=Pay");
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText("1-Initial")).toBeNull();
    expect(mockApi.callsOf("get", MATRIX)).toHaveLength(0);
  });

  it("does not load the other views while the house is shown", async () => {
    await renderLoaded();
    await waitFor(() => expect(locationText()).toBe(""));
    expect(mockApi.callsOf("get", MATRIX)).toHaveLength(0);
    expect(mockApi.callsOf("get", DEPENDENCIES)).toHaveLength(0);
  });

  it("writes each choice to the URL", async () => {
    const { user } = await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveAttribute("data-type", "REPLACE"));

    mockApi.on("get", MATRIX, { rows: [], columns: [], cells: [] });
    await user.click(screen.getByRole("button", { name: "Process × App Matrix" }));
    await waitFor(() => expect(locationText()).toBe("view=matrix"));
    // The house toolbar and content stay with the house.
    expect(screen.queryByPlaceholderText("Search processes...")).toBeNull();
    expect(screen.queryByText("Core Processes")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Process House" }));
    await waitFor(() => expect(locationText()).toBe(""));

    await user.type(screen.getByPlaceholderText("Search processes..."), "Pay");
    await waitFor(() => expect(locationText()).toBe("search=Pay"));
    await user.clear(screen.getByPlaceholderText("Search processes..."));

    await user.click(screen.getByRole("button", { name: "One column" }));
    await waitFor(() => expect(locationText()).toBe("cols=1"));

    await user.click(screen.getByRole("button", { name: /Maturity/ }));
    await waitFor(() => expect(locationText()).toBe("overlay=maturity&cols=1"));

    await user.click(within(cardOf("Order to Cash")).getAllByRole("button", { name: "Drill down into this process" })[0]);
    await waitFor(() => expect(locationText()).toBe("overlay=maturity&cols=1&zoom=o2c"));

    await user.click(screen.getByText("Quote"));
    await drawer();
    await waitFor(() => expect(locationText()).toBe("overlay=maturity&cols=1&zoom=o2c&open=quote"));
    expect(screen.getByTestId("location")).toHaveAttribute("data-type", "REPLACE");

    // Reset puts every parameter back, the drawer included.
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults", hidden: true }));
    await waitFor(() => expect(locationText()).toBe(""));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull());
  });

  it("forgets the stored preferences on reset", async () => {
    const { user } = await renderLoaded();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps a breadcrumb trail only for the house, ending on plain text", async () => {
    const { user } = await renderLoaded("/bpm?zoom=o2c", "Quote");
    const crumbs = within(screen.getByRole("navigation"));
    expect(crumbs.getByRole("button", { name: "All Processes" })).toBeInTheDocument();
    expect(crumbs.getByText("Order to Cash")).toBeInTheDocument();
    expect(crumbs.queryByRole("button", { name: "Order to Cash" })).toBeNull();

    mockApi.on("get", MATRIX, { rows: [], columns: [], cells: [] });
    await user.click(screen.getByRole("button", { name: "Process × App Matrix" }));
    await screen.findByText("No data. Link processes to applications first.");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows no breadcrumbs for a zoom target that does not exist", async () => {
    await renderLoaded("/bpm?zoom=nope");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("keeps an orphaned process searchable", async () => {
    script({ items: [...ITEMS, proc("orphan", "Orphan Task", { parent_id: "ghost" })] });
    const { user } = await renderLoaded();
    await user.type(screen.getByPlaceholderText("Search processes..."), "orphan");
    expect(screen.getByText("1 of 8 processes")).toBeInTheDocument();
  });
});

describe("ProcessNavigatorBody organization filter", () => {
  it("shows the picked organization as a chip and drops the placeholder", async () => {
    const { user } = await renderLoaded();
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("placeholder", "Filter by Organization...");
    await user.click(input);
    await user.click(await screen.findByRole("option", { name: "Finance" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(screen.getByText("Finance", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "");
  });
});

// `?open=<id>` is held until the map has loaded, so an asynchronous source (any
// real one) still opens the drawer it names.
describe("ProcessNavigatorBody deep link", () => {
  it("opens the drawer named by ?open= once the map is in", async () => {
    renderBody(
      bodySource({ loadMap: async () => mapPayload() }),
      FULL_CAPABILITIES,
      meta(),
      "/portal/p?open=p2p",
    );
    const d = await drawer();
    expect(d.getByText("Procure to Pay", { selector: "h6" })).toBeInTheDocument();
    await waitFor(() => expect(locationText()).toBe("open=p2p"));
  });

  it("opens nothing for an unknown id", async () => {
    renderBody(
      bodySource({ loadMap: async () => mapPayload() }),
      FULL_CAPABILITIES,
      meta(),
      "/portal/p?open=nope",
    );
    await screen.findByText("Procure to Pay");
    await waitFor(() => expect(locationText()).toBe(""));
    expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Admin: drag-and-drop and row moves
// ---------------------------------------------------------------------------

describe("ProcessNavigator admin drag-and-drop", () => {
  beforeEach(() => {
    hookState.auth.user = makeUser({ role: "admin" });
  });

  // Data order differs from the sorted order on purpose: o2c(1), p2p(2),
  // then the unsorted two by name.
  const FLAT = [
    proc("zeta", "Zeta Process"),
    proc("p2p", "Procure to Pay", { attributes: { processType: "core", sortOrder: 2 } }),
    proc("alpha", "Alpha Process"),
    proc("o2c", "Order to Cash", { attributes: { processType: "core", sortOrder: 1 } }),
  ];

  it("moves the dragged card to the drop position in the sorted row", async () => {
    script({ items: FLAT });
    await renderLoaded();
    dragOnto(cardOf("Procure to Pay"), cardOf("Alpha Process"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/cards/*")).toHaveLength(4));
    expect(sortOrderBodies()).toEqual({ o2c: 0, alpha: 1, p2p: 2, zeta: 3 });
  });

  it("ignores a card dropped onto itself", async () => {
    script({ items: FLAT });
    await renderLoaded();
    const p2p = cardOf("Procure to Pay");
    dragOnto(p2p, p2p);
    await act(async () => {});
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("ignores drops to or from a card whose parent is missing", async () => {
    script({ items: [...FLAT, proc("orphan", "Orphan Task", { parent_id: "ghost" })] });
    await renderLoaded();
    dragOnto(cardOf("Orphan Task"), cardOf("Alpha Process"));
    dragOnto(cardOf("Alpha Process"), cardOf("Orphan Task"));
    await act(async () => {});
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("refuses a second drop while the first is still saving", async () => {
    const pending = deferred<void>();
    const reorderCards = vi.fn(() => pending.promise);
    renderBody(
      bodySource({ loadMap: async () => mapPayload({ items: FLAT }), reorderCards }),
      { ...FULL_CAPABILITIES, canReorder: true },
    );
    await screen.findByText("Alpha Process");
    dragOnto(cardOf("Procure to Pay"), cardOf("Alpha Process"));
    await waitFor(() => expect(reorderCards).toHaveBeenCalledTimes(1));
    dragOnto(cardOf("Zeta Process"), cardOf("Order to Cash"));
    await act(async () => {});
    expect(reorderCards).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve();
    });
  });

  it("does nothing when the source cannot reorder", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBody(bodySource({ loadMap: async () => mapPayload({ items: FLAT }) }), {
      ...FULL_CAPABILITIES,
      canReorder: true,
    });
    await screen.findByText("Alpha Process");
    dragOnto(cardOf("Procure to Pay"), cardOf("Alpha Process"));
    await act(async () => {});
    expect(error).not.toHaveBeenCalledWith("Drag reorder failed", expect.anything());
  });
});

describe("ProcessNavigator admin row moves", () => {
  beforeEach(() => {
    hookState.auth.user = makeUser({ role: "admin" });
  });

  it("moves a row up on screen and in the saved order", async () => {
    const { user } = await renderLoaded();
    expect(rowHeaders()[0]).toBe("Management Processes");
    await user.click(screen.getAllByRole("button", { name: "arrow_upward" })[1]);
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/settings/bpm-row-order")[0].body).toEqual({
        row_order: ["core", "management", "support", "innovation"],
      }),
    );
    expect(rowHeaders()).toEqual([
      "Core Processes",
      "Management Processes",
      "Support Processes",
      "Innovation Processes",
    ]);
  });

  it("moves a row without a source that saves the order", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBody(bodySource(), { ...FULL_CAPABILITIES, canReorder: true });
    await screen.findByText("Procure to Pay");
    fireEvent.click(screen.getAllByRole("button", { name: "arrow_downward" })[0]);
    await waitFor(() => expect(rowHeaders()[0]).toBe("Core Processes"));
    await act(async () => {});
    expect(error).not.toHaveBeenCalledWith("Failed to save row order", expect.anything());
  });

  it("offers no row arrows with a single row", async () => {
    withMetamodel([bpType([makeOption({ key: "core", label: "Core" })]), APP_TYPE]);
    script({ items: [proc("p2p", "Procure to Pay")] });
    await renderLoaded();
    expect(rowHeaders()).toEqual(["Core Processes"]);
    expect(screen.queryByRole("button", { name: "arrow_upward" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// In-app container: auth and metamodel wiring
// ---------------------------------------------------------------------------

describe("ProcessNavigator container", () => {
  it("gives a member no reordering controls", async () => {
    await renderLoaded();
    expect(screen.queryByRole("button", { name: "arrow_upward" })).toBeNull();
    expect(screen.queryByText("drag_indicator")).toBeNull();
  });

  it("renders for a signed-out session", async () => {
    hookState.auth.user = null;
    await renderLoaded();
    expect(screen.queryByRole("button", { name: "arrow_upward" })).toBeNull();
  });

  it("grants reordering when the role becomes admin", async () => {
    const { rerender } = await renderLoaded();
    hookState.auth.user = makeUser({ role: "admin" });
    rerender(
      <MemoryRouter initialEntries={["/bpm"]}>
        <ProcessNavigator />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(await screen.findAllByRole("button", { name: "arrow_upward" })).not.toHaveLength(0);
  });

  /** The drawer header: the strip holding the type icon and the name. */
  async function drawerHeader(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText("Procure to Pay"));
    const d = await drawer();
    return d.getByText("Procure to Pay", { selector: "h6" }).parentElement!.parentElement!;
  }

  it("paints the drawer header with the BusinessProcess type's icon and colour", async () => {
    withMetamodel([bpType(DEFAULT_OPTIONS, { icon: "factory", color: "#123456" }), APP_TYPE]);
    const { user } = await renderLoaded();
    const header = await drawerHeader(user);
    expect(within(header).getByText("factory")).toBeInTheDocument();
    expect(getComputedStyle(header).backgroundColor).toBe("rgb(18, 52, 86)");
  });

  it("falls back to the seeded icon and colour without a BusinessProcess type", async () => {
    withMetamodel([APP_TYPE]);
    const { user } = await renderLoaded();
    const header = await drawerHeader(user);
    expect(within(header).getByText("route")).toBeInTheDocument();
    expect(getComputedStyle(header).backgroundColor).toBe("rgb(2, 143, 0)");
  });

  it("picks up the BusinessProcess type once the metamodel arrives", async () => {
    withMetamodel([APP_TYPE]);
    const { user, rerender } = await renderLoaded();
    withMetamodel([bpType(DEFAULT_OPTIONS, { icon: "factory" }), APP_TYPE]);
    rerender(
      <MemoryRouter initialEntries={["/bpm"]}>
        <ProcessNavigator />
        <LocationProbe />
      </MemoryRouter>,
    );
    const header = await drawerHeader(user);
    expect(within(header).getByText("factory")).toBeInTheDocument();
  });
});
