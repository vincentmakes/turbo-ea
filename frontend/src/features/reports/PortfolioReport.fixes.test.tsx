/**
 * Regression tests for bugs a mutation pass found in the Portfolio report: a
 * one-relation-type axis that listed cards related through other types, the
 * AI insights request read at the wrong date, the Color by select going blank
 * or out of range, colour bars whose order depended on render history, and
 * relation-subtype filters lost on restore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const state = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadedConfig: null as unknown,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  /** "Today", fixed per test: the real hook memoises it, and a value that
   *  moved on every render would rebuild every memo keyed on the date. */
  today: 0,
  timelineDate: null as number | null,
  aiEnabled: false,
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (key: string) => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: state.loadedConfig,
    consumeConfig: () => state.config,
    resetSavedReport: () => {},
    persistConfig: state.persistConfig,
    resetAll: () => {},
    reportType: key,
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => {
    const at = state.timelineDate ?? state.today;
    return {
      timelineDate: at,
      setTimelineDate: () => {},
      todayMs: state.today,
      isTimeTraveling: at !== state.today,
      persistValue: undefined,
      printParam: null,
      restore: () => {},
      reset: () => {},
    };
  },
}));
vi.mock("@/hooks/useAiStatus", async () => ({
  ...(await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus")),
  useAiStatus: () => ({ aiStatus: { portfolio_insights_enabled: state.aiEnabled } }),
}));
vi.mock("@/components/TimelineSlider", () => ({ default: () => <div data-testid="timeline-slider" /> }));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { APPLICATION_TYPE, makeCardType } from "@/test/fixtures/metamodel";
import PortfolioReport from "./PortfolioReport";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const ORG_TYPE = makeCardType({ key: "Organization", label: "Organization", icon: "corporate_fare", has_hierarchy: true });
const PROVIDER_TYPE = makeCardType({ key: "Provider", label: "Provider", icon: "storefront" });

type Item = {
  id: string;
  name: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  relations: Record<string, unknown>[];
  org_ids: string[];
};

const rel = (relation_type: string, related_id: string, related_name: string, attributes?: Record<string, unknown>) => ({
  relation_type,
  related_id,
  related_name,
  related_type: "Organization",
  ...(attributes ? { attributes } : {}),
});
const owns = (id: string, name: string, usage?: string) =>
  rel("relOrgOwnsApp", id, name, usage ? { usage } : undefined);
const uses = (id: string, name: string) => rel("relOrgUsesApp", id, name);
const app = (id: string, name: string, extra: Partial<Item> = {}): Item => ({
  id,
  name,
  attributes: {},
  lifecycle: {},
  relations: [],
  org_ids: [],
  ...extra,
});

const CRIT = {
  key: "crit",
  label: "Business Criticality",
  type: "single_select",
  options: [
    { key: "high", label: "High", color: "#f44336" },
    { key: "medium", label: "Medium", color: "#ff9800" },
    { key: "low", label: "Low", color: "#4caf50" },
  ],
};
const TIER = { key: "tier", label: "Tier", type: "single_select", options: [{ key: "t1", label: "Tier 1", color: "#000000" }] };

const REL_OWNS = {
  key: "relOrgOwnsApp",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
  other_type_key: "Organization",
  attributes_schema: [
    {
      key: "usage",
      label: "Usage",
      type: "single_select",
      options: [
        { key: "owner", label: "Owner", color: "#3f51b5" },
        { key: "user", label: "User", color: "#009688" },
      ],
    },
  ],
};
const REL_USES = {
  key: "relOrgUsesApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
  other_type_key: "Organization",
};

/** SAP ERP is owned by Finance HQ; Salesforce is owned by Payments Team and used by Finance HQ. */
const ITEMS: Item[] = [
  app("erp", "SAP ERP", {
    attributes: { crit: "high", tier: "t1" },
    relations: [owns("org-hq", "Finance HQ", "owner")],
    org_ids: ["org-hq"],
  }),
  app("crm", "Salesforce", {
    attributes: { crit: "medium" },
    relations: [owns("org-pay", "Payments Team", "user"), uses("org-hq", "Finance HQ")],
    org_ids: ["org-pay", "org-hq"],
  }),
  app("tool", "Standalone Tool"),
];

const PAYLOAD = {
  items: ITEMS,
  fields_schema: [{ section: "Details", fields: [CRIT, TIER] }],
  relation_types: [REL_OWNS, REL_USES],
  groupable_types: {
    Organization: [
      { id: "org-hq", name: "Finance HQ", type: "Organization" },
      { id: "org-pay", name: "Payments Team", type: "Organization", parent_id: "org-hq" },
    ],
  },
  organizations: [],
  tag_groups: [],
};

/** A Provider landscape with two select fields, the second one not the default. */
const PROVIDER_PAYLOAD = {
  items: [app("globex", "Globex", { attributes: { vendorTier: "gold", region: "eu" } })],
  fields_schema: [
    {
      section: "Vendor",
      fields: [
        { key: "vendorTier", label: "Vendor Tier", type: "single_select", options: [{ key: "gold", label: "Gold", color: "#ffd700" }] },
        { key: "region", label: "Region", type: "single_select", options: [{ key: "eu", label: "Europe", color: "#123456" }] },
      ],
    },
  ],
  relation_types: [],
  groupable_types: {},
  organizations: [],
  tag_groups: [],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;
const chipLabels = (el: HTMLElement) =>
  Array.from(el.querySelectorAll(".MuiChip-label")).map((c) => c.textContent);
const lastPersisted = () => {
  const calls = vi.mocked(state.persistConfig).mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
};
const colorSelect = (label = /color apps by/i) => screen.getByRole("combobox", { name: label });
/** The group box (or the ungrouped section) a header text sits in. */
const box = (header: string) =>
  (within(chart()).getByText(header).closest("[data-export-row]") ??
    within(chart()).getByText(header).parentElement!.parentElement) as HTMLElement;

function ui(props: Parameters<typeof PortfolioReport>[0] = {}) {
  return (
    <MemoryRouter>
      <PortfolioReport {...props} />
    </MemoryRouter>
  );
}
const loaded = (name = "Standalone Tool") => within(document.body).findByText(name);

async function pick(label: RegExp, option: string) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([APPLICATION_TYPE, ORG_TYPE, PROVIDER_TYPE]);
  state.config = null;
  state.loadedConfig = null;
  state.persistConfig = vi.fn();
  state.today = Date.now();
  state.timelineDate = null;
  state.aiEnabled = false;
  mockApi.on("get", "/reports/app-portfolio*", PAYLOAD);
});

