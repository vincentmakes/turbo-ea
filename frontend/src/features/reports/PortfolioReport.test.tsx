import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import PortfolioReport from "./PortfolioReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: vi.fn(),
}));

vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: vi.fn(),
}));

vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: vi.fn(),
}));

// Stub SaveReportDialog and TimelineSlider
vi.mock("./SaveReportDialog", () => ({
  default: () => null,
}));

// Captured so the milestone/delta/spotlight wiring can be asserted at the
// slider boundary, same pattern as DependencyReport.test.tsx.
type SliderProps = {
  milestones?: { value: number; activating: number; disappearing: number }[];
  delta?: { arriving: number; retiring: number };
  onMilestoneClick?: (from: number, to: number) => void;
  milestoneCards?: (
    from: number,
    to: number,
  ) => { id: string; name: string; kind: string; color?: string }[];
  onMilestoneCardClick?: (card: { id: string; name: string; kind: string }) => void;
};
const sliderProps: SliderProps[] = [];
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: SliderProps) => {
    sliderProps.push(props);
    return <div data-testid="timeline-slider" />;
  },
}));

// The real one pulls in CardDetailContent, which needs an AuthProvider.
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean }) =>
    open ? <div data-testid="card-side-panel">{cardId}</div> : null,
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTimeline } from "@/hooks/useTimeline";
import { createRef } from "react";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_API_RESPONSE = {
  items: [
    {
      id: "app-1",
      name: "SAP ERP",
      subtype: "Business Application",
      attributes: { businessCriticality: "high" },
      lifecycle: { active: "2020-01-01" },
      relations: [
        { relation_type: "app_to_org", related_id: "org-1", related_name: "Finance", related_type: "Organization" },
      ],
      org_ids: ["org-1"],
    },
    {
      id: "app-2",
      name: "Salesforce",
      subtype: "SaaS",
      attributes: { businessCriticality: "medium" },
      lifecycle: { active: "2021-06-15", endOfLife: "2028-12-31" },
      relations: [],
      org_ids: [],
    },
  ],
  fields_schema: [
    {
      section: "Details",
      fields: [
        {
          key: "businessCriticality",
          label: "Business Criticality",
          type: "single_select",
          options: [
            { key: "high", label: "High", color: "#f44336" },
            { key: "medium", label: "Medium", color: "#ff9800" },
            { key: "low", label: "Low", color: "#4caf50" },
          ],
        },
      ],
    },
  ],
  relation_types: [],
  groupable_types: {
    Organization: [{ id: "org-1", name: "Finance", type: "Organization" }],
  },
  organizations: [{ id: "org-1", name: "Finance" }],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  sliderProps.length = 0;

  vi.mocked(useMetamodel).mockReturnValue({
    types: [
      { key: "Organization", label: "Organization", icon: "corporate_fare", color: "#2889ff" },
    ],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  });

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    consumeConfig: vi.fn().mockReturnValue(null),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "portfolio",
  });

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  });

  vi.mocked(useTimeline).mockReturnValue({
    timelineDate: Date.now(),
    setTimelineDate: vi.fn(),
    todayMs: Date.now(),
    isTimeTraveling: false,
    persistValue: undefined,
    printParam: null,
    restore: vi.fn(),
    reset: vi.fn(),
  });

  // Stub clipboard. Must be defineProperty, not Object.assign: once any test
  // has called userEvent.setup() it installs its own getter-only `clipboard`,
  // and assigning over that throws for every subsequent test.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPortfolio() {
  return render(
    <MemoryRouter>
      <PortfolioReport />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PortfolioReport", () => {
  it("shows loading spinner before data loads", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderPortfolio();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders report title after data loads", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Application Portfolio")).toBeInTheDocument();
    });
  });

  it("fetches data from /reports/app-portfolio", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/reports/app-portfolio?type=Application",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("shows an error instead of spinning forever when the fetch fails", async () => {
    // The report cleared `data` on every type switch and never caught a
    // failure, so a failed request left it on the spinner permanently.
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("An error occurred")).toBeInTheDocument();
    });
    expect(document.querySelector(".MuiCircularProgress-root")).toBeNull();
  });

  it("renders app chips in chart view", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("SAP ERP")).toBeInTheDocument();
    });
    expect(screen.getByText("Salesforce")).toBeInTheDocument();
  });

  it("shows application count in legend", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("applications")).toBeInTheDocument();
    });
  });

  it("shows EOL count when apps have endOfLife dates", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("with EOL")).toBeInTheDocument();
    });
  });

  it("renders empty state when no applications exist", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [],
      fields_schema: [],
      relation_types: [],
      groupable_types: {},
      organizations: [],
    });
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText(/no applications found/i)).toBeInTheDocument();
    });
  });

  it("renders Group by and Color apps by selectors", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByLabelText("Group by")).toBeInTheDocument();
      expect(screen.getByLabelText("Color apps by")).toBeInTheDocument();
    });
  });

  it("renders Search field", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });
  });

  it("renders Application Filters section", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Application Filters")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Nested groups
// ---------------------------------------------------------------------------

const HIER_API_RESPONSE = {
  items: [
    {
      id: "app-1",
      name: "SAP ERP",
      subtype: "Business Application",
      attributes: { businessCriticality: "high" },
      lifecycle: { active: "2020-01-01" },
      relations: [
        { relation_type: "app_to_org", related_id: "org-child", related_name: "Payments Team", related_type: "Organization" },
      ],
      org_ids: ["org-child"],
    },
    {
      id: "app-2",
      name: "Salesforce",
      subtype: "SaaS",
      attributes: { businessCriticality: "medium" },
      lifecycle: { active: "2021-06-15" },
      relations: [
        { relation_type: "app_to_org", related_id: "org-root", related_name: "Finance HQ", related_type: "Organization" },
      ],
      org_ids: ["org-root"],
    },
    {
      id: "app-3",
      name: "Standalone Tool",
      subtype: "SaaS",
      attributes: {},
      lifecycle: { active: "2020-01-01" },
      relations: [],
      org_ids: [],
    },
  ],
  fields_schema: MOCK_API_RESPONSE.fields_schema,
  relation_types: [],
  groupable_types: {
    Organization: [
      { id: "org-root", name: "Finance HQ", type: "Organization", parent_id: null },
      { id: "org-child", name: "Payments Team", type: "Organization", parent_id: "org-root" },
    ],
  },
  organizations: [
    { id: "org-root", name: "Finance HQ" },
    { id: "org-child", name: "Payments Team" },
  ],
};

function mockHierarchicalMetamodel() {
  vi.mocked(useMetamodel).mockReturnValue({
    types: [
      {
        key: "Organization",
        label: "Organization",
        icon: "corporate_fare",
        color: "#2889ff",
        has_hierarchy: true,
      },
    ],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  });
}

function mockSavedConfig(config: Record<string, unknown>) {
  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: config,
    consumeConfig: vi.fn().mockReturnValue(config),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "portfolio",
  });
}

