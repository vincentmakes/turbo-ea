/**
 * The Licensing report page: request shape, the card-type toggles, the metric and license-type
 * selects, the status tiles, the list of collapsible card rows, a pair's history, the Table and
 * the saved-report round trip. Charts are the shared test double.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import i18n from "@/i18n";
import { installResizeObserver } from "@/test/dom";
import { isHiddenInPrint } from "@/test/hiddenInPrint";
import type { LicenseMetricItem } from "@/types";
import LicensingReport from "./LicensingReport";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() }, isAbortError: () => false }));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
const auth = vi.hoisted(() => ({ permissions: {} as Record<string, boolean> }));
vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: { permissions: auth.permissions } }),
  useOptionalAuthUser: () => ({ permissions: auth.permissions }),
}));
const catalogue = vi.hoisted(() => ({
  state: { metrics: [] as unknown[], loading: false, failed: false, reload: () => {} },
}));
vi.mock("@/hooks/useLicenseCatalogue", () => ({ useLicenseCatalogue: () => catalogue.state }));
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
const APP_TYPE = { key: "Application", label: "Application", icon: "apps", color: "#0f7eb5", is_hidden: false, has_hierarchy: false, fields_schema: FIELDS };
const ITC_TYPE = { key: "ITComponent", label: "IT Component", icon: "memory", color: "#8e24aa", is_hidden: false, has_hierarchy: false, fields_schema: [] };

const tp = (metric: string, key: string, label: string, sort: number, archived = false) => ({
  id: `${metric}-${key}`,
  metric_key: metric,
  key,
  label,
  sort_order: sort,
  archived,
  translations: {},
});
const CATALOGUE: LicenseMetricItem[] = [
  { id: "u", key: "users", label: "Users", sort_order: 1, archived: false, translations: {}, types: [tp("users", "admin", "Admin", 1), tp("users", "dev", "Dev", 2), tp("users", "old", "Old", 3, true)] },
  { id: "i", key: "installations", label: "Installations", sort_order: 2, archived: false, translations: {}, types: [tp("installations", "prod", "Prod", 1)] },
  { id: "c", key: "cores", label: "Cores", sort_order: 3, archived: true, translations: {}, types: [tp("cores", "xeon", "Xeon", 1)] },
];

const cell = (key: string, licensed: number, actual: number | null, pct: number | null, status: string) => ({
  key, licensed, actual, pct, status, no_licence: false,
});
const metric = (key: string, status: string, types: ReturnType<typeof cell>[]) => ({
  metric: key,
  status,
  worst_pct: null,
  licensed_total: types.reduce((n, c) => n + c.licensed, 0),
  actual_total: types.some((c) => c.actual != null) ? types.reduce((n, c) => n + (c.actual ?? 0), 0) : null,
  types,
});
const NAMES: Record<string, string> = { A: "Alpha", B: "Beta", C: "Gamma", D: "Delta" };
const ROW = (id: string, status: string | null, by_metric: unknown[], extra = {}) => ({
  id, name: NAMES[id], type: "Application", alias: null, attributes: {}, status, worst_pct: null,
  worst_no_licence: false, by_metric, ...extra,
});
const ROWS = [
  ROW("A", "over", [metric("users", "over", [cell("admin", 10, 12, 120, "over")])], { alias: "ALP" }),
  ROW("B", "compliant", [metric("users", "compliant", [cell("admin", 10, 5, 50, "compliant"), cell("dev", 4, 1, 25, "compliant")])]),
  ROW("C", "no_actual_data", [metric("installations", "no_actual_data", [cell("prod", 5, null, null, "no_data")])]),
  ROW("D", "no_actual_data", []),
];
const YEARS = [2022, 2023, 2024, 2025, 2026, 2027];
const report = (over = {}) => ({
  fiscal_year: 2026, current_fiscal_year: 2026, fiscal_year_start: 1, years: YEARS,
  aggregate: null, rows: ROWS, metrics_in_year: ["users", "installations"],
  types_in_year: ["installations:prod", "users:admin", "users:dev"], ...over,
});
const cardLicenses = {
  can_edit: false,
  years: YEARS.map((fy) => ({
    fiscal_year: fy, is_current: fy === 2026, is_forecast: fy === 2027, confirmed: true,
    fallback_from: null, status: "over",
    metrics: [{ ...metric("users", "over", [cell("admin", 10, fy === 2027 ? null : 12, 120, "over")]), has_actual: true }],
  })),
};

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
  catalogue.state = { metrics: CATALOGUE, loading: false, failed: false, reload: () => {} };
  vi.mocked(api.get).mockImplementation((path: string) => {
    const h = Object.entries(extra.handlers).find(([p]) => path.startsWith(p));
    if (h) return h[1](path) as never;
    if (path.startsWith("/reports/licensing")) {
      const q = new URLSearchParams(path.split("?")[1]);
      if (q.get("card_id") === "plat")
        return Promise.resolve(report({ aggregate: { id: "plat", name: "Plat", type: "Platform" }, rows: ROWS.map((r) => ({ ...r, status: null })) })) as never;
      // The server keeps only the cards that have a pair of the selection.
      const m = q.get("metric");
      const rows = m ? ROWS.filter((r) => r.by_metric.some((x) => (x as { metric: string }).metric === m)) : ROWS;
      return Promise.resolve(report({ rows })) as never;
    }
    if (path === "/cards/A/licenses") return Promise.resolve(cardLicenses) as never;
    return Promise.resolve({ items: [], total: 0 }) as never;
  });
  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE, ITC_TYPE], relationTypes: [], loading: false,
    getType: (k: string) => [APP_TYPE, ITC_TYPE].find((x) => x.key === k),
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
const tile = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}: \\d+$`) });
const rowHeader = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const rowNames = () =>
  screen.getAllByRole("button", { name: /(Over-licensed|Compliant|Approaching|No actual data)$/ })
    .filter((b) => b.hasAttribute("aria-expanded"))
    .map((b) => b.textContent?.match(/(Alpha|Beta|Gamma|Delta)/)?.[0]);
const loaded = () => screen.findByRole("button", { name: /^Alpha/ });
const optionsOf = async (name: string) => {
  await userEvent.click(screen.getByRole("combobox", { name }));
  const list = await screen.findByRole("listbox");
  const out = within(list).getAllByRole("option").map((o) => o.textContent);
  await userEvent.keyboard("{Escape}");
  return out;
};

describe("LicensingReport", () => {
  it("requests /reports/licensing with card_types only by default and draws no chart", async () => {
    renderReport();
    await loaded();
    expect(reportPaths()).toEqual(["/reports/licensing?card_types=Application"]);
    expect(echartState.props).toHaveLength(0);
  });

  it("one row per card, the status tiles count the rows", async () => {
    renderReport();
    await loaded();
    expect(rowNames()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(tile("Over-licensed")).toHaveTextContent("1");
    expect(tile("Compliant")).toHaveTextContent("1");
    expect(tile("Approaching")).toHaveTextContent("0");
    // C has a cell with no actual, D has no pair at all.
    expect(tile("No actual data")).toHaveTextContent("2");
  });

  describe("tiles", () => {
    it("a click keeps the rows of that status and dims the other tiles, a second click clears", async () => {
      renderReport();
      await loaded();
      await userEvent.click(tile("No actual data"));
      expect(rowNames()).toEqual(["Gamma", "Delta"]);
      expect(tile("No actual data")).toHaveAttribute("aria-pressed", "true");
      expect(tile("Over-licensed")).toHaveStyle({ opacity: "0.4" });
      expect(tile("No actual data")).toHaveStyle({ opacity: "1" });
      // The counts are of the whole list, not of what is left.
      expect(tile("Over-licensed")).toHaveTextContent("1");
      await userEvent.click(tile("No actual data"));
      expect(rowNames()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
      expect(tile("Over-licensed")).toHaveStyle({ opacity: "1" });
    });

    it("the tiles work from the keyboard", async () => {
      renderReport();
      await loaded();
      tile("Over-licensed").focus();
      await userEvent.keyboard("{Enter}");
      expect(rowNames()).toEqual(["Alpha"]);
      await userEvent.keyboard(" ");
      expect(rowNames()).toHaveLength(4);
    });

    it("a Platform selection shows no tiles and sends card_id", async () => {
      renderReport();
      await loaded();
      await userEvent.click(tile("Over-licensed"));
      await userEvent.click(screen.getByText("pick-platform"));
      await waitFor(() => expect(reportPaths().some((p) => p.includes("card_id=plat"))).toBe(true));
      expect(await screen.findByText("Totals of the Applications and IT Components linked to Plat")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Over-licensed: / })).toBeNull();
      // The status filter does not hide the Platform's rows, which carry no status.
      expect(screen.getAllByRole("button", { name: /^(Alpha|Beta|Gamma|Delta)/ })).toHaveLength(4);
    });
  });

  describe("a row", () => {
    it("expands to the card's pair bars", async () => {
      renderReport();
      await userEvent.click(await loaded());
      expect(echartState.byName("Licensed and actual counts per license type: Users")).toBeTruthy();
      expect(rowHeader("Alpha")).toHaveAttribute("aria-expanded", "true");
      await userEvent.click(rowHeader("Alpha"));
      expect(rowHeader("Alpha")).toHaveAttribute("aria-expanded", "false");
    });

    it("a pair click fetches the card's history and shows it below the list", async () => {
      renderReport();
      await userEvent.click(await loaded());
      expect(vi.mocked(api.get).mock.calls.some(([p]) => p === "/cards/A/licenses")).toBe(false);
      await userEvent.click(screen.getByRole("button", { name: /^Admin: / }));
      await waitFor(() => expect(echartState.byName("Licensed and actual counts per fiscal year: Users: Admin")).toBeTruthy());
      expect(echartState.byName("Licensed and actual counts per fiscal year: Users: Admin").option.xAxis.data).toHaveLength(6);
      // A second click closes it.
      await userEvent.click(screen.getByRole("button", { name: /^Admin: / }));
      expect(screen.queryByTestId("license-pair-history")).toBeNull();
    });

    it("collapsing the row closes its history", async () => {
      renderReport();
      await userEvent.click(await loaded());
      await userEvent.click(screen.getByRole("button", { name: /^Admin: / }));
      await screen.findByTestId("license-pair-history");
      await userEvent.click(rowHeader("Alpha"));
      expect(screen.queryByTestId("license-pair-history")).toBeNull();
    });

    it("a failed history says so", async () => {
      extra.handlers["/cards/A/licenses"] = () => Promise.reject(new Error("boom"));
      renderReport();
      await userEvent.click(await loaded());
      await userEvent.click(screen.getByRole("button", { name: /^Admin: / }));
      expect(await screen.findByText("Could not load the licenses of this card.")).toBeInTheDocument();
    });

    it("the open button opens the side panel", async () => {
      renderReport();
      await loaded();
      await userEvent.click(screen.getByRole("button", { name: "Open Beta" }));
      expect(screen.getByTestId("side-panel")).toHaveTextContent("B");
    });
  });

  describe("selects", () => {
    it("the card-type toggles: both on sends both, never none", async () => {
      renderReport();
      await loaded();
      const app = screen.getByRole("button", { name: "Application" });
      expect(app).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(app); // the only one on: stays on
      expect(app).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(screen.getByRole("button", { name: "IT Component" }));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?card_types=Application%2CITComponent"));
      expect(screen.queryByText("scope-b")).toBeNull();
    });

    it("the metric select lists All metrics and the active catalogue, an archived one only with data in the year", async () => {
      renderReport();
      await loaded();
      expect(await optionsOf("Metric")).toEqual(["All metrics", "Users", "Installations"]);
    });

    it("an archived metric the year has data for is offered, marked archived", async () => {
      extra.handlers["/reports/licensing"] = () =>
        Promise.resolve(report({ metrics_in_year: ["users", "cores"], types_in_year: ["cores:xeon", "users:admin"] }));
      renderReport();
      await loaded();
      expect(await optionsOf("Metric")).toEqual(["All metrics", "Users", "Installations", "Cores (archived)"]);
    });

    it("the license type select lists every type as `Metric: Type`, an archived one only with data", async () => {
      renderReport();
      await loaded();
      expect(await optionsOf("License type")).toEqual([
        "All license types", "Users: Admin", "Users: Dev", "Installations: Prod",
      ]);
    });

    it("an archived type the year has data for is offered", async () => {
      extra.handlers["/reports/licensing"] = () =>
        Promise.resolve(report({ types_in_year: ["users:admin", "users:old"] }));
      renderReport();
      await loaded();
      expect(await optionsOf("License type")).toContain("Users: Old (archived)");
    });

    it("a metric selected: the request carries it, the license types follow it and the card without a pair leaves", async () => {
      renderReport();
      await loaded();
      await userEvent.click(screen.getByRole("combobox", { name: "Metric" }));
      await userEvent.click(await screen.findByRole("option", { name: "Users" }));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?card_types=Application&metric=users"));
      await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Beta"]));
      expect(await optionsOf("License type")).toEqual(["All license types", "Users: Admin", "Users: Dev"]);
    });

    it("a license type selected is sent as the metric:type pair; changing the metric clears it", async () => {
      renderReport();
      await loaded();
      await userEvent.click(screen.getByRole("combobox", { name: "License type" }));
      await userEvent.click(await screen.findByRole("option", { name: "Installations: Prod" }));
      await waitFor(() => expect(reportPaths().at(-1)).toContain("license_type=installations%3Aprod"));
      await userEvent.click(screen.getByRole("combobox", { name: "Metric" }));
      await userEvent.click(await screen.findByRole("option", { name: "Users" }));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?card_types=Application&metric=users"));
      expect(screen.getByRole("combobox", { name: "License type" })).toHaveTextContent("All license types");
    });

    it("a saved archived metric the year has no data for falls back to All metrics, and is sent only until the response says so", async () => {
      extra.handlers["/saved-reports/r1"] = () =>
        Promise.resolve({ id: "r1", name: "Mine", config: { metric: "cores" } });
      renderReport("/?saved_report_id=r1");
      await loaded();
      await waitFor(() => expect(screen.getByRole("combobox", { name: "Metric" })).toHaveTextContent("All metrics"));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?card_types=Application"));
    });

    it("a saved archived metric the year has data for is kept and sent once the response says so", async () => {
      extra.handlers["/saved-reports/r1"] = () =>
        Promise.resolve({ id: "r1", name: "Mine", config: { metric: "cores" } });
      extra.handlers["/reports/licensing"] = () =>
        Promise.resolve(report({ metrics_in_year: ["users", "cores"] }));
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().at(-1)).toContain("metric=cores"));
      expect(screen.getByRole("combobox", { name: "Metric" })).toHaveTextContent("Cores (archived)");
    });
  });

  describe("the catalogue", () => {
    it("loading: a spinner and no rows", () => {
      catalogue.state = { metrics: [], loading: true, failed: false, reload: () => {} };
      renderReport();
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Alpha/ })).toBeNull();
    });

    it("failed: an error and no rows", () => {
      catalogue.state = { metrics: [], loading: false, failed: true, reload: () => {} };
      renderReport();
      expect(screen.getByRole("alert")).toHaveTextContent("Could not load the licensing report.");
      expect(screen.queryByRole("button", { name: /^Alpha/ })).toBeNull();
    });
  });

  describe("fiscal year row", () => {
    const slider = () => screen.findByRole("slider", { name: "Fiscal year" });

    it("the steps stop at the current year", async () => {
      renderReport();
      const s = await slider();
      expect(s).toHaveAttribute("aria-valuemin", "2022");
      expect(s).toHaveAttribute("aria-valuemax", "2026");
      expect(s).toHaveAttribute("aria-valuenow", "2026");
    });

    it("choosing a step changes the request year", async () => {
      renderReport();
      await slider();
      await userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
      await waitFor(() => expect(reportPaths().at(-1)).toContain("fiscal_year=2025"));
      await userEvent.click(screen.getByRole("button", { name: "Next fiscal year" }));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?card_types=Application"));
    });

    it("the year row is hidden in print (the year is in the print header)", async () => {
      renderReport();
      expect(isHiddenInPrint(await slider())).toBe(true);
    });

    it("a restored year outside the steps falls back", async () => {
      extra.handlers["/saved-reports/r1"] = () =>
        Promise.resolve({ id: "r1", name: "Mine", config: { fiscalYearParam: 2027 } });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().some((p) => p.includes("fiscal_year=2027"))).toBe(true));
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?card_types=Application"));
      expect(await slider()).toHaveAttribute("aria-valuenow", "2026");
    });

    it("an explicit pick is not silently reset to the current year when it fails", async () => {
      extra.handlers["/saved-reports/r1"] = () =>
        Promise.resolve({ id: "r1", name: "Mine", config: { fiscalYearParam: 2024 } });
      extra.handlers["/reports/licensing?card_types=Application&fiscal_year=2023"] = () =>
        Promise.reject(new Error("400"));
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().some((p) => p.includes("fiscal_year=2024"))).toBe(true));
      await slider();
      await userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
      await screen.findByText("Could not load the licensing report.");
      const n = reportPaths().length;
      await act(async () => {});
      await act(async () => {});
      expect(reportPaths().length).toBe(n);
      expect(reportPaths().at(-1)).toContain("fiscal_year=2023");
    });
  });

  describe("table view", () => {
    const toTable = () => userEvent.click(screen.getByRole("button", { name: "Table view" }));
    const tableNames = () => screen.getAllByTestId("licensing-row-name").map((n) => n.textContent);

    it("a column group per pair of the year and the totals of each metric, no cross-metric total", async () => {
      renderReport();
      await loaded();
      await toTable();
      const heads = [...document.querySelectorAll("thead th")].map((h) => h.textContent);
      expect(heads).toEqual([
        "Name",
        "Users: Admin lic.", "Users: Admin act.", "Users: Admin %",
        "Users: Dev lic.", "Users: Dev act.", "Users: Dev %",
        "Installations: Prod lic.", "Installations: Prod act.", "Installations: Prod %",
        "Users total lic.", "Users total act.", "Installations total lic.", "Installations total act.",
        "Status",
      ]);
      // Sorted by name.
      expect(tableNames()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
    });

    it("left click opens the side panel, right click drills", async () => {
      renderReport();
      await loaded();
      await toTable();
      const rowB = () => screen.getAllByTestId("licensing-row-name")[1];
      await userEvent.click(rowB());
      expect(screen.getByTestId("side-panel")).toHaveTextContent("B");
      await userEvent.pointer({ keys: "[MouseRight]", target: rowB() });
      await waitFor(() => expect(tableNames()).toEqual(["Beta"]));
    });

    it("the tiles filter the table too", async () => {
      renderReport();
      await loaded();
      await toTable();
      await userEvent.click(tile("Compliant"));
      expect(tableNames()).toEqual(["Beta"]);
    });

    it("Columns menu lists only built-in field types", async () => {
      renderReport();
      await loaded();
      expect(screen.queryByRole("combobox", { name: "Columns" })).toBeNull();
      await toTable();
      await userEvent.click(screen.getByRole("combobox", { name: "Columns" }));
      const names = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
      expect(names).toEqual(["Owner", "Seats"]);
    });
  });

  it("offers XLSX and not PPTX in the table view, PPTX in the list view", async () => {
    renderReport();
    await loaded();
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
    await loaded();
    await userEvent.click(screen.getByRole("combobox", { name: "Metric" }));
    await userEvent.click(await screen.findByRole("option", { name: "Users" }));
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

    it("restores the card types, metric, license type, picked card and view", async () => {
      extra.handlers["/cards/plat"] = () => Promise.resolve({ id: "plat", name: "Plat", type: "Platform" });
      savedConfig({
        cardTypeKey: "Application+ITComponent", view: "table", pickedCardId: "plat",
        metric: "users", licenseType: "users:admin", fiscalYearParam: 2025,
      });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().some((p) => p.includes("card_id=plat"))).toBe(true));
      const p = reportPaths().find((x) => x.includes("card_id=plat")) as string;
      expect(p).toContain("card_types=Application%2CITComponent");
      expect(p).toContain("metric=users");
      expect(p).toContain("license_type=users%3Aadmin");
      expect(p).toContain("fiscal_year=2025");
      expect(screen.getByRole("button", { name: "Table view" })).toHaveAttribute("aria-pressed", "true");
    });

    it("a view of the old shape (By license type) is ignored", async () => {
      savedConfig({ view: "bytype" });
      renderReport("/?saved_report_id=r1");
      await loaded();
      expect(screen.getByRole("button", { name: "Utilisation" })).toHaveAttribute("aria-pressed", "true");
    });

    it("auto-persists the keys of the saved config, the pick included", async () => {
      renderReport();
      await loaded();
      await userEvent.click(screen.getByText("pick-platform"));
      await waitFor(() => {
        const cfg = JSON.parse(localStorage.getItem("turboea-report:licensing") ?? "{}");
        expect(cfg).toEqual({
          cardTypeKey: "Application",
          metric: "",
          licenseType: "",
          groupBy: "",
          view: "chart",
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
      savedConfig({ pickedCardId: "other" });
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
      savedConfig({ pickedCardId: "gone" });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([p]) => p === "/cards/gone")).toBe(true));
      await loaded();
      expect(reportPaths().some((p) => p.includes("card_id"))).toBe(false);
    });

    it("a license type the year no longer has is cleared", async () => {
      savedConfig({ licenseType: "users:retired" });
      renderReport("/?saved_report_id=r1");
      await waitFor(() => expect(reportPaths().at(-1)).toBe("/reports/licensing?card_types=Application"));
      expect(screen.getByRole("combobox", { name: "License type" })).toHaveTextContent("All license types");
    });
  });

  describe("Import", () => {
    it("shows Import only with licenses.edit", async () => {
      const { unmount } = renderReport();
      await loaded();
      expect(screen.queryByRole("button", { name: /Import/ })).not.toBeInTheDocument();
      unmount();
      auth.permissions = { "licenses.edit": true };
      renderReport();
      expect(await screen.findByRole("button", { name: /Import/ })).toBeInTheDocument();
    });

    it("reloads the report after an apply", async () => {
      auth.permissions = { "licenses.edit": true };
      renderReport();
      await loaded();
      await userEvent.click(await screen.findByRole("button", { name: /Import/ }));
      await userEvent.click(screen.getByRole("button", { name: "mock-apply" }));
      await waitFor(() => expect(reportPaths()).toHaveLength(2));
    });
  });
});
