/**
 * Tests for the Cost report's card scope (#954) and its fiscal-year indicator.
 *
 * Scope: the risk is not the filter itself but its blast radius — the metric
 * strip, the treemap and the table footer are all derived separately, so a
 * scope applied in the wrong place leaves them disagreeing with each other.
 *
 * Fiscal year: the server shows the current year only and names it; the page
 * must say which year that is and never ask for another.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installResizeObserver } from "@/test/dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import i18n from "@/i18n";
import CostReport from "./CostReport";
import { cardColor } from "./costColors";
import { CHART_CATEGORICAL, CHART_OTHER, COST_UNSPECIFIED, STATUS_COLORS } from "@/theme/tokens";

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: vi.fn(),
}));
vi.mock("@/hooks/useCurrency", () => ({
  // `fmt` is an Intl-style formatter object, not a function.
  useCurrency: () => ({
    fmt: { format: (v: number) => `$${v}` },
    fmtShort: (v: number) => `$${v}`,
    symbol: "$",
    currency: "USD",
    loading: false,
    invalidate: () => {},
  }),
}));
// jsdom has no canvas: the charts are the shared test double, and a test reads the option the page built.
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
// The report hides everything behind `costs.view`.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: { "costs.view": true } } }),
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean }) =>
    open ? <div data-testid="side-panel">{cardId}</div> : null,
}));
// The trend chart's own fetching is tested in CostTrendChart.test.tsx; here only the years it is given.
const trendYearsSeen: number[][] = []; // every `years` array the stub was rendered with
vi.mock("./CostTrendChart", () => ({
  default: ({
    years,
    currentFiscalYear,
    typeParam,
    costField,
    components,
    labelOf,
    groupBy,
  }: {
    years: number[];
    currentFiscalYear: number;
    typeParam: string;
    costField: string;
    components: string[];
    labelOf?: (key: string) => string;
    groupBy?: string;
  }) => {
    trendYearsSeen.push(years);
    return (
      <div
        data-testid="cost-trend-chart"
        data-years={years.join(",")}
        data-current={currentFiscalYear}
        data-type={typeParam}
        data-field={costField}
        data-group-by={groupBy ?? ""}
        data-components={components.join(",")}
        data-labels={components.map((c) => labelOf?.(c) ?? c).join(",")}
      />
    );
  },
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { echartState } from "@/test/echartMock";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  color: "#0f7eb5",
  is_hidden: false,
  has_hierarchy: true,
  fields_schema: [
    {
      section: "Costs",
      fields: [
        { key: "costTotalAnnual", label: "Total Annual Cost", type: "cost" },
      ],
    },
  ],
};

const ITC_TYPE = {
  key: "ITComponent",
  label: "IT Component",
  color: "#8e24aa",
  is_hidden: false,
  has_hierarchy: false,
  fields_schema: [
    {
      section: "Cost",
      fields: [
        { key: "costTotalAnnual", label: "Total Annual Cost", type: "cost" },
      ],
    },
  ],
};

/** crm → crm-web (child).  erp is a separate root. */
const HIERARCHY = [
  { id: "crm", name: "CRM", type: "Application", parent_id: null },
  { id: "crm-web", name: "CRM Web", type: "Application", parent_id: "crm" },
  { id: "erp", name: "ERP", type: "Application", parent_id: null },
];

const COST_ITEMS = [
  { id: "crm", name: "CRM", cost: 100, attributes: {} },
  { id: "crm-web", name: "CRM Web", cost: 20, attributes: {} },
  { id: "erp", name: "ERP", cost: 500, attributes: {} },
];

const CATALOGUE = [
  { id: "2", key: "support", label: "Support", sort_order: 2, archived: true, translations: {} },
  { id: "1", key: "licenses", label: "Licenses", sort_order: 1, archived: false, translations: {} },
];

let fyStart = 1;

/** The server echoes the REQUESTED year as `fiscal_year` (2026 when none is asked for). */
const requestedYear = (path: string) =>
  Number(new URL(path, "http://x").searchParams.get("fiscal_year") ?? 2026);

let consumedConfig: Record<string, unknown> | null = { view: "table" };

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  echartState.reset();
  consumedConfig = { view: "table" };
  fyStart = 1;

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/cost-treemap")) {
      return Promise.resolve({
        items: COST_ITEMS,
        total: 620,
        components: ["licenseCost", "serviceCost"],
        fiscal_year: requestedYear(path),
        current_fiscal_year: 2026,
        fiscal_year_start: fyStart,
      }) as never;
    }
    if (path.startsWith("/reports/cost-sankey")) {
      return Promise.resolve({
        nodes: [
          { id: "crm", name: "CRM", type: "Application" },
          { id: "db", name: "DB", type: "ITComponent" },
        ],
        links: [{ source: 0, target: 1, value: 100 }],
        total: 100,
        fiscal_year: requestedYear(path),
        current_fiscal_year: 2026,
        fiscal_year_start: fyStart,
      }) as never;
    }
    if (path.startsWith("/metamodel/cost-item-types")) {
      return Promise.resolve(CATALOGUE) as never;
    }
    // The scope hook's own hierarchy fetch.
    return Promise.resolve({
      items: HIERARCHY,
      total: HIERARCHY.length,
    }) as never;
  });

  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE, ITC_TYPE],
    relationTypes: [],
    loading: false,
    getType: (key: string) => (key === "Application" ? APP_TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as never);

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    consumeConfig: vi.fn(() => consumedConfig),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "cost",
  } as never);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as never);
});

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;

describe("CostReport scope filter", () => {
  it("includes every card when unscoped", async () => {
    renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    expect(within(chart()).getAllByText("CRM").length).toBeGreaterThan(0);
    expect(within(toolbar()).getByText("All cards")).toBeInTheDocument();
  });

  it("narrows to the scoped subtree, and the total follows it", async () => {
    // Scoping to CRM keeps CRM + CRM Web (120) and drops ERP's 500 — the whole
    // point being that the metric strip must not keep reporting 620.
    consumedConfig = { view: "table", scopeIds: ["crm"] };
    renderCost();

    await waitFor(() =>
      expect(within(chart()).getAllByText("CRM").length).toBeGreaterThan(0),
    );
    expect(within(chart()).getAllByText("CRM Web").length).toBeGreaterThan(0);
    expect(within(chart()).queryByText("ERP")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(chart()).getAllByText("$120").length).toBeGreaterThan(0),
    );
    expect(within(chart()).queryByText("$620")).not.toBeInTheDocument();
  });

  it("issues no hierarchy request while unscoped", async () => {
    renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );

    const cardCalls = vi
      .mocked(api.get)
      .mock.calls.filter(([path]) => String(path).startsWith("/cards"));
    expect(cardCalls).toHaveLength(0);
  });

  it("drops a scoped id whose card no longer exists", async () => {
    consumedConfig = { view: "table", scopeIds: ["deleted-app"] };
    renderCost();

    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    expect(within(toolbar()).getByText("All cards")).toBeInTheDocument();
  });
});

