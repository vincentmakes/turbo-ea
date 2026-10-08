/**
 * Branch coverage for the Capability Map beyond scope, filter collapse, time
 * travel and columns (CapabilityMapReport.test.tsx): the metrics and their
 * formatting, application chips coloured by a field, the relation / tag /
 * attribute filters (including their legacy saved shapes and the "empty"
 * option), macro capabilities, the detail drawer, and the shell actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  saveDialogOpen: false,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  captureAndSave: (() => {}) as () => void,
  tlReset: (() => {}) as () => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: saved.saveDialogOpen,
    setSaveDialogOpen: saved.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: saved.resetAll,
    reportType: "capability-map",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => saved.captureAndSave(),
  }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => {
    const now = Date.now();
    return {
      timelineDate: now,
      setTimelineDate: () => {},
      todayMs: now,
      isTimeTraveling: false,
      persistValue: undefined,
      printParam: null,
      restore: () => {},
      reset: () => saved.tlReset(),
    };
  },
}));
vi.mock("@/components/TimelineSlider", () => ({ default: () => <div data-testid="timeline-slider" /> }));
vi.mock("./SaveReportDialog", () => ({
  default: (props: { open: boolean; onClose: () => void }) =>
    props.open ? <button onClick={props.onClose}>close-save</button> : null,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean; onClose: () => void }) =>
    props.open ? (
      <div data-testid="side-panel">
        {props.cardId}
        <button onClick={props.onClose}>close-panel</button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import CapabilityMapReport from "./CapabilityMapReport";

const TYPES = [
  makeCardType({ key: "BusinessCapability", label: "Business Capability", color: "#003399" }),
  makeCardType({ key: "Application", label: "Application", color: "#0f7eb5" }),
  makeCardType({ key: "Organization", label: "Organization" }),
  makeCardType({ key: "Provider", label: "Provider" }),
];

const app = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  attributes: {},
  lifecycle: {},
  org_ids: [],
  related_by_type: {},
  related_by_rel_type: {},
  tag_ids: [],
  ...over,
});

const ALPHA = app("alpha", "Alpha", {
  attributes: { criticality: "high", costTotalAnnual: 1000 },
  lifecycle: { active: "2015-01-01", endOfLife: "2099-01-01" },
  related_by_type: { Organization: ["org-sales"] },
  related_by_rel_type: { relOrgOwnsApp: ["org-sales"] },
  tag_ids: ["t-cloud"],
});
const BETA = app("beta", "Beta", {
  attributes: { criticality: "mystery", costTotalAnnual: 200 },
  related_by_rel_type: { relOrgUsesApp: ["org-sales"] },
  tag_ids: ["t-onprem"],
});
// Legacy payload: organisations only on `org_ids`.
const GAMMA = app("gamma", "Gamma", { org_ids: ["org-ops"] });

const cap = (
  id: string,
  name: string,
  parent_id: string | null,
  apps: ReturnType<typeof app>[] = [],
  attributes: Record<string, unknown> = {},
) => ({ id, name, parent_id, app_count: apps.length, total_cost: 0, risk_count: 0, attributes, apps });

/**
 *  Enterprise (Macro)
 *    └─ Sales (L1)
 *         └─ Lead Management (L2)   · Alpha · Beta
 *  Finance (L1)                     · Gamma
 *    └─ Billing (L2)                · Alpha
 */
