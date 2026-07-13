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

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "BusinessProcess"
        ? { key, icon: "route", color: "#028f00", subtypes: [] }
        : undefined,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "member" } }),
}));
vi.mock("@/hooks/useResolveLabel", () => ({
  useSubtypeLabel: () => () => "",
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