const treemapPaths = () =>
  vi
    .mocked(api.get)
    .mock.calls.map(([path]) => String(path))
    .filter((path) => path.startsWith("/reports/cost-treemap"));
const hasYear = (y: string) => (path: string) => path.includes(`fiscal_year=${y}`);

// The fiscal-year row: one slider step per year, oldest first. Previous/Next move one step.
const yearSlider = () => screen.findByRole("slider", { name: "Fiscal year" });
const prevYear = () => userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
const nextYear = () => userEvent.click(screen.getByRole("button", { name: "Next fiscal year" }));

// The slider measures its track with a ResizeObserver, which jsdom lacks.
let restoreResizeObserver: () => void;
beforeEach(() => {
  restoreResizeObserver = installResizeObserver();
});
afterEach(() => restoreResizeObserver());

describe("CostReport fiscal year", () => {
  it("the steps are the fiscal year options in order", async () => {
    renderCost();
    const slider = await yearSlider();
    expect(slider).toHaveAttribute("aria-valuemin", "2022");
    expect(slider).toHaveAttribute("aria-valuemax", "2027");
    // Exactly the six step labels, in order.
    expect(screen.getAllByText(/^FY\d\d$/).map((el) => el.textContent)).toEqual([
      "FY22",
      "FY23",
      "FY24",
      "FY25",
      "FY26",
      "FY27",
    ]);
    expect(slider).toHaveAttribute("aria-valuenow", "2026");
    // Between the toolbar and the summary strip.
    expect(
      slider.compareDocumentPosition(screen.getByText("Total Cost")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toolbar().compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("the old drop-down and the chip are gone", async () => {
    renderCost();
    await yearSlider();
    expect(screen.queryByTestId("cost-fiscal-year")).toBeNull();
    expect(within(toolbar()).queryByText(/Fiscal year/)).toBeNull(); // the print-only parameters line keeps its own label
    expect(screen.queryByRole("combobox", { name: /fiscal year/i })).toBeNull();
  });

  it("names the current fiscal year the figures are for", async () => {
    renderCost();
    expect(await yearSlider()).toHaveAttribute("aria-valuetext", "FY26 - Current");
    expect(document.querySelector(".report-print-params")).toHaveTextContent("FY26 - Current");
  });

  it("names the year the same whatever month the fiscal year starts in", async () => {
    fyStart = 10;
    renderCost();
    expect(await yearSlider()).toHaveAttribute("aria-valuetext", "FY26 - Current");
  });

  it("names a picked past year without a suffix, on the slider and in the parameters line", async () => {
    renderCost();
    await yearSlider();
    await prevYear();
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Fiscal year" })).toHaveAttribute(
        "aria-valuetext",
        "FY25",
      ),
    );
    const params = document.querySelector(".report-print-params");
    expect(params).toHaveTextContent("FY25");
    expect(params).not.toHaveTextContent("FY25 - ");
  });

  it("never asks the server for a particular year until one is chosen", async () => {
    renderCost();
    await yearSlider();
    expect(treemapPaths().length).toBeGreaterThan(0);
    for (const path of treemapPaths()) expect(path).not.toContain("fiscal_year");
  });

  it("choosing a step sets the request fiscal_year", async () => {
    renderCost();
    await yearSlider();
    await prevYear();
    await waitFor(() => expect(treemapPaths().some(hasYear("2025"))).toBe(true));
    vi.mocked(api.get).mockClear();
    await nextYear(); // back on the current year
    await waitFor(() => expect(treemapPaths().length).toBeGreaterThan(0));
    for (const path of treemapPaths()) expect(path).not.toContain("fiscal_year");
    await nextYear(); // the forecast year
    await waitFor(() => expect(treemapPaths().some(hasYear("2027"))).toBe(true));
  });

  it("previous/next and the arrow keys change the year", async () => {
    renderCost();
    const slider = await yearSlider();
    await prevYear();
    await waitFor(() => expect(treemapPaths().some(hasYear("2025"))).toBe(true));
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "2024"));
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    // Two steps right of 2024 is the current year: no fiscal_year on the last request.
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "2026"));
    expect(treemapPaths().at(-1)).not.toContain("fiscal_year");
  });

  it("keeps the steps anchored on the current year after picking a past year", async () => {
    renderCost();
    const slider = await yearSlider();
    await prevYear();
    await prevYear();
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuetext", "FY24"));
    expect(slider).toHaveAttribute("aria-valuemin", "2022");
    expect(slider).toHaveAttribute("aria-valuemax", "2027");
  });

  it("a saved report restores its year onto the slider", async () => {
    consumedConfig = { view: "table", fiscalYearParam: 2027 };
    renderCost();
    const slider = await yearSlider();
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "2027"));
    expect(slider).toHaveAttribute("aria-valuetext", "FY27 - Forecast");
    expect(treemapPaths().some(hasYear("2027"))).toBe(true);
  });

  it("opens on Current when a saved year equals the current year", async () => {
    consumedConfig = { view: "table", fiscalYearParam: 2026 };
    renderCost();
    const slider = await yearSlider();
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "2026"));
    await waitFor(() => expect(treemapPaths().length).toBeGreaterThan(1));
    expect(treemapPaths().at(-1)).not.toContain("fiscal_year");
  });

  it("a saved year older than the steps falls back to current", async () => {
    consumedConfig = { view: "table", fiscalYearParam: 2010 };
    renderCost();
    const slider = await yearSlider();
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "2026"));
    expect(treemapPaths().at(-1)).not.toContain("fiscal_year");
  });

  it("the forecast year shows the forecast banner as before", async () => {
    consumedConfig = { view: "chart" };
    renderCost();
    await yearSlider();
    expect(screen.queryByTestId("cost-trend-chart")).toBeNull();
    await nextYear();
    expect(await screen.findByTestId("cost-trend-chart")).toBeInTheDocument();
  });
});

const typeButton = (name: string) =>
  within(screen.getByRole("group", { name: /card type/i })).getByRole("button", { name });
const lastTreemapType = () =>
  new URL(treemapPaths().at(-1)!, "http://x").searchParams.get("type");