/* ------------------------------------------------------------------ */
/*  One relation type as the group-by axis                             */
/* ------------------------------------------------------------------ */

describe("grouping by one relation type", () => {
  it("lists a card only under the cards it reaches through that relation type", async () => {
    state.config = { groupByRaw: "relt:relOrgUsesApp" };
    render(ui());
    await loaded();
    // Finance HQ uses Salesforce, but only owns SAP ERP.
    expect(chipLabels(box("Finance HQ"))).toEqual(["1 app", "Salesforce"]);
    // Payments Team only owns Salesforce: no group on the "is used by" axis.
    expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument();
    const ungrouped = box("Not assigned to any Organization · is used by");
    expect(within(ungrouped).getByText("SAP ERP")).toBeInTheDocument();
    expect(within(ungrouped).getByText("Standalone Tool")).toBeInTheDocument();
  });
});

describe("Group by menu", () => {
  const groupBySelect = () => screen.getByRole("combobox", { name: /group by/i });

  it("offers each relation type reaching a card type, named by its verb", async () => {
    render(ui());
    await loaded();
    fireEvent.mouseDown(groupBySelect());
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Organization · is owned by"),
        expect.stringContaining("Organization · is used by"),
      ]),
    );
    fireEvent.click(within(listbox).getByRole("option", { name: /Organization · is used by/ }));
    await waitFor(() => expect(groupBySelect()).toHaveTextContent("Organization · is used by"));
    await waitFor(() => expect(lastPersisted()).toMatchObject({ groupByRaw: "relt:relOrgUsesApp" }));
    expect(chipLabels(box("Finance HQ"))).toEqual(["1 app", "Salesforce"]);
  });

  it("shows a restored one-relation-type axis in the select", async () => {
    state.config = { groupByRaw: "relt:relOrgOwnsApp" };
    render(ui());
    await loaded();
    expect(groupBySelect()).toHaveTextContent("Organization · is owned by");
  });
});

/* ------------------------------------------------------------------ */
/*  AI insights at the travelled date                                  */
/* ------------------------------------------------------------------ */

describe("AI insights while time-travelling", () => {
  it("reads lifecycle phases at the travelled date and names that date", async () => {
    state.aiEnabled = true;
    state.timelineDate = new Date(2030, 5, 15, 12).getTime();
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        // Active today, phasing out by the travelled date.
        app("p1", "Fading App", { lifecycle: { active: "2020-01-01", phaseOut: "2028-01-01", endOfLife: "2035-01-01" } }),
        // Planned today, live by the travelled date.
        app("p2", "Coming App", { lifecycle: { plan: "2020-01-01", active: "2029-01-01" } }),
      ],
    });
    mockApi.on("post", "/ai/portfolio-insights", { insights: [] });
    render(ui());
    await loaded("Coming App");

    fireEvent.click(within(screen.getByLabelText("AI Insights")).getByRole("button"));
    await waitFor(() => expect(mockApi.callsOf("post", "/ai/portfolio-insights")).toHaveLength(1));
    const body = mockApi.callsOf("post", "/ai/portfolio-insights")[0].body as Record<string, unknown>;
    expect(body.lifecycle_summary).toEqual({ phaseOut: 1, active: 1 });
    expect(body.active_filters).toEqual(["Timeline date: 2030-06-15"]);
  });
});

