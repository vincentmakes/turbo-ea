/**
 * Branch coverage for the Portfolio report beyond PortfolioReport.test.tsx:
 * chip and group clicks, the ungrouped section, colouring by a relation
 * subtype, the table's sorts, AI insights, the Flexible Portfolio's type
 * selector, the filter controls and their legacy saved shapes, and nested
 * group interactions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const state = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  saveDialogOpen: false,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  captureAndSave: (() => {}) as () => void,
  tlReset: (() => {}) as () => void,
  aiEnabled: false,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: state.saveDialogOpen,
    setSaveDialogOpen: state.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => state.config,
    resetSavedReport: () => {},
    persistConfig: state.persistConfig,
    resetAll: state.resetAll,
    reportType: "portfolio",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => state.captureAndSave(),
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
      reset: () => state.tlReset(),
    };
  },
}));
vi.mock("@/hooks/useAiStatus", async () => ({
  ...(await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus")),
  useAiStatus: () => ({ aiStatus: { portfolio_insights_enabled: state.aiEnabled } }),
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
import { APPLICATION_TYPE, makeCardType } from "@/test/fixtures/metamodel";
import PortfolioReport from "./PortfolioReport";

const ORG_TYPE = makeCardType({ key: "Organization", label: "Organization", icon: "corporate_fare", has_hierarchy: true });
const PROVIDER_TYPE = makeCardType({ key: "Provider", label: "Provider", icon: "storefront" });
const BP_TYPE = makeCardType({ key: "BusinessProcess", label: "Business Process", icon: "route" });

const owns = (id: string, name: string, usage?: string) => ({
  relation_type: "relOrgOwnsApp",
  related_id: id,
  related_name: name,
  related_type: "Organization",
  ...(usage ? { attributes: { usage } } : {}),
});

const ITEMS = [
  {
    id: "erp",
    name: "SAP ERP",
    subtype: "businessApplication",
    attributes: { crit: "high", tier: "t1" },
    lifecycle: { active: "2020-01-01" },
    relations: [owns("org-hq", "Finance HQ", "owner")],
    org_ids: ["org-hq"],
    tag_ids: ["tag-cloud"],
  },
  {
    id: "crm",
    name: "Salesforce",
    subtype: "microservice",
    attributes: { crit: "medium" },
    lifecycle: { active: "2021-01-01", endOfLife: "2099-12-31" },
    relations: [
      owns("org-pay", "Payments Team", "user"),
      { relation_type: "relOrgUsesApp", related_id: "org-hq", related_name: "Finance HQ", related_type: "Organization" },
    ],
    org_ids: ["org-pay", "org-hq"],
  },
  { id: "tool", name: "Standalone Tool", attributes: {}, lifecycle: {}, relations: [], org_ids: [] },
  {
    id: "zeta",
    name: "Zeta",
    attributes: { crit: "unknownKey" },
    relations: [{ relation_type: "relProvToApp", related_id: "prov-1", related_name: "Acme", related_type: "Provider" }],
    org_ids: [],
  },
];

const PAYLOAD = {
  items: ITEMS,
  fields_schema: [
    {
      section: "Details",
      fields: [
        {
          key: "crit",
          label: "Business Criticality",
          type: "single_select",
          options: [
            { key: "high", label: "High", color: "#f44336" },
            { key: "medium", label: "Medium", color: "#ff9800" },
            { key: "low", label: "Low", color: "#4caf50" },
          ],
        },
        { key: "tier", label: "Tier", type: "single_select", options: [{ key: "t1", label: "Tier 1", color: "#000000" }] },
      ],
    },
  ],
  relation_types: [
    {
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
    },
    { key: "relOrgUsesApp", label: "uses", reverse_label: "is used by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
    { key: "relProvToApp", label: "supplies", reverse_label: "is supplied by", source_type_key: "Provider", target_type_key: "Application", other_type_key: "Provider" },
  ],
  groupable_types: {
    Organization: [
      { id: "org-hq", name: "Finance HQ", type: "Organization" },
      { id: "org-pay", name: "Payments Team", type: "Organization", parent_id: "org-hq" },
      { id: "org-anc", name: "Ancestor Only", type: "Organization", ancestor_only: true },
    ],
    Provider: [{ id: "prov-1", name: "Acme", type: "Provider" }],
    Empty: [],
  },
  organizations: [],
  tag_groups: [{ id: "g-host", name: "Hosting", mode: "multi", tags: [{ id: "tag-cloud", name: "Cloud" }] }],
};

/** The AI button: its tooltip label sits on the span that wraps it. */
const aiButton = () => within(screen.getByLabelText("AI Insights")).getByRole("button");

