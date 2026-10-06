/**
 * TurboLens → Resolution tab: the canonical vendor hierarchy from
 * `GET /turbolens/vendors/hierarchy` as KPI tiles and a table (vendor type,
 * aliases with overflow, category with its sub-category, counts, cost and a
 * confidence chip coloured by band), with search, type / category filters
 * and four sort orders; and the "Resolve Vendors" flow —
 * `POST /turbolens/vendors/resolve` followed by the real `useAnalysisPolling`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import type { TurboLensVendorHierarchy } from "@/types";
import TurboLensResolution from "./TurboLensResolution";

const LIST_URL = "/turbolens/vendors/hierarchy";
const RESOLVE_URL = "/turbolens/vendors/resolve";
const RUN_URL = "/turbolens/analysis-runs/run-7";

function entry(
  overrides: Partial<TurboLensVendorHierarchy> & { id: string; canonical_name: string },
): TurboLensVendorHierarchy {
  return {
    vendor_type: "vendor",
    parent_id: null,
    aliases: null,
    category: null,
    sub_category: null,
    app_count: 0,
    itc_count: 0,
    total_cost: 0,
    confidence: null,
    analysed_at: null,
    ...overrides,
  };
}

const SAP = entry({
  id: "v-sap",
  canonical_name: "SAP",
  aliases: ["SAP SE", "SAP AG"],
  category: "ERP",
  sub_category: "Business Suite",
  app_count: 5,
  itc_count: 2,
  total_cost: 2_000_000,
  confidence: 70,
});
const HANA = entry({
  id: "v-hana",
  canonical_name: "Hana Cloud",
  vendor_type: "product",
  parent_id: "v-sap",
  aliases: ["HANA", "HANA DB", "SAP HANA", "Hana Cloud DB", "HDB", "HanaDB", "HC"],
  category: "ERP",
  app_count: 3,
  total_cost: 500_000,
  confidence: 95,
});
const MS = entry({
  id: "v-ms",
  canonical_name: "Microsoft",
  app_count: 1,
  itc_count: 1,
  total_cost: 3_000_000,
  confidence: 40,
});
const WIDGET = entry({
  id: "v-widget",
  canonical_name: "Widget Module",
  vendor_type: "module",
  aliases: [],
  category: "Tools",
});
const HIERARCHY = [WIDGET, MS, HANA, SAP];

function renderTab() {
  return renderWithProviders(<TurboLensResolution />, { route: "/turbolens?tab=resolution" });
}

function kpiValue(label: string): string | null {
  const tile = screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
  return tile.querySelector("h5")?.textContent ?? null;
}

function rows(): HTMLElement[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

function names(): string[] {
  return rows().map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

function rowOf(name: string): HTMLElement {
  const row = rows().find((r) => within(r).getAllByRole("cell")[0].textContent === name);
  if (!row) throw new Error(`no row ${name}`);
  return row;
}

/** The three dropdowns, in order: vendor type, category, sort. */
async function choose(
  user: ReturnType<typeof renderTab>["user"],
  index: number,
  option: string,
) {
  await user.click(screen.getAllByRole("combobox")[index]);
  await user.click(screen.getByRole("option", { name: option }));
}

/** A Select's label: the floating InputLabel and the outline notch sized around it. */
function expectSelectLabel(text: string) {
  expect(screen.getByText(text, { selector: "label" })).toBeInTheDocument();
  expect(screen.getByText(text, { selector: "legend span" })).toBeInTheDocument();
}

const RESOLVE = /Resolve Vendors$/;

beforeEach(() => {
  mockApi.reset();
});

