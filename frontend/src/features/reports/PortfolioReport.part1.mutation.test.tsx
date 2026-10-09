/**
 * Mutation-hardening for PortfolioReport.tsx, lines 1–1324: the grouping
 * helper, the group cards (flat and nested), saved-config restore, reset,
 * card-type switching, the derived option lists, filter state and the AI
 * insights payload. Every assertion is on what a user sees or on what the
 * report hands to a collaborator (the saved config, the AI request, the
 * inventory link, the timeline slider).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

type SliderProps = {
  delta?: { arriving: number; retiring: number };
  onMilestoneCardClick?: (card: { id: string; name: string; kind: string }) => void;
  milestoneCards?: (
    from: number,
    to: number,
  ) => { id: string; name: string; kind: string; color?: string }[];
};

const state = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadedConfig: null as unknown,
  savedKeys: [] as string[],
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  tlRestore: (() => {}) as (v: unknown) => void,
  tlReset: (() => {}) as () => void,
  timelineDate: null as number | null,
  aiEnabled: false,
  sliderProps: [] as SliderProps[],
  saveDialogProps: [] as { reportType: string; config: Record<string, unknown> }[],
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (key: string) => {
    state.savedKeys.push(key);
    return {
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: state.setSaveDialogOpen,
      loadedConfig: state.loadedConfig,
      consumeConfig: () => state.config,
      resetSavedReport: () => {},
      persistConfig: state.persistConfig,
      resetAll: state.resetAll,
      reportType: key,
    };
  },
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  // The real hook captures a thumbnail and then calls back; the callback is
  // what opens the save dialog.
  useThumbnailCapture: (onCaptured: () => void) => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => onCaptured(),
  }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => {
    const now = Date.now();
    const at = state.timelineDate ?? now;
    return {
      timelineDate: at,
      setTimelineDate: () => {},
      todayMs: now,
      isTimeTraveling: at !== now,
      persistValue: undefined,
      printParam: null,
      restore: (v: unknown) => state.tlRestore(v),
      reset: () => state.tlReset(),
    };
  },
}));
vi.mock("@/hooks/useAiStatus", async () => ({
  ...(await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus")),
  useAiStatus: () => ({ aiStatus: { portfolio_insights_enabled: state.aiEnabled } }),
}));
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: SliderProps) => {
    state.sliderProps.push(props);
    return <div data-testid="timeline-slider" />;
  },
}));
// Aliased, not "./SaveReportDialog": the mutation harness runs a copy of the
// report from another directory, and only the resolved path matches both.
vi.mock("@/features/reports/SaveReportDialog", () => ({
  default: (props: { reportType: string; config: Record<string, unknown> }) => {
    state.saveDialogProps.push(props);
    return null;
  },
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { APPLICATION_TYPE, makeCardType } from "@/test/fixtures/metamodel";
import { userWith, wrapWithProviders } from "@/test/render";
import i18n from "@/i18n";
import PortfolioReport from "./PortfolioReport";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const ORG_TYPE = makeCardType({ key: "Organization", label: "Organization", icon: "corporate_fare", has_hierarchy: true });
const PROVIDER_TYPE = makeCardType({ key: "Provider", label: "Provider", icon: "storefront" });
const BP_TYPE = makeCardType({ key: "BusinessProcess", label: "Business Process", icon: "route" });
const ITC_TYPE = makeCardType({ key: "ITComponent", label: "IT Component", icon: "memory" });

type Item = {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  relations: Record<string, unknown>[];
  org_ids: string[];
  tag_ids?: string[];
};

const rel = (relation_type: string, related_id: string, related_name: string, related_type: string, attributes?: Record<string, unknown>) => ({
  relation_type,
  related_id,
  related_name,
  related_type,
  ...(attributes ? { attributes } : {}),
});
const owns = (id: string, name: string, usage?: string) =>
  rel("relOrgOwnsApp", id, name, "Organization", usage ? { usage } : undefined);
const uses = (id: string, name: string) => rel("relOrgUsesApp", id, name, "Organization");
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
const REL_SUPPLIES = {
  key: "relProvToApp",
  label: "supplies",
  reverse_label: "is supplied by",
  source_type_key: "Provider",
  target_type_key: "Application",
  other_type_key: "Provider",
};
const REL_RUNS_ON = {
  key: "relAppRunsOnItc",
  label: "runs on",
  reverse_label: "hosts",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  other_type_key: "ITComponent",
  attributes_schema: [
    {
      key: "env",
      label: "Env",
      type: "single_select",
      options: [{ key: "prod", label: "Production", color: "#000000" }],
    },
    // An attribute an admin has not given options yet.
    { key: "stage", label: "Stage", type: "single_select" },
  ],
};

const ITEMS: Item[] = [
  app("erp", "SAP ERP", {
    subtype: "businessApplication",
    attributes: { crit: "high", tier: "t1" },
    lifecycle: { active: "2020-01-01" },
    relations: [owns("org-hq", "Finance HQ", "owner")],
    org_ids: ["org-hq"],
    tag_ids: ["tag-cloud"],
  }),
  app("crm", "Salesforce", {
    subtype: "microservice",
    attributes: { crit: "medium" },
    lifecycle: { active: "2021-01-01", endOfLife: "2099-12-31" },
    relations: [owns("org-pay", "Payments Team", "user"), uses("org-hq", "Finance HQ")],
    org_ids: ["org-pay", "org-hq"],
  }),
  app("tool", "Standalone Tool"),
  app("zeta", "Zeta", {
    attributes: { crit: "unknownKey" },
    relations: [rel("relProvToApp", "prov-1", "Acme", "Provider")],
  }),
];

const ORG_MEMBERS = [
  { id: "org-hq", name: "Finance HQ", type: "Organization" },
  { id: "org-pay", name: "Payments Team", type: "Organization", parent_id: "org-hq" },
];

const PAYLOAD = {
  items: ITEMS,
  fields_schema: [{ section: "Details", fields: [CRIT, TIER] }],
  // relProvToApp first: a lookup that ignores the key lands on the wrong axis.
  relation_types: [REL_SUPPLIES, REL_OWNS, REL_USES],
  groupable_types: {
    Organization: ORG_MEMBERS,
    Provider: [{ id: "prov-1", name: "Acme", type: "Provider" }],
  },
  organizations: [],
  tag_groups: [{ id: "g-host", name: "Hosting", mode: "multi", tags: [{ id: "tag-cloud", name: "Cloud" }] }],
};

/** A Provider landscape with its own select field. */
const PROVIDER_PAYLOAD = {
  items: [
    app("acme", "Acme Corp", {
      attributes: { crit: "high", vendorTier: "gold" },
      relations: [owns("org-pay", "Payments Team")],
    }),
    app("globex", "Globex", { attributes: { crit: "low", vendorTier: "gold" } }),
  ],
  fields_schema: [
    {
      section: "Vendor",
      fields: [
        {
          key: "vendorTier",
          label: "Vendor Tier",
          type: "single_select",
          options: [{ key: "gold", label: "Gold", color: "#ffd700" }],
        },
      ],
    },
  ],
  relation_types: [
    { ...REL_OWNS, target_type_key: "Provider", attributes_schema: [] },
    { ...REL_USES, target_type_key: "Provider" },
  ],
  groupable_types: { Organization: ORG_MEMBERS },
  organizations: [],
  tag_groups: [],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;
const printParams = () => document.querySelector(".report-print-params")?.textContent ?? "";
const appCalls = () => mockApi.callsOf("get", "/reports/app-portfolio*").map((c) => c.path);
const lastPersisted = () => {
  const calls = vi.mocked(state.persistConfig).mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
};
const chipLabels = (el: HTMLElement) =>
  Array.from(el.querySelectorAll(".MuiChip-label")).map((c) => c.textContent);
const filtersToggle = () => screen.getByRole("button", { name: /Filters/ });

function ui(props: Parameters<typeof PortfolioReport>[0] = {}) {
  return (
    <MemoryRouter>
      <PortfolioReport {...props} />
    </MemoryRouter>
  );
}
function renderPortfolio(props: Parameters<typeof PortfolioReport>[0] = {}) {
  return render(ui(props));
}

async function pick(label: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

async function openMenu(label: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  return screen.findByRole("listbox");
}

/** A promise the test settles by hand, for a request that must stay in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Let a settled request's continuation run, then flush React. */
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([APPLICATION_TYPE, ORG_TYPE, PROVIDER_TYPE, BP_TYPE, ITC_TYPE]);
  state.config = null;
  state.loadedConfig = null;
  state.savedKeys = [];
  state.setSaveDialogOpen = vi.fn();
  state.resetAll = vi.fn();
  state.persistConfig = vi.fn();
  state.tlRestore = vi.fn();
  state.tlReset = vi.fn();
  state.timelineDate = null;
  state.aiEnabled = false;
  state.sliderProps = [];
  state.saveDialogProps = [];
  mockApi.on("get", "/reports/app-portfolio*", PAYLOAD);
});

