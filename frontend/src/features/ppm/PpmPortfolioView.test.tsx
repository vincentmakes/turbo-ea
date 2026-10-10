/**
 * The portfolio board is rendered by two containers — the authenticated page and
 * the account-less web portal — that differ mainly in what a row click does.
 * These tests pin that contract, including the case where there is nothing to
 * click, so a future edit cannot leave a pointer affordance on a dead row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
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

describe("PpmPortfolioView groups", () => {
  const GROUPED: PpmPortfolioItem = { ...ITEM, group_id: "org-1", group_name: "Sales" };
  const UNGROUPED: PpmPortfolioItem = {
    ...ITEM,
    id: "22222222-2222-2222-2222-222222222222",
    name: "Data Platform",
  };

  it("collapses a group's rows and totals on the desktop grid, and expands them again", () => {
    renderBoard({ items: [GROUPED, UNGROUPED] });
    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.getAllByText("— 1 project")).toHaveLength(2);
    expect(screen.getAllByText(/Totals/)).toHaveLength(2);

    fireEvent.click(screen.getByText("Sales"));
    expect(screen.queryByText("ERP Replacement")).toBeNull();
    expect(screen.getAllByText(/Totals/)).toHaveLength(1);
    // The other group is untouched.
    expect(screen.getByText("Data Platform")).toBeTruthy();

    fireEvent.click(screen.getByText("Sales"));
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
    expect(screen.getAllByText(/Totals/)).toHaveLength(2);
  });

  it("lists the ungrouped initiatives last, under their own heading", () => {
    renderBoard({ items: [UNGROUPED, GROUPED] });
    const headings = screen.getAllByText(/^(Sales|Ungrouped)$/).map((el) => el.textContent);
    expect(headings).toEqual(["Sales", "Ungrouped"]);
  });

  it("collapses a group on the mobile list too", () => {
    setViewportWidth(400);
    renderBoard({ items: [GROUPED] });
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
    fireEvent.click(screen.getByText("Sales"));
    expect(screen.queryByText("ERP Replacement")).toBeNull();
    fireEvent.click(screen.getByText("— 1 project"));
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
  });
});

describe("PpmPortfolioView report preview", () => {
  it("shows the latest report's summary, accomplishments and next steps on hover", () => {
    renderBoard();
    fireEvent.mouseEnter(screen.getByText("Feb-26"));
    expect(screen.getByText("Reporter: Dana Fischer")).toBeTruthy();
    for (const text of [
      "Summary",
      "Vendor selection under way",
      "Accomplishments",
      "Shortlist agreed",
      "Next Steps",
      "Contract negotiation",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("leaves out each section the report does not fill in", () => {
    renderBoard({
      items: [
        {
          ...ITEM,
          latest_report: {
            ...ITEM.latest_report!,
            summary: null,
            accomplishments: "Shortlist agreed",
            next_steps: "",
          },
        },
      ],
    });
    fireEvent.mouseEnter(screen.getByText("Feb-26"));
    expect(screen.getByText("Shortlist agreed")).toBeTruthy();
    expect(screen.queryByText("Summary")).toBeNull();
    expect(screen.queryByText("Next Steps")).toBeNull();
  });
});

/** Renders the router's current query string, so a test can read the URL the board wrote. */
function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location">{search}</output>;
}

function renderAt(url: string, props: Partial<React.ComponentProps<typeof PpmPortfolioView>> = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PpmPortfolioView
        items={[ITEM]}
        dashboard={DASHBOARD}
        groupOptions={[]}
        subtypeDefs={[{ key: "Project", label: "Project" }]}
        loading={false}
        {...props}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId("location").textContent;

const EPIC: PpmPortfolioItem = {
  ...ITEM,
  id: "33333333-3333-3333-3333-333333333333",
  name: "Data Platform",
  subtype: "Epic",
};

describe("PpmPortfolioView filters", () => {
  const selects = () => screen.getAllByRole("combobox");
  const pick = (select: HTMLElement, option: string) => {
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole("option", { name: option }));
  };

  it("narrows the rows to a search and carries it in the URL", () => {
    renderAt("/", { items: [ITEM, EPIC] });
    const box = screen.getByPlaceholderText("Search initiatives...");
    fireEvent.change(box, { target: { value: "data" } });
    expect(screen.queryByText("ERP Replacement")).toBeNull();
    expect(screen.getByText("Data Platform")).toBeTruthy();
    expect(location()).toBe("?search=data");

    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
    expect(location()).toBe("");
  });

  it("narrows the rows to a subtype", () => {
    renderAt("/", { items: [ITEM, EPIC] });
    pick(selects()[1], "Epic");
    expect(screen.queryByText("ERP Replacement")).toBeNull();
    expect(screen.getByText("Data Platform")).toBeTruthy();
    expect(location()).toBe("?subtype=Epic");
  });

  it("regroups on a new grouping and tells its container", () => {
    const onGroupByChange = vi.fn();
    renderAt("/", {
      groupOptions: [
        { type_key: "Organization", label: "Organization" },
        { type_key: "Platform", label: "Platform" },
      ],
      onGroupByChange,
    });
    pick(selects()[0], "Platform");
    expect(onGroupByChange).toHaveBeenCalledWith("Platform");
    expect(selects()[0]).toHaveTextContent("Platform");
    expect(location()).toBe("?groupBy=Platform");
  });

  it("opens on the filters the URL carries", () => {
    renderAt("/?search=erp&subtype=Project", { items: [ITEM, EPIC] });
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
    expect(screen.queryByText("Data Platform")).toBeNull();
    expect(screen.getByPlaceholderText("Search initiatives...")).toHaveValue("erp");
  });

  it("says so when nothing matches", () => {
    renderAt("/", { items: [ITEM] });
    expect(screen.queryByText("No initiatives found")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search initiatives..."), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No initiatives found")).toBeTruthy();
  });
});