describe("TurboLensResolution", () => {
  it("paints a spinner, not the empty state, before the hierarchy is requested", () => {
    // The very first render, before any effect has run.
    const html = renderToStaticMarkup(wrapWithProviders(<TurboLensResolution />));
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("No vendor hierarchy data");
  });

  it("shows a spinner, then the empty state when there is no hierarchy", async () => {
    let resolve: (v: TurboLensVendorHierarchy[]) => void = () => {};
    mockApi.on("get", LIST_URL, () => new Promise<TurboLensVendorHierarchy[]>((r) => (resolve = r)));
    renderTab();

    expect(screen.getByRole("heading", { name: "Vendor Resolution" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    resolve([]);

    expect(await screen.findByText("No vendor hierarchy data")).toBeInTheDocument();
    expect(
      screen.getByText("Run vendor resolution to build the canonical vendor hierarchy."),
    ).toBeInTheDocument();
  });

  it("treats a failed load as no data", async () => {
    mockApi.fail("get", LIST_URL);
    renderTab();

    expect(await screen.findByText("No vendor hierarchy data")).toBeInTheDocument();
  });

  it("summarises the hierarchy in KPI tiles", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    renderTab();

    await screen.findByText("Canonical Vendors");
    expect(kpiValue("Canonical Vendors")).toBe("2");
    expect(kpiValue("Products / Modules")).toBe("2");
    expect(kpiValue("Linked Cards")).toBe("12");
    // Averaged over the entries that carry a confidence: (70 + 95 + 40) / 3.
    expect(kpiValue("Avg Confidence")).toBe("68%");
  });

  it("reports 0% confidence when no entry carries one", async () => {
    mockApi.on("get", LIST_URL, [WIDGET]);
    renderTab();

    await screen.findByText("Avg Confidence");
    expect(kpiValue("Avg Confidence")).toBe("0%");
    // A module is not a canonical vendor.
    expect(kpiValue("Canonical Vendors")).toBe("0");
    expect(kpiValue("Products / Modules")).toBe("1");
  });

  it("renders each entry's type, aliases, category, counts, cost and confidence", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    renderTab();

    expect(await screen.findByText("Vendor Hierarchy (4)")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Canonical Name",
      "Type",
      "Aliases",
      "Category",
      "Apps",
      "Components",
      "Annual Cost",
      "Confidence",
    ]);

    const sap = rowOf("SAP");
    expect(within(sap).getByText("vendor")).toHaveClass("MuiChip-label");
    expect(within(sap).getByText("SAP SE")).toBeInTheDocument();
    expect(within(sap).getByText("SAP AG")).toBeInTheDocument();
    // Two aliases: no overflow chip.
    expect(within(sap).queryByText(/^\+/)).not.toBeInTheDocument();
    // The sub-category rides on the category chip as its tooltip.
    expect(within(sap).getByText("ERP").closest(".MuiChip-root")).toHaveAttribute(
      "aria-label",
      "Business Suite",
    );
    expect(within(sap).getByText("2.0M")).toBeInTheDocument();
    expect(within(sap).getByText("70%").closest(".MuiChip-root")).toHaveClass("MuiChip-colorWarning");

    // Five aliases, then the overflow count.
    const hana = rowOf("Hana Cloud");
    for (const alias of ["HANA", "HANA DB", "SAP HANA", "Hana Cloud DB", "HDB"]) {
      expect(within(hana).getByText(alias)).toBeInTheDocument();
    }
    expect(within(hana).queryByText("HanaDB")).not.toBeInTheDocument();
    expect(within(hana).getByText("+2")).toBeInTheDocument();
    expect(within(hana).getByText("95%").closest(".MuiChip-root")).toHaveClass("MuiChip-colorSuccess");
    // No sub-category: the category chip carries no tooltip text.
    expect(within(hana).getByText("ERP").closest(".MuiChip-root")).toHaveAttribute("aria-label", "");

    // No aliases and no category → dashes; low confidence → error colour.
    const ms = rowOf("Microsoft");
    expect(within(ms).getAllByText("-")).toHaveLength(2);
    expect(within(ms).getByText("3.0M")).toBeInTheDocument();
    expect(within(ms).getByText("40%").closest(".MuiChip-root")).toHaveClass("MuiChip-colorError");

    // Empty alias list, no cost, no confidence → three dashes.
    const widget = rowOf("Widget Module");
    expect(within(widget).getByText("module")).toBeInTheDocument();
    expect(within(widget).getByText("Tools")).toBeInTheDocument();
    expect(within(widget).getAllByText("-")).toHaveLength(3);
  });

  it("sorts by most linked by default, then by cost, name or confidence", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (4)");
    expectSelectLabel("Sort by");
    expect(names()).toEqual(["SAP", "Hana Cloud", "Microsoft", "Widget Module"]);

    await choose(user, 2, "Highest Cost");
    expect(names()).toEqual(["Microsoft", "SAP", "Hana Cloud", "Widget Module"]);

    await choose(user, 2, "Name A–Z");
    expect(names()).toEqual(["Hana Cloud", "Microsoft", "SAP", "Widget Module"]);

    await choose(user, 2, "Confidence");
    expect(names()).toEqual(["Hana Cloud", "SAP", "Microsoft", "Widget Module"]);

    await choose(user, 2, "Most Linked");
    expect(names()).toEqual(["SAP", "Hana Cloud", "Microsoft", "Widget Module"]);
  });

  it("filters by vendor type and by category", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (4)");
    expectSelectLabel("Type");
    expectSelectLabel("Category");
    await user.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All",
      "module",
      "product",
      "vendor",
    ]);
    await user.click(screen.getByRole("option", { name: "vendor" }));
    expect(names()).toEqual(["SAP", "Microsoft"]);

    await user.click(screen.getAllByRole("combobox")[1]);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All", "ERP", "Tools"]);
    await user.click(screen.getByRole("option", { name: "ERP" }));
    expect(names()).toEqual(["SAP"]);
    expect(screen.getByText("Vendor Hierarchy (1)")).toBeInTheDocument();

    await choose(user, 0, "All");
    expect(names()).toEqual(["SAP", "Hana Cloud"]);
  });

  it("searches canonical names and aliases", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (4)");
    const search = screen.getByPlaceholderText("Search vendor name or alias...");
    expect(
      within(search.closest(".MuiInputBase-root") as HTMLElement).getByText("search"),
    ).toBeInTheDocument();

    await user.type(search, "micro");
    expect(names()).toEqual(["Microsoft"]);

    await user.clear(search);
    await user.type(search, "sap se");
    expect(names()).toEqual(["SAP"]);

    // "hdb" only matches one of Hana Cloud's aliases.
    await user.clear(search);
    await user.type(search, "HDB");
    expect(names()).toEqual(["Hana Cloud"]);

    // A single letter matches inside names and aliases; an entry without an
    // alias list (Microsoft) only matches on its name.
    await user.clear(search);
    await user.type(search, "e");
    expect(names()).toEqual(["SAP", "Widget Module"]);

    // Whitespace alone is no filter.
    await user.clear(search);
    await user.type(search, "   ");
    expect(names()).toEqual(["SAP", "Hana Cloud", "Microsoft", "Widget Module"]);

    await user.clear(search);
    await user.type(search, "nothing like this");
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Vendor Hierarchy (0)")).toBeInTheDocument();
  });

  it("starts a resolution, polls the run and reloads the hierarchy when it completes", async () => {
    mockApi.on("get", LIST_URL, []);
    mockApi.on("post", RESOLVE_URL, { run_id: "run-7" });
    let answerPoll: (run: unknown) => void = () => {};
    mockApi.on("get", RUN_URL, () => new Promise((r) => (answerPoll = r)));
    const { user } = renderTab();

    await screen.findByText("No vendor hierarchy data");
    await user.click(screen.getByRole("button", { name: RESOLVE }));

    expect(await screen.findByText("Vendor resolution started")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", RUN_URL)).toHaveLength(1));
    expect(screen.getByRole("button", { name: RESOLVE })).toBeDisabled();

    mockApi.on("get", LIST_URL, HIERARCHY);
    answerPoll({ id: "run-7", status: "completed", analysis_type: "vendor_resolution" });
    expect(await screen.findByText("Vendor Hierarchy (4)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RESOLVE })).toBeEnabled();

    const notice = screen.getByText("Vendor resolution started").closest(".MuiAlert-root") as HTMLElement;
    await user.click(within(notice).getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Vendor resolution started")).not.toBeInTheDocument();
  });

  it("surfaces a failed run, and an error starting one", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    mockApi.on("post", RESOLVE_URL, { run_id: "run-7" });
    mockApi.on("get", RUN_URL, {
      id: "run-7",
      status: "failed",
      analysis_type: "vendor_resolution",
      error_message: null,
    });
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (4)");
    await user.click(screen.getByRole("button", { name: RESOLVE }));
    // No message on the run → the generic one.
    expect(await screen.findByText("Analysis failed")).toBeInTheDocument();
    const alert = screen.getByText("Analysis failed").closest(".MuiAlert-root") as HTMLElement;
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Analysis failed")).not.toBeInTheDocument();

    mockApi.fail("post", RESOLVE_URL, 503, "AI not configured");
    await waitFor(() => expect(screen.getByRole("button", { name: RESOLVE })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: RESOLVE }));
    expect(await screen.findByText(`POST ${RESOLVE_URL} failed`)).toBeInTheDocument();
    expect(screen.queryByText("Vendor resolution started")).not.toBeInTheDocument();
  });

  it("stringifies an error that is not an ApiError", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    mockApi.on("post", RESOLVE_URL, () => {
      throw new Error("offline");
    });
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (4)");
    await user.click(screen.getByRole("button", { name: RESOLVE }));
    expect(await screen.findByText("Error: offline")).toBeInTheDocument();
  });

  it("ranks by apps plus components when sorting by most linked", async () => {
    mockApi.on("get", LIST_URL, [
      entry({ id: "a", canonical_name: "Apps only", app_count: 5 }),
      entry({ id: "c", canonical_name: "Components only", itc_count: 9 }),
      entry({ id: "m", canonical_name: "Mixed", app_count: 3, itc_count: 4 }),
    ]);
    renderTab();

    await screen.findByText("Vendor Hierarchy (3)");
    expect(names()).toEqual(["Components only", "Mixed", "Apps only"]);
    expect(kpiValue("Linked Cards")).toBe("21");
  });

  it("colours confidence at the band edges: 80 is high, 50 is medium", async () => {
    mockApi.on("get", LIST_URL, [
      entry({ id: "e80", canonical_name: "Edge high", confidence: 80 }),
      entry({ id: "e50", canonical_name: "Edge medium", confidence: 50 }),
    ]);
    renderTab();

    await screen.findByText("Vendor Hierarchy (2)");
    expect(within(rowOf("Edge high")).getByText("80%").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorSuccess",
    );
    expect(within(rowOf("Edge medium")).getByText("50%").closest(".MuiChip-root")).toHaveClass(
      "MuiChip-colorWarning",
    );
  });

  it("shows exactly five aliases without an overflow chip", async () => {
    mockApi.on("get", LIST_URL, [
      entry({ id: "five", canonical_name: "Five", aliases: ["A1", "A2", "A3", "A4", "A5"] }),
    ]);
    renderTab();

    await screen.findByText("Vendor Hierarchy (1)");
    const five = rowOf("Five");
    for (const alias of ["A1", "A2", "A3", "A4", "A5"]) {
      expect(within(five).getByText(alias)).toBeInTheDocument();
    }
    expect(within(five).queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("offers an \"unknown\" type for entries the resolver left untyped", async () => {
    mockApi.on("get", LIST_URL, [WIDGET, entry({ id: "u", canonical_name: "Untyped", vendor_type: "" })]);
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (2)");
    await user.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All",
      "module",
      "unknown",
    ]);
  });

  it("disables the button while the request is in flight and clears an earlier error", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    mockApi.fail("post", RESOLVE_URL, 503, "AI not configured");
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (4)");
    await user.click(screen.getByRole("button", { name: RESOLVE }));
    expect(await screen.findByText(`POST ${RESOLVE_URL} failed`)).toBeInTheDocument();

    let answerPost: (v: { run_id: string }) => void = () => {};
    mockApi.on("post", RESOLVE_URL, () => new Promise<{ run_id: string }>((r) => (answerPost = r)));
    mockApi.on("get", RUN_URL, () => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: RESOLVE }));

    expect(screen.queryByText(`POST ${RESOLVE_URL} failed`)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: RESOLVE })).toBeDisabled();
    answerPost({ run_id: "run-7" });
    expect(await screen.findByText("Vendor resolution started")).toBeInTheDocument();
  });

  it("empties the hierarchy when the reload after a run fails", async () => {
    mockApi.on("get", LIST_URL, HIERARCHY);
    mockApi.on("post", RESOLVE_URL, { run_id: "run-7" });
    let answerPoll: (run: unknown) => void = () => {};
    mockApi.on("get", RUN_URL, () => new Promise((r) => (answerPoll = r)));
    const { user } = renderTab();

    await screen.findByText("Vendor Hierarchy (4)");
    await user.click(screen.getByRole("button", { name: RESOLVE }));
    await waitFor(() => expect(mockApi.callsOf("get", RUN_URL)).toHaveLength(1));

    mockApi.fail("get", LIST_URL);
    answerPoll({ id: "run-7", status: "completed", analysis_type: "vendor_resolution" });
    expect(await screen.findByText("No vendor hierarchy data")).toBeInTheDocument();
    expect(screen.queryByText("Vendor Hierarchy (4)")).not.toBeInTheDocument();
  });
});
