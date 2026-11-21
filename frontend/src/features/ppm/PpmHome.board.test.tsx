/**
 * PpmHome with the REAL Portfolio board — the tab in the link must survive the
 * board's own link writes.
 *
 * The board writes its parameters into the link as it mounts (the view's
 * URL-sync effect, and the container's restore of what the browser
 * remembers), with a functional `setSearchParams`, which in react-router starts
 * from the parameters of the last render. When the page switched its tab in
 * local state, the board mounted before the router had applied the tab switch,
 * so its write started from a link still carrying `tab=ea-delivery` and put it
 * back: the page showed Portfolio while the link — and the next reload — said
 * EA Delivery. `PpmHome.test.tsx` stubs the board, so it could not see this.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { api } from "@/api/client";
import { renderWithProviders } from "@/test/render";
import PpmHome from "./PpmHome";
// Loaded up front so the page's lazy() import of the board resolves at once.
import "./PpmPortfolio";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: () => false,
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/features/reports/EaDeliveryReport", () => ({
  default: () => <div data-testid="ea-delivery" />,
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "CHF",
    fmt: { format: (v: number) => `CHF ${v}` },
    fmtShort: (v: number) => `CHF${v}`,
    symbol: "CHF",
  }),
}));

const TYPES = [
  {
    key: "Initiative",
    label: "Initiative",
    translations: {},
    subtypes: [{ key: "project", label: "Project", translations: {} }],
    fields_schema: [],
  },
];

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((tp) => tp.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  }),
}));

const row = (id: string, name: string) => ({
  id,
  name,
  subtype: "project",
  parent_id: null,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  capex_planned: 100,
  capex_actual: 0,
  opex_planned: 0,
  opex_actual: 0,
  group_id: null,
  group_name: null,
  latest_report: null,
  stakeholders: [],
});

const GANTT = [row("i1", "Alpha Rollout"), row("i2", "Beta Upgrade")];

const DASHBOARD = {
  total_initiatives: 2,
  total_budget: 200,
  total_actual: 0,
  health_schedule: { onTrack: 0, atRisk: 0, offTrack: 0, noReport: 2 },
  health_cost: { onTrack: 0, atRisk: 0, offTrack: 0, noReport: 2 },
  health_scope: { onTrack: 0, atRisk: 0, offTrack: 0, noReport: 2 },
};

const PREFS_KEY = "turboea.ppm.portfolio.prefs";

beforeEach(() => {
  vi.clearAllMocks();
  // The board remembers its state in the browser, and jsdom shares one storage.
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path.startsWith("/reports/ppm/gantt")) return Promise.resolve(GANTT);
    if (path.startsWith("/reports/ppm/dashboard")) return Promise.resolve(DASHBOARD);
    return Promise.resolve([]);
  }) as typeof api.get);
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderHome(route = "/ppm") {
  return renderWithProviders(
    <>
      <PpmHome />
      <LocationProbe />
    </>,
    { route, routes: [{ path: "/ppm" }] },
  );
}

const link = () => new URLSearchParams(screen.getByTestId("location").textContent ?? "");
const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("PpmHome — the tab in the link with the real Portfolio board", () => {
  it("drops `tab` from the link when going back from EA Delivery to Portfolio, keeping the board's search", async () => {
    // Open on the board first: the lazy board has then loaded, so going back to
    // it mounts it in the same commit as the tab switch, as in the browser.
    const { user } = renderHome("/ppm?search=Beta&groupBy=Organization");
    expect(await screen.findByText("Beta Upgrade")).toBeInTheDocument();
    await user.click(tab(/EA Delivery/));
    expect(await screen.findByTestId("ea-delivery")).toBeInTheDocument();
    expect(link().get("tab")).toBe("ea-delivery");

    await user.click(tab(/Portfolio/));
    expect(await screen.findByText("Beta Upgrade")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Rollout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ea-delivery")).not.toBeInTheDocument();
    expect(tab(/Portfolio/)).toHaveAttribute("aria-selected", "true");
    // The board has written its own parameters by now (the opening `groupBy` is
    // its default, so it leaves the link); the tab switch survives them.
    await waitFor(() => expect(link().toString()).toBe("search=Beta"));
    expect(link().has("tab")).toBe(false);
  });

  it("writes `tab=ea-delivery` when leaving the board for EA Delivery", async () => {
    const { user } = renderHome("/ppm?search=Beta");
    expect(await screen.findByText("Beta Upgrade")).toBeInTheDocument();

    await user.click(tab(/EA Delivery/));
    expect(await screen.findByTestId("ea-delivery")).toBeInTheDocument();
    expect(tab(/EA Delivery/)).toHaveAttribute("aria-selected", "true");
    expect(link().get("tab")).toBe("ea-delivery");
    expect(link().get("search")).toBe("Beta");
  });

  it("keeps a remembered board search through a round trip, and ends on a link without `tab`", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ params: { search: "Beta" } }));
    const { user } = renderHome("/ppm");
    // The bare link gets the remembered search before the board opens.
    expect(await screen.findByText("Beta Upgrade")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Rollout")).not.toBeInTheDocument();
    await waitFor(() => expect(link().toString()).toBe("search=Beta"));

    await user.click(tab(/EA Delivery/));
    expect(await screen.findByTestId("ea-delivery")).toBeInTheDocument();
    expect(link().toString()).toBe("search=Beta&tab=ea-delivery");

    await user.click(tab(/Portfolio/));
    expect(await screen.findByText("Beta Upgrade")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Rollout")).not.toBeInTheDocument();
    await waitFor(() => expect(link().toString()).toBe("search=Beta"));
    expect(tab(/Portfolio/)).toHaveAttribute("aria-selected", "true");
  });

  it("restores a remembered search when returning to a bare Portfolio link from EA Delivery", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ params: { search: "Beta" } }));
    // EA Delivery opened by a link without board parameters: going to Portfolio
    // leaves the link bare, so the board restores what the browser remembers.
    const { user } = renderHome("/ppm?tab=ea-delivery");
    expect(await screen.findByTestId("ea-delivery")).toBeInTheDocument();

    await user.click(tab(/Portfolio/));
    expect(await screen.findByText("Beta Upgrade")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Rollout")).not.toBeInTheDocument();
    await waitFor(() => expect(link().toString()).toBe("search=Beta"));
    expect(tab(/Portfolio/)).toHaveAttribute("aria-selected", "true");
  });

  it("opens EA Delivery straight from a link naming it", async () => {
    renderHome("/ppm?tab=ea-delivery");
    expect(await screen.findByTestId("ea-delivery")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Rollout")).not.toBeInTheDocument();
    expect(tab(/EA Delivery/)).toHaveAttribute("aria-selected", "true");
    expect(link().get("tab")).toBe("ea-delivery");
  });

  it("shows the board for an unknown tab value", async () => {
    renderHome("/ppm?tab=nope");
    expect(await screen.findByText("Alpha Rollout")).toBeInTheDocument();
    expect(screen.queryByTestId("ea-delivery")).not.toBeInTheDocument();
    expect(tab(/Portfolio/)).toHaveAttribute("aria-selected", "true");
  });
});
