/**
 * The Licensing report's Table view: one header row (the XLSX export reads no colspan/rowspan),
 * a column group per `Metric: Type` pair, per-metric totals and no cross-metric total, sorting,
 * the cost report's click gestures and group headers.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
import type { LicenseReportMetric, LicenseReportRow } from "@/types";
import LicensingTable, { type LicensingTableRow } from "./LicensingTable";

const PAIRS = [
  { key: "users:admin", metric: "users", label: "Users: Admin" },
  { key: "users:dev", metric: "users", label: "Users: Dev" },
  { key: "installations:prod", metric: "installations", label: "Installations: Prod" },
];
const METRICS = [
  { key: "users", label: "Users" },
  { key: "installations", label: "Installations" },
];

const cell = (key: string, licensed: number, actual: number | null, pct: number | null, no_licence = false) => ({
  key,
  licensed,
  actual,
  pct,
  no_licence,
  status: "compliant" as const,
});
const metric = (
  key: string,
  licensed_total: number,
  actual_total: number | null,
  types: LicenseReportMetric["types"],
): LicenseReportMetric => ({ metric: key, status: "compliant", worst_pct: null, licensed_total, actual_total, types });
const raw = (id: string, by_metric: LicenseReportMetric[]): LicenseReportRow => ({
  id,
  name: id,
  type: "Application",
  alias: null,
  attributes: {},
  status: "compliant",
  worst_pct: null,
  worst_no_licence: false,
  confirmed: true,
  by_metric,
});
const ROWS: LicensingTableRow[] = [
  {
    id: "A",
    name: "Alpha",
    type: "Application",
    status: "over",
    group: "g1",
    raw: raw("A", [metric("users", 10, 15, [cell("admin", 10, 12, 120), cell("dev", 0, 3, null, true)])]),
  },
  {
    id: "B",
    name: "Beta",
    type: "Application",
    status: "compliant",
    group: "g2",
    raw: raw("B", [metric("users", 20, 5, [cell("admin", 20, 5, 25)])]),
  },
  {
    id: "C",
    name: "Gamma",
    type: "Application",
    status: "no_actual_data",
    group: "g1",
    raw: raw("C", [metric("installations", 4, null, [cell("prod", 4, null, null)])]),
  },
];

function setup(over: Partial<React.ComponentProps<typeof LicensingTable>> = {}) {
  const props: React.ComponentProps<typeof LicensingTable> = {
    rows: ROWS,
    pairs: PAIRS,
    metrics: METRICS,
    extraColumns: [],
    extraLabel: (k) => k,
    extraValue: () => "",
    typeOf: () => ({ icon: "apps", label: "Application" }),
    showStatus: true,
    sortK: "name",
    sortD: "asc",
    onSort: vi.fn(),
    onOpen: vi.fn(),
    onDrill: vi.fn(),
    ...over,
  };
  render(<LicensingTable {...props} />);
  return props;
}
const names = () => screen.getAllByTestId("licensing-row-name").map((n) => n.textContent);
const texts = (tr: Element) => [...tr.querySelectorAll("td")].map((c) => c.textContent);

describe("LicensingTable", () => {
  it("one header row: lic./act./% per pair, then the totals of each metric, no cross-metric total", async () => {
    await i18n.changeLanguage("en");
    setup();
    const headRows = document.querySelectorAll("thead tr");
    expect(headRows).toHaveLength(1);
    const heads = [...headRows[0].querySelectorAll("th")].map((h) => h.textContent);
    expect(heads).toEqual([
      "Name",
      "Users: Admin lic.",
      "Users: Admin act.",
      "Users: Admin %",
      "Users: Dev lic.",
      "Users: Dev act.",
      "Users: Dev %",
      "Installations: Prod lic.",
      "Installations: Prod act.",
      "Installations: Prod %",
      "Users total lic.",
      "Users total act.",
      "Installations total lic.",
      "Installations total act.",
      "Status",
    ]);
    expect(heads).not.toContain("Total lic.");
    // No colspan/rowspan anywhere: extractSheetsFromDOM does not read them.
    expect(document.querySelectorAll("[colspan],[rowspan]")).toHaveLength(0);
  });

  it("the total row sums each pair and each metric, with no percentage", async () => {
    await i18n.changeLanguage("en");
    setup();
    expect(texts(screen.getByTestId("licensing-total-row"))).toEqual([
      "Total",
      "30", "17", "", // Users: Admin
      "0", "3", "", // Users: Dev
      "4", "—", "", // Installations: Prod (no actual at all)
      "30", "20", // Users totals
      "4", "—", // Installations totals
      "",
    ]);
  });

  it("renders counts, percentages, no-license, a missing cell and the status pill", async () => {
    await i18n.changeLanguage("en");
    setup();
    const rowA = screen.getByText("Alpha").closest("tr") as HTMLElement;
    expect(texts(rowA).slice(1, 7)).toEqual(["10", "12", "120 %", "0", "3", "no license"]);
    expect(texts(rowA).slice(7, 14)).toEqual(["—", "—", "—", "10", "15", "—", "—"]);
    expect(within(rowA).getByText("Over-licensed")).toBeInTheDocument();
  });

  it("sorts by a pair column", async () => {
    await i18n.changeLanguage("en");
    setup({ sortK: "lic:users:admin", sortD: "desc" });
    // Beta 20, Alpha 10, Gamma has no such cell (counts as 0).
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("sorts by a metric total", async () => {
    await i18n.changeLanguage("en");
    setup({ sortK: "tlic:users", sortD: "desc" });
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("clicking a header asks to sort by that column", async () => {
    await i18n.changeLanguage("en");
    const p = setup();
    await userEvent.click(screen.getByText("Users: Dev act."));
    expect(p.onSort).toHaveBeenCalledWith("act:users:dev");
    await userEvent.click(screen.getByText("Installations total lic."));
    expect(p.onSort).toHaveBeenCalledWith("tlic:installations");
  });

  it("sorts by status, worst first", async () => {
    await i18n.changeLanguage("en");
    setup({ sortK: "status", sortD: "asc" });
    expect(names()).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("right click drills, click opens", async () => {
    await i18n.changeLanguage("en");
    const p = setup();
    const row = screen.getByText("Beta").closest("tr") as HTMLElement;
    await userEvent.click(row);
    expect(p.onOpen).toHaveBeenCalledWith("B");
    await userEvent.pointer({ keys: "[MouseRight]", target: row });
    expect(p.onDrill).toHaveBeenCalledWith({ id: "B" });
  });

  it("group header rows when grouped, summing the members, right click drills the group", async () => {
    await i18n.changeLanguage("en");
    const p = setup({
      groups: [
        { key: "g1", label: "Group one" },
        { key: "g2", label: "Group two" },
      ],
    });
    const head = screen.getByText("Group one").closest("tr") as HTMLElement;
    expect(texts(head).slice(1, 3)).toEqual(["10", "12"]);
    expect(within(head).getByText("(2)")).toBeInTheDocument();
    // Members follow their header.
    const order = [...document.querySelectorAll("tbody tr")].map((r) => r.textContent ?? "");
    expect(order[0]).toContain("Group one");
    expect(order[1]).toContain("Alpha");
    expect(order[2]).toContain("Gamma");
    expect(order[3]).toContain("Group two");
    await userEvent.pointer({ keys: "[MouseRight]", target: head });
    expect(p.onDrill).toHaveBeenCalledWith({ group: "g1" });
  });

  it("hides the status column and pills when showStatus is off (a Platform)", async () => {
    await i18n.changeLanguage("en");
    setup({ showStatus: false });
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Over-licensed")).toBeNull();
  });

  it("appends the extra columns", async () => {
    await i18n.changeLanguage("en");
    setup({ extraColumns: ["owner"], extraLabel: () => "Owner", extraValue: (r) => `o-${r.id}` });
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("o-A")).toBeInTheDocument();
  });
});
