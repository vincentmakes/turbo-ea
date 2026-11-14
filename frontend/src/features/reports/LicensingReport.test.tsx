/**
 * The Licensing report page: request shape, metric cards, the trend above every view, the
 * Utilisation and By-license-type views and the drill. Charts are the shared test double.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import i18n from "@/i18n";
import { installResizeObserver } from "@/test/dom";
import LicensingReport from "./LicensingReport";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() }, isAbortError: () => false }));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
const auth = vi.hoisted(() => ({ permissions: {} as Record<string, boolean> }));
vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: { permissions: auth.permissions } }),
  useOptionalAuthUser: () => ({ permissions: auth.permissions }),
}));
vi.mock("./LicensingImportDialog", () => ({
  default: ({ open, onApplied }: { open: boolean; onApplied: () => void }) =>
    open ? <button onClick={onApplied}>mock-apply</button> : null,
}));
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean }) =>
    open ? <div data-testid="side-panel">{cardId}</div> : null,
}));
vi.mock("@/components/CardPicker", () => ({
  default: ({ onChange }: { onChange: (v: { id: string; name: string; type: string } | null) => void }) => (
    <button onClick={() => onChange({ id: "plat", name: "Plat", type: "Platform" })}>pick-platform</button>
  ),
}));
vi.mock("@/components/CardScopeFilter", () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange(["B"])}>scope-b</button>
  ),
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { echartState } from "@/test/echartMock";

const FIELDS = [
  {
    section: "General",
    fields: [
      { key: "owner", label: "Owner", type: "text" },
      { key: "seats", label: "Seats", type: "number" },
      { key: "extra", label: "Extension thing", type: "ext.demo.rating" },
    ],
  },
];
const APP_TYPE = { key: "Application", label: "Application", color: "#0f7eb5", is_hidden: false, has_hierarchy: false, fields_schema: FIELDS };
const ITC_TYPE = { key: "ITComponent", label: "IT Component", color: "#8e24aa", is_hidden: false, has_hierarchy: false, fields_schema: [] };

const cell = (licensed: number, actual: number | null, pct: number | null, status: string) => ({
  licensed, actual, pct, status, no_licence: false,
});
const ROW = (id: string, status: string, worst: number | null, by_type: Record<string, unknown>) => ({
  id, name: id, type: "Application", attributes: {}, status, worst_pct: worst, worst_no_licence: false,
  licensed_total: 10, actual_total: 5, by_type,
});
const ROWS = [
  ROW("A", "over", 120, { admin: cell(10, 12, 120, "over") }),
  ROW("B", "compliant", 50, { admin: cell(10, 5, 50, "compliant"), dev: cell(4, 1, 25, "compliant") }),
  ROW("C", "no_actual_data", null, { dev: cell(5, null, null, "no_data") }),
];
const YEARS = [2022, 2023, 2024, 2025, 2026, 2027];
const TREND = YEARS.map((fy) => ({
  fiscal_year: fy,
  cards: {
    A: { admin: { licensed: 10, actual: fy === 2027 ? null : 12 } },
    B: { admin: { licensed: 10, actual: fy === 2027 ? null : 5 } },
  },
}));
const LICENSE_TYPES = [
  { id: "1", key: "admin", label: "Admin", sort_order: 1, archived: false, translations: {} },
  { id: "2", key: "dev", label: "Dev", sort_order: 2, archived: false, translations: {} },
];
const report = (over = {}) => ({
  fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1, metric: "users", years: YEARS,
  license_types: LICENSE_TYPES, aggregate: null, rows: ROWS, trend: TREND, ...over,
});

const extra: { handlers: Record<string, (path: string) => Promise<unknown>> } = { handlers: {} };
const reportPaths = () =>
  vi.mocked(api.get).mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith("/reports/licensing"));

// The year slider measures its track with a ResizeObserver, which jsdom lacks.
let restoreResizeObserver: () => void;
afterEach(() => restoreResizeObserver());
beforeEach(async () => {
  restoreResizeObserver = installResizeObserver();
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  echartState.reset();
  localStorage.clear();
  extra.handlers = {};
  auth.permissions = {};
  vi.mocked(api.get).mockImplementation((path: string) => {
    const h = Object.entries(extra.handlers).find(([p]) => path.startsWith(p));
    if (h) return h[1](path) as never;
    if (path.startsWith("/reports/licensing")) {
      return Promise.resolve(
        path.includes("card_id=plat")
          ? report({ aggregate: { id: "plat", name: "Plat", type: "Platform" }, rows: ROWS.map((r) => ({ ...r, status: null })) })
          : report(),
      ) as never;
    }
    return Promise.resolve({
      items: ROWS.map((r) => ({ id: r.id, name: r.name, type: "Application", parent_id: null })),
      total: 3,
    }) as never;
  });
  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE, ITC_TYPE], relationTypes: [], loading: false, getType: () => undefined,
    getRelationsForType: () => [], invalidateCache: vi.fn(),
  } as never);
});

function renderReport(entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LicensingReport />
    </MemoryRouter>,
  );
}
const card = (label: string) => screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
const util = () => echartState.byName("Utilisation per card");
const trend = () => echartState.byName("Licensed and actual counts per fiscal year");
const trendBars = () => trend().option.series.filter((s: { type: string }) => s.type === "bar");

describe("LicensingReport", () => {
  it("requests /reports/licensing with type, metric and no fiscal_year by default", async () => {
    renderReport();
    await waitFor(() => expect(reportPaths()).toHaveLength(1));
    expect(reportPaths()[0]).toBe("/reports/licensing?type=Application&metric=users");
  });

  it("metric cards count statuses and follow the license type filter", async () => {
    renderReport();
    await waitFor(() => expect(card("Over-licensed")).toHaveTextContent("1"));
    expect(card("Compliant")).toHaveTextContent("1");
    expect(card("Approaching")).toHaveTextContent("0");
    expect(card("No actual data")).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("combobox", { name: "License type" }));
    await userEvent.click(await screen.findByRole("option", { name: "Dev" }));
    // Only B and C hold a Dev cell: B compliant, C no data.
    await waitFor(() => expect(card("Over-licensed")).toHaveTextContent("0"));
    expect(card("Compliant")).toHaveTextContent("1");
    expect(card("No actual data")).toHaveTextContent("1");
    expect(reportPaths()).toHaveLength(1);
  });

  describe("fiscal year row", () => {
    const slider = () => screen.findByRole("slider", { name: "Fiscal year" });

    it("the steps stop at the current year", async () => {
      renderReport();
      const s = await slider();
      expect(s).toHaveAttribute("aria-valuemin", "2022");
      expect(s).toHaveAttribute("aria-valuemax", "2026");
      expect(s).toHaveAttribute("aria-valuenow", "2026");
      expect(screen.getAllByText(/^FY\d\d$/).map((el) => el.textContent)).toEqual([
        "FY22", "FY23", "FY24", "FY25", "FY26",
      ]);
    });

    it("choosing a step changes the request year", async () => {
      renderReport();
      await slider();
      await userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
      await waitFor(() => expect(reportPaths().at(-1)).toContain("fiscal_year=2025"));
      await userEvent.click(screen.getByRole("button", { name: "Next fiscal year" }));
      await waitFor(() =>
        expect(reportPaths().at(-1)).toBe("/reports/licensing?type=Application&metric=users"),
      );
    });

    it("the drop-down and the chip are gone", async () => {
      renderReport();
      await slider();
      expect(screen.queryByRole("combobox", { name: "Fiscal year" })).toBeNull();
      expect(screen.queryByTestId("licensing-fiscal-year")).toBeNull();
    });

    it("a restored year outside the steps falls back", async () => {
      extra.handlers["/saved-reports/r1"] = () =>
        Promise.resolve({ id: "r1", name: "Mine", config: { fiscalYearParam: 2027 } });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().some((p) => p.includes("fiscal_year=2027"))).toBe(true));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?type=Application&metric=users"));
      expect(await slider()).toHaveAttribute("aria-valuenow", "2026");
    });

    it("the value text names the year the server served", async () => {
      // The default double answers fiscal_year 2026 whatever was asked.
      extra.handlers["/saved-reports/r1"] = () =>
        Promise.resolve({ id: "r1", name: "Mine", config: { fiscalYearParam: 2024 } });
      renderReport("/?saved_report_id=r1");
      const s = await slider();
      await waitFor(() => expect(s).toHaveAttribute("aria-valuenow", "2024"));
      expect(s).toHaveAttribute("aria-valuetext", "FY26 - Current");
    });

    it("an explicit pick is not silently reset to the current year when it fails", async () => {
      extra.handlers["/saved-reports/r1"] = () =>
        Promise.resolve({ id: "r1", name: "Mine", config: { fiscalYearParam: 2024 } });
      extra.handlers["/reports/licensing?type=Application&metric=users&fiscal_year=2023"] = () =>
        Promise.reject(new Error("400"));
      renderReport("/?saved_report_id=r1");
      await waitFor(() =>
        expect(reportPaths().some((p) => p.includes("fiscal_year=2024"))).toBe(true),
      );
      await slider();
      await userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
      await screen.findByText("Could not load the licensing report.");
      // Let any fallback effect run: a silent reset to the current year would refetch and clear the error.
      const n = reportPaths().length;
      await act(async () => {});
      await act(async () => {});
      expect(reportPaths().length).toBe(n);
      expect(screen.getByText("Could not load the licensing report.")).toBeInTheDocument();
      expect(reportPaths().at(-1)).toContain("fiscal_year=2023");
    });
  });

  it("shows the trend above the view, with the licensed marker", async () => {
    renderReport();
    await waitFor(() => expect(trendBars()).toHaveLength(1));
    expect(trendBars()[0].data).toEqual([17, 17, 17, 17, 17, 0]);
    const scatter = trend().option.series.find((s: { type: string }) => s.type === "scatter");
    expect(scatter.name).toBe("Licensed");
    expect(scatter.data).toEqual([20, 20, 20, 20, 20, 20]);
  });

  it("scope and drill re-sum the trend without a new request", async () => {
    renderReport();
    await waitFor(() => expect(trendBars()).toHaveLength(1));
    await userEvent.click(screen.getByText("scope-b"));
    await waitFor(() => expect(trendBars()[0].data[0]).toBe(5));
    act(() => util().onContextMenu?.({ data: { id: "B" } }));
    expect(trendBars()[0].data[0]).toBe(5);
    expect(reportPaths()).toHaveLength(1);
  });

  it("right click drills and Back climbs; left click opens the side panel", async () => {
    renderReport();
    await waitFor(() => expect(util().option.yAxis.data).toEqual(["A", "B", "C"]));
    act(() => util().onClick?.({ data: { id: "A" } }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("A");

    act(() => util().onContextMenu?.({ data: { id: "B" } }));
    await waitFor(() => expect(util().option.yAxis.data).toEqual(["B"]));
    expect(trendBars()[0].data[0]).toBe(5);
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    await waitFor(() => expect(util().option.yAxis.data).toHaveLength(3));
    expect(screen.getByText("Click: open card · Right click: analyse")).toBeInTheDocument();
  });

  it("by-type view sums the scope per license type and has no drill", async () => {
    renderReport();
    await waitFor(() => expect(reportPaths()).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "By license type" }));
    const bt = echartState.byName("Licensed and actual counts per license type");
    expect(bt.option.xAxis.data).toEqual(["Admin", "Dev"]);
    expect(bt.option.series[0].data.map((d: { value: number }) => d.value)).toEqual([20, 9]);
    expect(bt.option.series[1].data.map((d: { value: number }) => d.value)).toEqual([17, 1]);
    expect(bt.onContextMenu).toBeUndefined();
  });

  it("picking a Platform sends card_id, hides metric cards and resets the drill", async () => {
    renderReport();
    await waitFor(() => expect(util().option.yAxis.data).toHaveLength(3));
    act(() => util().onContextMenu?.({ data: { id: "B" } }));
    await waitFor(() => expect(util().option.yAxis.data).toEqual(["B"]));
    await userEvent.click(screen.getByRole("button", { name: "By license type" }));
    await userEvent.click(screen.getByText("pick-platform"));
    await waitFor(() => expect(reportPaths().some((p) => p.includes("card_id=plat"))).toBe(true));
    expect(screen.queryByText("Over-licensed")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Utilisation" }));
    await waitFor(() => expect(util().option.yAxis.data).toHaveLength(3));
  });

  describe("table view", () => {
    const toTable = () => userEvent.click(screen.getByRole("button", { name: "Table view" }));
    const rowNames = () => screen.getAllByTestId("licensing-row-name").map((n) => n.textContent);

    it("renders one row per card, left click opens, right click drills the trend", async () => {
      renderReport();
      await waitFor(() => expect(reportPaths()).toHaveLength(1));
      await toTable();
      expect(rowNames()).toEqual(["A", "B", "C"]);
      expect(screen.getByTestId("licensing-total-row")).toBeInTheDocument();
      const rowB = () => screen.getAllByTestId("licensing-row-name")[1];
      await userEvent.click(rowB());
      expect(screen.getByTestId("side-panel")).toHaveTextContent("B");
      await userEvent.pointer({ keys: "[MouseRight]", target: rowB() });
      await waitFor(() => expect(rowNames()).toEqual(["B"]));
      expect(trendBars()[0].data[0]).toBe(5);
    });

    it("Columns menu lists only built-in field types", async () => {
      renderReport();
      await waitFor(() => expect(reportPaths()).toHaveLength(1));
      expect(screen.queryByRole("combobox", { name: "Columns" })).toBeNull();
      await toTable();
      await userEvent.click(screen.getByRole("combobox", { name: "Columns" }));
      const names = within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((o) => o.textContent);
      expect(names).toEqual(["Owner", "Seats"]);
    });

    it("sorts by a header click and flips on a second click", async () => {
      renderReport();
      await waitFor(() => expect(reportPaths()).toHaveLength(1));
      await toTable();
      await userEvent.click(screen.getByText("Admin lic."));
      expect(rowNames()).toEqual(["C", "A", "B"]); // 0, 10, 10 ascending, ties keep order
      await userEvent.click(screen.getByText("Admin lic."));
      expect(rowNames()[2]).toBe("C");
    });
  });

  it("offers XLSX and not PPTX in the table view, PPTX in the chart views", async () => {
    renderReport();
    await waitFor(() => expect(reportPaths()).toHaveLength(1));
    const openMenu = async () => {
      await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
      await screen.findByText("Copy link");
    };
    await openMenu();
    expect(screen.getByText("Export to PowerPoint (.pptx)")).toBeInTheDocument();
    expect(screen.queryByText("Export to Excel (.xlsx)")).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Table view" }));
    await openMenu();
    expect(screen.getByText("Export to Excel (.xlsx)")).toBeInTheDocument();
    expect(screen.queryByText("Export to PowerPoint (.pptx)")).toBeNull();
  });

  it("states the type, metric and year in the print header", async () => {
    renderReport();
    await waitFor(() => expect(reportPaths()).toHaveLength(1));
    // The year label comes with the response, so wait for the content, not just the request.
    await waitFor(() => {
      const text = document.querySelector(".report-print-params")?.textContent ?? "";
      expect(text).toContain("Metric: Users");
      expect(text).toContain("Fiscal year: FY26 - Current");
    });
  });

  describe("saved reports", () => {
    const savedConfig = (config: Record<string, unknown>) => {
      extra.handlers["/saved-reports/r1"] = () => Promise.resolve({ id: "r1", name: "Mine", config });
    };

    it("persists and restores pickedCardId and the view through the saved config", async () => {
      extra.handlers["/cards/plat"] = () => Promise.resolve({ id: "plat", name: "Plat", type: "Platform" });
      savedConfig({ view: "bytype", pickedCardId: "plat", metric: "installations", fiscalYearParam: 2025 });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().some((p) => p.includes("card_id=plat"))).toBe(true));
      const p = reportPaths().find((x) => x.includes("card_id=plat")) as string;
      expect(p).toContain("metric=installations");
      expect(p).toContain("fiscal_year=2025");
      expect(screen.getByRole("button", { name: "By license type" })).toHaveAttribute("aria-pressed", "true");
    });

    it("auto-persists the keys of the saved config, the pick included", async () => {
      renderReport();
      await waitFor(() => expect(reportPaths()).toHaveLength(1));
      await userEvent.click(screen.getByRole("button", { name: "By license type" }));
      await userEvent.click(screen.getByText("pick-platform"));
      await waitFor(() => {
        const cfg = JSON.parse(localStorage.getItem("turboea-report:licensing") ?? "{}");
        expect(cfg).toEqual({
          cardTypeKey: "Application",
          metric: "users",
          licenseType: "",
          groupBy: "",
          view: "bytype",
          scopeIds: [],
          fiscalYearParam: null,
          pickedCardId: "plat",
          extraColumns: [],
          sortK: "name",
          sortD: "asc",
        });
      });
    });

    it("a pick made while the saved pick is still loading wins", async () => {
      let resolveSaved: (v: unknown) => void = () => {};
      extra.handlers["/cards/other"] = () => new Promise((r) => (resolveSaved = r));
      savedConfig({ view: "bytype", pickedCardId: "other" });
      renderReport("/?saved_report_id=r1");
      await userEvent.click(await screen.findByText("pick-platform"));
      await act(async () => {
        resolveSaved({ id: "other", name: "Other", type: "Application" });
      });
      await waitFor(() => expect(reportPaths().some((p) => p.includes("card_id=plat"))).toBe(true));
      expect(reportPaths().some((p) => p.includes("card_id=other"))).toBe(false);
    });

    it("a picked card that no longer exists is dropped without breaking the report", async () => {
      extra.handlers["/cards/gone"] = () => Promise.reject(new Error("404"));
      savedConfig({ view: "bytype", pickedCardId: "gone" });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([p]) => p === "/cards/gone")).toBe(true));
      await waitFor(() => expect(echartState.byName("Licensed and actual counts per license type")).toBeTruthy());
      expect(reportPaths().some((p) => p.includes("card_id"))).toBe(false);
    });

    it("a fiscal year no longer offered falls back to the current year", async () => {
      savedConfig({ fiscalYearParam: 2027 });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().some((p) => p.includes("fiscal_year=2027"))).toBe(true));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?type=Application&metric=users"));
    });

    it("a year the server refuses falls back to the current year", async () => {
      savedConfig({ fiscalYearParam: 2019 });
      extra.handlers["/reports/licensing?type=Application&metric=users&fiscal_year=2019"] = () =>
        Promise.reject(new Error("400"));
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().some((p) => p.includes("fiscal_year=2019"))).toBe(true));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?type=Application&metric=users"));
    });

    it("a license type the catalogue no longer has is cleared", async () => {
      savedConfig({ licenseType: "retired" });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(card("Over-licensed")).toHaveTextContent("1"));
      expect(screen.getByRole("combobox", { name: "License type" })).toHaveTextContent("All license types");
    });
  });

  describe("Import", () => {
    it("shows Import only with licenses.edit", async () => {
      const { unmount } = renderReport();
      await waitFor(() => expect(card("Over-licensed")).toHaveTextContent("1"));
      expect(screen.queryByRole("button", { name: /Import/ })).not.toBeInTheDocument();
      unmount();
      auth.permissions = { "licenses.edit": true };
      renderReport();
      expect(await screen.findByRole("button", { name: /Import/ })).toBeInTheDocument();
    });

    it("shows Import for the * permission", async () => {
      auth.permissions = { "*": true };
      renderReport();
      expect(await screen.findByRole("button", { name: /Import/ })).toBeInTheDocument();
    });

    it("reloads the report after an apply", async () => {
      auth.permissions = { "licenses.edit": true };
      renderReport();
      await waitFor(() => expect(reportPaths()).toHaveLength(1));
      await userEvent.click(await screen.findByRole("button", { name: /Import/ }));
      await userEvent.click(screen.getByRole("button", { name: "mock-apply" }));
      await waitFor(() => expect(reportPaths()).toHaveLength(2));
    });
  });
});