/* ------------------------------------------------------------------ */
/*  Grouping and the group cards                                       */
/* ------------------------------------------------------------------ */

describe("relation groups", () => {
  it("lists a card once per member, biggest group first, chips alphabetical", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        // Two relations to the same org must not list the card twice.
        app("a1", "Zulu", { attributes: { crit: "high" }, relations: [owns("org-g", "Gamma Org"), uses("org-g", "Gamma Org")] }),
        app("a2", "Echo", { attributes: { crit: "high" }, relations: [owns("org-g", "Gamma Org")] }),
        app("a3", "Bravo", { attributes: { crit: "medium" }, relations: [owns("org-g", "Gamma Org"), owns("org-b", "Beta Org")] }),
        app("a4", "Delta", { attributes: { crit: "low" }, relations: [owns("org-b", "Beta Org")] }),
        app("a5", "Kilo", { attributes: { crit: "low" }, relations: [owns("org-a", "Alpha Org")] }),
        // Related to an organisation the payload does not list as a member.
        app("a6", "Lima", { relations: [owns("org-gone", "Gone Org")] }),
      ],
      groupable_types: {
        Organization: [
          { id: "org-a", name: "Alpha Org", type: "Organization" },
          { id: "org-b", name: "Beta Org", type: "Organization" },
          { id: "org-g", name: "Gamma Org", type: "Organization" },
        ],
      },
    });
    state.config = { groupByRaw: "rel:Organization", colorBy: "crit" };
    renderPortfolio();
    await within(document.body).findByText("Lima");

    const headers = within(chart()).getAllByText(/^(Alpha|Beta|Gamma) Org$/).map((h) => h.textContent);
    expect(headers).toEqual(["Gamma Org", "Beta Org", "Alpha Org"]);

    const gamma = within(chart()).getByText("Gamma Org").closest("[data-export-row]") as HTMLElement;
    expect(chipLabels(gamma)).toEqual(["3 apps", "Bravo", "Echo", "Zulu"]);
    // One bar segment per colour bucket.
    expect(within(gamma).getByLabelText("High: 2 (67%) · Medium: 1 (33%)").children).toHaveLength(2);

    expect(within(chart()).getByText("Not assigned to any Organization")).toBeInTheDocument();
    expect(within(legend()).getByText("1 ungrouped")).toBeInTheDocument();
  });

  it("offers each groupable type under its own label and icon, and only fields that have options", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      fields_schema: [
        {
          section: "Details",
          fields: [
            CRIT,
            // Not offered for grouping: nothing to group into.
            { key: "draft", label: "Draft Field", type: "single_select" },
            { key: "bare", label: "Bare Field", type: "single_select", options: [] },
          ],
        },
      ],
      relation_types: [],
      groupable_types: {
        BusinessProcess: [{ id: "bp-1", name: "Order to Cash", type: "BusinessProcess" }],
        Mystery: [{ id: "m-1", name: "Thing", type: "Mystery" }],
        Empty: [],
        Organization: ORG_MEMBERS,
      },
    });
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");

    // The relation facets carry the metamodel label, falling back to the key.
    expect(within(toolbar()).getByLabelText("Business Process")).toBeInTheDocument();
    expect(within(toolbar()).getByLabelText("Mystery")).toBeInTheDocument();

    const listbox = await openMenu(/group by/i);
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Attributes",
      "tuneBusiness Criticality",
      "Related Types",
      "routeBusiness Process",
      "linkMystery",
      "corporate_fareOrganization",
    ]);
    fireEvent.keyDown(listbox, { key: "Escape" });
  });
});

