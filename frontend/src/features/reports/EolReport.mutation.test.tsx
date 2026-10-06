/**
 * Behaviour the EOL report's other suites run through without asserting: the
 * exact KPI figures and alert wording, the timeline's year axis and its
 * centring on today, which rows carry which badge, the table's per-cell
 * placeholders, every sort (order and indicator), the print strip, and how a
 * saved configuration is restored, persisted and reset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadedConfig: null as unknown,
  savedReportName: null as string | null,
  saveDialogOpen: false,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  reportTypes: [] as string[],
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => {
    saved.reportTypes.push(reportType);
    return {
      savedReport: null,
      savedReportName: saved.savedReportName,
      saveDialogOpen: saved.saveDialogOpen,
      setSaveDialogOpen: saved.setSaveDialogOpen,
      loadedConfig: saved.loadedConfig,
      consumeConfig: () => saved.config,
      resetSavedReport: () => {},
      persistConfig: saved.persistConfig,
      resetAll: saved.resetAll,
      reportType,
    };
  },
}));
// The capture hook hands the report's "open the save dialog" callback back as
// the save action, so pressing Save shows what the report asked for.
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: (onCaptured: () => void) => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => onCaptured(),
  }),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
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
import { toIsoDate } from "@/lib/dates";
import EolReport from "./EolReport";

const DAY = 86400000;
const inDays = (n: number) => toIsoDate(new Date(Date.now() + n * DAY));

const TYPES = [
  makeCardType({ key: "ITComponent", label: "IT Component", color: "#d29270" }),
  makeCardType({ key: "Application", label: "Application", color: "#0f7eb5" }),
];

const item = (over: Record<string, unknown> & { id: string; name: string }) => ({
  type: "ITComponent",
  eol_product: null,
  eol_cycle: null,
  status: "supported",
  source: "api",
  cycle_data: null,
  lifecycle: {},
  affected_apps: [],
  ...over,
});

const ITEMS = [
  item({
    id: "nginx",
    name: "Nginx LB",
    eol_product: "nginx",
    eol_cycle: "1.25",
    status: "eol",
    cycle_data: { cycle: "1.25", releaseDate: "2018-01-01", eol: "2020-01-01", support: "2019-06-01", latest: "1.25.4" },
    affected_apps: [
      { id: "app-a", name: "Shop" },
      { id: "app-b", name: "Portal" },
    ],
  }),
  item({
    id: "pg",
    name: "Postgres",
    eol_product: "postgresql",
    eol_cycle: "12",
    status: "approaching",
    cycle_data: { eol: inDays(60), support: true },
    affected_apps: [{ id: "app-c", name: "Billing" }],
  }),
  item({
    id: "redis",
    name: "Redis",
    eol_product: "redis",
    eol_cycle: "7",
    status: "supported",
    cycle_data: { eol: inDays(800), support: false },
  }),
  item({
    id: "crm",
    name: "Legacy CRM",
    type: "Application",
    status: "approaching",
    source: "manual",
    cycle_data: { eol: inDays(10) },
  }),
  item({ id: "mystery", name: "Mystery", eol_product: "foo", eol_cycle: "1", status: "unknown" }),
  item({ id: "box", name: "Unknown Box", status: "missing", source: "none" }),
];

const SUMMARY = {
  eol: 1,
  approaching: 2,
  supported: 1,
  missing: 1,
  impacted_apps: 2,
  approaching_impacted_apps: 1,
  manual: 1,
};

const DEFAULTS = {
  view: "chart",
  filterStatus: "",
  filterType: "",
  filterSource: "",
  sortK: "status",
  sortD: "asc",
};

function ui() {
  return (
    <MemoryRouter>
      <EolReport />
    </MemoryRouter>
  );
}

function renderReport() {
  return render(ui());
}

function serve(items: unknown[], summary: Partial<typeof SUMMARY> = {}) {
  mockApi.on("get", "/reports/eol", { items, summary: { ...SUMMARY, ...summary } });
}

async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

/** The year labels along the timeline's axis, in order. */
async function axisYears(): Promise<string[]> {
  const today = await screen.findByText("Today");
  const axis = today.parentElement!.firstElementChild as HTMLElement;
  return Array.from(axis.children).map((c) => c.textContent ?? "");
}

const years = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/** The KPI tile showing `label`: its caption sits beside the figure. */
function kpiValue(label: string): string {
  const caption = screen
    .getAllByText(label)
    .find((el) => el.parentElement?.querySelector("h4"));
  if (!caption) throw new Error(`No KPI tile for ${label}`);
  return caption.parentElement!.querySelector("h4")!.textContent ?? "";
}

