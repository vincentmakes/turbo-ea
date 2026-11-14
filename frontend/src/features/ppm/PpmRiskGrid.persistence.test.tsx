/**
 * The risk grid against the REAL AG Grid: what the stub cannot show.
 *
 * Regression (#1398 review): a column frozen with the header pin was saved
 * but came back unfrozen after a reload. The grid seeds its sort through
 * `initialState`, and AG Grid treats an `initialState` without
 * `partialColumnState` as the whole column state — it reset every column it
 * did not mention, wiping the `pinned` that `applyFrozen` had stamped on.
 * The sequence here is the browser's: mount, freeze, unmount, mount again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("./ppmRiskSpreadsheet", () => ({ exportPpmRisks: vi.fn() }));

import type { PpmRisk } from "@/types";
import PpmRiskGrid from "./PpmRiskGrid";
import { RISK_GRID_PREFS_KEY } from "./ppmRiskModel";

const RISKS: PpmRisk[] = [
  {
    id: "r1",
    initiative_id: "i1",
    title: "Vendor lock-in",
    description: "One supplier",
    probability: 4,
    impact: 4,
    risk_score: 16,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
  },
];

const noop = () => {};
const mount = () =>
  render(
    <PpmRiskGrid
      risks={RISKS}
      onAdd={noop}
      onEdit={noop}
      onDelete={noop}
      onImport={noop}
    />,
  );

const stored = () => JSON.parse(localStorage.getItem(RISK_GRID_PREFS_KEY) ?? "{}");
const pinnedIds = (c: HTMLElement) =>
  [...c.querySelectorAll(".ag-pinned-left-header .ag-header-cell")].map((h) =>
    h.getAttribute("col-id"),
  );

async function header(c: HTMLElement, colId: string) {
  return waitFor(() => {
    const el = c.querySelector(`.ag-header-cell[col-id="${colId}"]`);
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

describe("PpmRiskGrid on the real AG Grid", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a column frozen with the header pin across a reload, with a saved sort", async () => {
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({ sortModel: [{ colId: "status", sort: "asc" }] }),
    );
    const first = mount();
    const pin = (await header(first.container, "risk")).querySelector(".tea-freeze-do") as HTMLElement;
    pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => expect(pinnedIds(first.container)).toEqual(["risk"]));
    expect(stored().frozenColumns).toEqual(["risk"]);
    first.unmount();

    const second = mount();
    await header(second.container, "risk");
    await waitFor(() => expect(pinnedIds(second.container)).toEqual(["risk"]));
    // The saved sort is still the one applied.
    expect(
      (await header(second.container, "status")).getAttribute("aria-sort"),
    ).toBe("ascending");
    expect(second.container.querySelector('.ag-header-cell[col-id="risk_score"]')).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("keeps a frozen column on a first visit's default sort too", async () => {
    localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify({ frozenColumns: ["mitigation"] }));
    const { container } = mount();
    await header(container, "risk");
    await waitFor(() => expect(pinnedIds(container)).toEqual(["mitigation"]));
    expect((await header(container, "risk_score")).getAttribute("aria-sort")).toBe("descending");
  });

  it("offers no freeze pin on the action column, and one on every other", async () => {
    const { container } = mount();
    const actions = await header(container, "actions");
    expect(actions.querySelectorAll(".tea-freeze")).toHaveLength(0);
    const status = await header(container, "status");
    expect(status.querySelectorAll(".tea-freeze")).toHaveLength(2);
    expect(status.querySelector(".ag-header-cell-text")).toHaveTextContent("Status");
  });
});