describe("PpmPortfolioView desktop row", () => {
  it("names the project manager", () => {
    renderBoard();
    expect(screen.getByText("Dana Fischer")).toBeTruthy();
  });

  it("opens the initiative from its timeline bar", () => {
    const onOpen = vi.fn();
    renderBoard({ onOpen });
    fireEvent.click(screen.getByLabelText("2026-01-01 \u2192 2026-12-31"));
    expect(onOpen).toHaveBeenCalledWith(ITEM);
  });

  it("draws no bar for an initiative without dates", () => {
    renderBoard({ items: [{ ...ITEM, start_date: null }] });
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
    expect(screen.queryByLabelText(/\u2192/)).toBeNull();
  });

  it("labels the health counts beside the KPI dots", () => {
    renderBoard();
    expect(screen.getByText("At Risk")).toBeTruthy();
  });
});

describe("PpmPortfolioView mobile card", () => {
  beforeEach(() => setViewportWidth(400));

  it("opens the initiative from its name, and its reports from the report date", () => {
    const onOpen = vi.fn();
    renderBoard({ onOpen });
    fireEvent.click(screen.getByText("ERP Replacement"));
    expect(onOpen).toHaveBeenLastCalledWith(ITEM, "detail");
    fireEvent.click(screen.getByText("Feb-26"));
    expect(onOpen).toHaveBeenLastCalledWith(ITEM, "reports");
  });

  it("shows the subtype, the manager and both cost bars", () => {
    renderBoard({ items: [{ ...ITEM, opex_planned: 400, opex_actual: 100 }] });
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("Dana Fischer")).toBeTruthy();
    expect(screen.getByText("CapEx")).toBeTruthy();
    expect(screen.getByText("OpEx")).toBeTruthy();
  });

  it("leaves out the subtype and the cost bars when there are none", () => {
    renderBoard({
      items: [{ ...ITEM, subtype: null, capex_planned: 0, capex_actual: null }],
    });
    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.queryByText("CapEx")).toBeNull();
  });

  it("renders a card with no manager", () => {
    renderBoard({ items: [{ ...ITEM, stakeholders: [] }] });
    expect(screen.getByText("ERP Replacement")).toBeTruthy();
    expect(screen.queryByText("Dana Fischer")).toBeNull();
  });

  it("drops the KPI health labels and keeps the counts", () => {
    renderBoard();
    expect(screen.queryByText("At Risk")).toBeNull();
  });

  it("says so when nothing matches", () => {
    renderBoard({ items: [] });
    expect(screen.getByText("No initiatives found")).toBeTruthy();
  });
});

describe("PpmPortfolioView report preview timing", () => {
  const SUMMARY = "Vendor selection under way";

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(1000);
    });

  it("closes shortly after the pointer leaves the date", () => {
    renderBoard();
    fireEvent.mouseEnter(screen.getByText("Feb-26"));
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    fireEvent.mouseLeave(screen.getByText("Feb-26"));
    settle();
    expect(screen.queryByText(SUMMARY)).toBeNull();
  });

  it("stays open when the pointer comes back to the date in time", () => {
    renderBoard();
    const date = screen.getByText("Feb-26");
    fireEvent.mouseEnter(date);
    fireEvent.mouseLeave(date);
    fireEvent.mouseEnter(date);
    settle();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
  });

  it("stays open while the pointer is over the preview itself", () => {
    renderBoard();
    const date = screen.getByText("Feb-26");
    fireEvent.mouseEnter(date);
    fireEvent.mouseLeave(date);
    fireEvent.mouseEnter(screen.getByText(SUMMARY).closest(".MuiPopover-paper")!);
    settle();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
  });
});
