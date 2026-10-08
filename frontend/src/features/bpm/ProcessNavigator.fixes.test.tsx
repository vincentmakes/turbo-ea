/**
 * ProcessNavigator regressions for the bugs a mutation pass surfaced: failed
 * loads rendered as empty states (the house, the matrix, the dependencies, the
 * drawer's flow and the fullscreen preview), `?open=` lost to the URL sync
 * before an asynchronous map arrives, the drawer's subtype chip hidden behind
 * the attribute chips, an empty row for a hidden default process type, and a
 * stale drawer node after the map reloads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

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
import type { FieldOption } from "@/types";

const OPTIONS = [
  makeOption({ key: "core", label: "Core", color: "#1976d2" }),
  makeOption({ key: "support", label: "Support", color: "#607d8b" }),
  makeOption({ key: "management", label: "Management", color: "#9c27b0" }),
];

function bpType(options: FieldOption[] = OPTIONS) {
  return makeCardType({
    key: "BusinessProcess",
    icon: "route",
    color: "#028f00",
    subtypes: [makeSubtype({ key: "valueChain", label: "Value Chain" })],
    fields_schema: [
      makeSection({
        section: "Classification",
        fields: [makeField({ key: "processType", type: "single_select", options })],
      }),
    ],
  });
}

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
    org_ids: ["org-1"],
  }),
  proc("quote", "Quote", { parent_id: "o2c", attributes: { processType: "core", sortOrder: 1 } }),
  proc("billing", "Billing", { parent_id: "o2c", attributes: { processType: "core", sortOrder: 2 } }),
  proc("p2p", "Procure to Pay", { attributes: { processType: "core", sortOrder: 2 }, has_diagram: true }),
  proc("hr", "Hire to Retire", { attributes: { processType: "support" } }),
];

const ORGS = [{ id: "org-1", name: "Finance" }];

function script(items: unknown[] = ITEMS) {
  mockApi.on("get", "/reports/bpm/process-map", { items, organizations: ORGS });
  mockApi.on("get", "/settings/bpm-row-order", { row_order: ["management", "core", "support"] });
  mockApi.on("get", /\/flow\/published$/, { bpmn_xml: "<xml/>", svg_thumbnail: "<svg></svg>" });
  mockApi.on("get", /\/elements$/, []);
  mockApi.on("get", /\/flow\/drafts$/, []);
  mockApi.on("get", /^\/cards\/[^/]+$/, { description: "", tags: [] });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{new URLSearchParams(location.search).toString()}</div>;
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

function meta(options: FieldOption[] = OPTIONS, subtypes = bpType().subtypes ?? []): NavigatorMeta {
  return {
    typeIcon: "route",
    typeColor: "#028f00",
    subtypes,
    processTypes: processTypeOptionsFrom(bpType(options).fields_schema, (o) => o.label ?? o.key, false),
  };
}

const EMPTY_FLOW: ProcessFlowPayload = { bpmnXml: null, svgThumbnail: null, steps: [], hasDrafts: false };

function mapPayload(overrides: Partial<NavigatorMapPayload> = {}): NavigatorMapPayload {
  return { items: ITEMS, organizations: ORGS, rowOrder: [], ...overrides } as NavigatorMapPayload;
}

function bodySource(overrides: Partial<ProcessNavigatorSource> = {}): ProcessNavigatorSource {
  return { loadMap: async () => mapPayload(), loadFlow: async () => EMPTY_FLOW, ...overrides };
}

function renderBody(
  source: ProcessNavigatorSource = bodySource(),
  caps: NavigatorCapabilities = FULL_CAPABILITIES,
  m: NavigatorMeta = meta(),
  route = "/portal/p",
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ProcessNavigatorProvider value={{ source, capabilities: caps, meta: m }}>
        <ProcessNavigatorBody />
      </ProcessNavigatorProvider>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function drawer() {
  const tab = await screen.findByRole("tab", { name: /Overview/ });
  return within(tab.closest(".MuiDrawer-paper") as HTMLElement);
}

function cardOf(name: string): HTMLElement {
  const title = screen.getAllByText(name).find((el) => el.closest("[draggable]"));
  if (!title) throw new Error(`no card ${name}`);
  return title.closest("[draggable]") as HTMLElement;
}

function dragOnto(from: HTMLElement, to: HTMLElement) {
  fireEvent.mouseDown(within(from).getAllByText("drag_indicator")[0]);
  fireEvent.dragStart(from, { dataTransfer: {} });
  fireEvent.dragOver(to, { dataTransfer: {} });
  fireEvent.drop(to, { dataTransfer: {} });
  fireEvent.dragEnd(from, { dataTransfer: {} });
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([bpType()]);
  hookState.auth.user = makeUser({ role: "member" });
  mockNavigate.mockReset();
  localStorage.clear();
  script();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ProcessNavigator failed loads", () => {
  it("says the map could not be loaded instead of showing an empty house", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderBody(bodySource({ loadMap: () => Promise.reject(new Error("map down")) }));
    expect(await screen.findByText("map down")).toBeInTheDocument();
    expect(screen.queryByText("No Business Processes found")).toBeNull();
    expect(document.querySelectorAll(".MuiSkeleton-root")).toHaveLength(0);
  });

  it("says the matrix could not be loaded instead of showing it empty", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("get", "/reports/bpm/process-application-matrix");
    renderNavigator("/bpm?view=matrix");
    expect(
      await screen.findByText("GET /reports/bpm/process-application-matrix failed"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No data. Link processes to applications first.")).toBeNull();
  });

  it("says the dependencies could not be loaded instead of saying there are none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("get", "/reports/bpm/process-dependencies");
    renderNavigator("/bpm?view=dependencies");
    expect(await screen.findByText("GET /reports/bpm/process-dependencies failed")).toBeInTheDocument();
    expect(screen.queryByText("No process dependencies defined yet.")).toBeNull();
  });

  it("says the flow could not be loaded in the drawer, not that there is none", async () => {
    mockApi.fail("get", "/bpm/processes/p2p/flow/published");
    const user = userEvent.setup();
    renderNavigator();
    await user.click(await screen.findByText("Procure to Pay"));
    const d = await drawer();
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    expect(await d.findByText("GET /bpm/processes/p2p/flow/published failed")).toBeInTheDocument();
    expect(d.queryByText("No process flow available.")).toBeNull();
  });

  it("says the steps could not be loaded in the drawer, not that there are none", async () => {
    mockApi.fail("get", "/bpm/processes/p2p/elements");
    const user = userEvent.setup();
    renderNavigator();
    await user.click(await screen.findByText("Procure to Pay"));
    const d = await drawer();
    await user.click(d.getByRole("tab", { name: /Steps/ }));
    expect(await d.findByText("GET /bpm/processes/p2p/elements failed")).toBeInTheDocument();
    expect(d.queryByText(/No BPMN elements found/)).toBeNull();
  });

  it("still shows the published flow when only the drafts are refused", async () => {
    mockApi.fail("get", "/bpm/processes/p2p/flow/drafts", 403);
    const user = userEvent.setup();
    renderNavigator();
    await user.click(await screen.findByText("Procure to Pay"));
    const d = await drawer();
    await user.click(d.getByRole("tab", { name: /Flow/ }));
    expect(await d.findByText("View Published Flow")).toBeInTheDocument();
    expect(d.queryByText(/failed/)).toBeNull();
  });

  it("says the flow could not be loaded in the fullscreen preview", async () => {
    const user = userEvent.setup();
    renderBody(bodySource({ loadFlow: () => Promise.reject(new Error("flow down")) }));
    await screen.findByText("Order to Cash");
    const [flow] = within(cardOf("Procure to Pay")).getAllByRole("button", { name: "View Flow" });
    await user.click(flow);
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("flow down")).toBeInTheDocument();
    expect(dialog.queryByText("No process flow available.")).toBeNull();
  });
});

describe("ProcessNavigator ?open= deep link", () => {
  it("opens the named drawer once an asynchronous map arrives", async () => {
    const map = deferred<NavigatorMapPayload>();
    renderBody(bodySource({ loadMap: () => map.promise }), FULL_CAPABILITIES, meta(), "/portal/p?open=p2p");
    await act(async () => {});
    // The URL keeps the deep link while the map is still loading.
    expect(locationText()).toBe("open=p2p");
    await act(async () => {
      map.resolve(mapPayload());
    });
    const d = await drawer();
    expect(d.getByText("Procure to Pay", { selector: "h6" })).toBeInTheDocument();
    expect(locationText()).toBe("open=p2p");
  });

  it("opens the named drawer in the app, from the real process map", async () => {
    renderNavigator("/bpm?open=p2p");
    const d = await drawer();
    expect(d.getByText("Procure to Pay", { selector: "h6" })).toBeInTheDocument();
    await waitFor(() => expect(locationText()).toBe("open=p2p"));
  });

  it("drops an unknown id from the URL once the map is in", async () => {
    renderBody(bodySource(), FULL_CAPABILITIES, meta(), "/portal/p?open=nope");
    await screen.findByText("Procure to Pay");
    await waitFor(() => expect(locationText()).toBe(""));
    expect(screen.queryByRole("tab", { name: /Overview/ })).toBeNull();
  });

  it("keeps the filtered node when a drawer is first opened under an organization filter", async () => {
    const user = userEvent.setup();
    renderNavigator();
    await screen.findByText("Procure to Pay");
    await user.click(screen.getByPlaceholderText("Filter by Organization..."));
    await user.click(await screen.findByRole("option", { name: "Finance" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Procure to Pay")).toBeNull());
    await user.click(screen.getByText("Order to Cash"));
    const d = await drawer();
    await waitFor(() => expect(locationText()).toBe("open=o2c"));
    // Neither sub-process is linked to Finance, so the filtered node has none.
    expect(d.queryByText(/Sub-Processes/)).toBeNull();
    expect(d.queryByText("Quote")).toBeNull();
  });
});

describe("ProcessNavigator drawer overview", () => {
  it("shows the subtype even when the process has no attribute chips", async () => {
    const user = userEvent.setup();
    renderBody(
      bodySource({
        loadMap: async () =>
          mapPayload({ items: [proc("vc", "Value Process", { subtype: "valueChain", attributes: {} })] }),
      }),
    );
    await user.click(await screen.findByText("Value Process"));
    const d = await drawer();
    expect(d.getByText("Value Chain").closest(".MuiChip-root")).not.toBeNull();
  });

  it("re-reads the open drawer's process when the map reloads", async () => {
    const base = [...ITEMS, proc("r2r", "Record to Report", { attributes: { processType: "core", sortOrder: 3 } })];
    let items: unknown[] = base;
    const reorder = deferred<void>();
    const reorderCards = vi.fn(() => reorder.promise);
    renderBody(
      bodySource({
        loadMap: async () => mapPayload({ items: items as NavigatorMapPayload["items"] }),
        reorderCards,
      }),
      { ...FULL_CAPABILITIES, canReorder: true },
    );
    await screen.findByText("Procure to Pay");
    dragOnto(cardOf("Procure to Pay"), cardOf("Record to Report"));
    await waitFor(() => expect(reorderCards).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    await user.click(screen.getByText("Procure to Pay"));
    const d = await drawer();
    expect(d.getByText("Elements").previousElementSibling).toHaveTextContent("0");
    items = base.map((i) => (i.id === "p2p" ? { ...i, element_count: 7 } : i));
    await act(async () => {
      reorder.resolve();
    });
    await waitFor(() => expect(d.getByText("Elements").previousElementSibling).toHaveTextContent("7"));
  });
});

describe("ProcessNavigator house rows", () => {
  it("gives a hidden default process type no empty row", async () => {
    withMetamodel([
      bpType([
        makeOption({ key: "core", label: "Core", hidden: true }),
        makeOption({ key: "support", label: "Support" }),
      ]),
    ]);
    script([proc("hr", "Hire to Retire", { attributes: { processType: "support" } })]);
    renderNavigator();
    expect(await screen.findByText("Hire to Retire")).toBeInTheDocument();
    expect(screen.queryByText("No Core Processes defined")).toBeNull();
    expect(screen.queryByText("Core Processes")).toBeNull();
  });

  it("still lists processes without a type under a hidden default type", async () => {
    withMetamodel([
      bpType([
        makeOption({ key: "core", label: "Core", hidden: true }),
        makeOption({ key: "support", label: "Support" }),
      ]),
    ]);
    script([proc("untyped", "Untyped Process", { attributes: {} })]);
    renderNavigator();
    expect(await screen.findByText("Untyped Process")).toBeInTheDocument();
    expect(screen.getByText("Core Processes")).toBeInTheDocument();
  });
});
