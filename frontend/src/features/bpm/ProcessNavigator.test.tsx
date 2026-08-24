import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

// ProcessNavigator pulls in the API client at module load; mock it so the
// import is side-effect free in the test environment.
vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));

// The fullscreen flow preview lazy-loads the real bpmn-js viewer — stub it so
// tests stay light and deterministic (mirrors ProcessFlowTab.test.tsx).
vi.mock("./BpmnViewer", () => ({
  default: ({ bpmnXml }: { bpmnXml: string }) => (
    <div data-testid="bpmn-viewer">{bpmnXml ? "BPMN loaded" : ""}</div>
  ),
}));

// The BusinessProcess type carries the admin-customizable processType
// options the navigator must render from (issue #857): "management" is
// renamed to "Strategic" with a custom color, and a fourth admin-added
// option ("innovation") exists beyond the seeded three.
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    loading: false,
    getType: (key: string) =>
      key === "BusinessProcess"
        ? {
            key,
            icon: "route",
            color: "#028f00",
            subtypes: [],
            fields_schema: [
              {
                section: "Process Classification",
                fields: [
                  {
                    key: "processType",
                    label: "Process Type",
                    type: "single_select",
                    options: [
                      { key: "core", label: "Core", color: "#1976d2" },
                      { key: "support", label: "Support", color: "#607d8b" },
                      { key: "management", label: "Strategic", color: "#00aa55" },
                      { key: "innovation", label: "Innovation", color: "#ff8800" },
                    ],
                  },
                ],
              },
            ],
          }
        : undefined,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "member" } }),
}));
vi.mock("@/hooks/useResolveLabel", () => ({
  useSubtypeLabel: () => () => "",
  useFieldLabel:
    () => (e: { label?: string; key?: string } | null | undefined) =>
      e?.label ?? e?.key ?? "",
  useOptionLabel:
    () => (e: { label?: string; key?: string } | null | undefined) =>
      e?.label ?? e?.key ?? "",
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

import { api } from "@/api/client";
import ProcessNavigator, { ATTR_COLORS } from "./ProcessNavigator";

/*
 * Regression guard for issue #762.
 *
 * The BusinessProcess `automationLevel` field is seeded with these option keys
 * (backend/app/services/seed.py → AUTOMATION_LEVEL_OPTIONS). The BPM Process
 * Navigator colours nodes, builds side-summary chips, and renders the overlay
 * legend from ATTR_COLORS, so its keys MUST match the seeded option keys.
 * They previously read `partially` / `fully`, which never matched the stored
 * values `partiallyAutomated` / `fullyAutomated`, so those processes showed as
 * grey "Not Set" and were missing their Automation chip.
 */
const SEEDED_AUTOMATION_KEYS = ["manual", "partiallyAutomated", "fullyAutomated"];

describe("ProcessNavigator ATTR_COLORS (issue #762)", () => {
  it("keys the automationLevel overlay by the seeded option keys", () => {
    expect(Object.keys(ATTR_COLORS.automationLevel).sort()).toEqual(
      [...SEEDED_AUTOMATION_KEYS].sort(),
    );
  });

  it("resolves a non-Manual automation value to a real colour (not the grey default)", () => {
    for (const key of SEEDED_AUTOMATION_KEYS) {
      const info = ATTR_COLORS.automationLevel[key];
      expect(info).toBeDefined();
      expect(info.color).not.toBe("#bdbdbd");
      expect(info.label.length).toBeGreaterThan(0);
    }
  });
});

/* ────────────────────────────────────────────────────────────────
 * Clickable "has process flow" icon → fullscreen inline viewer.
 * ──────────────────────────────────────────────────────────────── */

const PROC_ID = "proc-1";

function makeProcessMap(hasDiagram: boolean, elementCount = 0) {
  return {
    items: [
      {
        id: PROC_ID,
        name: "Order to Cash",
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
        has_diagram: hasDiagram,
        element_count: elementCount,
      },
    ],
    organizations: [],
    business_contexts: [],
  };
}

function mockApi(processMap: unknown, published: unknown = { bpmn_xml: "<xml/>" }) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith("/reports/bpm/process-map")) return Promise.resolve(processMap);
    if (url.startsWith("/settings/bpm-row-order"))
      return Promise.resolve({ row_order: ["management", "core", "support"] });
    if (url.includes("/flow/published")) return Promise.resolve(published);
    if (url.includes("/elements")) return Promise.resolve([]);
    return Promise.resolve(null);
  });
}

function renderNavigator() {
  return render(
    <MemoryRouter initialEntries={["/bpm"]}>
      <ProcessNavigator />
    </MemoryRouter>,
  );
}

