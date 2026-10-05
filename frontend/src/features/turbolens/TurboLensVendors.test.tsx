/**
 * TurboLens → Vendors tab: the vendor analysis from `GET /turbolens/vendors`
 * as KPI tiles, a category grid (click a category to drill into the table)
 * and a vendor table, with search and category filtering; and the
 * "Run Analysis" flow — `POST /turbolens/vendors/analyse`, then the real
 * `useAnalysisPolling` watching the run until it finishes and the list is
 * reloaded, or surfacing the failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { TurboLensVendor } from "@/types";
import TurboLensVendors from "./TurboLensVendors";

const LIST_URL = "/turbolens/vendors";
const ANALYSE_URL = "/turbolens/vendors/analyse";
const RUN_URL = "/turbolens/analysis-runs/run-1";

function vendor(overrides: Partial<TurboLensVendor> & { id: string; vendor_name: string }): TurboLensVendor {
  return {
    category: "CRM",
    sub_category: "",
    reasoning: "",
    app_count: 0,
    total_cost: 0,
    app_list: null,
    analysed_at: null,
    ...overrides,
  };
}

// Six CRM vendors (one more than the four chips a category card shows + 1),
// one database vendor and one the AI could not categorise.
const CRM = ["Salesforce", "HubSpot", "Zoho", "Pipedrive", "Freshsales", "Copper"].map((name, i) =>
  vendor({
    id: `crm-${i}`,
    vendor_name: name,
    category: "CRM",
    sub_category: i === 0 ? "Sales Cloud" : "",
    reasoning: i === 0 ? "Market-leading CRM suite" : "",
    app_count: i === 0 ? 3 : 1,
    total_cost: i === 0 ? 250_000 : 0,
  }),
);
const ORACLE = vendor({
  id: "db-1",
  vendor_name: "Oracle",
  category: "Database",
  sub_category: "RDBMS",
  app_count: 2,
  total_cost: 1_200_000,
  reasoning: "Relational database vendor",
});
const MYSTERY = vendor({ id: "x-1", vendor_name: "Acme Widgets", category: "" });
const VENDORS = [...CRM, ORACLE, MYSTERY];

function renderTab() {
  return renderWithProviders(<TurboLensVendors />, { route: "/turbolens?tab=vendors" });
}

function kpiValue(label: string): string | null {
  const tile = screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
  return tile.querySelector("h5")?.textContent ?? null;
}

/** The outlined card for one vendor category in the grid. */
function categoryCard(name: string): HTMLElement {
  const title = screen.getAllByText(name).find((el) => el.tagName === "H6");
  if (!title) throw new Error(`no category card ${name}`);
  return title.closest(".MuiCard-root") as HTMLElement;
}