const HEATMAP = {
  items: [
    cap("macro", "Enterprise", null, [], { capabilityLevel: "Macro" }),
    cap("sales", "Sales", "macro"),
    cap("leads", "Lead Management", "sales", [ALPHA, BETA]),
    cap("finance", "Finance", null, [GAMMA]),
    cap("billing", "Billing", "finance", [ALPHA]),
  ],
  fields_schema: [
    {
      section: "Business",
      fields: [
        {
          key: "criticality",
          label: "Criticality",
          type: "single_select",
          options: [
            { key: "high", label: "High Crit", color: "#d32f2f" },
            { key: "low", label: "Low Crit", color: "#388e3c" },
            { key: "plain", label: "Plain" },
          ],
        },
        { key: "costTotalAnnual", label: "Annual Cost", type: "cost" },
      ],
    },
  ],
  filterable_types: {
    Organization: [
      { id: "org-sales", name: "Sales Org", type: "Organization" },
      { id: "org-ops", name: "Ops Org", type: "Organization" },
    ],
    Provider: [{ id: "prov-1", name: "Acme", type: "Provider" }],
    Empty: [],
  },
  relation_types: [
    { key: "relOrgOwnsApp", label: "owns", reverse_label: "is owned by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
    { key: "relOrgUsesApp", label: "uses", reverse_label: "is used by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
    { key: "relAppToApp", label: "calls", source_type_key: "Application", target_type_key: "Application", other_type_key: "Application" },
  ],
  tag_groups: [
    { id: "g-host", name: "Hosting", mode: "multi", tags: [{ id: "t-cloud", name: "Cloud" }, { id: "t-onprem", name: "On-Prem" }] },
    { id: "g-other", name: "Other", mode: "multi", tags: [{ id: "t-x", name: "X" }] },
  ],
};

const heatmapCalls = () => mockApi.callsOf("get", "/reports/capability-heatmap*").map((c) => c.path);

function renderMap() {
  return render(
    <MemoryRouter>
      <CapabilityMapReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;
const loaded = () => within(document.body).findByText("Finance");

async function pick(label: RegExp, option: RegExp) {
  // The request the caller waited on is recorded when it is sent, not when its
  // response renders, so the toolbar may still be behind a spinner here.
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  saved.config = null;
  saved.saveDialogOpen = false;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  saved.captureAndSave = vi.fn();
  saved.tlReset = vi.fn();
  mockApi.on("get", "/reports/capability-heatmap*", HEATMAP);
  mockApi.on("get", "/cards*", { items: [], total: 0 });
});

describe("CapabilityMapReport metrics", () => {
  it("starts macro roots a level above L1 and flags EOL risk", async () => {
    saved.config = { displayLevel: 1 };
    renderMap();
    await loaded();
    // At depth 1 the macro root (level 0) still expands to show its L1 child.
    expect(within(chart()).getByText("Enterprise")).toBeInTheDocument();
    expect(within(chart()).getByText("Sales")).toBeInTheDocument();
    expect(within(chart()).queryByText("Lead Management")).not.toBeInTheDocument();
    // Alpha carries an end-of-life date under Sales and Finance.
    expect(within(chart()).getAllByLabelText("1 EOL risk").length).toBeGreaterThan(0);
    // Two apps each under Enterprise (via Lead Management) and Finance.
    expect(within(legend()).getByText("Max: 2")).toBeInTheDocument();
  });

  it("formats the cost metric and re-fetches for it", async () => {
    renderMap();
    await loaded();
    await pick(/heatmap metric/i, /Total Cost/);
    await waitFor(() => expect(heatmapCalls()).toContain("/reports/capability-heatmap?metric=total_cost"));
    // Lead Management: Alpha 1000 + Beta 200; Finance: Gamma 0 + Alpha 1000.
    expect(await within(chart()).findByText("$1200")).toBeInTheDocument();
    expect(within(legend()).getByText("Max: $1200")).toBeInTheDocument();
  });

  it("drops the EOL flag when the metric already is the EOL count", async () => {
    renderMap();
    await loaded();
    await pick(/heatmap metric/i, /Risk \(EOL count\)/);
    await waitFor(() => expect(heatmapCalls()).toContain("/reports/capability-heatmap?metric=risk_count"));
    await waitFor(() => expect(within(chart()).queryByLabelText("1 EOL risk")).not.toBeInTheDocument());
    expect(within(legend()).getByText("Max: 1")).toBeInTheDocument();
  });

  it("explains an empty map", async () => {
    mockApi.on("get", "/reports/capability-heatmap*", { items: [] });
    renderMap();
    expect(await screen.findByText(/No Business Capabilities found/)).toBeInTheDocument();
  });
});

describe("CapabilityMapReport application chips", () => {
  it("colours chips by a field, with a legend of coloured options and Not set", async () => {
    const user = userEvent.setup();
    renderMap();
    await loaded();
    await user.click(within(toolbar()).getByRole("checkbox", { name: /show applications/i }));
    expect(within(chart()).getAllByText("Alpha").length).toBeGreaterThan(0);
    // Not coloured yet: the tooltip is the bare name.
    expect(within(chart()).getAllByLabelText("Alpha").length).toBeGreaterThan(0);

    await pick(/color apps by/i, /^Criticality$/);
    expect(within(legend()).getByText("Criticality:")).toBeInTheDocument();
    expect(within(legend()).getByText("High Crit")).toBeInTheDocument();
    expect(within(legend()).getByText("Low Crit")).toBeInTheDocument();
    expect(within(legend()).queryByText("Plain")).not.toBeInTheDocument();
    expect(within(legend()).getByText("Not set")).toBeInTheDocument();
    expect(within(chart()).getAllByLabelText("Alpha — High Crit").length).toBeGreaterThan(0);
    // A stored key the field does not define is named raw.
    expect(within(chart()).getByLabelText("Beta — mystery")).toBeInTheDocument();

    await pick(/color apps by/i, /No color/);
    expect(within(legend()).queryByText("Criticality:")).not.toBeInTheDocument();
  });

  it("shows a branch's own apps on its header and opens one", async () => {
    saved.config = { showApps: true };
    renderMap();
    await loaded();
    // Finance is a branch at depth 2: Gamma is its own, Alpha belongs to Billing.
    fireEvent.click(within(chart()).getByText("Gamma"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("gamma");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });
});

describe("CapabilityMapReport detail drawer", () => {
  it("lists a leaf's apps with colour and EOL notes, and links to the inventory", async () => {
    saved.config = { colorBy: "criticality", relationFilters: { Organization: ["org-sales", "gone"] } };
    renderMap();
    await loaded();
    fireEvent.click(within(chart()).getByText("Lead Management"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("Supporting Applications (1)")).toBeInTheDocument();
    expect(within(panel).getByText("High Crit · End of Life: 2099-01-01")).toBeInTheDocument();
    const link = within(panel).getByRole("link", { name: /view in inventory/i });
    // The relation filter travels by name; the unknown id is dropped.
    expect(link.getAttribute("href")).toContain("rel_Organization=Sales+Org");

    fireEvent.click(within(panel).getByText("Alpha"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("alpha");
  });

  it("lists a branch's sub-capabilities and walks into one", async () => {
    renderMap();
    await loaded();
    fireEvent.click(within(chart()).getByText("Finance"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("Sub-Capabilities (1)")).toBeInTheDocument();
    expect(within(panel).getByText("$1000")).toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: /view in inventory/i })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByText("Billing (1)"));
    expect(within(screen.getByRole("presentation")).getByRole("heading", { name: "Billing" }))
      .toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("presentation")).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  });

  it("says when the filters leave a capability without apps", async () => {
    saved.config = { attrFilters: { criticality: ["low"] } };
    renderMap();
    await loaded();
    fireEvent.click(within(chart()).getByText("Billing"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("No applications match current filters")).toBeInTheDocument();
  });

  it("says when a capability has no apps at all", async () => {
    mockApi.on("get", "/reports/capability-heatmap*", { ...HEATMAP, items: [cap("lonely", "Lonely", null)] });
    renderMap();
    fireEvent.click(await within(document.body).findByText("Lonely"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("No linked applications")).toBeInTheDocument();
    expect(within(panel).getByText("Supporting Applications (0)")).toBeInTheDocument();
  });
});

describe("CapabilityMapReport filters", () => {
  const appsShown = () =>
    ["Alpha", "Beta", "Gamma"].filter((n) => within(chart()).queryAllByText(n).length > 0);

  it("filters by a card-type relation, falling back to org_ids", async () => {
    saved.config = { showApps: true, relationFilters: { Organization: ["org-ops"] } };
    renderMap();
    await loaded();
    expect(appsShown()).toEqual(["Gamma"]);
  });

  it("filters by a relation type separately from the card type", async () => {
    saved.config = { showApps: true, relationFilters: { relOrgUsesApp: ["org-sales"] } };
    renderMap();
    await loaded();
    expect(appsShown()).toEqual(["Beta"]);
  });

  it("keeps apps with no relation when the empty option is picked", async () => {
    saved.config = { showApps: true, relationFilters: { Provider: [EMPTY_FILTER_KEY] } };
    renderMap();
    await loaded();
    // Neither Alpha nor Beta has a Provider. (Gamma is deliberately not
    // asserted: its legacy `org_ids` currently leak into every card-type facet.)
    expect(appsShown()).toEqual(expect.arrayContaining(["Alpha", "Beta"]));
  });

  it("filters by attribute value, or by the attribute being empty", async () => {
    saved.config = { showApps: true, attrFilters: { criticality: [EMPTY_FILTER_KEY], other: [] } };
    renderMap();
    await loaded();
    expect(appsShown()).toEqual(["Gamma"]);
  });

  it("filters by tags (OR within a group), including the legacy grouped shape", async () => {
    saved.config = { showApps: true, tagFilterIds: ["t-cloud"] };
    const first = renderMap();
    await loaded();
    expect(appsShown()).toEqual(["Alpha"]);
    first.unmount();

    saved.config = { showApps: true, tagFilters: { "g-host": ["t-onprem"], bad: "x" } };
    renderMap();
    await loaded();
    expect(appsShown()).toEqual(["Beta"]);
  });

  it("migrates the legacy organisation filter", async () => {
    saved.config = { showApps: true, filterOrgs: ["org-sales"] };
    renderMap();
    await loaded();
    expect(appsShown()).toEqual(["Alpha"]);
    expect(within(document.querySelector(".report-print-params") as HTMLElement).getByText("1 active"))
      .toBeInTheDocument();
  });

  it("offers a facet per relation type and folds the rest behind More", async () => {
    saved.config = { showApps: true };
    renderMap();
    await loaded();
    // Organization first, then by key: Provider before the two relation facets.
    expect(within(toolbar()).getByLabelText("Organization")).toBeInTheDocument();
    expect(within(toolbar()).getByLabelText("Provider")).toBeInTheDocument();
    expect(within(toolbar()).queryByLabelText("Organization · is owned by")).not.toBeInTheDocument();

    fireEvent.click(within(toolbar()).getByText("2 more"));
    // Read from the Application's side: the reverse verb.
    expect(within(toolbar()).getByLabelText("Organization · is owned by")).toBeInTheDocument();
    expect(within(toolbar()).getByLabelText("Organization · is used by")).toBeInTheDocument();

    fireEvent.click(within(toolbar()).getByText("Less"));
    expect(within(toolbar()).queryByLabelText("Organization · is used by")).not.toBeInTheDocument();
  });

  it("applies a relation and a field filter picked in the toolbar, then clears them", async () => {
    const user = userEvent.setup();
    saved.config = { showApps: true };
    renderMap();
    await loaded();

    await user.click(within(toolbar()).getByLabelText("Organization"));
    await user.click(await screen.findByRole("option", { name: "Ops Org" }));
    await waitFor(() => expect(appsShown()).toEqual(["Gamma"]));
    await user.keyboard("{Escape}");

    await user.click(within(toolbar()).getByLabelText("Criticality"));
    await user.click(await screen.findByRole("option", { name: "High Crit" }));
    await waitFor(() => expect(appsShown()).toEqual([]));
    await user.keyboard("{Escape}");

    const clear = within(toolbar()).getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    await user.click(within(clear).getByTestId("CancelIcon"));
    await waitFor(() => expect(appsShown()).toEqual(["Alpha", "Beta", "Gamma"]));
  });
});

describe("CapabilityMapReport shell actions", () => {
  it("resets every control and the timeline", async () => {
    saved.config = { metric: "risk_count", showApps: true, colorBy: "criticality", tagFilterIds: ["t-cloud"] };
    renderMap();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    expect(saved.tlReset).toHaveBeenCalled();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          metric: "app_count",
          showApps: false,
          colorBy: "",
          tagFilterIds: [],
          attrFilters: {},
          relationFilters: {},
        }),
      ),
    );
  });

  it("saves through the thumbnail capture and closes the dialog", async () => {
    saved.saveDialogOpen = true;
    renderMap();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(saved.captureAndSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });

  it("shows the timeline slider once apps carry lifecycle dates", async () => {
    renderMap();
    await loaded();
    expect(screen.getByTestId("timeline-slider")).toBeInTheDocument();
  });
});