const appCalls = () => mockApi.callsOf("get", "/reports/app-portfolio*").map((c) => c.path);
const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;

function renderPortfolio(props: Parameters<typeof PortfolioReport>[0] = {}) {
  return render(
    <MemoryRouter>
      <PortfolioReport {...props} />
    </MemoryRouter>,
  );
}

const loaded = () => within(document.body).findByText("Standalone Tool");

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
  withMetamodel([APPLICATION_TYPE, ORG_TYPE, PROVIDER_TYPE, BP_TYPE]);
  state.config = null;
  state.saveDialogOpen = false;
  state.setSaveDialogOpen = vi.fn();
  state.resetAll = vi.fn();
  state.persistConfig = vi.fn();
  state.captureAndSave = vi.fn();
  state.tlReset = vi.fn();
  state.aiEnabled = false;
  mockApi.on("get", "/reports/app-portfolio*", PAYLOAD);
});

describe("PortfolioReport chart interactions", () => {
  it("groups by the first attribute, colours by the first field and opens a chip", async () => {
    renderPortfolio();
    await loaded();
    // Each attribute bucket carries a colour bar; High holds SAP ERP only.
    expect(within(chart()).getByLabelText("High: 1 (100%)")).toBeInTheDocument();
    expect(within(legend()).getByText("Business Criticality:")).toBeInTheDocument();
    expect(within(legend()).getByText("2 ungrouped")).toBeInTheDocument();

    fireEvent.click(within(chart()).getByText("SAP ERP"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });

  it("lists the ungrouped cards, colours them, and opens them in a drawer", async () => {
    renderPortfolio();
    await loaded();
    // Zeta carries an option key the field does not define; the tool has none.
    expect(within(chart()).getByLabelText(/Not set: 1 \(50%\)/)).toBeInTheDocument();
    fireEvent.click(within(chart()).getByText("Zeta"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("zeta");

    fireEvent.click(within(chart()).getByText("Not assigned to any Business Criticality"));
    const panel = await screen.findByRole("presentation");
    expect(
      within(panel).getByRole("heading", { name: "Ungrouped (not linked to any Business Criticality)" }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /view in inventory/i })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  });

  it("describes drawer rows with subtype, colour and EOL, and counts the EOL risk", async () => {
    renderPortfolio();
    await loaded();
    fireEvent.click(within(chart()).getAllByText("Medium")[0]);
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("Microservice · Medium · End of Life: 2099-12-31")).toBeInTheDocument();
    expect(within(panel).getByText("EOL Risk")).toBeInTheDocument();
  });

  it("says when an attribute bucket is empty", async () => {
    renderPortfolio();
    await loaded();
    fireEvent.click(within(chart()).getByText("Low"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("No applications in this group")).toBeInTheDocument();
  });

  it("explains an empty result once filters exclude everything", async () => {
    // Relation grouping: attribute grouping always draws one box per option.
    state.config = { groupByRaw: "rel:Organization", search: "no-such-app" };
    renderPortfolio();
    expect(await screen.findByText("No applications match current filters.")).toBeInTheDocument();
  });

  it("filters live as the search is typed", async () => {
    const user = userEvent.setup();
    renderPortfolio();
    await loaded();
    await user.type(within(toolbar()).getByLabelText("Search"), "zet");
    await waitFor(() => expect(within(chart()).queryByText("SAP ERP")).not.toBeInTheDocument());
    expect(within(chart()).getByText("Zeta")).toBeInTheDocument();
  });
});

describe("PortfolioReport relation grouping and subtypes", () => {
  it("colours each chip by the relation it came through, and filters by subtype", async () => {
    state.config = { groupByRaw: "rel:Organization", colorBy: "rel:relOrgOwnsApp::usage" };
    renderPortfolio();
    await loaded();
    expect(within(legend()).getByText("is owned by · Usage:")).toBeInTheDocument();
    expect(within(legend()).getByText("Owner")).toBeInTheDocument();
    // Under Finance HQ, SAP ERP is owned; under Payments Team, Salesforce is used.
    expect(within(chart()).getByLabelText("SAP ERP — Owner")).toBeInTheDocument();
    expect(within(chart()).getByLabelText("Salesforce — User")).toBeInTheDocument();
    expect(within(toolbar()).getByText("Relation Subtypes")).toBeInTheDocument();

    // The colour picker lists the subtype under its own heading.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /color apps by/i }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /is owned by · Usage/ })).toBeInTheDocument();
    fireEvent.keyDown(listbox, { key: "Escape" });
  });

  it("drops a subtype colour and subtype filters once the group-by no longer reaches them", async () => {
    const user = userEvent.setup();
    state.config = { groupByRaw: "rel:Organization", colorBy: "rel:relOrgOwnsApp::usage" };
    renderPortfolio();
    await loaded();
    await user.click(within(toolbar()).getByLabelText("is owned by · Usage"));
    await user.click(await screen.findByRole("option", { name: "Owner" }));
    await user.keyboard("{Escape}");
    // Only SAP ERP is owned; Salesforce's Payments Team link is a "user" one.
    await waitFor(() => expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument());

    // Group-by options carry their icon glyph in the accessible name.
    await pick(/group by/i, /Business Criticality$/);
    await waitFor(() =>
      expect(state.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ colorBy: "crit", relSubtypeFilters: {} }),
      ),
    );
  });

  it("groups by one relation type when a saved report asks for it", async () => {
    state.config = { groupByRaw: "relt:relOrgUsesApp", view: "table" };
    renderPortfolio();
    await loaded();
    // The table names the cards related through that relation type only:
    // Salesforce is used by Finance HQ, and merely owned by Payments Team.
    const row = screen.getByRole("row", { name: /Salesforce/ });
    expect(within(row).getAllByRole("cell")[2]).toHaveTextContent(/^Finance HQ$/);
    // SAP ERP is only owned: nothing on this axis.
    const erp = screen.getByRole("row", { name: /SAP ERP/ });
    expect(within(erp).getAllByRole("cell")[2]).toHaveTextContent(/^\u2014$/);
  });

  it("drills into a nested group without an inventory link, and changes depth", async () => {
    state.config = { groupByRaw: "rel:Organization", nestedGroups: true, groupDepth: 99, colorBy: "crit" };
    renderPortfolio();
    await loaded();
    // Payments Team's box carries its own colour bar and chip.
    expect(within(chart()).getAllByLabelText("Medium: 1 (100%)").length).toBeGreaterThan(0);
    fireEvent.click(within(chart()).getAllByText("Salesforce")[0]);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("crm");

    fireEvent.click(within(chart()).getByText("Finance HQ"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).queryByRole("link", { name: /view in inventory/i })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());

    await pick(/display depth/i, /^Level 1$/);
    await waitFor(() =>
      expect(state.persistConfig).toHaveBeenLastCalledWith(expect.objectContaining({ groupDepth: 1 })),
    );
  });
});

describe("PortfolioReport table", () => {
  const names = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);

  it("sorts by subtype label, by the group attribute and by the colour field", async () => {
    const user = userEvent.setup();
    state.config = { view: "table", colorBy: "crit" };
    renderPortfolio();
    await screen.findByRole("table");
    // Group column shows the option label, a raw unknown key, or a dash.
    const cells = (name: RegExp) =>
      within(screen.getByRole("row", { name })).getAllByRole("cell").map((c) => c.textContent);
    expect(cells(/^SAP ERP/)).toEqual(["SAP ERP", "Business Application", "High", "High"]);
    expect(cells(/^Zeta/)).toEqual(["Zeta", "\u2014", "unknownKey", "unknownKey"]);
    expect(cells(/^Standalone/)).toEqual(["Standalone Tool", "\u2014", "\u2014", "\u2014"]);

    await user.click(screen.getByRole("button", { name: "Subtype" }));
    expect(names().slice(0, 2)).toEqual(["Standalone Tool", "Zeta"]);
    await user.click(screen.getByRole("button", { name: "Subtype" }));
    expect(names()[0]).toBe("Salesforce");

    // The attribute group column and the colour column both sort the attribute.
    const sortables = screen.getAllByRole("button", { name: "Business Criticality" });
    await user.click(sortables[0]);
    expect(names()).toEqual(["Standalone Tool", "SAP ERP", "Salesforce", "Zeta"]);
    // The colour column sorts the same key, so it flips the direction.
    await user.click(sortables[1]);
    expect(names()).toEqual(["Zeta", "Salesforce", "SAP ERP", "Standalone Tool"]);
    await user.click(sortables[1]);
    expect(names()[0]).toBe("Standalone Tool");

    await user.click(screen.getByRole("row", { name: /^Zeta/ }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("zeta");
  });

  it("drops the colour column when colouring is off, and restores a saved sort", async () => {
    state.config = { view: "table", colorBy: "", sortK: "name", sortD: "desc" };
    renderPortfolio();
    await screen.findByRole("table");
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(names()[0]).toBe("Zeta");
  });
});

describe("PortfolioReport filters", () => {
  it("restores legacy tag and organisation filters and clears them all", async () => {
    state.config = { tagFilters: { "g-host": ["tag-cloud"], junk: "x" }, filterOrgs: ["org-hq"] };
    renderPortfolio();
    await within(document.body).findByText("SAP ERP");
    expect(within(chart()).queryByText("Zeta")).not.toBeInTheDocument();

    const clear = within(toolbar()).getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(clear).getByTestId("CancelIcon"));
    expect(await within(chart()).findByText("Zeta")).toBeInTheDocument();
    expect(state.tlReset).toHaveBeenCalled();
  });

  it("offers a facet per relation type, skips ancestor-only members and folds the rest", async () => {
    renderPortfolio();
    await loaded();
    expect(within(toolbar()).getByLabelText("Organization")).toBeInTheDocument();
    expect(within(toolbar()).getByLabelText("Organization · is owned by")).toBeInTheDocument();
    expect(within(toolbar()).queryByLabelText("Provider")).not.toBeInTheDocument();

    fireEvent.click(within(toolbar()).getByText("2 more"));
    expect(within(toolbar()).getByLabelText("Organization · is used by")).toBeInTheDocument();
    expect(within(toolbar()).getByLabelText("Provider")).toBeInTheDocument();
    fireEvent.mouseDown(within(toolbar()).getByLabelText("Organization"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByText("Ancestor Only")).not.toBeInTheDocument();
    fireEvent.keyDown(listbox, { key: "Escape" });

    fireEvent.click(within(toolbar()).getByText("Less"));
    expect(within(toolbar()).queryByLabelText("Provider")).not.toBeInTheDocument();
  });

  it("applies relation, field and subtype filters picked in the toolbar", async () => {
    const user = userEvent.setup();
    state.config = { groupByRaw: "rel:Organization" };
    renderPortfolio();
    await loaded();

    await user.click(within(toolbar()).getByLabelText("Organization"));
    await user.click(await screen.findByRole("option", { name: "Payments Team" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(within(chart()).queryByText("SAP ERP")).not.toBeInTheDocument());

    await user.click(within(toolbar()).getByLabelText("Business Criticality"));
    await user.click(await screen.findByRole("option", { name: "Medium" }));
    await user.keyboard("{Escape}");

    await user.click(within(toolbar()).getByLabelText("is owned by · Usage"));
    await user.click(await screen.findByRole("option", { name: "User" }));
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(state.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          relationFilters: { Organization: ["org-pay"] },
          attrFilters: { crit: ["medium"] },
          relSubtypeFilters: { "relOrgOwnsApp::usage": ["user"] },
        }),
      ),
    );
    expect(within(chart()).getByText("Salesforce")).toBeInTheDocument();
    expect(within(document.querySelector(".report-print-params") as HTMLElement).getByText("3 active"))
      .toBeInTheDocument();
  });

  it("carries relation filters into the inventory link by name", async () => {
    state.config = { groupByRaw: "rel:Organization", relationFilters: { relOrgUsesApp: ["org-hq", "nobody"] } };
    renderPortfolio();
    await within(document.body).findAllByText("Salesforce");
    fireEvent.click(within(chart()).getByText("Finance HQ"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByRole("link", { name: /view in inventory/i }).getAttribute("href"))
      .toContain("rel_relOrgUsesApp=Finance+HQ");
  });
});

describe("PortfolioReport AI insights", () => {
  const INSIGHTS = {
    model: "test-model",
    insights: [
      "a bare string the panel skips",
      { title: "Consolidate CRM", observation: "Two CRMs overlap.", recommendation: "Retire one." },
      { title: "Keep ERP", observation: "Stable." },
    ],
  };

  it("generates insights from the visible portfolio, then toggles and regenerates them", async () => {
    state.aiEnabled = true;
    state.config = { search: "a", colorBy: "crit", groupByRaw: "rel:Organization" };
    mockApi.on("post", "/ai/portfolio-insights", INSIGHTS);
    renderPortfolio();
    await within(document.body).findByText("SAP ERP");

    fireEvent.click(aiButton());
    expect(await screen.findByText("Consolidate CRM")).toBeInTheDocument();
    expect(screen.getByText("Retire one.")).toBeInTheDocument();
    expect(screen.getByText("Keep ERP")).toBeInTheDocument();
    expect(screen.queryByText("a bare string the panel skips")).not.toBeInTheDocument();
    expect(screen.getByText("test-model")).toBeInTheDocument();

    const body = mockApi.callsOf("post", "/ai/portfolio-insights")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ total_apps: 4, color_by: "crit", group_by: "rel:Organization" });
    expect(body.active_filters).toEqual(expect.arrayContaining(['Search: "a"']));
    expect(body.lifecycle_summary).toEqual({ active: 2, Unknown: 1, "No lifecycle": 1 });
    expect((body.attribute_summary as Record<string, Record<string, number>>)["Business Criticality"])
      .toEqual({ high: 1, medium: 1, unknownKey: 1, "Not set": 1 });
    // Each group is summarised with its colour breakdown.
    expect(body.groups).toEqual(
      expect.arrayContaining([{ name: "Finance HQ", count: 2, breakdown: { High: 1, Medium: 1 } }]),
    );

    // Toggle off and back on without refetching.
    fireEvent.click(aiButton());
    fireEvent.click(aiButton());
    expect(mockApi.callsOf("post", "/ai/portfolio-insights")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/ai/portfolio-insights")).toHaveLength(2));
  });

  it("names attribute filters in the request and says when nothing came back", async () => {
    state.aiEnabled = true;
    state.config = { attrFilters: { crit: ["high", "medium"], tier: [] }, colorBy: "" };
    mockApi.on("post", "/ai/portfolio-insights", { insights: [] });
    renderPortfolio();
    await within(document.body).findByText("SAP ERP");
    fireEvent.click(aiButton());
    expect(
      await screen.findByText("No insights could be generated for the current portfolio view."),
    ).toBeInTheDocument();
    const body = mockApi.callsOf("post", "/ai/portfolio-insights")[0].body as Record<string, unknown>;
    expect(body.active_filters).toEqual(expect.arrayContaining(["Business Criticality: high, medium"]));
    expect(body.color_by).toBeNull();
  });

  it("shows a failure, with a generic message for a non-Error rejection", async () => {
    state.aiEnabled = true;
    mockApi.fail("post", "/ai/portfolio-insights", 502);
    renderPortfolio();
    await loaded();
    fireEvent.click(aiButton());
    expect(await screen.findByText("POST /ai/portfolio-insights failed")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: /close/i }));
    expect(screen.queryByText("POST /ai/portfolio-insights failed")).not.toBeInTheDocument();
  });

  it("falls back to a generic error for a non-Error rejection", async () => {
    state.aiEnabled = true;
    mockApi.on("post", "/ai/portfolio-insights", () => Promise.reject("nope"));
    renderPortfolio();
    await loaded();
    fireEvent.click(aiButton());
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});

describe("Flexible Portfolio", () => {
  /** Nothing to group by, so an empty type renders its empty state. */
  const EMPTY_PAYLOAD = { ...PAYLOAD, items: [], fields_schema: [], relation_types: [], groupable_types: {}, tag_groups: [] };

  it("titles itself by type, switches type and words its labels by the type", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=BusinessProcess", EMPTY_PAYLOAD);
    renderPortfolio({ showTypeSelector: true });
    await loaded();
    expect(screen.getByRole("heading", { name: "Application Portfolio" })).toBeInTheDocument();

    await pick(/card type/i, /Business Process/);
    await waitFor(() => expect(appCalls()).toContain("/reports/app-portfolio?type=BusinessProcess"));
    expect(await screen.findByText("No Business Process found. Create some to see the portfolio."))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Business Process Portfolio" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Color by$/ })).toBeInTheDocument();

    // Picking the same type again is a no-op.
    await pick(/card type/i, /Business Process/);
    expect(appCalls().filter((p) => p.endsWith("BusinessProcess"))).toHaveLength(1);
  });

  it("restores a saved card type and counts groups by the type label", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Provider", PAYLOAD);
    state.config = { cardType: "Provider" };
    renderPortfolio({ showTypeSelector: true });
    await loaded();
    expect(screen.getAllByText("1 Provider", { selector: ".MuiChip-label" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Provider Filters")).toBeInTheDocument();
  });

  it("honours a title override and a non-Application initial type", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Provider", EMPTY_PAYLOAD);
    renderPortfolio({ initialCardType: "Provider", titleOverride: "Vendors" });
    expect(await screen.findByRole("heading", { name: "Vendors" })).toBeInTheDocument();
    expect(screen.getByText("No Provider found. Create some to see the portfolio.")).toBeInTheDocument();
  });

  it("names a non-Application type in its own title without the selector", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Provider", EMPTY_PAYLOAD);
    state.config = { search: "x" };
    renderPortfolio({ initialCardType: "Provider" });
    expect(await screen.findByRole("heading", { name: "Provider Portfolio" })).toBeInTheDocument();
    expect(screen.getByText("No Provider match current filters.")).toBeInTheDocument();
  });
});

describe("PortfolioReport shell actions", () => {
  it("resets every control to its default", async () => {
    state.config = { view: "table", colorBy: "tier", search: "x", nestedGroups: true };
    renderPortfolio();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(state.resetAll).toHaveBeenCalled();
    expect(state.tlReset).toHaveBeenCalled();
    expect(await screen.findByText("Standalone Tool")).toBeInTheDocument();
  });

  it("saves through the thumbnail capture and closes the dialog", async () => {
    state.saveDialogOpen = true;
    renderPortfolio();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(state.captureAndSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(state.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });
});