describe("nested groups", () => {
  const NESTED = {
    ...PAYLOAD,
    items: [
      app("n1", "Yankee", { attributes: { crit: "high" }, relations: [owns("team", "Team")] }),
      app("n2", "Xray", { attributes: { crit: "medium" }, relations: [owns("team", "Team")] }),
      app("n3", "Alpha", { attributes: { crit: "high" }, relations: [owns("hq", "HQ")] }),
      app("n4", "Bravo", { attributes: { crit: "high" }, relations: [owns("hq", "HQ")] }),
    ],
    groupable_types: {
      Organization: [
        { id: "hq", name: "HQ", type: "Organization" },
        { id: "div", name: "Division", type: "Organization", parent_id: "hq" },
        { id: "team", name: "Team", type: "Organization", parent_id: "div" },
      ],
    },
  };

  it("tapers columns per depth, sorts chips, and re-derives a card when the depth changes", async () => {
    mockApi.on("get", "/reports/app-portfolio*", NESTED);
    state.config = { groupByRaw: "rel:Organization", nestedGroups: true, groupDepth: 99, columns: 1, colorBy: "crit" };
    renderPortfolio();
    await within(document.body).findByText("Team");

    // Team sits in Division's grid — a depth-3 grid under a one-column pick.
    expect(screen.getByText("Team").closest("[data-nested-cols]")?.getAttribute("data-nested-cols")).toBe("2");
    const team = screen.getByText("Team").closest("[data-nested-cols] > *") as HTMLElement;
    expect(chipLabels(team)).toEqual(["2 apps", "Xray", "Yankee"]);
    // Segments follow the chips' (alphabetical) order.
    expect(within(team).getByLabelText("Medium: 1 (50%) · High: 1 (50%)").children).toHaveLength(2);

    const hq = () => screen.getByText("HQ").closest("[data-export-row]") as HTMLElement;
    expect(within(hq()).getByLabelText("High: 2 (100%)")).toBeInTheDocument();

    const listbox = await openMenu(/display depth/i);
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Level 1",
      "Level 2",
      "Level 3",
      "All levels",
    ]);
    fireEvent.click(within(listbox).getByRole("option", { name: "Level 1" }));

    // HQ is now a leaf: it rolls up every card beneath it.
    await waitFor(() => expect(within(hq()).getByText("Xray")).toBeInTheDocument());
    expect(chipLabels(hq())).toEqual(["4 apps", "Alpha", "Bravo", "Xray", "Yankee"]);
    expect(within(hq()).getByLabelText("High: 3 (75%) · Medium: 1 (25%)")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Group-by axis resolution                                           */
/* ------------------------------------------------------------------ */

describe("group-by axis", () => {
  it.each([
    // One relation type: named by its verb from this card's side.
    [{ groupByRaw: "relt:relOrgUsesApp" }, "Group by: Organization · is used by", "Finance HQ"],
    // A relation type that is the only one reaching its card type is no axis
    // of its own, and an unknown key is no axis at all: both fall back.
    [{ groupByRaw: "relt:relProvToApp" }, "Group by: Business Criticality", "High"],
    [{ groupByRaw: "rel:Nope" }, "Group by: Business Criticality", "High"],
    [{ groupByRaw: "attr:tier" }, "Group by: Tier", "Tier 1"],
  ])("resolves %j", async (config, param, header) => {
    state.config = config;
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    expect(printParams()).toContain(param);
    expect(within(chart()).getByText(header)).toBeInTheDocument();
  });

  it("groups one relation type by the card type at its other end", async () => {
    state.config = { groupByRaw: "relt:relOrgUsesApp" };
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    expect(within(chart()).queryByText("Acme")).not.toBeInTheDocument();
    // Organization's relation subtypes are in scope on this axis.
    expect(within(toolbar()).getByText("Relation Subtypes")).toBeInTheDocument();
  });

  it("offers neither nesting nor relation subtypes for a flat type without subtypes", async () => {
    state.config = { groupByRaw: "rel:Provider" };
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    expect(within(chart()).getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("Nested groups")).not.toBeInTheDocument();
    expect(within(toolbar()).queryByText("Relation Subtypes")).not.toBeInTheDocument();
  });

  it("words a subtype by the verb on this card's side of the relation", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        ...ITEMS,
        app("srv", "Server App", { relations: [rel("relAppRunsOnItc", "itc-1", "Linux Box", "ITComponent", { env: "prod" })] }),
      ],
      relation_types: [REL_SUPPLIES, REL_OWNS, REL_USES, REL_RUNS_ON],
      groupable_types: { ...PAYLOAD.groupable_types, ITComponent: [{ id: "itc-1", name: "Linux Box", type: "ITComponent" }] },
    });
    // Colour by a subtype the next axis does not reach.
    state.config = { groupByRaw: "rel:Organization", colorBy: "rel:relOrgOwnsApp::usage" };
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    expect(within(legend()).getByText("is owned by · Usage:")).toBeInTheDocument();

    await pick(/group by/i, /IT Component$/);
    // The Application is the source of "runs on".
    expect(await within(toolbar()).findByLabelText("runs on · Env")).toBeInTheDocument();
    fireEvent.mouseDown(within(toolbar()).getByLabelText("runs on · Stage"));
    const stages = await screen.findByRole("listbox");
    expect(within(stages).getAllByRole("option").map((o) => o.textContent)).toEqual(["(empty)"]);
    fireEvent.keyDown(stages, { key: "Escape" });
    // The orphaned subtype colour falls back to the first own field.
    await waitFor(() =>
      expect(within(legend()).getByText("Business Criticality:")).toBeInTheDocument(),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Defaults, first paint and persistence                              */
/* ------------------------------------------------------------------ */

describe("defaults and persistence", () => {
  it("paints a spinner, not an error, before the data request has even started", () => {
    const html = renderToStaticMarkup(wrapWithProviders(<PortfolioReport />));
    expect(html).toContain("MuiCircularProgress");
    expect(html).not.toContain("An error occurred");
  });

  it("applies and persists the defaults once data arrives", async () => {
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");

    expect(state.savedKeys[0]).toBe("portfolio");
    expect(screen.queryByRole("combobox", { name: /card type/i })).not.toBeInTheDocument();
    // No AI error is pending before anyone asked for insights.
    expect(document.querySelector(".MuiAlert-root")).toBeNull();
    // Not travelling: the slider is told there is nothing arriving or leaving.
    expect(state.sliderProps.at(-1)?.delta).toEqual({ arriving: 0, retiring: 0 });

    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        cardType: "Application",
        view: "chart",
        groupByRaw: "attr:crit",
        colorBy: "crit",
        sortK: "name",
        sortD: "asc",
      }),
    );
    expect(state.saveDialogProps.at(-1)?.reportType).toBe("portfolio");

    // "No color" switches the colouring off — and is not itself a colouring.
    await pick(/color apps by/i, "No color");
    await waitFor(() => expect(within(legend()).queryByText("Business Criticality:")).not.toBeInTheDocument());
    expect(printParams()).not.toContain("Color by");
  });

  it("does not persist anything while the data is still loading", () => {
    mockApi.on("get", "/reports/app-portfolio*", () => new Promise(() => {}));
    state.config = { search: "x", view: "table" };
    renderPortfolio();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(state.persistConfig).not.toHaveBeenCalled();
  });

  it("keeps a restored config as stored, without re-applying defaults over it", async () => {
    state.config = { search: "a", cardType: "Provider" };
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    // Only the Flexible Portfolio honours a saved card type.
    expect(appCalls()).toEqual(["/reports/app-portfolio?type=Application"]);
    const saved = state.saveDialogProps.at(-1)!.config;
    expect(saved).toMatchObject({ groupByRaw: "", colorBy: "", search: "a" });
  });

  it("re-reads the saved config when another saved report is loaded", async () => {
    const { rerender } = renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument();

    state.config = {
      groupByRaw: "rel:Organization",
      relSubtypeFilters: { "relOrgOwnsApp::usage": ["owner"] },
      timelineDate: 1234,
    };
    state.loadedConfig = { id: "another" };
    rerender(ui());

    await waitFor(() => expect(within(chart()).getByText("Finance HQ")).toBeInTheDocument());
    // The subtype filter came with it: only an owning organisation is listed.
    expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument();
    expect(state.tlRestore).toHaveBeenCalledWith(1234);
  });
});

/* ------------------------------------------------------------------ */
/*  Restoring saved shapes                                             */
/* ------------------------------------------------------------------ */

describe("restoring saved filters and sorts", () => {
  const visible = () =>
    ["SAP ERP", "Salesforce", "Standalone Tool", "Zeta"].filter((n) => within(chart()).queryByText(n));

  it.each([
    [{ tagFilterIds: ["tag-cloud"] }, ["SAP ERP"], 1],
    // The pre-flat `{groupId: tagIds}` shape migrates; junk values are skipped.
    [{ tagFilters: { "g-host": ["tag-cloud"], junk: "x" } }, ["SAP ERP"], 1],
    // Legacy `filterOrgs` becomes an Organization relation filter.
    [{ filterOrgs: ["org-hq"] }, ["SAP ERP", "Salesforce"], 1],
    [{ tagFilters: null }, ["SAP ERP", "Salesforce", "Standalone Tool", "Zeta"], 0],
  ])("restores %j", async (config, names, count) => {
    state.config = config;
    renderPortfolio();
    await within(document.body).findAllByText("SAP ERP");
    expect(visible()).toEqual(names);
    if (count) expect(within(filtersToggle()).getByLabelText(`${count} active`)).toBeInTheDocument();
    else expect(within(toolbar()).queryByText("Clear all")).not.toBeInTheDocument();
  });

  it("ignores a tag filter when the payload carries no tag groups", async () => {
    mockApi.on("get", "/reports/app-portfolio*", { ...PAYLOAD, tag_groups: undefined });
    state.config = { tagFilterIds: ["tag-cloud"] };
    renderPortfolio();
    await within(document.body).findByText("Zeta");
    expect(visible()).toEqual(["SAP ERP", "Salesforce", "Standalone Tool", "Zeta"]);
  });

  const names = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);

  it.each([
    [{ view: "table" }, ["Salesforce", "SAP ERP", "Standalone Tool", "Zeta"]],
    [{ view: "table", sortK: "crit" }, ["Standalone Tool", "SAP ERP", "Salesforce", "Zeta"]],
  ])("sorts the table for %j", async (config, order) => {
    state.config = config;
    renderPortfolio();
    await screen.findByRole("table");
    expect(names()).toEqual(order);
  });
});