/** Each table row's cells' text, header excluded. */
function rows(): string[][] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent ?? ""));
}
const names = () => rows().map((r) => r[0]);
const rowOf = (name: string) => rows().find((r) => r[0] === name)!;

/** The print strip's parameters as `label: value` texts. */
function printParams(): string[] {
  const strip = document.querySelector(".report-print-params");
  if (!strip) return [];
  return Array.from(strip.children).map((c) => (c.textContent ?? "").replace(/\|$/, ""));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  saved.config = null;
  saved.loadedConfig = null;
  saved.savedReportName = null;
  saved.saveDialogOpen = false;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  saved.reportTypes = [];
  serve(ITEMS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("EolReport — loading and chrome", () => {
  it("fetches the report once and keeps its saved state under the eol report type", async () => {
    renderReport();
    expect(await screen.findByRole("heading", { name: "End-of-Life & Impact" })).toBeInTheDocument();
    expect(mockApi.callsOf("get").map((c) => c.path)).toEqual(["/reports/eol"]);
    expect(new Set(saved.reportTypes)).toEqual(new Set(["eol"]));
  });

  it("names a saved report it is showing", async () => {
    saved.savedReportName = "Q3 lifecycle review";
    renderReport();
    expect(await screen.findByText("Q3 lifecycle review")).toBeInTheDocument();
  });

  it("opens the save dialog once the thumbnail is captured", async () => {
    renderReport();
    fireEvent.click(await screen.findByRole("button", { name: /save report/i }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(true);
  });

  it("shows every KPI with its own figure", async () => {
    serve(ITEMS, {
      eol: 3,
      approaching: 4,
      supported: 5,
      impacted_apps: 6,
      manual: 7,
      missing: 8,
    });
    renderReport();
    await screen.findByText("Today");
    expect(kpiValue("End of Life")).toBe("3");
    expect(kpiValue("Approaching EOL")).toBe("4");
    expect(kpiValue("Supported")).toBe("5");
    expect(kpiValue("Impacted Apps")).toBe("6");
    expect(kpiValue("Manually Maintained")).toBe("7");
    expect(kpiValue("No EOL data")).toBe("8");
  });

  it("keys the legend by status, plus manual maintenance", async () => {
    renderReport();
    await screen.findByText("Today");
    const legend = document.querySelector(".report-legend") as HTMLElement;
    expect(Array.from(legend.querySelectorAll(".MuiTypography-caption")).map((e) => e.textContent)).toEqual([
      "End of Life",
      "Approaching EOL",
      "Supported",
      "Unknown",
      "No EOL data",
      "Manually Maintained",
    ]);
  });

  it("offers an 'all' choice and every status in the filters", async () => {
    renderReport();
    await screen.findByText("Today");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /^status$/i }));
    let listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All Statuses",
      "cancelEnd of Life",
      "warningApproaching EOL",
      "check_circleSupported",
      "helpUnknown",
      "event_busyNo EOL data",
    ]);
    fireEvent.click(within(listbox).getByRole("option", { name: "All Statuses" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /^type$/i }));
    listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")[0]).toHaveTextContent(/^All Types$/);
    fireEvent.click(within(listbox).getByRole("option", { name: "All Types" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /^source$/i }));
    listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")[0]).toHaveTextContent(/^All Sources$/);
  });
});

describe("EolReport — alerts", () => {
  it("uses the plural wording, with the count emphasised", async () => {
    serve(ITEMS, { eol: 3, approaching: 4, impacted_apps: 5, approaching_impacted_apps: 2 });
    renderReport();
    await screen.findByText("Today");
    const [error, warning] = screen.getAllByRole("alert");
    expect(error).toHaveTextContent("3 items have reached End of Life, impacting 5 application(s)");
    expect(within(error).getByText("3").tagName).toBe("STRONG");
    expect(warning).toHaveTextContent(
      "4 items are approaching End of Life within 6 months, impacting 2 additional application(s)",
    );
    expect(within(warning).getByText("4").tagName).toBe("STRONG");
  });

  it("raises no end-of-life alert when nothing has reached it", async () => {
    serve(ITEMS, { eol: 0, approaching: 2 });
    renderReport();
    await screen.findByText("Today");
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("2 items are approaching End of Life");
  });

  it("raises no approaching alert when nothing approaches", async () => {
    serve(ITEMS, { eol: 2, approaching: 0 });
    renderReport();
    await screen.findByText("Today");
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("2 items have reached End of Life");
  });
});