describe("CostReport card type toggle buttons", () => {
  it("offers Application and IT Component as two buttons, only Application on", async () => {
    renderCost();
    await screen.findByRole("group", { name: /card type/i });
    const names = within(screen.getByRole("group", { name: /card type/i }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Application", "IT Component"]);
    expect(typeButton("Application")).toHaveAttribute("aria-pressed", "true");
    expect(typeButton("IT Component")).toHaveAttribute("aria-pressed", "false");
  });

  it("only IT Component on requests ITComponent", async () => {
    renderCost();
    await screen.findByRole("group", { name: /card type/i });
    await userEvent.click(typeButton("IT Component"));
    await userEvent.click(typeButton("Application"));
    await waitFor(() => expect(lastTreemapType()).toBe("ITComponent"));
    expect(typeButton("Application")).toHaveAttribute("aria-pressed", "false");
  });

  it("both on requests the combined type, only Application on requests Application", async () => {
    renderCost();
    await screen.findByRole("group", { name: /card type/i });
    await userEvent.click(typeButton("IT Component"));
    await waitFor(() => expect(lastTreemapType()).toBe("Application,ITComponent"));
    await userEvent.click(typeButton("IT Component"));
    await waitFor(() => expect(lastTreemapType()).toBe("Application"));
  });

  it("the last active button cannot be turned off", async () => {
    renderCost();
    await screen.findByRole("group", { name: /card type/i });
    await userEvent.click(typeButton("Application"));
    expect(typeButton("Application")).toHaveAttribute("aria-pressed", "true");
    expect(typeButton("IT Component")).toHaveAttribute("aria-pressed", "false");
  });

  it("a user who may read only one type sees one button, always on", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [APP_TYPE],
      relationTypes: [],
      loading: false,
      getType: () => APP_TYPE,
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    renderCost();
    await screen.findByRole("group", { name: /card type/i });
    const buttons = within(screen.getByRole("group", { name: /card type/i })).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("a saved report with the combined key reopens with both buttons on", async () => {
    consumedConfig = { view: "table", cardTypeKey: "Application+ITComponent" };
    renderCost();
    await screen.findByRole("group", { name: /card type/i });
    expect(typeButton("Application")).toHaveAttribute("aria-pressed", "true");
    expect(typeButton("IT Component")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("CostReport card-type selector and Sankey view", () => {
  it("renders a Sankey toggle button and switches the panel on click", async () => {
    const { findByRole, findByTestId } = renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    const sankeyBtn = await findByRole("button", {
      name: /sankey chart view/i,
    });
    await userEvent.click(sankeyBtn);
    expect(await findByTestId("cost-sankey-panel")).toBeInTheDocument();
  });

  it("renders cost item, group and card nodes from the payload, groups between", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({
          nodes: [
            { id: "item:costTotalAnnual", name: "Licences", type: "CostItem" },
            { id: "group:EMEA", name: "EMEA", type: "Group" },
            { id: "crm", name: "CRM", type: "Application" },
          ],
          links: [
            { source: 0, target: 1, value: 100 },
            { source: 1, target: 2, value: 100 },
          ],
          total: 100,
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      return Promise.resolve({ items: COST_ITEMS, total: 620, fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 }) as never;
    });
    const { findByTestId, findByRole } = renderCost();
    await userEvent.click(await findByRole("button", { name: /sankey chart view/i }));
    await findByTestId("cost-sankey-panel");
    const s = echartState.last().option.series[0];
    const label = (id: string) => s.label.formatter({ name: id });
    const ids: string[] = s.data.map((d: { name: string }) => d.name);
    // Item and group nodes are named for what they are; the flow runs item -> group -> card.
    expect(ids.map(label)).toEqual(["Total Annual Cost", "EMEA", "CRM · Application"]);
    expect(s.links.map((l: { source: string; target: string }) => [label(l.source), label(l.target)])).toEqual([
      ["Total Annual Cost", "EMEA"],
      ["EMEA", "CRM · Application"],
    ]);
    const fill = (id: string) => s.data.find((d: { name: string }) => d.name === id).itemStyle.color;
    expect(fill(ids[0])).not.toBe(fill(ids[1]));
  });

  it("shows the no-data message for an empty Sankey payload", async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/reports/cost-sankey")
          ? { nodes: [], links: [], total: 0, fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 }
          : { items: COST_ITEMS, total: 620, fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 },
      ) as never,
    );
    const { findByText, findByRole } = renderCost();
    await userEvent.click(await findByRole("button", { name: /sankey chart view/i }));
    expect(await findByText("No cost data found.")).toBeInTheDocument();
  });

  it("no longer renders the cost-source (aggregate) control", async () => {
    const { queryByLabelText } = renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    expect(queryByLabelText(/cost source/i)).not.toBeInTheDocument();
  });
});

describe("CostReport custom columns", () => {
  it("offers every field of the current card type, in table view", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        {
          ...APP_TYPE,
          fields_schema: [
            {
              section: "Extra",
              fields: [{ key: "alias", label: "Alias", type: "text" }],
            },
            ...APP_TYPE.fields_schema,
          ],
        },
        ITC_TYPE,
      ],
      relationTypes: [],
      loading: false,
      getType: (key: string) => (key === "Application" ? APP_TYPE : undefined),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    const { findByRole } = renderCost();
    await waitFor(() =>
      expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0),
    );
    await userEvent.click(await screen.findByRole("button", { name: /table view/i }));
    const picker = await findByRole("combobox", { name: /columns/i });
    await userEvent.click(picker);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("Total Annual Cost");
  });

  it("does not offer extension-typed (object) fields in the Columns menu", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        {
          ...APP_TYPE,
          fields_schema: [
            ...APP_TYPE.fields_schema,
            {
              section: "Licensing",
              fields: [
                { key: "licensedUsers", label: "Licensed users", type: "ext.licensing.multivalue" },
                { key: "alias", label: "Alias", type: "text" },
              ],
            },
          ],
        },
        ITC_TYPE,
      ],
      relationTypes: [],
      loading: false,
      getType: () => APP_TYPE,
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    consumedConfig = { view: "table", extraColumns: ["licensedUsers"] };
    renderCost();
    const picker = await screen.findByRole("combobox", { name: /columns/i });
    // The saved extension column is pruned.
    await waitFor(() => expect(picker).not.toHaveTextContent("1"));
    await userEvent.click(picker);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("Alias");
    expect(options).not.toContain("Licensed users");
  });

  it("persists and restores picked columns", async () => {
    consumedConfig = { view: "table", extraColumns: ["costTotalAnnual"] };
    renderCost();
    await waitFor(() =>
      expect(
        within(toolbar()).getByRole("combobox", { name: /columns/i }),
      ).toHaveTextContent("1"),
    );
  });

  it("renders picked columns in pick order, not picker order", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        {
          ...APP_TYPE,
          fields_schema: [
            ...APP_TYPE.fields_schema,
            {
              section: "Extra",
              fields: [{ key: "alias", label: "Alias", type: "text" }],
            },
          ],
        },
        ITC_TYPE,
      ],
      relationTypes: [],
      loading: false,
      getType: () => APP_TYPE,
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    consumedConfig = {
      view: "table",
      extraColumns: ["costTotalAnnual", "alias"],
    };
    renderCost();
    await screen.findByRole("table");
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.indexOf("Total Annual Cost")).toBeLessThan(
      headers.indexOf("Alias"),
    );
  });

  it("drops a picked column the new type does not define", async () => {
    vi.mocked(useMetamodel).mockReturnValue({
      types: [
        {
          ...APP_TYPE,
          fields_schema: [
            ...APP_TYPE.fields_schema,
            {
              section: "Extra",
              fields: [{ key: "alias", label: "Alias", type: "text" }],
            },
          ],
        },
        ITC_TYPE,
      ],
      relationTypes: [],
      loading: false,
      getType: (key: string) =>
        key === "Application" ? APP_TYPE : key === "ITComponent" ? ITC_TYPE : undefined,
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    consumedConfig = { view: "table", extraColumns: ["alias"] };
    renderCost();
    await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: "Alias" })).toBeInTheDocument();
    await userEvent.click(typeButton("IT Component"));
    await userEvent.click(typeButton("Application"));
    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: "Alias" })).not.toBeInTheDocument(),
    );
  });
});