function tableRows(): HTMLElement[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

const RUN = /Run Analysis$/;

beforeEach(() => {
  mockApi.reset();
});

describe("TurboLensVendors", () => {
  it("shows a spinner, then the empty state when nothing has been analysed", async () => {
    let resolve: (v: TurboLensVendor[]) => void = () => {};
    mockApi.on("get", LIST_URL, () => new Promise<TurboLensVendor[]>((r) => (resolve = r)));
    renderTab();

    expect(screen.getByRole("heading", { name: "Vendor Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    resolve([]);

    expect(await screen.findByText("No vendor analysis data")).toBeInTheDocument();
    expect(
      screen.getByText("Run a vendor analysis to categorize your technology vendors."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unique Vendors")).not.toBeInTheDocument();
  });

  it("treats a failed load as no data", async () => {
    mockApi.fail("get", LIST_URL);
    renderTab();

    expect(await screen.findByText("No vendor analysis data")).toBeInTheDocument();
  });

  it("summarises the analysis in KPI tiles", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    renderTab();

    await screen.findByText("Unique Vendors");
    expect(kpiValue("Unique Vendors")).toBe("8");
    expect(kpiValue("Application Links")).toBe("10");
    expect(kpiValue("Annual IT Cost")).toBe("1.4M");
    expect(kpiValue("Top Category")).toBe("CRM (6)");
  });

  it("omits the cost tile when no vendor carries a cost", async () => {
    mockApi.on("get", LIST_URL, [MYSTERY]);
    renderTab();

    await screen.findByText("Unique Vendors");
    expect(screen.queryByText("Annual IT Cost")).not.toBeInTheDocument();
    expect(kpiValue("Top Category")).toBe("Uncategorized (1)");
  });

  it("groups vendors into category cards, largest category first", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    renderTab();

    expect(await screen.findByText("Vendor Categories (3)")).toBeInTheDocument();
    const titles = Array.from(document.querySelectorAll(".MuiCard-root h6")).map((h) => h.textContent);
    expect(titles[0]).toBe("CRM");
    expect(titles).toEqual(expect.arrayContaining(["Database", "Uncategorized"]));

    const crm = categoryCard("CRM");
    expect(within(crm).getByRole("heading", { level: 4 })).toHaveTextContent("6");
    expect(within(crm).getByText("8 apps")).toBeInTheDocument();
    expect(within(crm).getByText("250K")).toBeInTheDocument();
    // Four vendor chips, then the overflow count.
    for (const name of ["Salesforce", "HubSpot", "Zoho", "Pipedrive"]) {
      expect(within(crm).getByText(name)).toBeInTheDocument();
    }
    expect(within(crm).queryByText("Freshsales")).not.toBeInTheDocument();
    expect(within(crm).getByText("+2")).toBeInTheDocument();

    const db = categoryCard("Database");
    expect(within(db).getByText("2 apps")).toBeInTheDocument();
    expect(within(db).getByText("1.2M")).toBeInTheDocument();

    // A category with no apps and no cost shows neither chip.
    const other = categoryCard("Uncategorized");
    expect(within(other).queryByText(/apps$/)).not.toBeInTheDocument();
    expect(within(other).getByText("Acme Widgets")).toBeInTheDocument();
  });

  it("drills into the table for a category when its card is clicked", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    const { user } = renderTab();

    await screen.findByText("Vendor Categories (3)");
    await user.click(categoryCard("Database"));

    expect(screen.getByText("All Vendors (1)")).toBeInTheDocument();
    const [row] = tableRows();
    expect(within(row).getByText("Oracle")).toBeInTheDocument();
    expect(within(row).getByText("Database")).toBeInTheDocument();
    expect(within(row).getByText("RDBMS")).toBeInTheDocument();
    expect(within(row).getByText("1.2M")).toBeInTheDocument();
    expect(within(row).getByText("Relational database vendor")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Database");
  });

  it("switches between the category grid and the vendor table", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    const { user } = renderTab();

    await screen.findByText("Vendor Categories (3)");
    await user.click(screen.getByRole("button", { name: "view_list" }));

    expect(screen.queryByText("Vendor Categories (3)")).not.toBeInTheDocument();
    expect(screen.getByText("All Vendors (8)")).toBeInTheDocument();
    const rows = tableRows();
    expect(rows).toHaveLength(8);

    const salesforce = rows.find((r) => within(r).queryByText("Salesforce")) as HTMLElement;
    expect(within(salesforce).getByText("Sales Cloud")).toBeInTheDocument();
    expect(within(salesforce).getByText("250K")).toBeInTheDocument();

    // No cost and no reasoning → dashes.
    const hubspot = rows.find((r) => within(r).queryByText("HubSpot")) as HTMLElement;
    expect(within(hubspot).getAllByText("-")).toHaveLength(2);

    // Clicking the active toggle again keeps the view (exclusive group emits null).
    await user.click(screen.getByRole("button", { name: "view_list" }));
    expect(screen.getByText("All Vendors (8)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "grid_view" }));
    expect(screen.getByText("Vendor Categories (3)")).toBeInTheDocument();
  });

  it("filters by vendor name, category or sub-category from the search box", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    const { user } = renderTab();

    await screen.findByText("Vendor Categories (3)");
    await user.click(screen.getByRole("button", { name: "view_list" }));
    const search = screen.getByPlaceholderText("Search vendor, category, sub-category...");

    await user.type(search, "zoho");
    expect(tableRows().map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["Zoho"]);

    await user.clear(search);
    await user.type(search, "rdbms");
    expect(screen.getByText("All Vendors (1)")).toBeInTheDocument();
    expect(within(tableRows()[0]).getByText("Oracle")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "crm");
    expect(screen.getByText("All Vendors (6)")).toBeInTheDocument();

    // Whitespace alone is no filter.
    await user.clear(search);
    await user.type(search, "   ");
    expect(screen.getByText("All Vendors (8)")).toBeInTheDocument();
  });

  it("filters by category from the dropdown, including the Uncategorized bucket", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    const { user } = renderTab();

    await screen.findByText("Vendor Categories (3)");
    await user.click(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["All", "CRM", "Database", "Uncategorized"]);

    await user.click(screen.getByRole("option", { name: "Uncategorized" }));
    expect(screen.getByText("Vendor Categories (1)")).toBeInTheDocument();
    expect(within(categoryCard("Uncategorized")).getByText("Acme Widgets")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "All" }));
    expect(screen.getByText("Vendor Categories (3)")).toBeInTheDocument();
  });

  it("runs an analysis, polls the run and reloads the vendors when it completes", async () => {
    mockApi.on("get", LIST_URL, []);
    mockApi.on("post", ANALYSE_URL, { run_id: "run-1" });
    // The first poll stays in flight until the test answers it.
    let answerPoll: (run: unknown) => void = () => {};
    mockApi.on("get", RUN_URL, () => new Promise((r) => (answerPoll = r)));
    const { user } = renderTab();

    await screen.findByText("No vendor analysis data");
    await user.click(screen.getByRole("button", { name: RUN }));

    expect(await screen.findByText("Vendor analysis started")).toBeInTheDocument();
    expect(mockApi.callsOf("post", ANALYSE_URL)).toHaveLength(1);
    await waitFor(() => expect(mockApi.callsOf("get", RUN_URL)).toHaveLength(1));
    // The button stays disabled while the run is being polled.
    expect(screen.getByRole("button", { name: RUN })).toBeDisabled();

    // The run finishes; the list is reloaded.
    mockApi.on("get", LIST_URL, VENDORS);
    answerPoll({ id: "run-1", status: "completed", analysis_type: "vendors" });
    expect(await screen.findByText("Vendor Categories (3)")).toBeInTheDocument();
    expect(mockApi.callsOf("get", LIST_URL)).toHaveLength(2);
    expect(screen.getByRole("button", { name: RUN })).toBeEnabled();

    // The success notice can be dismissed.
    await user.click(
      within(screen.getByText("Vendor analysis started").closest(".MuiAlert-root") as HTMLElement).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    expect(screen.queryByText("Vendor analysis started")).not.toBeInTheDocument();
  });

  it("surfaces a failed run's error message", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    mockApi.on("post", ANALYSE_URL, { run_id: "run-1" });
    mockApi.on("get", RUN_URL, {
      id: "run-1",
      status: "failed",
      analysis_type: "vendors",
      error_message: "AI provider unreachable",
    });
    const { user } = renderTab();

    await screen.findByText("Vendor Categories (3)");
    await user.click(screen.getByRole("button", { name: RUN }));

    expect(await screen.findByText("AI provider unreachable")).toBeInTheDocument();
    // A failure still reloads, so the user sees whatever partial data exists.
    await waitFor(() => expect(mockApi.callsOf("get", LIST_URL)).toHaveLength(2));

    await user.click(
      within(screen.getByText("AI provider unreachable").closest(".MuiAlert-root") as HTMLElement).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    expect(screen.queryByText("AI provider unreachable")).not.toBeInTheDocument();
  });

  it("shows the API error when the analysis cannot be started", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    mockApi.fail("post", ANALYSE_URL, 409, "Analysis already running");
    const { user } = renderTab();

    await screen.findByText("Vendor Categories (3)");
    await user.click(screen.getByRole("button", { name: RUN }));

    expect(await screen.findByText(`POST ${ANALYSE_URL} failed`)).toBeInTheDocument();
    expect(screen.queryByText("Vendor analysis started")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", /analysis-runs/)).toHaveLength(0);
    expect(screen.getByRole("button", { name: RUN })).toBeEnabled();
  });

  it("stringifies an error that is not an ApiError", async () => {
    mockApi.on("get", LIST_URL, VENDORS);
    mockApi.on("post", ANALYSE_URL, () => {
      throw new Error("network down");
    });
    const { user } = renderTab();

    await screen.findByText("Vendor Categories (3)");
    await user.click(screen.getByRole("button", { name: RUN }));

    expect(await screen.findByText("Error: network down")).toBeInTheDocument();
  });
});