/* ------------------------------------------------------------------ */
/*  The Color by select                                                */
/* ------------------------------------------------------------------ */

describe("Color by select", () => {
  it("shows No color once it is picked", async () => {
    render(ui());
    await loaded();
    expect(colorSelect()).toHaveTextContent("Business Criticality");
    await pick(/color apps by/i, "No color");
    await waitFor(() => expect(colorSelect()).toHaveTextContent("No color"));
  });

  it("resets a saved colouring by a field the card type no longer has", async () => {
    state.config = { groupByRaw: "rel:Organization", colorBy: "goneField", view: "table" };
    render(ui());
    await loaded();
    await waitFor(() =>
      expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
        "Name",
        "Subtype",
        "Organization",
        "Business Criticality",
      ]),
    );
    const row = screen.getByRole("row", { name: /SAP ERP/ });
    expect(within(row).getByText("High")).toBeInTheDocument();
    expect(colorSelect()).toHaveTextContent("Business Criticality");
    await waitFor(() => expect(lastPersisted()).toMatchObject({ colorBy: "crit" }));
  });

  it("keeps a saved colouring by a field that still exists", async () => {
    state.config = { colorBy: "tier" };
    render(ui());
    await loaded();
    expect(within(legend()).getByText("Tier:")).toBeInTheDocument();
    expect(colorSelect()).toHaveTextContent("Tier");
  });

  it("keeps a saved colouring for another card type while that type loads", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Provider", PROVIDER_PAYLOAD);
    const { rerender } = render(ui({ showTypeSelector: true }));
    await loaded();

    state.config = { cardType: "Provider", colorBy: "region" };
    state.loadedConfig = { id: "provider-report" };
    rerender(ui({ showTypeSelector: true }));
    await loaded("Globex");
    expect(within(legend()).getByText("Region:")).toBeInTheDocument();
    expect(colorSelect(/^color by/i)).toHaveTextContent("Region");
  });
});

/* ------------------------------------------------------------------ */
/*  Colour bars                                                        */
/* ------------------------------------------------------------------ */

describe("colour bar order", () => {
  it("does not change when the colouring is switched away and back", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("z", "Zed", { attributes: { crit: "low" }, relations: [owns("org-hq", "Finance HQ")] }),
        app("a", "Abe", { attributes: { crit: "high" }, relations: [owns("org-hq", "Finance HQ")] }),
        app("y", "Yak", { attributes: { crit: "low" } }),
        app("n", "Ant", { attributes: { crit: "high" } }),
      ],
    });
    state.config = { groupByRaw: "rel:Organization", colorBy: "crit" };
    render(ui());
    await loaded("Ant");
    const BAR = "Low: 1 (50%) · High: 1 (50%)";
    const group = () => box("Finance HQ");
    const ungrouped = () => box("Not assigned to any Organization");
    expect(within(group()).getByLabelText(BAR)).toBeInTheDocument();
    expect(within(ungrouped()).getByLabelText(BAR)).toBeInTheDocument();
    // The chips themselves are alphabetical.
    expect(chipLabels(group())).toEqual(["2 apps", "Abe", "Zed"]);

    await pick(/color apps by/i, "Tier");
    await waitFor(() => expect(within(legend()).getByText("Tier:")).toBeInTheDocument());
    await pick(/color apps by/i, "Business Criticality");
    await waitFor(() => expect(within(legend()).getByText("Business Criticality:")).toBeInTheDocument());

    expect(within(group()).getByLabelText(BAR)).toBeInTheDocument();
    expect(within(ungrouped()).getByLabelText(BAR)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Restored relation-subtype filters                                  */
/* ------------------------------------------------------------------ */

describe("restoring relation-subtype filters", () => {
  it("applies a saved relation-subtype filter when the report opens", async () => {
    state.config = {
      groupByRaw: "rel:Organization",
      relSubtypeFilters: { "relOrgOwnsApp::usage": ["owner"] },
    };
    render(ui());
    await loaded("SAP ERP");
    // Only SAP ERP is owned as "Owner"; Salesforce's ownership is a "User" one.
    expect(chipLabels(box("Finance HQ"))).toEqual(["1 app", "SAP ERP"]);
    expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument();
    expect(within(chart()).queryByText("Salesforce")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        relSubtypeFilters: { "relOrgOwnsApp::usage": ["owner"] },
      }),
    );
  });
});