/* ------------------------------------------------------------------ */
/*  Active filters and Clear all                                       */
/* ------------------------------------------------------------------ */

describe("active filters", () => {
  it.each([
    [{ attrFilters: { crit: ["high"] } }, true],
    [{ relationFilters: { Organization: ["org-hq"] } }, true],
    [{ tagFilterIds: ["tag-cloud"] }, true],
    // A facet emptied out again is no filter.
    [{ attrFilters: { crit: [] }, relationFilters: { Organization: [] } }, false],
  ])("offers Clear all for %j: %s", async (config, active) => {
    state.config = config;
    renderPortfolio();
    await within(document.body).findAllByText("SAP ERP");
    if (!active) {
      expect(within(toolbar()).queryByText("Clear all")).not.toBeInTheDocument();
      return;
    }
    const clear = within(toolbar()).getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(clear).getByTestId("CancelIcon"));
    expect(await within(chart()).findByText("Zeta")).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Clear all")).not.toBeInTheDocument();
    expect(within(filtersToggle()).queryByLabelText(/active/)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Relation-only landscapes: subtype filters, clear, reset            */
/* ------------------------------------------------------------------ */

describe("a landscape with relations but no own select fields", () => {
  const REL_ONLY = { ...PAYLOAD, fields_schema: [] };

  async function chooseOwner(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(toolbar()).getByLabelText("is owned by · Usage"));
    await user.click(await screen.findByRole("option", { name: "Owner" }));
    await user.keyboard("{Escape}");
  }

  it("counts, clears and resets a relation-subtype filter", async () => {
    const user = userEvent.setup();
    mockApi.on("get", "/reports/app-portfolio*", REL_ONLY);
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    // With no own field the first axis is the first related type.
    expect(within(chart()).getByText("Payments Team")).toBeInTheDocument();

    await chooseOwner(user);
    await waitFor(() => expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument());
    expect(within(toolbar()).getByText("Clear all")).toBeInTheDocument();

    const clear = within(toolbar()).getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(clear).getByTestId("CancelIcon"));
    expect(await within(chart()).findByText("Payments Team")).toBeInTheDocument();

    // Picking and un-picking the only value leaves an empty facet: no filter.
    await chooseOwner(user);
    await waitFor(() => expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument());
    const facet = within(toolbar()).getByLabelText("is owned by · Usage").closest(".MuiAutocomplete-root") as HTMLElement;
    fireEvent.click(within(facet).getByTestId("CancelIcon"));
    expect(await within(chart()).findByText("Payments Team")).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Clear all")).not.toBeInTheDocument();

    await chooseOwner(user);
    await waitFor(() => expect(within(chart()).queryByText("Payments Team")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(await within(chart()).findByText("Payments Team")).toBeInTheDocument();
  });

  it("drops an orphaned subtype colour to no colour at all", async () => {
    mockApi.on("get", "/reports/app-portfolio*", REL_ONLY);
    state.config = { view: "table", groupByRaw: "rel:Organization", colorBy: "rel:relOrgOwnsApp::usage" };
    renderPortfolio();
    await screen.findByRole("table");
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);

    await pick(/group by/i, /Provider$/);
    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(3));
  });
});

/* ------------------------------------------------------------------ */
/*  Reset                                                              */
/* ------------------------------------------------------------------ */

describe("reset", () => {
  it("puts every control back to its default", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Provider", PROVIDER_PAYLOAD);
    state.config = {
      cardType: "Provider",
      view: "table",
      groupByRaw: "rel:Organization",
      colorBy: "",
      attrFilters: { crit: ["high"] },
      relationFilters: { Organization: ["org-pay"] },
      tagFilterIds: ["tag-cloud"],
      filtersCollapsed: true,
      sortK: "crit",
      sortD: "desc",
      nestedGroups: true,
      groupDepth: 3,
      columns: 1,
    };
    renderPortfolio({ showTypeSelector: true });
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(state.resetAll).toHaveBeenCalled();
    await waitFor(() => expect(appCalls().at(-1)).toBe("/reports/app-portfolio?type=Application"));
    expect(await within(document.body).findByText("Zeta")).toBeInTheDocument();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(legend()).getByText("Business Criticality:")).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Clear all")).not.toBeInTheDocument();
    expect(within(toolbar()).getByText("2 more")).toBeInTheDocument();
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        cardType: "Application",
        groupByRaw: "attr:crit",
        colorBy: "crit",
        sortK: "name",
        sortD: "asc",
        nestedGroups: false,
        groupDepth: 2,
        columns: 3,
        tagFilterIds: [],
      }),
    );
  });

  it("resets to the initial card type the report is currently given", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Provider", PROVIDER_PAYLOAD);
    mockApi.on("get", "/reports/app-portfolio?type=BusinessProcess", { ...PROVIDER_PAYLOAD, items: [app("bp", "Order to Cash")] });
    const { rerender } = renderPortfolio({ initialCardType: "Provider" });
    await within(document.body).findByText("Globex");
    rerender(ui({ initialCardType: "BusinessProcess" }));

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(await within(document.body).findByText("Order to Cash")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Flexible Portfolio: switching card types                          */
/* ------------------------------------------------------------------ */

describe("switching card types", () => {
  it("clears the old type's selections and re-applies the new type's defaults", async () => {
    const provider = deferred<typeof PROVIDER_PAYLOAD>();
    mockApi.on("get", "/reports/app-portfolio?type=Provider", () => provider.promise);
    state.config = {
      attrFilters: { crit: ["high"] },
      relationFilters: { Organization: ["org-hq"] },
      nestedGroups: true,
      groupDepth: 3,
    };
    renderPortfolio({ showTypeSelector: true });
    await within(document.body).findByText("SAP ERP");
    expect(within(chart()).queryByText("Salesforce")).not.toBeInTheDocument();

    await pick(/card type/i, /Provider$/);
    // The previous type's data is gone while the new one loads.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("SAP ERP")).not.toBeInTheDocument();
    await act(async () => provider.resolve(PROVIDER_PAYLOAD));

    expect(await within(document.body).findByText("Globex")).toBeInTheDocument();
    expect(within(chart()).getByText("Acme Corp")).toBeInTheDocument();
    expect(within(legend()).getByText("Vendor Tier:")).toBeInTheDocument();
    expect(within(toolbar()).getByText("1 more")).toBeInTheDocument();
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        cardType: "Provider",
        groupByRaw: "attr:vendorTier",
        colorBy: "vendorTier",
        attrFilters: {},
        relationFilters: {},
        nestedGroups: false,
        groupDepth: 2,
      }),
    );

    await pick(/card type/i, /Application$/);
    await waitFor(() => expect(appCalls().at(-1)).toBe("/reports/app-portfolio?type=Application"));
    expect(await within(document.body).findByText("Zeta")).toBeInTheDocument();
  });

  it("ignores a response that arrives after a newer type was asked for", async () => {
    const late = deferred<typeof PAYLOAD>();
    mockApi.on("get", "/reports/app-portfolio?type=Application", () => late.promise);
    mockApi.on("get", "/reports/app-portfolio?type=Provider", PROVIDER_PAYLOAD);
    const { rerender } = renderPortfolio({ showTypeSelector: true });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    // A saved report naming another type is opened while the first is in flight.
    state.config = { cardType: "Provider" };
    state.loadedConfig = { id: "provider-report" };
    rerender(ui({ showTypeSelector: true }));
    expect(await within(document.body).findByText("Globex")).toBeInTheDocument();

    late.resolve(PAYLOAD);
    await flush();
    expect(within(chart()).getByText("Globex")).toBeInTheDocument();
    expect(screen.queryByText("SAP ERP")).not.toBeInTheDocument();
  });

  it("offers every type the reader may see in a report, not only inventory types", async () => {
    render(wrapWithProviders(<PortfolioReport showTypeSelector />, { user: userWith("reports.portfolio") }));
    await within(document.body).findByText("Standalone Tool");
    const listbox = await openMenu(/card type/i);
    expect(within(listbox).getByRole("option", { name: /Business Process/ })).toBeInTheDocument();
    fireEvent.keyDown(listbox, { key: "Escape" });

    // Saving captures a thumbnail, then opens the save dialog.
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(state.setSaveDialogOpen).toHaveBeenCalledWith(true);
  });
});

