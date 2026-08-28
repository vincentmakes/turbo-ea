/**
 * The portfolio board is rendered by two containers — the authenticated page and
 * the account-less web portal — that differ mainly in what a row click does.
 * These tests pin that contract, including the case where there is nothing to
 * click, so a future edit cannot leave a pointer affordance on a dead row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { setViewportWidth } from "@/test/matchMedia";
import PpmPortfolioView from "./PpmPortfolioView";
import type { PpmPortfolioItem, PpmPortfolioDashboard } from "@/types";

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "CHF",
    fmt: { format: (v: number) => `CHF ${v}` },
    fmtShort: (v: number) => `CHF${v}`,
    symbol: "CHF",
  }),
}));

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (d: string) => d, dateFormat: "YYYY-MM-DD" }),
}));

const DESKTOP = 1600;

const ITEM: PpmPortfolioItem = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "ERP Replacement",
  subtype: "Project",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  group_id: null,
  group_name: null,
  capex_planned: 1000,
  capex_actual: 250,
  opex_planned: 0,
  opex_actual: 0,
  stakeholders: [{ display_name: "Dana Fischer", role_key: "itProjectManager" }],
  latest_report: {
    report_date: "2026-02-01",
    schedule_health: "atRisk",
    cost_health: "onTrack",
    scope_health: "onTrack",
    reporter: { display_name: "Dana Fischer" },
    summary: "Vendor selection under way",
    accomplishments: "Shortlist agreed",
    next_steps: "Contract negotiation",
  },
};

const DASHBOARD: PpmPortfolioDashboard = {
  total_initiatives: 1,
  total_budget: 1000,
  health_schedule: { onTrack: 0, atRisk: 1, offTrack: 0, noReport: 0 },
};

function renderBoard(props: Partial<React.ComponentProps<typeof PpmPortfolioView>> = {}) {
  return render(
    <MemoryRouter>
      <PpmPortfolioView
        items={[ITEM]}
        dashboard={DASHBOARD}
        groupOptions={[]}
        subtypeDefs={[{ key: "Project", label: "Project" }]}
        loading={false}
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setViewportWidth(DESKTOP);
  // The sticky quarter header measures itself on resize to hide overlapping
  // labels; jsdom has no ResizeObserver and the measurement is irrelevant here.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("PpmPortfolioView row interaction", () => {
  it("opens the initiative detail when the name is clicked", () => {
    const onOpen = vi.fn();
    renderBoard({ onOpen });

    fireEvent.click(screen.getByText("ERP Replacement"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe(ITEM.id);
    expect(onOpen.mock.calls[0][1]).toBe("detail");
  });

  it("opens the reports tab when the last-report date is clicked", () => {
    const onOpen = vi.fn();
    renderBoard({ onOpen });

    fireEvent.click(screen.getByText("Feb-26"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][1]).toBe("reports");
  });

  it("renders no click handler at all when onOpen is omitted", () => {
    renderBoard();
    // Nothing throws and nothing navigates — the cells are inert. Clicking is
    // the observable half of the contract; the styling half is asserted below.
    fireEvent.click(screen.getByText("ERP Replacement"));
    fireEvent.click(screen.getByText("Feb-26"));
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
  });

  it("drops the pointer affordance when there is nothing to open", () => {
    const { unmount } = renderBoard({ onOpen: vi.fn() });
    const clickable = screen.getByText("ERP Replacement").parentElement!;
    expect(getComputedStyle(clickable).cursor).toBe("pointer");
    unmount();

    renderBoard();
    const inert = screen.getByText("ERP Replacement").parentElement!;
    expect(getComputedStyle(inert).cursor).not.toBe("pointer");
  });
});

describe("PpmPortfolioView withheld data", () => {
  it("hides the budget KPI when the figure is not published", () => {
    renderBoard({ dashboard: { ...DASHBOARD, total_budget: null } });
    expect(screen.queryByText("CHF1000")).toBeNull();
  });

  it("shows the budget KPI when the figure is published", () => {
    renderBoard();
    expect(screen.getByText("CHF1000")).toBeTruthy();
  });

  it("renders a row whose costs and people were withheld", () => {
    const withheld: PpmPortfolioItem = {
      ...ITEM,
      capex_planned: null,
      capex_actual: null,
      opex_planned: null,
      opex_actual: null,
      stakeholders: [],
      latest_report: {
        report_date: "2026-02-01",
        schedule_health: "atRisk",
        cost_health: "onTrack",
        scope_health: "onTrack",
        reporter: null,
        summary: null,
        accomplishments: null,
        next_steps: null,
      },
    };
    renderBoard({ items: [withheld] });
    // The board still renders: name, dates and health survive redaction.
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
    expect(screen.getByText("Feb-26")).toBeTruthy();
  });
});

describe("PpmPortfolioView opening state", () => {
  const OPTIONS = [
    { type_key: "Organization", label: "Organization" },
    { type_key: "Platform", label: "Platform" },
  ];

  /** The two MUI Selects, in render order: Group by, then Subtype. */
  const selects = () => screen.getAllByRole("combobox");

  it("opens on Organization with no subtype by default", () => {
    renderBoard({ groupOptions: OPTIONS });
    const [groupBy, subtype] = selects();
    expect(groupBy).toHaveTextContent("Organization");
    // No subtype preselected — the Select renders its zero-width-space
    // placeholder rather than "All", which is MUI's behaviour for an empty
    // value without `displayEmpty`.
    expect(subtype.textContent?.replace(/\u200b/g, "").trim()).toBe("");
  });

  it("opens on the grouping and subtype a portal configures", () => {
    renderBoard({
      groupOptions: OPTIONS,
      initialGroupBy: "Platform",
      initialSubtype: "Project",
    });
    const [groupBy, subtype] = selects();
    expect(groupBy).toHaveTextContent("Platform");
    expect(subtype).toHaveTextContent("Project");
  });

  it("tells its container which grouping to load", () => {
    const onGroupByChange = vi.fn();
    renderBoard({ groupOptions: OPTIONS, initialGroupBy: "Platform", onGroupByChange });
    // The container seeds its own fetch from the same default, so the board must
    // not fire on mount — only when the visitor actually changes the control.
    expect(onGroupByChange).not.toHaveBeenCalled();
  });
});

describe("PpmPortfolioView chrome", () => {
  const HEADING = "Project Portfolio Management";

  it("renders its own heading by default", () => {
    renderBoard();
    expect(screen.getByText(HEADING)).toBeTruthy();
  });

  it("suppresses the heading inside a portal, which has its own header", () => {
    renderBoard({ showTitle: false });
    expect(screen.queryByText(HEADING)).toBeNull();
  });
});