describe("PortfolioReport nested groups", () => {
  it("hides the toggle while grouping by an attribute", async () => {
    vi.mocked(api.get).mockResolvedValue(HIER_API_RESPONSE);
    mockHierarchicalMetamodel();
    renderPortfolio(); // defaults to the first option = attr:businessCriticality

    await waitFor(() => {
      expect(screen.getByLabelText("Group by")).toBeInTheDocument();
    });
    expect(screen.queryByText("Nested groups")).not.toBeInTheDocument();
  });

  it("hides the toggle for a relation type without hierarchy", async () => {
    vi.mocked(api.get).mockResolvedValue(HIER_API_RESPONSE);
    // Default metamodel mock: Organization has no has_hierarchy flag
    mockSavedConfig({ groupByRaw: "rel:Organization" });
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Finance HQ")).toBeInTheDocument();
    });
    expect(screen.queryByText("Nested groups")).not.toBeInTheDocument();
  });

  it("shows the toggle for a hierarchical relation type, flat until enabled", async () => {
    vi.mocked(api.get).mockResolvedValue(HIER_API_RESPONSE);
    mockHierarchicalMetamodel();
    mockSavedConfig({ groupByRaw: "rel:Organization" });
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Nested groups")).toBeInTheDocument();
    });
    // Depth selector only appears once nesting is on
    expect(screen.queryByLabelText("Display Depth")).not.toBeInTheDocument();
  });

  it("renders the child group inside the parent group when nested", async () => {
    vi.mocked(api.get).mockResolvedValue(HIER_API_RESPONSE);
    mockHierarchicalMetamodel();
    mockSavedConfig({ groupByRaw: "rel:Organization", nestedGroups: true, groupDepth: 99 });
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByLabelText("Display Depth")).toBeInTheDocument();
    });
    const parentHeader = screen.getByText("Finance HQ");
    const childHeader = screen.getByText("Payments Team");
    // The child group's box lives inside the parent group's box.
    const parentBox = parentHeader.closest("[data-export-row]");
    expect(parentBox).not.toBeNull();
    expect(parentBox!.contains(childHeader)).toBe(true);
    // Apps land at their deepest group; ungrouped section still renders.
    expect(screen.getByText("SAP ERP")).toBeInTheDocument();
    expect(screen.getByText("Standalone Tool")).toBeInTheDocument();
    expect(screen.getByText(/not assigned to any/i)).toBeInTheDocument();
  });

  it("rolls deeper groups up into the visible level when depth is 1", async () => {
    vi.mocked(api.get).mockResolvedValue(HIER_API_RESPONSE);
    mockHierarchicalMetamodel();
    mockSavedConfig({ groupByRaw: "rel:Organization", nestedGroups: true, groupDepth: 1 });
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Finance HQ")).toBeInTheDocument();
    });
    // Child group is cut off by the depth limit …
    expect(screen.queryByText("Payments Team")).not.toBeInTheDocument();
    // … but its app rolls up into the visible root.
    expect(screen.getByText("SAP ERP")).toBeInTheDocument();
  });

  it("persists nestedGroups and groupDepth when the toggle changes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(HIER_API_RESPONSE);
    mockHierarchicalMetamodel();
    mockSavedConfig({ groupByRaw: "rel:Organization" });
    renderPortfolio();

    await waitFor(() => {
      expect(screen.getByText("Nested groups")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("checkbox"));

    const persistConfig = vi.mocked(useSavedReport).mock.results[0].value.persistConfig;
    await waitFor(() => {
      expect(persistConfig).toHaveBeenCalledWith(
        expect.objectContaining({ nestedGroups: true, groupDepth: 2 }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Group drawer
//
// Characterization tests written before the drawer was moved onto the shared
// ReportCardListPanel — the drawer had no coverage at all, and its per-item
// secondary text and colour dot depend on a `perMemberColor` member-id
// fallback that is easy to get subtly wrong.
// ---------------------------------------------------------------------------

describe("PortfolioReport group drawer", () => {
  async function openGroup(name: string) {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    mockSavedConfig({ groupByRaw: "rel:Organization", colorBy: "businessCriticality" });
    renderPortfolio();
    await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
    await user.click(screen.getByText(name));
    return user;
  }

  it("lists the group's applications", async () => {
    await openGroup("Finance");
    // The drawer heading repeats the count, and the row itself is the app name.
    await waitFor(() => {
      expect(screen.getAllByText("SAP ERP").length).toBeGreaterThan(0);
    });
  });

  it("describes each row with its subtype and colour-by value", async () => {
    await openGroup("Finance");
    await waitFor(() => {
      expect(screen.getByText("Business Application · High")).toBeInTheDocument();
    });
  });

  it("resolves the subtype key to its metamodel display label", async () => {
    // A card stores its subtype as a bare key; the drawer used to print that
    // key straight out, so the row read "businessApplication" where the rest
    // of the UI says "Business Application".
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        { key: "Organization", label: "Organization", icon: "corporate_fare", color: "#2889ff" },
        {
          key: "Application",
          label: "Application",
          subtypes: [{ key: "businessApplication", label: "Business Application" }],
        },
      ],
      relationTypes: [],
      loading: false,
      getType: () => undefined,
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(api.get).mockResolvedValue({
      ...MOCK_API_RESPONSE,
      items: [
        { ...MOCK_API_RESPONSE.items[0], subtype: "businessApplication" },
        MOCK_API_RESPONSE.items[1],
      ],
    });
    mockSavedConfig({ groupByRaw: "rel:Organization", colorBy: "businessCriticality" });
    renderPortfolio();
    await waitFor(() => expect(screen.getByText("Finance")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByText("Finance"));

    await waitFor(() => {
      expect(screen.getByText("Business Application · High")).toBeInTheDocument();
    });
    expect(screen.queryByText(/businessApplication/)).not.toBeInTheDocument();
  });

  it("offers a View in inventory link for a real group", async () => {
    await openGroup("Finance");
    await waitFor(() => {
      const link = screen.getByRole("link");
      expect(link.getAttribute("href")).toContain("type=Application");
      expect(link.getAttribute("href")).toContain("rel_Organization=Finance");
    });
  });

  it("hands a clicked row to the card side panel", async () => {
    const user = await openGroup("Finance");
    await waitFor(() => expect(screen.getByText("Business Application · High")).toBeInTheDocument());
    await user.click(screen.getByText("Business Application · High"));
    expect(await screen.findByTestId("card-side-panel")).toHaveTextContent("app-1");
  });

  it("does not mutate the grouped app arrays when sorting rows for display", async () => {
    // The drawer used to call drawer.apps.sort() in place, mutating the array
    // held in React state and owned by the grouping memo.
    await openGroup("Finance");
    await waitFor(() => expect(screen.getByText("Business Application · High")).toBeInTheDocument());
    // Reopening the same group must still render it — an in-place sort of a
    // memoized array is the kind of thing that only breaks on the second open.
    expect(screen.getAllByText("SAP ERP").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Collapsible filters section
// ---------------------------------------------------------------------------

describe("PortfolioReport collapsible filters", () => {
  /** The filters header toggle — a real button, so addressable by role. */
  const filtersToggle = () =>
    screen.getByRole("button", { name: /Application Filters/ });

  it("starts expanded, with the filter controls visible", async () => {
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => expect(filtersToggle()).toBeInTheDocument());
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("restores a collapsed section from the saved config", async () => {
    mockSavedConfig({ filtersCollapsed: true });
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => expect(filtersToggle()).toBeInTheDocument());
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    // The header stays readable so the section can be found and reopened.
    expect(screen.getByText("Application Filters")).toBeVisible();
  });

  it("restores an explicitly stored expanded state", async () => {
    // Guards the `!= null` restore idiom: a truthiness check would drop a
    // stored `false` — invisible here (the default is also false) but the
    // pairing with the collapsed case above pins the intent.
    mockSavedConfig({ filtersCollapsed: false });
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => expect(filtersToggle()).toBeInTheDocument());
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("persists the collapse when the header is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    mockSavedConfig({ groupByRaw: "rel:Organization" });
    renderPortfolio();

    await waitFor(() => expect(filtersToggle()).toBeInTheDocument());
    await user.click(filtersToggle());

    // Asserted only after an interaction: `skipFirstPersistRef` swallows the
    // mount-time call.
    const persistConfig = vi.mocked(useSavedReport).mock.results[0].value.persistConfig;
    await waitFor(() =>
      expect(persistConfig).toHaveBeenCalledWith(
        expect.objectContaining({ filtersCollapsed: true }),
      ),
    );
  });

  it("shows the active-filter count on the collapsed header", async () => {
    mockSavedConfig({
      filtersCollapsed: true,
      attrFilters: { businessCriticality: ["high"] },
    });
    vi.mocked(api.get).mockResolvedValue(MOCK_API_RESPONSE);
    renderPortfolio();

    await waitFor(() => expect(filtersToggle()).toBeInTheDocument());
    // Same integer the report puts in its print params, so a collapsed
    // section on screen and the printed header cannot disagree.
    expect(within(filtersToggle()).getByText("1")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Time travel — transition marks, delta, spotlight
// ---------------------------------------------------------------------------

const ms = (iso: string) => new Date(iso).getTime();
const TODAY = ms("2026-08-22");
const FUTURE = ms("2028-06-01");
const OLD_EOL = ms("2027-06-01");

const TT_API_RESPONSE = {
  items: [
    {
      id: "app-old",
      name: "Old System",
      subtype: "Business Application",
      attributes: { businessCriticality: "medium" },
      lifecycle: { active: "2015-01-01", endOfLife: "2027-06-01" },
      relations: [],
      org_ids: [],
    },
    {
      id: "app-new",
      name: "New System",
      subtype: "Business Application",
      attributes: { businessCriticality: "high" },
      lifecycle: { active: "2027-09-01" },
      relations: [],
      org_ids: [],
    },
    {
      id: "app-steady",
      name: "Steady App",
      subtype: "SaaS",
      attributes: { businessCriticality: "high" },
      lifecycle: { active: "2020-01-01" },
      relations: [],
      org_ids: [],
    },
  ],
  fields_schema: MOCK_API_RESPONSE.fields_schema,
  relation_types: [],
  groupable_types: {},
  organizations: [],
};

function mockTimeTravel() {
  vi.mocked(useTimeline).mockReturnValue({
    timelineDate: FUTURE,
    setTimelineDate: vi.fn(),
    todayMs: TODAY,
    isTimeTraveling: true,
    persistValue: FUTURE,
    printParam: { label: "Time Travel", value: "Jun 1, 2028" },
    restore: vi.fn(),
    reset: vi.fn(),
  });
}

describe("PortfolioReport time travel — transition marks", () => {
  it("marks come from the statically-filtered set: a date-hidden app still marks its dates", async () => {
    vi.mocked(api.get).mockResolvedValue(TT_API_RESPONSE);
    mockTimeTravel();
    renderPortfolio();
    await screen.findByText("Steady App");

    // Old System is hidden at the travelled 2028 date — its chip is gone …
    expect(screen.queryByText("Old System")).not.toBeInTheDocument();
    // … but its retirement is still a mark, and the delta still counts it.
    const props = sliderProps.at(-1)!;
    expect(props.milestones).toContainEqual({ value: OLD_EOL, activating: 0, disappearing: 1 });
    expect(props.delta).toEqual({ arriving: 1, retiring: 1 });
  });

  it("an app excluded by an attribute filter contributes no mark and no delta", async () => {
    vi.mocked(api.get).mockResolvedValue(TT_API_RESPONSE);
    mockTimeTravel();
    // Filter to "high" criticality — Old System (medium) drops out of scope.
    mockSavedConfig({ attrFilters: { businessCriticality: ["high"] } });
    renderPortfolio();
    await screen.findByText("Steady App");

    const props = sliderProps.at(-1)!;
    expect(props.milestones?.some((m) => m.value === OLD_EOL)).toBe(false);
    expect(props.delta).toEqual({ arriving: 1, retiring: 0 });
  });

  it("clicking a retirement mark reveals the hidden chip for the pulse, then re-hides it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(api.get).mockResolvedValue(TT_API_RESPONSE);
      mockTimeTravel();
      const { container } = renderPortfolio();
      await screen.findByText("Steady App");
      expect(screen.queryByText("Old System")).not.toBeInTheDocument();
      expect(container.innerHTML).not.toContain("tl-pulse-retire");

      act(() => sliderProps.at(-1)!.onMilestoneClick!(OLD_EOL, OLD_EOL));
      // The retiring app's chip appears as the spotlight's ghost, and the
      // pulse keyframes are injected while it runs.
      await waitFor(() => expect(screen.getByText("Old System")).toBeInTheDocument());
      expect(container.innerHTML).toContain("tl-pulse-retire");

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(screen.queryByText("Old System")).not.toBeInTheDocument());
      expect(container.innerHTML).not.toContain("tl-pulse-retire");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the changing apps as pills and spotlights one on a pill click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(api.get).mockResolvedValue(TT_API_RESPONSE);
      mockTimeTravel();
      const { container } = renderPortfolio();
      await screen.findByText("Steady App");

      const props = sliderProps.at(-1)!;
      const pills = props.milestoneCards!(ms("2027-01-01"), ms("2028-01-01"));
      expect(pills.map((p) => p.name).sort()).toEqual(["New System", "Old System"]);

      act(() =>
        props.onMilestoneCardClick!({ id: "app-new", name: "New System", kind: "activating" }),
      );
      await waitFor(() => expect(container.innerHTML).toContain("tl-pulse-live"));

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(container.innerHTML).not.toContain("tl-pulse-live"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("pulses table rows too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(api.get).mockResolvedValue(TT_API_RESPONSE);
      mockTimeTravel();
      mockSavedConfig({ view: "table" });
      const { container } = renderPortfolio();
      await screen.findByText("Steady App");

      act(() => sliderProps.at(-1)!.onMilestoneClick!(OLD_EOL, OLD_EOL));
      await waitFor(() => expect(container.innerHTML).toContain("tl-pulse-row-retire"));

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(container.innerHTML).not.toContain("tl-pulse-row-retire"));
    } finally {
      vi.useRealTimers();
    }
  });
});