/* ------------------------------------------------------------------ */
/*  AI insights request                                                */
/* ------------------------------------------------------------------ */

describe("AI insights request", () => {
  const aiButton = () => within(screen.getByLabelText("AI Insights")).getByRole("button");
  const body = (i = 0) =>
    mockApi.callsOf("post", "/ai/portfolio-insights")[i].body as Record<string, unknown>;
  const NOW = Date.UTC(2026, 0, 1);

  it("summarises lifecycle phases, attributes and filters as they stand", async () => {
    // Today is pinned so a phase that starts exactly now can be told apart.
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      state.aiEnabled = true;
      const attrs = { crit: "high", tier: "t1", region: "eu" };
      mockApi.on("get", "/reports/app-portfolio*", {
        ...PAYLOAD,
        items: [
          // Phasing out from exactly today: a phase counts from its own date.
          app("p1", "PhaseOut App", { attributes: attrs, lifecycle: { active: "2020-01-01", phaseOut: "2026-01-01" } }),
          app("p2", "Live App", { attributes: attrs, lifecycle: { active: "2020-01-01", phaseOut: "2027-01-01" } }),
          app("p3", "Undated App", { attributes: attrs, lifecycle: {} }),
          app("p4", "Bare One", { attributes: attrs, lifecycle: undefined }),
          app("p5", "Bare Two", { attributes: attrs, lifecycle: undefined }),
        ],
      });
      mockApi.on("post", "/ai/portfolio-insights", { insights: [] });
      // `region` is no select field: its filter is described by its key.
      state.config = { attrFilters: { tier: ["t1"], crit: [], region: ["eu"] }, colorBy: "" };
      renderPortfolio();
      await within(document.body).findByText("Bare Two");

      fireEvent.click(aiButton());
      await waitFor(() => expect(mockApi.callsOf("post", "/ai/portfolio-insights")).toHaveLength(1));
      expect(body().lifecycle_summary).toEqual({ phaseOut: 1, active: 1, Unknown: 1, "No lifecycle": 2 });
      expect(body().attribute_summary).toEqual({ "Business Criticality": { high: 5 }, Tier: { t1: 5 } });
      // Not time-travelling: no timeline entry among the filters.
      expect(body().active_filters).toEqual(["Tier: t1", "region: eu"]);
      // Not coloured: no per-group breakdown.
      expect(body().groups).toEqual([
        { name: "High", count: 5, breakdown: {} },
        { name: "Medium", count: 0, breakdown: {} },
        { name: "Low", count: 0, breakdown: {} },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the default axis and colouring, shows progress, and clears a stale error", async () => {
    state.aiEnabled = true;
    const reply = deferred<unknown>();
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [...ITEMS, app("erp2", "SAP BW", { attributes: { crit: "high" } })],
    });
    mockApi.on("post", "/ai/portfolio-insights", () => reply.promise);
    renderPortfolio();
    await within(document.body).findByText("SAP BW");

    fireEvent.click(aiButton());
    // Spinner in the button while the request is out.
    expect(within(screen.getByLabelText("AI Insights")).getByRole("progressbar")).toBeInTheDocument();
    expect(document.querySelector(".MuiAlert-root")).toBeNull();
    await act(async () => reply.resolve({ insights: [] }));
    expect(
      await screen.findByText("No insights could be generated for the current portfolio view."),
    ).toBeInTheDocument();
    expect(document.querySelector(".MuiAlert-root")).toBeNull();

    expect(body()).toMatchObject({ group_by: "attr:crit", color_by: "crit" });
    expect(body().groups).toEqual(
      expect.arrayContaining([{ name: "High", count: 2, breakdown: { High: 2 } }]),
    );
  });

  it("breaks a group down by colour, counting cards with no value as not set", async () => {
    state.aiEnabled = true;
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("x1", "Hi One", { attributes: { crit: "high" }, relations: [owns("org-hq", "Finance HQ")] }),
        app("x2", "Hi Two", { attributes: { crit: "high" }, relations: [owns("org-hq", "Finance HQ")] }),
        app("x3", "Blank", { relations: [owns("org-hq", "Finance HQ")] }),
      ],
    });
    mockApi.on("post", "/ai/portfolio-insights", { insights: [] });
    state.config = { groupByRaw: "rel:Organization", colorBy: "crit" };
    renderPortfolio();
    await within(document.body).findByText("Blank");
    fireEvent.click(aiButton());
    await waitFor(() => expect(mockApi.callsOf("post", "/ai/portfolio-insights")).toHaveLength(1));
    expect(body().groups).toEqual([
      { name: "Finance HQ", count: 3, breakdown: { High: 2, "Not set": 1 } },
    ]);
  });

  it("asks again after the card type changed instead of showing the old type's insights", async () => {
    state.aiEnabled = true;
    mockApi.on("get", "/reports/app-portfolio?type=Provider", PROVIDER_PAYLOAD);
    mockApi.on("post", "/ai/portfolio-insights", { insights: [{ title: "About apps", observation: "x" }] });
    renderPortfolio({ showTypeSelector: true });
    await within(document.body).findByText("Standalone Tool");
    fireEvent.click(aiButton());
    expect(await screen.findByText("About apps")).toBeInTheDocument();

    await pick(/card type/i, /Provider$/);
    await within(document.body).findByText("Globex");
    fireEvent.click(aiButton());
    await waitFor(() => expect(mockApi.callsOf("post", "/ai/portfolio-insights")).toHaveLength(2));
  });
});