describe("ProcessNavigator — clickable process-flow icon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the flow indicator as an accessible button when a published flow exists", async () => {
    mockApi(makeProcessMap(true));
    renderNavigator();
    await screen.findByText("Order to Cash");
    expect(screen.getByRole("button", { name: "View Flow" })).toBeInTheDocument();
  });

  it("opens the fullscreen diagram inline (without opening the detail drawer) on click", async () => {
    mockApi(makeProcessMap(true));
    renderNavigator();
    await screen.findByText("Order to Cash");

    await userEvent.click(screen.getByRole("button", { name: "View Flow" }));

    // The inline BPMN viewer renders in the dialog...
    expect(await screen.findByTestId("bpmn-viewer")).toHaveTextContent("BPMN loaded");
    // ...and the card-detail drawer (its "Overview" tab) did NOT open — proving
    // the icon click stopped propagation to the card's own onClick.
    expect(screen.queryByRole("tab", { name: /Overview/ })).not.toBeInTheDocument();
  });

  it("opens the dialog via keyboard (Enter)", async () => {
    mockApi(makeProcessMap(true));
    renderNavigator();
    await screen.findByText("Order to Cash");

    screen.getByRole("button", { name: "View Flow" }).focus();
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByTestId("bpmn-viewer")).toHaveTextContent("BPMN loaded");
  });

  it("routes to the full flow editor from the dialog app bar", async () => {
    mockApi(makeProcessMap(true));
    renderNavigator();
    await screen.findByText("Order to Cash");
    await userEvent.click(screen.getByRole("button", { name: "View Flow" }));

    const dialog = await screen.findByRole("dialog");
    // The app-bar action carries the same "View Flow" label (prefixed by the
    // icon glyph text in its accessible name); scope to the dialog + regex-match.
    await userEvent.click(within(dialog).getByRole("button", { name: /View Flow/ }));
    expect(mockNavigate).toHaveBeenCalledWith(`/cards/${PROC_ID}?tab=1`);
  });

  it("shows the empty state when no published flow is returned", async () => {
    mockApi(makeProcessMap(true), null);
    renderNavigator();
    await screen.findByText("Order to Cash");
    await userEvent.click(screen.getByRole("button", { name: "View Flow" }));

    expect(await screen.findByText("No process flow available.")).toBeInTheDocument();
    expect(screen.queryByTestId("bpmn-viewer")).not.toBeInTheDocument();
  });

  it("keeps the indicator non-interactive when the process has only elements (no published flow)", async () => {
    mockApi(makeProcessMap(false, 5));
    renderNavigator();
    await screen.findByText("Order to Cash");
    expect(screen.queryByRole("button", { name: "View Flow" })).not.toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────
 * Issue #857 — rows, legend, and colors must follow the metamodel's
 * processType options (labels, translations, colors), not hardcoded maps.
 * ──────────────────────────────────────────────────────────────── */

function makeItem(id: string, name: string, processType?: string) {
  return {
    id,
    name,
    subtype: undefined,
    parent_id: null,
    attributes: processType ? { processType } : {},
    lifecycle: {},
    app_count: 0,
    total_cost: 0,
    apps: [],
    data_objects: [],
    org_ids: [],
    ctx_ids: [],
    has_diagram: false,
    element_count: 0,
  };
}

describe("ProcessNavigator — metamodel-driven process types (issue #857)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders row headers with the customized option label, not the hardcoded one", async () => {
    mockApi({
      items: [makeItem("p1", "Order to Cash", "core"), makeItem("p2", "Budgeting", "management")],
      organizations: [],
      business_contexts: [],
    });
    renderNavigator();
    await screen.findByText("Order to Cash");

    // "management" was renamed to "Strategic" in the (mocked) metamodel.
    expect(screen.getByText("Strategic Processes")).toBeInTheDocument();
    expect(screen.queryByText("Management Processes")).not.toBeInTheDocument();
  });

  it("adds a row for an admin-added fourth option even when absent from the persisted row order", async () => {
    mockApi({
      items: [makeItem("p1", "Order to Cash", "core")],
      organizations: [],
      business_contexts: [],
    });
    renderNavigator();
    await screen.findByText("Order to Cash");

    // The mocked /settings/bpm-row-order only knows management/core/support;
    // the "innovation" option still gets its own row (appended).
    expect(screen.getByText("Innovation Processes")).toBeInTheDocument();
  });

  it("renders the overlay legend from the metamodel options", async () => {
    mockApi({
      items: [makeItem("p1", "Order to Cash", "core")],
      organizations: [],
      business_contexts: [],
    });
    renderNavigator();
    await screen.findByText("Order to Cash");

    for (const label of ["Core", "Support", "Strategic", "Innovation"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText("Management")).not.toBeInTheDocument();
  });

  it("keeps a card whose processType no longer exists visible in its own row", async () => {
    mockApi({
      items: [makeItem("p1", "Order to Cash", "core"), makeItem("p2", "Old Timer", "legacy")],
      organizations: [],
      business_contexts: [],
    });
    renderNavigator();
    await screen.findByText("Order to Cash");

    // Unknown key → synthetic row titled with the raw key, card still shown.
    expect(screen.getByText("legacy Processes")).toBeInTheDocument();
    expect(screen.getByText("Old Timer")).toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────
 * Column picker.
 *
 * The navigator lays each process-type row out on its own grid, so the
 * pick has to reach the rows rather than a single page-level container —
 * and a row shorter than the pick must not stretch across empty tracks.
 * ──────────────────────────────────────────────────────────────── */

const NAV_STORAGE_KEY = "turboea-report:process-navigator";

function makeCoreProcesses(count: number) {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      id: `core-${i}`,
      name: `Core Process ${i}`,
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
    })),
    organizations: [],
    business_contexts: [],
  };
}

describe("ProcessNavigator column picker", () => {
  /** The grid holding a process row's cards. */
  const rowGrid = () =>
    document.querySelector("[class*='report-print-grid-']") as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("defaults to three columns", async () => {
    mockApi(makeCoreProcesses(4));
    renderNavigator();
    await screen.findByText("Core Process 0");

    expect(rowGrid()).toHaveClass("report-print-grid-3");
  });

  it("never stretches a row across more tracks than it has cards", async () => {
    mockApi(makeCoreProcesses(2));
    renderNavigator();
    await screen.findByText("Core Process 0");

    expect(rowGrid()).toHaveClass("report-print-grid-2");
  });

  it("reflows the rows and remembers the pick", async () => {
    mockApi(makeCoreProcesses(4));
    renderNavigator();
    await screen.findByText("Core Process 0");

    await userEvent.click(screen.getByRole("button", { name: "One column" }));

    expect(rowGrid()).toHaveClass("report-print-grid-1");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(NAV_STORAGE_KEY)!)).toMatchObject({
        columns: 1,
      }),
    );
  });

  it("restores a stored count on the next visit", async () => {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ columns: 2 }));
    mockApi(makeCoreProcesses(4));
    renderNavigator();
    await screen.findByText("Core Process 0");

    expect(rowGrid()).toHaveClass("report-print-grid-2");
  });

  it("ignores a stored count it does not support", async () => {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ columns: 4 }));
    mockApi(makeCoreProcesses(4));
    renderNavigator();
    await screen.findByText("Core Process 0");

    expect(rowGrid()).toHaveClass("report-print-grid-3");
  });
});