describe("CostReport trend chart", () => {
  const ready = async () => {
    consumedConfig = { view: "chart" };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
  };
  // From the current year, one step: the forecast is next, FY25 is previous.
  const pickYear = async (name: string) => {
    await yearSlider();
    await (name.includes("Forecast") ? nextYear() : prevYear());
  };
  const yearText = () => screen.getByRole("slider", { name: "Fiscal year" });

  it("chart hidden on Current and on a past year", async () => {
    await ready();
    expect(screen.queryByTestId("cost-trend-chart")).not.toBeInTheDocument();
    await pickYear("FY25");
    await waitFor(() =>
      expect(yearText()).toHaveAttribute("aria-valuetext", "FY25"),
    );
    expect(screen.queryByTestId("cost-trend-chart")).not.toBeInTheDocument();
  });

  it("chart shown on Forecast with the components, five past years oldest first", async () => {
    await ready();
    await pickYear("FY27 - Forecast");
    const trend = await screen.findByTestId("cost-trend-chart");
    expect(trend).toHaveAttribute("data-years", "2022,2023,2024,2025,2026,2027");
    expect(trend).toHaveAttribute("data-current", "2026");
    // A cost-item type stacks the catalogue's items in sort_order, archived ones included.
    expect(trend).toHaveAttribute("data-components", "licenses,support");
    expect(trend).toHaveAttribute("data-field", "costTotalAnnual");
  });

  it.each([
    ["chart", () => screen.getByRole("img", { name: "Cost Analysis" })],
    ["sankey", () => screen.getByTestId("cost-sankey-panel")],
    ["table", () => screen.getByRole("table")],
  ] as const)("renders the trend above the %s view", async (view, panel) => {
    consumedConfig = { view, fiscalYearParam: 2027 };
    renderCost();
    const trend = await screen.findByTestId("cost-trend-chart");
    await waitFor(() => expect(panel()).toBeInTheDocument());
    expect(trend.compareDocumentPosition(panel()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("labels the components from the report's catalogue labels, not the raw keys", async () => {
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path: string, ...rest: never[]) => {
      const r = (await base(path, ...rest)) as Record<string, unknown>;
      return path.startsWith("/reports/cost-treemap")
        ? {
            ...r,
            components: ["lic", "archivedItem"],
            item_labels: {
              lic: { label: "Licences", translations: { it: "Licenze" } },
              archivedItem: { label: "Legacy support", translations: {} },
            },
          }
        : r;
    });
    await ready();
    await pickYear("FY27 - Forecast");
    const trend = await screen.findByTestId("cost-trend-chart");
    // The catalogue (not the response's components) decides the bars; its labels name them.
    expect(trend).toHaveAttribute("data-labels", "Licenses,Support");
  });

  it("chart hidden when the catalogue is empty and the response carries no components", async () => {
    const baseCat = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path: string, ...rest: never[]) =>
      path.startsWith("/metamodel/cost-item-types") ? ([] as never) : baseCat(path, ...rest),
    );
    const base = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path: string, ...rest: never[]) => {
      const r = (await base(path, ...rest)) as Record<string, unknown>;
      return path.startsWith("/reports/cost-treemap") ? { ...r, components: [] } : r;
    });
    await ready();
    await pickYear("FY27 - Forecast");
    await waitFor(() =>
      expect(yearText()).toHaveAttribute("aria-valuetext", "FY27 - Forecast"),
    );
    expect(screen.queryByTestId("cost-trend-chart")).not.toBeInTheDocument();
  });

  it("passes the group-by to the trend chart", async () => {
    const grouped = {
      ...APP_TYPE,
      fields_schema: [
        ...APP_TYPE.fields_schema,
        {
          section: "General",
          fields: [
            {
              key: "tier",
              label: "Tier",
              type: "single_select",
              options: [{ key: "gold", label: "Gold" }],
            },
          ],
        },
      ],
    };
    vi.mocked(useMetamodel).mockReturnValue({
      types: [grouped, ITC_TYPE],
      relationTypes: [],
      loading: false,
      getType: (key: string) => (key === "Application" ? grouped : undefined),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    consumedConfig = { view: "chart", fiscalYearParam: 2027, groupBy: "field:tier" };
    renderCost();
    await screen.findByTestId("cost-trend-chart");
    expect(screen.getByTestId("cost-trend-chart")).toHaveAttribute("data-group-by", "field:tier");
  });

  it("chart refetches when the card type changes", async () => {
    await ready();
    await pickYear("FY27 - Forecast");
    expect(await screen.findByTestId("cost-trend-chart")).toHaveAttribute("data-type", "Application");
    await userEvent.click(typeButton("IT Component"));
    await userEvent.click(typeButton("Application"));
    await waitFor(() =>
      expect(screen.getByTestId("cost-trend-chart")).toHaveAttribute("data-type", "ITComponent"),
    );
    expect(
      vi.mocked(api.get).mock.calls.some(
        ([p]) => String(p).startsWith("/reports/cost-treemap") && String(p).includes("type=ITComponent"),
      ),
    ).toBe(true);
  });

  it("treemap fills the panel in fullscreen and is 450 high otherwise", async () => {
    await ready();
    const style = () => echartState.last().style;
    expect(style()).toEqual({ height: 450 });
    const panel = screen.getByTestId("fullscreen-panel");
    Object.defineProperty(document, "fullscreenElement", { value: panel, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(style()).toEqual({ flex: 1, minHeight: 0 });
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(style()).toEqual({ height: 450 });
  });
});


describe("CostReport Sankey from per-card costs", () => {
  const NODES = [
    { id: "item:lic", name: "Licences", type: "CostItem" },
    { id: "item:host", name: "Hosting", type: "CostItem" },
    { id: "group:G", name: "G", type: "Group" },
    { id: "crm", name: "CRM", type: "Application", cost: 100, costs: { lic: 100 } },
    { id: "erp", name: "ERP", type: "Application", cost: 100, costs: { host: 100 } },
  ];
  const LINKS = [
    { source: 0, target: 2, value: 100 },
    { source: 1, target: 2, value: 100 },
    { source: 2, target: 3, value: 100 },
    { source: 2, target: 4, value: 100 },
  ];
  const mockSankey = (nodes = NODES, links = LINKS) =>
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({
          nodes,
          links,
          total: 200,
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
  type Seen = {
    nodes: { name: string }[];
    links: { source: number; target: number; value: number }[];
  };
  // The Sankey option names a node by its id; its label formatter maps back to the card's name.
  const sankeySeen = (): Seen => {
    const s = echartState.last().option.series[0];
    const ids: string[] = s.data.map((d: { name: string }) => d.name);
    return {
      // a card prints "Name · Type": the tests below read the name
      nodes: ids.map((id) => ({ name: s.label.formatter({ name: id }).replace(/ · .*$/, "") })),
      links: s.links.map((l: { source: string; target: string; value: number }) => ({
        source: ids.indexOf(l.source),
        target: ids.indexOf(l.target),
        value: l.value,
      })),
    };
  };
  const flow = (d: Seen, from: string, to: string) =>
    d.links.find((l) => d.nodes[l.source].name === from && d.nodes[l.target].name === to)?.value;

  it("re-sums the item -> group flows over the cards the scope keeps", async () => {
    consumedConfig = { view: "sankey", scopeIds: ["crm"] };
    mockSankey();
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    await waitFor(() => {
      const d = sankeySeen();
      expect(d.nodes.map((n) => n.name)).not.toContain("Hosting");
    });
    const d = sankeySeen();
    expect(d.links).toHaveLength(2);
    expect(flow(d, "Licences", "G")).toBe(100);
    expect(flow(d, "G", "CRM")).toBe(100);
  });

  it("names a cost item from the report's labels even when the schema does not know the key", async () => {
    consumedConfig = { view: "sankey" };
    await i18n.changeLanguage("it");
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({
          nodes: [
            { id: "item:lic", name: "lic", type: "CostItem" },
            { id: "item:old", name: "old", type: "CostItem" },
            { id: "crm", name: "CRM", type: "Application", cost: 150, costs: { lic: 100, old: 50 } },
          ],
          links: [
            { source: 0, target: 2, value: 100 },
            { source: 1, target: 2, value: 50 },
          ],
          total: 150,
          item_labels: {
            lic: { label: "Licences", translations: { it: "Licenze" } },
            old: { label: "Legacy", translations: {} },
          },
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    await waitFor(() => {
      const d = sankeySeen();
      expect(d.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(["Licenze", "Legacy"]));
    });
    expect(sankeySeen().nodes.map((n) => n.name)).not.toContain("lic");
    await i18n.changeLanguage("en");
  });

  it("keeps in = out for every group when unscoped", async () => {
    consumedConfig = { view: "sankey" };
    mockSankey();
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    const d = sankeySeen();
    const g = d.nodes.findIndex((n) => n.name === "G");
    const sum = (f: (l: Seen["links"][number]) => boolean) =>
      d.links.filter(f).reduce((n, l) => n + l.value, 0);
    expect(sum((l) => l.target === g)).toBe(sum((l) => l.source === g));
  });

  it("fills the summary tiles from the kept card nodes in Sankey view", async () => {
    consumedConfig = { view: "sankey" };
    mockSankey(
      [
        { id: "item:lic", name: "Licences", type: "CostItem" },
        { id: "crm", name: "CRM", type: "Application", cost: 100, costs: { lic: 100 } },
        { id: "erp", name: "ERP", type: "Application", cost: 50, costs: { lic: 50 } },
      ],
      [
        { source: 0, target: 1, value: 100 },
        { source: 0, target: 2, value: 50 },
      ],
    );
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    const tile = (label: string) =>
      screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
    expect(within(tile("Total Cost")).getByText("$150")).toBeInTheDocument();
    expect(within(tile("Items")).getByText("2")).toBeInTheDocument();
    expect(within(tile("Top Cost Driver")).getByText("CRM")).toBeInTheDocument();
  });
});

describe("CostReport cost-type selector", () => {
  it("shows the cost-type selector with TCO and the catalogue items", async () => {
    renderCost();
    const select = await screen.findByLabelText("Cost Field");
    await userEvent.click(select);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["TCO", "Licenses", "Support"]);
  });

  it("offers no Initiative type", async () => {
    renderCost();
    await screen.findByLabelText("Cost Field");
    expect(screen.queryByText("Initiative")).not.toBeInTheDocument();
  });

  it("printParams lists the cost type", async () => {
    renderCost();
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll(".report-print-params > *")).map(
        (n) => n.textContent,
      );
      expect(labels.join("|")).toContain("Cost Field");
    });
  });
});

describe("CostReport per-card breakdown request", () => {
  const sankeyCalls = () =>
    vi.mocked(api.get).mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith("/reports/cost-sankey"));

  it("fetches the TCO breakdown from the Sankey endpoint in the table view", async () => {
    consumedConfig = { view: "table" };
    renderCost();
    await waitFor(() => expect(sankeyCalls().length).toBeGreaterThan(0));
    expect(sankeyCalls()[0]).toContain("cost_field=costTotalAnnual");
    expect(sankeyCalls()[0]).toContain("type=Application");
  });

  it("does not fetch it in the treemap view before a drill", async () => {
    consumedConfig = { view: "chart" };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
    expect(sankeyCalls()).toHaveLength(0);
  });
});

describe("CostReport treemap colours, type badge and drill", () => {
  const TIER_FIELD = {
    section: "General",
    fields: [{ key: "tier", label: "Tier", type: "single_select", options: [{ key: "gold", label: "Gold" }] }],
  };
  const withTier = (tp: typeof APP_TYPE) => ({ ...tp, fields_schema: [...tp.fields_schema, TIER_FIELD] });
  const mockTierMetamodel = () => {
    const app = withTier(APP_TYPE);
    vi.mocked(useMetamodel).mockReturnValue({
      types: [app, withTier(ITC_TYPE)],
      relationTypes: [],
      loading: false,
      getType: (key: string) => (key === "Application" ? app : undefined),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
  };
  /** 10 one-card groups g1..g10, g1 the costliest. */
  const TEN = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i + 1}`,
    name: `Card ${i + 1}`,
    type: "Application",
    cost: 1000 - i * 10,
    group: `g${i + 1}`,
    attributes: {},
  }));
  const mockApi = (items: unknown[], sankeyNodes: unknown[] = []) =>
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-treemap"))
        return Promise.resolve({
          items,
          total: 1,
          components: ["licenses", "support"],
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({
          nodes: sankeyNodes,
          links: [],
          total: 1,
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      if (path.startsWith("/metamodel/cost-item-types")) return Promise.resolve(CATALOGUE) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
  const treemap = () => echartState.byName("Cost Analysis");
  const clickTile = (data: unknown) => act(() => treemap().onContextMenu!({ data }));
  const rightClickTile = (data: unknown) => act(() => treemap().onClick!({ data }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- option trees are plain JSON
  const series = (): any => treemap().option.series[0];
  const backButton = () => screen.queryByRole("button", { name: /back/i });

  it("right click on a tile drills into that card", async () => {
    mockApi(TEN, [{ id: "c1", name: "Card 1", type: "Application", cost: 1000, costs: { licenses: 700, support: 300 } }]);
    consumedConfig = { view: "chart" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    clickTile({ id: "c1" });
    expect(await screen.findByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });

  it("left click on a tile opens the side panel and does not drill", async () => {
    consumedConfig = { view: "chart" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    rightClickTile({ id: "erp" });
    expect(await screen.findByTestId("side-panel")).toHaveTextContent("erp");
    expect(backButton()).not.toBeInTheDocument();
  });

  it("drills a card to one tile per cost item, the rest merged into Other items", async () => {
    mockApi(TEN, [
      {
        id: "c1",
        name: "Card 1",
        type: "Application",
        cost: 1000,
        costs: { licenses: 500, support: 300, a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1 },
      },
    ]);
    consumedConfig = { view: "chart" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    clickTile({ id: "c1" });
    await waitFor(() => {
      const names = series().data.map((d: { name: string }) => d.name);
      expect(names).toEqual(["Licenses", "Support", "a", "b", "c", "d", "e", "f", "Other items"]);
    });
    const colours = series().data.map((d: { itemStyle: { color: string } }) => d.itemStyle.color);
    expect(colours.slice(0, 8)).toEqual([...CHART_CATEGORICAL.light]);
    expect(colours[8]).toBe(CHART_OTHER.light);
    // Item tiles carry no card id: clicking them is inert.
    expect(series().data.every((d: { id?: string }) => d.id === undefined)).toBe(true);
  });

  it("resets the drill when the cost type changes", async () => {
    mockApi(TEN, [{ id: "c1", name: "Card 1", type: "Application", cost: 1000, costs: { licenses: 1000 } }]);
    consumedConfig = { view: "chart" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    clickTile({ id: "c1" });
    await screen.findByRole("button", { name: /back/i });
    await userEvent.click(screen.getByLabelText("Cost Field"));
    await userEvent.click(await screen.findByRole("option", { name: "Licenses" }));
    await waitFor(() => expect(backButton()).not.toBeInTheDocument());
  });

  it("gives each group its hue by size, folds the 9th and later into Others, keeps Unspecified apart", async () => {
    mockTierMetamodel();
    mockApi([...TEN, { id: "u", name: "Loose", type: "Application", cost: 5, group: "__other__", attributes: {} }]);
    consumedConfig = { view: "chart", groupBy: "field:tier" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    await waitFor(() => expect(series().data.length).toBe(10));
    const frames = series().data as { key: string; name: string; value: number; itemStyle: { color: string } }[];
    expect(frames.map((f) => f.key)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "__others__", "__other__"]);
    expect(frames.slice(0, 8).map((f) => f.itemStyle.color)).toEqual([...CHART_CATEGORICAL.light]);
    expect(frames[8].value).toBe(920 + 910);
    expect(frames[8].itemStyle.color).toBe(CHART_OTHER.light);
    expect(frames[9].itemStyle.color).toBe(COST_UNSPECIFIED.light);
    expect(frames[9].name).toBe("Unspecified");
  });

  it("lists the groups, Others and Unspecified in a legend", async () => {
    mockTierMetamodel();
    mockApi([...TEN, { id: "u", name: "Loose", type: "Application", cost: 5, group: "__other__", attributes: {} }]);
    consumedConfig = { view: "chart", groupBy: "field:tier" };
    renderCost();
    const legend = await screen.findByTestId("cost-legend");
    expect(within(legend).getByText("g1")).toBeInTheDocument();
    expect(within(legend).getByText("Others (2 groups)")).toBeInTheDocument();
    expect(within(legend).getByText("Unspecified")).toBeInTheDocument();
    expect(within(legend).queryByText("g9")).not.toBeInTheDocument();
  });

  it("shows no legend when the report is not grouped", async () => {
    consumedConfig = { view: "chart" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    expect(screen.queryByTestId("cost-legend")).not.toBeInTheDocument();
  });

  it("clicking a card inside a folded group drills with group Others", async () => {
    mockTierMetamodel();
    mockApi(TEN);
    consumedConfig = { view: "chart", groupBy: "field:tier" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    await waitFor(() => expect(series().data.length).toBe(9));
    clickTile({ id: "c10" });
    expect(await screen.findByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.getByText("Others")).toBeInTheDocument();
  });

  it("clicking the Others frame drills into the folded members", async () => {
    mockTierMetamodel();
    mockApi(TEN);
    consumedConfig = { view: "chart", groupBy: "field:tier" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    await waitFor(() => expect(series().data.length).toBe(9));
    clickTile({ key: "__others__", name: "Others" });
    await waitFor(() => {
      const names = series().data.map((d: { name: string }) => d.name);
      expect(names).toEqual(["Card 9", "Card 10"]);
    });
  });

  it("shows the card type on every tile, Application and IT Component alike in the combined view", async () => {
    mockApi([
      { id: "a", name: "App", type: "Application", cost: 10, attributes: {} },
      { id: "i", name: "Comp", type: "ITComponent", cost: 5, attributes: {} },
    ]);
    consumedConfig = { view: "chart", cardTypeKey: "Application+ITComponent" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    await waitFor(() =>
      expect(series().data.map((d: { typeLabel?: string }) => d.typeLabel)).toEqual(["Application", "IT Component"]),
    );
  });

  it("colours an ungrouped tile by its name, the same on every render", async () => {
    consumedConfig = { view: "chart" };
    renderCost();
    await screen.findByRole("img", { name: "Cost Analysis" });
    await waitFor(() => expect(series().data.length).toBe(3));
    const erp = series().data.find((d: { name: string }) => d.name === "ERP");
    expect(erp.itemStyle.color).toBe(cardColor("ERP", CHART_CATEGORICAL.light));
  });
});

describe("CostReport Sankey colours, fold, drill and right click", () => {
  const TIER_FIELD = {
    section: "General",
    fields: [{ key: "tier", label: "Tier", type: "single_select", options: [{ key: "gold", label: "Gold" }] }],
  };
  const mockTierMetamodel = () => {
    const app = { ...APP_TYPE, fields_schema: [...APP_TYPE.fields_schema, TIER_FIELD] };
    vi.mocked(useMetamodel).mockReturnValue({
      types: [app, ITC_TYPE],
      relationTypes: [],
      loading: false,
      getType: (key: string) => (key === "Application" ? app : undefined),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
  };
  // g1..g10, one card each, g1 the costliest; c2 pays "host", the others "lic".
  const costOf = (i: number) => 1000 - (i - 1) * 10;
  const itemOf = (i: number) => (i === 2 ? "host" : "lic");
  const NODES = [
    { id: "item:lic", name: "Licences", type: "CostItem" },
    { id: "item:host", name: "Hosting", type: "CostItem" },
    ...Array.from({ length: 10 }, (_, k) => ({ id: `group:g${k + 1}`, name: `g${k + 1}`, type: "Group" })),
    ...Array.from({ length: 10 }, (_, k) => ({
      id: `c${k + 1}`,
      name: `Card ${k + 1}`,
      type: "Application",
      cost: costOf(k + 1),
      costs: { [itemOf(k + 1)]: costOf(k + 1) },
    })),
  ];
  const LINKS = [
    ...Array.from({ length: 10 }, (_, k) => ({
      source: itemOf(k + 1) === "lic" ? 0 : 1,
      target: 2 + k,
      value: costOf(k + 1),
    })),
    ...Array.from({ length: 10 }, (_, k) => ({ source: 2 + k, target: 12 + k, value: costOf(k + 1) })),
  ];
  const sankey = () => echartState.byName("Sankey chart view");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- option trees are plain JSON
  const series = (): any => sankey().option.series[0];
  const ids = (): string[] => series().data.map((d: { name: string }) => d.name);
  const linkValue = (from: string, to: string) =>
    series().links.find((l: { source: string; target: string }) => l.source === from && l.target === to)?.value;
  const backButton = () => screen.queryByRole("button", { name: /back/i });

  const open = async () => {
    mockTierMetamodel();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({
          nodes: NODES,
          links: LINKS,
          total: 1,
          fiscal_year: 2026,
          current_fiscal_year: 2026,
          fiscal_year_start: 1,
        }) as never;
      if (path.startsWith("/metamodel/cost-item-types")) return Promise.resolve(CATALOGUE) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
    consumedConfig = { view: "sankey", groupBy: "field:tier" };
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    await waitFor(() => expect(ids().length).toBeGreaterThan(0));
  };

  it("folds the groups beyond the 8th into one Others node with summed links in both directions", async () => {
    await open();
    expect(ids()).toContain("group:__others__");
    expect(ids()).not.toContain("group:g9");
    expect(ids()).not.toContain("group:g10");
    expect(linkValue("item:lic", "group:__others__")).toBe(920 + 910 - 0);
    expect(linkValue("group:__others__", "c9")).toBe(920);
    expect(linkValue("group:__others__", "c10")).toBe(910);
  });

  it("colours group nodes with the shared hues, Others grey, items neutral", async () => {
    await open();
    const colour = (id: string) =>
      series().data.find((d: { name: string }) => d.name === id).itemStyle.color;
    expect(colour("group:g1")).toBe(CHART_CATEGORICAL.light[0]);
    expect(colour("group:g8")).toBe(CHART_CATEGORICAL.light[7]);
    expect(colour("group:__others__")).toBe(CHART_OTHER.light);
    expect(colour("item:lic")).toBe(STATUS_COLORS.neutral);
    // a lone member keeps its group's hue
    expect(colour("c1")).toBe(CHART_CATEGORICAL.light[0]);
  });

  it("prints the card type on a card node", async () => {
    await open();
    expect(series().label.formatter({ name: "c1" })).toBe("Card 1 · Application");
  });

  it("right click on a group node drills into the group", async () => {
    await open();
    act(() => sankey().onContextMenu!({ dataType: "node", name: "group:g1" }));
    await waitFor(() => expect(backButton()).toBeInTheDocument());
    expect(ids().sort()).toEqual(["c1", "group:g1", "item:lic"]);
  });

  it("right click on a node of the Others group drills with group Others", async () => {
    await open();
    act(() => sankey().onContextMenu!({ dataType: "node", name: "group:__others__" }));
    await waitFor(() => expect(backButton()).toBeInTheDocument());
    expect(ids().sort()).toEqual(["c10", "c9", "group:__others__", "item:lic"]);
  });

  it("drilled card Sankey shows only that card and its items", async () => {
    await open();
    act(() => sankey().onContextMenu!({ dataType: "node", name: "c2" }));
    await waitFor(() => expect(ids().sort()).toEqual(["c2", "group:g2", "item:host"]));
    expect(linkValue("item:host", "group:g2")).toBe(990);
  });

  it("left click on a card opens the side panel", async () => {
    await open();
    act(() => sankey().onClick!({ dataType: "node", name: "c3" }));
    expect(await screen.findByTestId("side-panel")).toHaveTextContent("c3");
    expect(backButton()).not.toBeInTheDocument();
  });

  it("does nothing on a click on a cost-item node, an edge or a left click on a group", async () => {
    await open();
    act(() => sankey().onContextMenu!({ dataType: "node", name: "item:lic" }));
    act(() => sankey().onContextMenu!({ dataType: "edge", name: "item:lic > group:g1" }));
    act(() => sankey().onClick!({ dataType: "node", name: "group:g1" }));
    expect(backButton()).not.toBeInTheDocument();
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });
});

describe("CostReport table per-item columns, TCO and drill", () => {
  const TREEMAP: Record<string, { id: string; name: string; type: string; cost: number; attributes: object }[]> = {
    costTotalAnnual: [
      { id: "crm", name: "CRM", type: "Application", cost: 160, attributes: {} },
      { id: "crm-web", name: "CRM Web", type: "Application", cost: 20, attributes: {} },
      { id: "erp", name: "ERP", type: "Application", cost: 500, attributes: {} },
    ],
    support: [
      { id: "crm", name: "CRM", type: "Application", cost: 150, attributes: {} },
      { id: "erp", name: "ERP", type: "Application", cost: 100, attributes: {} },
    ],
  };
  const SANKEY_NODES = [
    { id: "crm", name: "CRM", type: "Application", cost: 160, costs: { licenses: 10, support: 150 } },
    { id: "crm-web", name: "CRM Web", type: "Application", cost: 20, costs: { licenses: 20 } },
    { id: "erp", name: "ERP", type: "Application", cost: 500, costs: { licenses: 400, support: 100 } },
  ];
  const mockTable = () =>
    vi.mocked(api.get).mockImplementation((path: string) => {
      const meta = { fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 };
      if (path.startsWith("/reports/cost-treemap")) {
        const field = new URL(path, "http://x").searchParams.get("cost_field") ?? "costTotalAnnual";
        const items = TREEMAP[field] ?? [];
        return Promise.resolve({ items, total: 1, components: ["licenses", "support"], ...meta }) as never;
      }
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({ nodes: SANKEY_NODES, links: [], total: 1, ...meta }) as never;
      if (path.startsWith("/metamodel/cost-item-types")) return Promise.resolve(CATALOGUE) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
  const bodyRows = () => screen.getAllByRole("row").slice(1, -1);
  const nameOf = (r: HTMLElement) => within(r).getByTestId("cost-row-name").textContent;
  const rowNamed = (name: string) => bodyRows().find((r) => nameOf(r) === name)!;
  const cellTexts = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

  it("shows a column per cost item and a TCO column equal to their sum", async () => {
    mockTable();
    consumedConfig = { view: "table" };
    renderCost();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(cellTexts(rowNamed("ERP"))[1]).toBe("$400"));
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Licenses", "Support", "TCO"]),
    );
    const [, lic, sup, tco] = cellTexts(rowNamed("ERP"));
    expect([lic, sup, tco]).toEqual(["$400", "$100", "$500"]);
    const [, clic, csup, ctco] = cellTexts(rowNamed("CRM Web"));
    expect([clic, csup, ctco]).toEqual(["$20", "$0", "$20"]);
  });

  it("names the card type in the name cell", async () => {
    mockTable();
    consumedConfig = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() => expect(rowNamed("ERP")).toHaveTextContent("Application"));
  });

  it("sorts by the TCO first and, when the cost type changes, by that column descending", async () => {
    mockTable();
    consumedConfig = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() => expect(bodyRows().map(nameOf)).toEqual(["ERP", "CRM", "CRM Web"]));
    await userEvent.click(screen.getByLabelText("Cost Field"));
    await userEvent.click(await screen.findByRole("option", { name: "Support" }));
    await waitFor(() => expect(bodyRows().map(nameOf)).toEqual(["CRM", "ERP"]));
  });

  it("row right click drills, left click opens the card", async () => {
    mockTable();
    consumedConfig = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() => expect(cellTexts(rowNamed("ERP"))[3]).toBe("$500"));
    fireEvent.click(rowNamed("ERP"));
    expect(await screen.findByTestId("side-panel")).toHaveTextContent("erp");
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
    const notPrevented = fireEvent.contextMenu(rowNamed("ERP"));
    expect(notPrevented).toBe(false);
    expect(await screen.findByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("a drilled card shows a single row", async () => {
    mockTable();
    consumedConfig = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() => expect(cellTexts(rowNamed("ERP"))[3]).toBe("$500"));
    fireEvent.contextMenu(rowNamed("ERP"));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(nameOf(bodyRows()[0])).toBe("ERP");
  });

  it("lists the folded groups under one Others header with its swatch", async () => {
    const app = {
      ...APP_TYPE,
      fields_schema: [
        ...APP_TYPE.fields_schema,
        {
          section: "General",
          fields: [{ key: "tier", label: "Tier", type: "single_select", options: [{ key: "gold", label: "Gold" }] }],
        },
      ],
    };
    vi.mocked(useMetamodel).mockReturnValue({
      types: [app, ITC_TYPE],
      relationTypes: [],
      loading: false,
      getType: (key: string) => (key === "Application" ? app : undefined),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
    const ten = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i + 1}`,
      name: `Card ${i + 1}`,
      type: "Application",
      cost: 1000 - i * 10,
      group: `g${i + 1}`,
      attributes: {},
    }));
    vi.mocked(api.get).mockImplementation((path: string) => {
      const meta = { fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 };
      if (path.startsWith("/reports/cost-treemap")) return Promise.resolve({ items: ten, total: 1, ...meta }) as never;
      if (path.startsWith("/reports/cost-sankey")) return Promise.resolve({ nodes: [], links: [], total: 1, ...meta }) as never;
      if (path.startsWith("/metamodel/cost-item-types")) return Promise.resolve(CATALOGUE) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
    consumedConfig = { view: "table", groupBy: "field:tier" };
    renderCost();
    await screen.findByRole("table");
    const swatch = await screen.findByTestId("cost-group-swatch-__others__");
    expect(swatch).toHaveStyle({ backgroundColor: CHART_OTHER.light });
    expect(screen.getByText(/Others \(2 groups\)/)).toBeInTheDocument();
    expect(screen.getByText("Card 10")).toBeInTheDocument();
    expect(screen.queryByText("g9")).not.toBeInTheDocument();
    expect(screen.getByTestId("cost-group-swatch-g1")).toHaveStyle({ backgroundColor: CHART_CATEGORICAL.light[0] });
  });
});