/* ------------------------------------------------------------------ */
/*  Time travel pills, drawers and the inventory link                  */
/* ------------------------------------------------------------------ */

describe("time travel pills", () => {
  it("colours each changing card by the report's colour-by", async () => {
    state.timelineDate = Date.UTC(2099, 0, 1);
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("new", "New System", { attributes: { crit: "high" }, lifecycle: { active: "2090-01-01" } }),
        app("steady", "Steady", { attributes: { crit: "low" }, lifecycle: { active: "2020-01-01" } }),
      ],
    });
    renderPortfolio();
    await within(document.body).findByText("New System");
    const pills = state.sliderProps.at(-1)!.milestoneCards!(Date.UTC(2089, 0, 1), Date.UTC(2091, 0, 1));
    expect(pills).toEqual([expect.objectContaining({ name: "New System", color: "#f44336" })]);
  });
});

describe("group drawers", () => {
  it("closes the drawer when one of its cards is opened", async () => {
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    fireEvent.click(within(chart()).getByText("High"));
    const panel = await screen.findByRole("presentation");
    fireEvent.click(within(panel).getByText("SAP ERP"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp");
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  });

  it("colours a rolled-up nested card by its own organisation's relation", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("erp", "SAP ERP", { subtype: "businessApplication", relations: [owns("org-hq", "Finance HQ", "owner")] }),
        app("crm", "Salesforce", { subtype: "microservice", relations: [owns("org-pay", "Payments Team", "user")] }),
      ],
    });
    state.config = {
      groupByRaw: "rel:Organization",
      nestedGroups: true,
      groupDepth: 1,
      colorBy: "rel:relOrgOwnsApp::usage",
    };
    renderPortfolio();
    await within(document.body).findByText("Salesforce");
    fireEvent.click(within(chart()).getByText("Finance HQ"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("Business Application · Owner")).toBeInTheDocument();
    expect(within(panel).getByText("Microservice · User")).toBeInTheDocument();
  });

  it("carries relation filters into the inventory link by member name", async () => {
    state.config = {
      search: "a",
      relationFilters: {
        Provider: ["prov-1"],
        relOrgUsesApp: ["org-pay", "ghost"],
        Organization: ["ghost-only"],
      },
    };
    renderPortfolio();
    await within(document.body).findAllByText("Low");
    fireEvent.click(within(chart()).getByText("Low"));
    const panel = await screen.findByRole("presentation");
    const href = within(panel).getByRole("link", { name: /view in inventory/i }).getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.getAll("rel_Provider")).toEqual(["Acme"]);
    expect(params.getAll("rel_relOrgUsesApp")).toEqual(["Payments Team"]);
    // No member resolved: nothing to carry.
    expect(params.has("rel_Organization")).toBe(false);
    expect(params.get("search")).toBe("a");
  });

  it("leaves search out of the link when there is none", async () => {
    renderPortfolio();
    await within(document.body).findByText("Standalone Tool");
    fireEvent.click(within(chart()).getByText("Low"));
    const panel = await screen.findByRole("presentation");
    const href = within(panel).getByRole("link", { name: /view in inventory/i }).getAttribute("href")!;
    expect(new URLSearchParams(href.split("?")[1]).has("search")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Relation filters on a self-referencing type, and colour labels     */
/* ------------------------------------------------------------------ */

describe("self-referencing relation filters", () => {
  const SELF = {
    ...PAYLOAD,
    items: [
      app("caller", "Caller", {
        relations: [{ ...rel("relAppDependsOnApp", "core", "Core Lib", "Application"), direction: "outgoing" }],
      }),
      app("callee", "Callee", {
        relations: [{ ...rel("relAppDependsOnApp", "core", "Core Lib", "Application"), direction: "incoming" }],
      }),
      app("loner", "Loner"),
    ],
    relation_types: [
      {
        key: "relAppDependsOnApp",
        label: "depends on",
        reverse_label: "is depended on by",
        source_type_key: "Application",
        target_type_key: "Application",
        other_type_key: "Application",
      },
    ],
    groupable_types: { Application: [{ id: "core", name: "Core Lib", type: "Application" }] },
  };

  it.each([
    ["relAppDependsOnApp__out", "Caller", "Callee"],
    ["relAppDependsOnApp__in", "Callee", "Caller"],
    ["relAppDependsOnApp", "Caller", "Loner"],
  ])("filters by the %s side", async (key, shown, hidden) => {
    mockApi.on("get", "/reports/app-portfolio*", SELF);
    state.config = { relationFilters: { [key]: ["core"] } };
    renderPortfolio();
    expect(await within(document.body).findByText(shown)).toBeInTheDocument();
    expect(within(chart()).queryByText(hidden)).not.toBeInTheDocument();
  });
});

describe("colour labels", () => {
  it("adds a Multiple swatch when a card's relations disagree", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("erp", "SAP ERP", { relations: [owns("org-hq", "Finance HQ", "owner"), owns("org-pay", "Payments Team", "user")] }),
      ],
    });
    state.config = { groupByRaw: "rel:Organization", colorBy: "rel:relOrgOwnsApp::usage" };
    renderPortfolio();
    await within(document.body).findAllByText("SAP ERP");
    expect(within(legend()).getByText("Multiple")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Chip rendering: contrast and the mark-click spotlight              */
/* ------------------------------------------------------------------ */

describe("app chips", () => {
  const chipOf = (name: string) => within(chart()).getByText(name).closest(".MuiChip-root") as HTMLElement;

  it("keeps the chip label readable on light and dark colours", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("pale", "Pale App", { attributes: { crit: "low" } }),
        app("deep", "Deep App", { attributes: { crit: "high" } }),
      ],
      fields_schema: [
        {
          section: "Details",
          fields: [{ ...CRIT, options: [{ key: "high", label: "High", color: "#1a237e" }, { key: "low", label: "Low", color: "#ffeb3b" }] }],
        },
      ],
    });
    renderPortfolio();
    await within(document.body).findByText("Pale App");
    expect(getComputedStyle(chipOf("Pale App")).color).toBe("rgb(51, 51, 51)");
    expect(getComputedStyle(chipOf("Deep App")).color).toBe("rgb(255, 255, 255)");
  });

  it.each([false, true])(
    "pulses the clicked card and dims the rest (nested: %s)",
    async (nestedGroups) => {
      state.timelineDate = Date.UTC(2099, 0, 1);
      mockApi.on("get", "/reports/app-portfolio*", {
        ...PAYLOAD,
        items: [
          app("new", "New System", { lifecycle: { active: "2090-01-01" }, relations: [owns("org-hq", "Finance HQ")] }),
          app("steady", "Steady", { lifecycle: { active: "2020-01-01" }, relations: [owns("org-hq", "Finance HQ")] }),
        ],
        groupable_types: { Organization: [{ id: "org-hq", name: "Finance HQ", type: "Organization" }] },
      });
      state.config = { groupByRaw: "rel:Organization", nestedGroups, groupDepth: 99 };
      renderPortfolio();
      await within(document.body).findByText("Steady");
      // Not coloured: no distribution bar (and no unnamed element standing in for one).
      expect(chart().querySelector('[aria-label=""]')).toBeNull();
      expect(getComputedStyle(chipOf("Steady")).opacity).toBe("");
      expect(getComputedStyle(chipOf("New System")).animation).toBe("");

      // Everything below runs before the pulse timer can fire.
      act(() =>
        state.sliderProps.at(-1)!.onMilestoneCardClick!({ id: "new", name: "New System", kind: "activating" }),
      );
      expect(getComputedStyle(chipOf("New System")).animation).toBe("tl-pulse-live 0.65s ease-in-out 2");
      expect(getComputedStyle(chipOf("New System")).opacity).toBe("");
      expect(getComputedStyle(chipOf("Steady")).opacity).toBe("0.3");
      expect(getComputedStyle(chipOf("Steady")).animation).toBe("");
    },
  );
});

/* ------------------------------------------------------------------ */
/*  Locale changes                                                     */
/* ------------------------------------------------------------------ */

describe("a locale change", () => {
  const setLanguage = (lng: string) => act(async () => void (await i18n.changeLanguage(lng)));

  it("relabels the colour buckets and leaves a chosen 'no colour' alone", async () => {
    try {
      renderPortfolio();
      await within(document.body).findByText("Standalone Tool");
      expect(within(chart()).getByLabelText(/^Not set: 1 \(50%\)/)).toBeInTheDocument();

      await setLanguage("de");
      expect(within(chart()).getByLabelText(/^Nicht gesetzt: 1 \(50%\)/)).toBeInTheDocument();

      await pick(/Anwendungen einfärben nach/, "Keine Farbe");
      await waitFor(() => expect(within(legend()).queryByText(/Business Criticality/)).not.toBeInTheDocument());
      await setLanguage("en");
      expect(within(legend()).queryByText("Business Criticality:")).not.toBeInTheDocument();
      expect(within(chart()).queryByLabelText(/Not set/)).not.toBeInTheDocument();
    } finally {
      await setLanguage("en");
    }
  });
});