describe("EolReport — timeline axis", () => {
  it("spans from the earliest release to the latest support end, both years inclusive", async () => {
    serve([
      item({
        id: "a",
        name: "Alpha",
        eol_product: "alpha",
        eol_cycle: "1",
        // Local midnight on Jan 1, so the axis bounds fall exactly on a year.
        cycle_data: { releaseDate: "2000-01-01T00:00:00", support: "2041-01-01T00:00:00" },
      }),
    ]);
    renderReport();
    expect(await axisYears()).toEqual(years(2000, 2041));
  });

  it("pads half a year past the last end of life, and starts at the first full year", async () => {
    serve([
      item({
        id: "a",
        name: "Alpha",
        eol_product: "alpha",
        eol_cycle: "1",
        cycle_data: { releaseDate: "2000-06-15", eol: "2039-10-01", support: true },
      }),
    ]);
    renderReport();
    // 2039-10-01 + 180 days reaches into 2040; release mid-2000 leaves 2000 out.
    expect(await axisYears()).toEqual(years(2001, 2040));
  });

  it("spans two years either side of today when nothing is dated", async () => {
    serve([item({ id: "a", name: "Alpha", eol_product: "alpha", eol_cycle: "1", cycle_data: { cycle: "1" } })]);
    renderReport();
    const now = new Date().getFullYear();
    const axis = await axisYears();
    expect(axis).toContain(String(now));
    expect(axis).toContain(String(now + 1));
    expect(axis).not.toContain(String(now - 3));
    expect(axis).not.toContain(String(now + 3));
    expect(axis.every((y) => /^\d{4}$/.test(y))).toBe(true);
  });

  it("scrolls the timeline so today sits in the middle", async () => {
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(2000);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(400);
    serve([
      item({
        id: "a",
        name: "Alpha",
        eol_product: "alpha",
        eol_cycle: "1",
        cycle_data: { releaseDate: "2000-01-01T00:00:00", support: "2041-01-01T00:00:00" },
      }),
    ]);
    renderReport();
    const today = await screen.findByText("Today");
    const timeline = today.parentElement!.parentElement as HTMLElement;
    const start = new Date(2000, 0, 1).getTime();
    const end = new Date(2041, 0, 1).getTime();
    const expected = (2000 * (Date.now() - start)) / (end - start) - 200;
    await waitFor(() => expect(timeline.scrollLeft).toBeCloseTo(expected, 0));
  });
});

describe("EolReport — timeline rows", () => {
  it("badges only the manually maintained row and counts impact only where apps are affected", async () => {
    renderReport();
    await screen.findByText("Today");
    const badges = screen.getAllByLabelText(/End-of-Life date was manually maintained/);
    expect(badges).toHaveLength(1);
    const crmRow = screen.getByLabelText("Legacy CRM (manually maintained)").parentElement as HTMLElement;
    expect(crmRow).toContainElement(badges[0]);

    expect(screen.getAllByLabelText(/^Impacts \d+ apps?$/).map((e) => e.getAttribute("aria-label"))).toEqual([
      "Impacts 2 apps",
      "Impacts 1 app",
    ]);
    // Only rows that can expand carry the disclosure arrow.
    expect(screen.getAllByText("expand_more")).toHaveLength(2);
    expect(screen.queryByText("expand_less")).not.toBeInTheDocument();
  });

  it("labels each API bar with its product and version", async () => {
    renderReport();
    await screen.findByText("Today");
    expect(screen.getByText("nginx 1.25")).toBeInTheDocument();
    expect(screen.getByText("postgresql 12")).toBeInTheDocument();
    expect(screen.getByText("foo 1")).toBeInTheDocument();
  });

  it("keeps a bar-side row for every app an expanded product lists", async () => {
    renderReport();
    await screen.findByText("Today");
    const nameRow = () => screen.getByLabelText("Nginx LB (nginx 1.25)").parentElement!.parentElement as HTMLElement;
    const barRow = () =>
      screen.getByLabelText(/^nginx 1\.25 · EOL/).parentElement!.parentElement!.parentElement as HTMLElement;
    const redisBarRow = () =>
      screen.getByLabelText(/^redis 7 · EOL/).parentElement!.parentElement!.parentElement as HTMLElement;
    expect(nameRow().children).toHaveLength(1);
    expect(barRow().children).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Nginx LB (nginx 1.25)"));
    expect(await screen.findByText("Shop")).toBeInTheDocument();
    expect(nameRow().children).toHaveLength(3);
    expect(barRow().children).toHaveLength(3);
    expect(redisBarRow().children).toHaveLength(1);
    expect(screen.getAllByText("expand_less")).toHaveLength(1);
    expect(screen.getAllByText("expand_more")).toHaveLength(1);
  });

  it("closes the side panel it opened", async () => {
    renderReport();
    await screen.findByText("Today");
    fireEvent.click(screen.getByLabelText(/^redis 7 · EOL/));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("redis");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    await waitFor(() => expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument());
  });

  it("draws a card whose type the metamodel does not know", async () => {
    serve([item({ id: "srv", name: "Mainframe", type: "Server", eol_product: "zos", eol_cycle: "2" })]);
    renderReport();
    expect(await screen.findByLabelText("Mainframe (zos 2)")).toBeInTheDocument();
  });
});

