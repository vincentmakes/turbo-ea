/**
 * PpmProjectDetail regressions: the initiative's data was loaded by a bare
 * `api.get` in an effect, so after switching initiatives the previous one's
 * name, reports and costs stayed on screen until the new ones landed, and a
 * late reply for the initiative the user had left overwrote the new one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

// The tabs are stubbed to print the per-initiative data they are handed.
vi.mock("./PpmOverviewTab", () => ({
  default: ({
    card,
    latestReport,
    costLines,
  }: {
    card: { name: string };
    latestReport: { id: string } | null;
    costLines: unknown[];
  }) => (
    <div data-testid="overview-tab">
      {card.name} | report {latestReport?.id ?? "none"} | {costLines.length} costs
    </div>
  ),
}));
vi.mock("./PpmReportsTab", () => ({
  default: ({ reports, onRefresh }: { reports: { id: string }[]; onRefresh: () => void }) => (
    <div data-testid="reports-tab">
      {reports.map((r) => r.id).join(",")}
      <button onClick={onRefresh}>refresh</button>
    </div>
  ),
}));
vi.mock("./PpmCostTab", () => ({ default: () => null }));
vi.mock("./PpmRiskTab", () => ({ default: () => null }));
vi.mock("./PpmTaskBoard", () => ({ default: () => null }));
vi.mock("./PpmGanttTab", () => ({ default: () => null }));
vi.mock("@/features/cards/CardDetailContent", () => ({
  default: ({ perms }: { perms: { can_edit: boolean } }) => (
    <div data-testid="details-tab">can edit: {String(perms.can_edit)}</div>
  ),
}));
vi.mock("@/hooks/useCardSubtypeLabel", () => ({
  useCardSubtypeLabel: () => (_type: string, subtype: string) => subtype,
}));

import { mockApi } from "@/test/apiMock";
import PpmProjectDetail from "./PpmProjectDetail";

function initiative(id: string, name: string) {
  return {
    id,
    type: "Initiative",
    name,
    subtype: null,
    description: null,
    status: "ACTIVE",
    approval_status: "DRAFT",
    data_quality: 0,
    attributes: {},
    lifecycle: {},
    parent_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Script every read the page makes for one initiative. */
function serve(
  id: string,
  name: string,
  o: { card?: () => Promise<unknown>; perms?: () => Promise<unknown>; canEdit?: boolean } = {},
) {
  mockApi.on("get", `/cards/${id}`, o.card ?? initiative(id, name));
  mockApi.on("get", `/ppm/initiatives/${id}/reports`, [{ id: `${id}-report` }]);
  mockApi.on("get", `/ppm/initiatives/${id}/costs`, id === "i1" ? [{ id: "c1" }, { id: "c2" }] : []);
  mockApi.on("get", `/ppm/initiatives/${id}/budgets`, []);
  mockApi.on("get", `/ppm/initiatives/${id}/risks`, []);
  mockApi.on(
    "get",
    `/cards/${id}/my-permissions`,
    o.perms ?? { effective: { can_view: true, can_edit: o.canEdit ?? true } },
  );
}

let navigateTo: NavigateFunction;
function NavGrab() {
  navigateTo = useNavigate();
  return null;
}

function renderPage(path = "/ppm/i1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavGrab />
      <Routes>
        <Route path="/ppm/:id" element={<PpmProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.reset();
});

describe("PpmProjectDetail switching initiatives", () => {
  it("never shows the previous initiative's data while the next one loads", async () => {
    serve("i1", "ERP Replacement");
    const card2 = deferred();
    serve("i2", "CRM Rollout", { card: () => card2.promise });
    renderPage();
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent(
      "ERP Replacement | report i1-report | 2 costs",
    );

    act(() => {
      navigateTo("/ppm/i2");
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i2")).toHaveLength(1));
    expect(screen.queryByText("ERP Replacement")).toBeNull();
    expect(screen.queryByTestId("overview-tab")).toBeNull();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await act(async () => {
      card2.resolve(initiative("i2", "CRM Rollout"));
    });
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent(
      "CRM Rollout | report i2-report | 0 costs",
    );
  });

  it("ignores a late reply for the initiative the user has left", async () => {
    const card1 = deferred();
    serve("i1", "ERP Replacement", { card: () => card1.promise });
    serve("i2", "CRM Rollout");
    renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i1")).toHaveLength(1));

    act(() => {
      navigateTo("/ppm/i2");
    });
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent(
      "CRM Rollout | report i2-report | 0 costs",
    );

    await act(async () => {
      card1.resolve(initiative("i1", "ERP Replacement"));
    });
    expect(screen.getByTestId("overview-tab")).toHaveTextContent(
      "CRM Rollout | report i2-report | 0 costs",
    );
    expect(screen.queryByText(/ERP Replacement/)).toBeNull();
  });

  it("ignores a late permissions reply for the initiative the user has left", async () => {
    const perms1 = deferred();
    serve("i1", "ERP Replacement", { perms: () => perms1.promise });
    serve("i2", "CRM Rollout", { canEdit: true });
    renderPage("/ppm/i1?tab=details");
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i1/my-permissions")).toHaveLength(1));

    act(() => {
      navigateTo("/ppm/i2?tab=details");
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i2/my-permissions")).toHaveLength(1));
    expect(await screen.findByTestId("details-tab")).toHaveTextContent("can edit: true");

    await act(async () => {
      perms1.resolve({ effective: { can_view: true, can_edit: false } });
    });
    expect(screen.getByTestId("details-tab")).toHaveTextContent("can edit: true");
  });

  it("says a failed load for the next initiative, not the previous one's data", async () => {
    serve("i1", "ERP Replacement");
    serve("i2", "CRM Rollout");
    mockApi.fail("get", "/ppm/initiatives/i2/reports", 404);
    renderPage();
    await screen.findByTestId("overview-tab");

    act(() => {
      navigateTo("/ppm/i2");
    });
    expect(await screen.findByText("Not found")).toBeInTheDocument();
    expect(screen.queryByText(/ERP Replacement/)).toBeNull();
  });
});

describe("PpmProjectDetail refresh after a change", () => {
  it("re-reads the initiative in place when a tab reports a change", async () => {
    serve("i1", "ERP Replacement");
    const user = userEvent.setup();
    renderPage("/ppm/i1?tab=reports");
    expect(await screen.findByTestId("reports-tab")).toHaveTextContent("i1-report");

    mockApi.on("get", "/ppm/initiatives/i1/reports", [{ id: "fresh" }, { id: "i1-report" }]);
    await user.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() =>
      expect(screen.getByTestId("reports-tab")).toHaveTextContent("fresh,i1-report"),
    );
    // In place: the tab never gave way to the page spinner.
    expect(mockApi.callsOf("get", "/ppm/initiatives/i1/reports")).toHaveLength(2);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