describe("CostReport review fixes", () => {
  const meta = { fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1 };
  const NODES = [
    { id: "item:lic", name: "Licences", type: "CostItem" },
    { id: "group:G", name: "G", type: "Group" },
    { id: "crm", name: "CRM", type: "Application", cost: 100, costs: { lic: 100 } },
    { id: "erp", name: "ERP", type: "Application", cost: 60, costs: { lic: 60 } },
  ];
  const LINKS = [
    { source: 0, target: 1, value: 160 },
    { source: 1, target: 2, value: 100 },
    { source: 1, target: 3, value: 60 },
  ];
  const mockSankeyOnly = () =>
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/reports/cost-sankey"))
        return Promise.resolve({ nodes: NODES, links: LINKS, total: 160, ...meta }) as never;
      if (path.startsWith("/metamodel/cost-item-types")) return Promise.resolve(CATALOGUE) as never;
      return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
    });
  const sankeyCalls = () =>
    vi.mocked(api.get).mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith("/reports/cost-sankey"));
  const withTier = (tp: typeof APP_TYPE) => ({
    ...tp,
    fields_schema: [
      ...tp.fields_schema,
      {
        section: "General",
        fields: [{ key: "tier", label: "Tier", type: "single_select", options: [{ key: "gold", label: "Gold" }] }],
      },
    ],
  });
  const mockTier = () => {
    const app = withTier(APP_TYPE);
    vi.mocked(useMetamodel).mockReturnValue({
      types: [app, withTier(ITC_TYPE)],
      relationTypes: [],
      loading: false,
      getType: (key: string) => (key === "Application" ? app : undefined),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    } as never);
  };
  const clickNode = (name: string) =>
    act(() => echartState.byName("Sankey chart view").onContextMenu!({ name, dataType: "node" }));

  it("hands the trend only the selected cost item", async () => {
    consumedConfig = { view: "table", costField: "support", fiscalYearParam: 2027 };
    renderCost();
    const trend = await screen.findByTestId("cost-trend-chart");
    expect(trend).toHaveAttribute("data-components", "support");
  });

  it("names a drilled card in the breadcrumb in the Sankey view", async () => {
    mockSankeyOnly();
    consumedConfig = { view: "sankey" };
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    await clickNode("crm");
    expect(await screen.findByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.getAllByText("CRM").length).toBeGreaterThan(0);
    expect(screen.queryByText("crm")).not.toBeInTheDocument();
  });

  it("requests no breakdown when a card is drilled in the Sankey view", async () => {
    mockSankeyOnly();
    consumedConfig = { view: "sankey" };
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    const before = sankeyCalls().length;
    await clickNode("crm");
    await screen.findByRole("button", { name: /back/i });
    expect(sankeyCalls()).toHaveLength(before);
  });

  it("flows a drilled card's own cost from the item to its group, not the group sum", async () => {
    mockTier();
    mockSankeyOnly();
    consumedConfig = { view: "sankey", groupBy: "field:tier" };
    renderCost();
    await screen.findByTestId("cost-sankey-panel");
    await clickNode("crm");
    await waitFor(() => {
      const links = echartState.byName("Sankey chart view").option.series[0].links;
      const l = links.find((x: { source: string; target: string }) => x.source === "item:lic" && x.target === "group:G");
      expect(l?.value).toBe(100);
    });
  });
});