/* ────────────────────────────────────────────────────────────────
 * Nested column taper.
 *
 * The top-level pick propagates down the tree, tapering one column per
 * level, so drilling in doesn't leave L3 cards fighting for space.
 * ──────────────────────────────────────────────────────────────── */

function makeProcessTree() {
  const proc = (id: string, name: string, parent_id: string | null) => ({
    id,
    name,
    subtype: undefined,
    parent_id,
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
  });
  return {
    // Root > Mid > Deep
    items: [
      proc("root-1", "Root Process", null),
      proc("mid-1", "Mid Process", "root-1"),
      proc("deep-1", "Deep Process", "mid-1"),
    ],
    organizations: [],
    business_contexts: [],
  };
}

describe("ProcessNavigator nested column taper", () => {
  /** The count on the nested grid holding `name`. */
  const colsAround = (name: string) =>
    screen.getByText(name).closest("[data-nested-cols]")?.getAttribute("data-nested-cols");

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const renderAtLevel3 = async (columns: number) => {
    localStorage.setItem(
      NAV_STORAGE_KEY,
      JSON.stringify({ columns, displayLevel: 3, viewMode: "house" }),
    );
    mockApi(makeProcessTree());
    renderNavigator();
    await screen.findByText("Deep Process");
  };

  it("gives L2 three columns and L3 two when one column is picked", async () => {
    await renderAtLevel3(1);
    expect(colsAround("Mid Process")).toBe("3");
    expect(colsAround("Deep Process")).toBe("2");
  });

  it("stacks the levels below the top when three columns are picked", async () => {
    await renderAtLevel3(3);
    expect(colsAround("Mid Process")).toBe("1");
    expect(colsAround("Deep Process")).toBe("1");
  });

  it("restarts the taper at the zoomed root", async () => {
    // Zoom re-roots the tree without re-levelling its nodes, so a taper keyed
    // on the absolute node level would start from the wrong origin: Mid is
    // level 2, but once zoomed it is what the page is built around, so its
    // children must be laid out as depth 2, not depth 3.
    mockApi(makeProcessTree());
    // URL params deliberately take precedence over the stored config, so the
    // pick has to travel in the URL here alongside the zoom.
    render(
      <MemoryRouter initialEntries={["/bpm?zoom=root-1&level=3&cols=1"]}>
        <ProcessNavigator />
      </MemoryRouter>,
    );
    await screen.findByText("Deep Process");

    // Zoomed onto Root, its child Mid is now a rendered root (depth 1), so
    // Deep sits in a depth-2 grid and gets the full three columns.
    expect(colsAround("Deep Process")).toBe("3");
  });
});
