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
// The reports tab also keeps the last `onRefresh` it was given, so a test can
// fire a refresh that a tab started before the user switched initiative.
const reportsTab = vi.hoisted(() => ({ refresh: null as null | (() => unknown) }));
vi.mock("./PpmOverviewTab", () => ({
  default: ({
    card,
    latestReport,
    costLines,
    budgetLines,
  }: {
    card: { name: string };
    latestReport: { id: string } | null;
    costLines: unknown[];
    budgetLines: unknown[];
  }) => (
    <div data-testid="overview-tab">
      {card.name} | report {latestReport?.id ?? "none"} | {costLines.length} costs |{" "}
      {budgetLines.length} budgets
    </div>
  ),
}));
vi.mock("./PpmReportsTab", () => ({
  default: ({ reports, onRefresh }: { reports: { id: string }[]; onRefresh: () => void }) => {
    reportsTab.refresh = onRefresh;
    return (
    <div data-testid="reports-tab">
      {reports.map((r) => r.id).join(",")}
      <button onClick={onRefresh}>refresh</button>
    </div>
    );
  },
}));
// The cost tab stub counts its mounts: a switch must give it a fresh one
// (its own query, closed dialogs), not the previous initiative's instance
// with new props.
const costTab = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("./PpmCostTab", async () => {
  const { useEffect } = await import("react");
  function CostTabStub({ initiativeId }: { initiativeId: string }) {
    useEffect(() => {
      costTab.mounts += 1;
    }, []);
    return <div data-testid="cost-tab">{initiativeId}</div>;
  }
  return { default: CostTabStub };
});
vi.mock("./PpmRiskTab", () => ({
  default: ({ risks }: { risks: { id: string }[] }) => (
    <div data-testid="risks-tab">{risks.map((r) => r.id).join(",")}</div>
  ),
}));
vi.mock("./PpmTaskBoard", () => ({ default: () => null }));
vi.mock("./PpmGanttTab", () => ({ default: () => null }));
vi.mock("@/features/cards/CardDetailContent", () => ({
  default: ({ card, perms }: { card: { name: string }; perms: { can_edit: boolean } }) => (
    <div data-testid="details-tab">
      {card.name} can edit: {String(perms.can_edit)}
    </div>
  ),
}));
vi.mock("@/hooks/useCardSubtypeLabel", () => ({
  useCardSubtypeLabel: () => (_type: string, subtype: string) => subtype,
}));