describe("EolReport — countdowns", () => {
  const countdown = (name: string) => rowOf(name)[6].replace(/^[^(]*/, "");
  const shape = (s: string) => s.replace(/\d+(\.\d+)?/g, "N");

  it("words today, 30 days and a year like the unit they belong to", async () => {
    saved.config = { view: "table" };
    serve([
      item({ id: "past", name: "Past", cycle_data: { eol: inDays(-40) } }),
      item({ id: "today", name: "Today item", cycle_data: { eol: inDays(0) } }),
      item({ id: "d30", name: "In 30", cycle_data: { eol: inDays(30) } }),
      item({ id: "d90", name: "In 90", cycle_data: { eol: inDays(90) } }),
      item({ id: "d365", name: "In 365", cycle_data: { eol: inDays(365) } }),
      item({ id: "d400", name: "In 400", cycle_data: { eol: inDays(400) } }),
    ]);
    renderReport();
    await screen.findByRole("table");
    expect(countdown("Today item")).toMatch(/^\(0\D/);
    expect(shape(countdown("Today item"))).toBe(shape(countdown("Past")));
    // A month from now already counts in months, a year from now in years.
    expect(shape(countdown("In 30"))).toBe(shape(countdown("In 90")));
    expect(shape(countdown("In 365"))).toBe(shape(countdown("In 400")));
  });

  it("shows a dash and no countdown for an end-of-life date it cannot read", async () => {
    saved.config = { view: "table" };
    serve([item({ id: "odd", name: "Oddity", eol_product: "odd", eol_cycle: "1", cycle_data: { eol: "n/a" } })]);
    renderReport();
    await screen.findByRole("table");
    expect(rowOf("Oddity")[6]).toBe("—");
  });
});

describe("EolReport — table cells", () => {
  it("names the columns and fills every gap with a dash", async () => {
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Name",
      "Type",
      "Product",
      "Version",
      "Source",
      "Status",
      "EOL Date",
      "Support Until",
      "Latest",
      "Impact",
    ]);

    const nginx = rowOf("Nginx LB");
    expect(nginx.slice(1, 4)).toEqual(["IT Component", "nginx", "1.25"]);
    expect(rowOf("Legacy CRM")[1]).toBe("Application");

    const box = rowOf("Unknown Box");
    // product, version, EOL date, support, latest, impact
    expect([box[2], box[3], box[6], box[7], box[8], box[9]]).toEqual(["—", "—", "—", "—", "—", "—"]);
    expect(rowOf("Redis")[9]).toBe("—");
    expect(rowOf("Redis")[8]).toBe("—");
  });

  it("falls back to the raw type key for a type the metamodel does not know", async () => {
    saved.config = { view: "table" };
    serve([item({ id: "srv", name: "Mainframe", type: "Server", eol_product: "zos", eol_cycle: "2" })]);
    renderReport();
    await screen.findByRole("table");
    expect(rowOf("Mainframe")[1]).toBe("Server");
  });
});

