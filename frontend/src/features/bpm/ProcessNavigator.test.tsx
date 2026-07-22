import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

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
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
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