import { ApiError } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Script every read the page makes for one initiative. */
function serve(
  id: string,
  name: string,
  o: {
    card?: () => Promise<unknown>;
    perms?: () => Promise<unknown>;
    canEdit?: boolean;
    budgets?: { id: string }[];
    risks?: { id: string }[];
  } = {},
) {
  mockApi.on("get", `/cards/${id}`, o.card ?? initiative(id, name));
  mockApi.on("get", `/ppm/initiatives/${id}/reports`, [{ id: `${id}-report` }]);
  mockApi.on("get", `/ppm/initiatives/${id}/costs`, id === "i1" ? [{ id: "c1" }, { id: "c2" }] : []);
  mockApi.on("get", `/ppm/initiatives/${id}/budgets`, o.budgets ?? []);
  mockApi.on("get", `/ppm/initiatives/${id}/risks`, o.risks ?? []);
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

/** What the browser tab is named after. */
function SubjectProbe() {
  const { subject } = usePageTitleSlots();
  return <output data-testid="subject">{subject?.text ?? ""}</output>;
}

const subject = () => screen.getByTestId("subject").textContent;

function renderPage(path = "/ppm/i1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavGrab />
      <SubjectProbe />
      <Routes>
        <Route path="/ppm/:id" element={<PpmProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.reset();
  resetPageTitle();
  costTab.mounts = 0;
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
    await waitFor(() => expect(subject()).toBe("ERP Replacement"));

    act(() => {
      navigateTo("/ppm/i2");
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i2")).toHaveLength(1));
    expect(screen.queryByText("ERP Replacement")).toBeNull();
    expect(screen.queryByTestId("overview-tab")).toBeNull();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // Nor does the browser tab go on naming the initiative that was left.
    expect(subject()).toBe("");

    await act(async () => {
      card2.resolve(initiative("i2", "CRM Rollout"));
    });
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent(
      "CRM Rollout | report i2-report | 0 costs",
    );
    await waitFor(() => expect(subject()).toBe("CRM Rollout"));
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

  it("gives the next initiative the default permissions until its own arrive, never the last one's", async () => {
    serve("i1", "ERP Replacement", { canEdit: false });
    const perms2 = deferred();
    serve("i2", "CRM Rollout", { perms: () => perms2.promise });
    renderPage("/ppm/i1?tab=details");
    await waitFor(() =>
      expect(screen.getByTestId("details-tab")).toHaveTextContent("ERP Replacement can edit: false"),
    );

    act(() => {
      navigateTo("/ppm/i2?tab=details");
    });
    await waitFor(() =>
      expect(screen.getByTestId("details-tab")).toHaveTextContent("CRM Rollout"),
    );
    expect(screen.getByTestId("details-tab")).toHaveTextContent("can edit: true");

    // Then its own permissions take over.
    await act(async () => {
      perms2.resolve({ effective: { can_view: true, can_edit: false } });
    });
    expect(screen.getByTestId("details-tab")).toHaveTextContent("CRM Rollout can edit: false");
  });

  it("ignores a late failure of the initiative the user has left", async () => {
    const card1 = deferred();
    serve("i1", "ERP Replacement", { card: () => card1.promise });
    serve("i2", "CRM Rollout");
    renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i1")).toHaveLength(1));

    act(() => {
      navigateTo("/ppm/i2");
    });
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent("CRM Rollout");

    await act(async () => {
      card1.reject(new Error("ERP Replacement could not be read"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("overview-tab")).toHaveTextContent("CRM Rollout");
  });

  it("mounts a fresh cost tab for the next initiative", async () => {
    serve("i1", "ERP Replacement");
    serve("i2", "CRM Rollout");
    renderPage("/ppm/i1?tab=cost");
    expect(await screen.findByTestId("cost-tab")).toHaveTextContent("i1");
    // The stub counts in a passive effect, which flushes after the text the
    // wait above saw was committed: read the count through a wait too, or a
    // slower run (Stryker's initial run, nightly 2026-10-09) reads it early.
    await waitFor(() => expect(costTab.mounts).toBe(1));

    act(() => {
      navigateTo("/ppm/i2?tab=cost");
    });
    await waitFor(() => expect(screen.getByTestId("cost-tab")).toHaveTextContent("i2"));
    // A new instance, not the old one re-rendered with a new id.
    await waitFor(() => expect(costTab.mounts).toBe(2));
  });

  it("keeps the spinner while the next initiative loads when the one left finishes first", async () => {
    const card1 = deferred();
    const card2 = deferred();
    serve("i1", "ERP Replacement", { card: () => card1.promise });
    serve("i2", "CRM Rollout", { card: () => card2.promise });
    renderPage();
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i1")).toHaveLength(1));

    act(() => {
      navigateTo("/ppm/i2");
    });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards/i2")).toHaveLength(1));

    await act(async () => {
      card1.resolve(initiative("i1", "ERP Replacement"));
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/ERP Replacement/)).toBeNull();

    await act(async () => {
      card2.resolve(initiative("i2", "CRM Rollout"));
    });
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent("CRM Rollout");
  });

});

describe("PpmProjectDetail loaded data", () => {
  it("hands the initiative's budget lines and risks to the tabs that show them", async () => {
    serve("i1", "ERP Replacement", {
      budgets: [{ id: "b1" }, { id: "b2" }],
      risks: [{ id: "r1" }, { id: "r2" }],
    });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByTestId("overview-tab")).toHaveTextContent("2 costs | 2 budgets");

    await user.click(screen.getByRole("tab", { name: "Risk Management" }));
    expect(await screen.findByTestId("risks-tab")).toHaveTextContent("r1,r2");
  });

  it("applies the initiative's own permissions once they arrive", async () => {
    serve("i1", "ERP Replacement", { canEdit: false });
    renderPage("/ppm/i1?tab=details");
    await waitFor(() =>
      expect(screen.getByTestId("details-tab")).toHaveTextContent("ERP Replacement can edit: false"),
    );
  });
});

describe("PpmProjectDetail failed loads", () => {
  it("says a server failure in its own words, not that the initiative was not found", async () => {
    serve("i1", "ERP Replacement", {
      card: () => Promise.reject(new ApiError("Database unavailable", 500, null)),
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByText("Not found")).toBeNull();
  });

  it("says what a failure that is not an Error was", async () => {
    serve("i1", "ERP Replacement", { card: () => Promise.reject("connection reset") });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("connection reset");
  });

  it("says Not found when a refresh finds the initiative gone", async () => {
    serve("i1", "ERP Replacement");
    const user = userEvent.setup();
    renderPage("/ppm/i1?tab=reports");
    expect(await screen.findByTestId("reports-tab")).toHaveTextContent("i1-report");

    mockApi.fail("get", "/cards/i1", 404);
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
    expect(screen.queryByTestId("reports-tab")).toBeNull();
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

describe("PpmProjectDetail a tab refresh that outlives a switch", () => {
  it("reloads the initiative on screen, never the one the tab was rendered for", async () => {
    serve("i1", "ERP Replacement");
    serve("i2", "CRM Rollout");
    renderPage("/ppm/i1?tab=reports");
    expect(await screen.findByTestId("reports-tab")).toHaveTextContent("i1-report");
    // e.g. a report delete on i1 whose request answers after the switch.
    const staleRefresh = reportsTab.refresh!;

    act(() => {
      navigateTo("/ppm/i2?tab=reports");
    });
    expect(await screen.findByTestId("reports-tab")).toHaveTextContent("i2-report");
    await waitFor(() => expect(subject()).toBe("CRM Rollout"));

    await act(async () => {
      await staleRefresh();
    });
    expect(screen.getByTestId("reports-tab")).toHaveTextContent("i2-report");
    expect(screen.queryByText(/i1-report/)).toBeNull();
    expect(subject()).toBe("CRM Rollout");
    expect(mockApi.callsOf("get", "/cards/i1")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/cards/i2")).toHaveLength(2);
  });
});