describe("EolReport — sorting", () => {
  const COLUMNS = ["Name", "Type", "Product", "Source", "EOL Date", "Impact", "Status"];
  const sortButton = (label: string) => screen.getByRole("button", { name: label });

  function expectActive(label: string, direction: "Asc" | "Desc") {
    for (const col of COLUMNS) {
      const btn = sortButton(col);
      if (col === label) {
        expect(btn).toHaveClass("Mui-active");
        expect(btn).toHaveClass(`MuiTableSortLabel-direction${direction}`);
      } else {
        expect(btn).not.toHaveClass("Mui-active");
        expect(btn).toHaveClass("MuiTableSortLabel-directionAsc");
      }
    }
  }

  it("marks the sorted column and its direction", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    expectActive("Status", "Asc");
    for (const col of COLUMNS) {
      await user.click(sortButton(col));
      expectActive(col, "Asc");
      await user.click(sortButton(col));
      expectActive(col, "Desc");
    }
  });

  it("flips back to ascending on a third press", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    await user.click(sortButton("Name"));
    await user.click(sortButton("Name"));
    await waitFor(() => expect(saved.persistConfig).toHaveBeenLastCalledWith({ ...DEFAULTS, view: "table", sortK: "name", sortD: "desc" }));
    await user.click(sortButton("Name"));
    expect(names()[0]).toBe("Legacy CRM");
    await waitFor(() => expect(saved.persistConfig).toHaveBeenLastCalledWith({ ...DEFAULTS, view: "table", sortK: "name", sortD: "asc" }));
  });

  it("orders by product with unnamed products first", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    await user.click(sortButton("Product"));
    expect(names()).toEqual(["Legacy CRM", "Unknown Box", "Mystery", "Nginx LB", "Postgres", "Redis"]);
  });

  it("orders by end-of-life date with undated rows last, both ways", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    await user.click(sortButton("EOL Date"));
    expect(names()).toEqual(["Nginx LB", "Legacy CRM", "Postgres", "Redis", "Mystery", "Unknown Box"]);
    await user.click(sortButton("EOL Date"));
    expect(names()).toEqual(["Mystery", "Unknown Box", "Redis", "Postgres", "Legacy CRM", "Nginx LB"]);
  });

  it("orders by impact both ways", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    await user.click(sortButton("Impact"));
    expect(names()).toEqual(["Redis", "Legacy CRM", "Mystery", "Unknown Box", "Postgres", "Nginx LB"]);
    await user.click(sortButton("Impact"));
    expect(names()).toEqual(["Nginx LB", "Postgres", "Redis", "Legacy CRM", "Mystery", "Unknown Box"]);
  });

  it("keeps the served order for a saved sort it does not know", async () => {
    saved.config = { view: "table", sortK: "bogus" };
    renderReport();
    await screen.findByRole("table");
    expect(names()).toEqual(["Nginx LB", "Postgres", "Redis", "Legacy CRM", "Mystery", "Unknown Box"]);
  });
});

describe("EolReport — print strip", () => {
  it("is empty for the default chart", async () => {
    renderReport();
    await screen.findByText("Today");
    expect(printParams()).toEqual([]);
  });

  it("names each active filter and the table view", async () => {
    saved.config = { view: "table", filterStatus: "eol", filterType: "Application", filterSource: "manual" };
    renderReport();
    await screen.findByText("No items match the current filters.");
    expect(printParams()).toEqual([
      "Status: End of Life",
      "Type: Application",
      "Source: Manual",
      "View: Table",
    ]);
  });
});

describe("EolReport — saved configuration", () => {
  it("restores only what the saved configuration carries", async () => {
    saved.config = { sortK: "name" };
    renderReport();
    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await waitFor(() => expect(saved.persistConfig).toHaveBeenLastCalledWith({ ...DEFAULTS, sortK: "name" }));
  });

  it("restores a view without touching the filters", async () => {
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    await waitFor(() => expect(saved.persistConfig).toHaveBeenLastCalledWith({ ...DEFAULTS, view: "table" }));
  });

  it("applies a saved report loaded after the page opened", async () => {
    const { rerender } = renderReport();
    await screen.findByText("Today");
    saved.loadedConfig = { id: "r1" };
    saved.config = { view: "table" };
    rerender(ui());
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("persists each change as it is made", async () => {
    renderReport();
    await screen.findByText("Today");
    await pick(/^source$/i, /endoflife\.date/);
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith({ ...DEFAULTS, filterSource: "api" }),
    );
  });

  it("collapses an expanded product on reset", async () => {
    renderReport();
    await screen.findByText("Today");
    fireEvent.click(screen.getByLabelText("Nginx LB (nginx 1.25)"));
    expect(await screen.findByText("Shop")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(screen.queryByText("Shop")).not.toBeInTheDocument());
  });

  it("resets through the saved-report state of the current render", async () => {
    renderReport();
    await screen.findByText("Today");
    const first = saved.resetAll;
    const current = vi.fn();
    saved.resetAll = current;
    await pick(/^source$/i, /endoflife\.date/);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(current).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});
