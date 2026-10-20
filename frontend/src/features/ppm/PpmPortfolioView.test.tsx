/**
 * The portfolio board is rendered by two containers — the authenticated page and
 * the account-less web portal — that differ mainly in what a row click does.
 * These tests pin that contract, including the case where there is nothing to
 * click, so a future edit cannot leave a pointer affordance on a dead row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
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

/* ------------------------------------------------------------------ */
/*  Hierarchy and subtype sub-groups                                   */
/* ------------------------------------------------------------------ */

const PROGRAM: PpmPortfolioItem = {
  ...ITEM,
  id: "44444444-4444-4444-4444-444444444444",
  name: "Transformation",
  subtype: "Program",
  latest_report: null,
};
const PROJECT: PpmPortfolioItem = {
  ...ITEM,
  id: "55555555-5555-5555-5555-555555555555",
  name: "ERP Rollout",
  subtype: "Project",
  parent_id: PROGRAM.id,
  latest_report: null,
};
const STREAM: PpmPortfolioItem = {
  ...ITEM,
  id: "66666666-6666-6666-6666-666666666666",
  name: "Finance Stream",
  subtype: "Epic",
  parent_id: PROJECT.id,
  latest_report: null,
};
const TREE = [STREAM, PROJECT, PROGRAM];
const SUBTYPES = [
  { key: "Program", label: "Program" },
  { key: "Project", label: "Project" },
  { key: "Epic", label: "Epic" },
];

const nameCell = (name: string) => screen.getByText(name).closest("[data-depth]") as HTMLElement;
const rowNames = () =>
  Array.from(document.querySelectorAll("[data-depth]")).map(
    (el) => el.querySelector("p, span.MuiTypography-root")?.textContent,
  );
const hierarchySwitch = () => screen.getByLabelText("Show hierarchy");
const subtypeSwitch = () => screen.getByLabelText("Sub-group by subtype");

describe("PpmPortfolioView hierarchy", () => {
  it("offers the hierarchy only when some row has its parent on the board", () => {
    renderAt("/", { items: [ITEM, EPIC] });
    expect(screen.queryByLabelText("Show hierarchy")).toBeNull();
    expect(subtypeSwitch()).toBeTruthy();
  });

  it("is off on opening, and lists the rows flat", () => {
    renderAt("/", { items: TREE, subtypeDefs: SUBTYPES });
    expect(hierarchySwitch()).not.toBeChecked();
    expect(rowNames()).toEqual(["Finance Stream", "ERP Rollout", "Transformation"]);
    expect(screen.queryByRole("combobox", { name: "Display depth" })).toBeNull();
  });

  it("nests the rows by parent, indented, and carries the switch in the URL", () => {
    renderAt("/", { items: TREE, subtypeDefs: SUBTYPES });
    fireEvent.click(hierarchySwitch());

    expect(location()).toBe("?hierarchy=1");
    expect(rowNames()).toEqual(["Transformation", "ERP Rollout", "Finance Stream"]);
    expect(nameCell("Transformation").dataset.depth).toBe("0");
    expect(nameCell("ERP Rollout").dataset.depth).toBe("1");
    expect(nameCell("Finance Stream").dataset.depth).toBe("2");
    expect(getComputedStyle(nameCell("Transformation")).paddingLeft).toBe("12px");
    expect(getComputedStyle(nameCell("ERP Rollout")).paddingLeft).toBe("28px");
    expect(getComputedStyle(nameCell("Finance Stream")).paddingLeft).toBe("44px");
  });

  it("names each row's subtype while the tree is on", () => {
    renderAt("/", { items: TREE, subtypeDefs: SUBTYPES });
    expect(screen.queryByText("Program")).toBeNull();
    fireEvent.click(hierarchySwitch());
    expect(within(nameCell("Transformation")).getByText("Program")).toBeTruthy();
    expect(within(nameCell("Finance Stream")).getByText("Epic")).toBeTruthy();
  });

  it("gives a parent a chevron and a leaf the empty slot, so names line up", () => {
    renderAt("/?hierarchy=1", { items: TREE, subtypeDefs: SUBTYPES });
    const toggle = screen.getByRole("button", {
      name: "Show or hide the children: Transformation",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(nameCell("Transformation").contains(toggle)).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Show or hide the children: Finance Stream" }),
    ).toBeNull();
    expect(nameCell("Finance Stream").querySelector("[data-tree-spacer]")).not.toBeNull();
    expect(nameCell("Transformation").querySelector("[data-tree-spacer]")).toBeNull();
  });

  it("collapses a parent's whole subtree without opening it", () => {
    const onOpen = vi.fn();
    renderAt("/?hierarchy=1", { items: TREE, subtypeDefs: SUBTYPES, onOpen });
    const toggle = screen.getByRole("button", {
      name: "Show or hide the children: Transformation",
    });
    fireEvent.click(toggle);

    expect(onOpen).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(rowNames()).toEqual(["Transformation"]);
    // The group header still counts every member.
    expect(screen.getByText("— 3 projects")).toBeTruthy();

    fireEvent.click(toggle);
    expect(rowNames()).toEqual(["Transformation", "ERP Rollout", "Finance Stream"]);
  });

  it("caps the tree at the chosen depth and carries it in the URL", () => {
    renderAt("/?hierarchy=1", { items: TREE, subtypeDefs: SUBTYPES });
    const depth = screen.getByRole("combobox", { name: "Display depth" });
    expect(depth).toHaveTextContent("All levels");

    fireEvent.mouseDown(depth);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Level 1",
      "Level 2",
      "Level 3",
      "All levels",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Level 2" }));

    expect(location()).toBe("?hierarchy=1&depth=2");
    expect(rowNames()).toEqual(["Transformation", "ERP Rollout"]);
    // At the cap, a parent has nothing to unfold.
    expect(
      screen.queryByRole("button", { name: "Show or hide the children: ERP Rollout" }),
    ).toBeNull();
  });

  it("opens on the hierarchy and depth the URL carries", () => {
    renderAt("/?hierarchy=1&depth=1", { items: TREE, subtypeDefs: SUBTYPES });
    expect(hierarchySwitch()).toBeChecked();
    expect(rowNames()).toEqual(["Transformation"]);
  });

  it("nests inside each group: a parent in another group leaves a root", () => {
    renderAt("/?hierarchy=1", {
      items: [
        { ...PROGRAM, group_id: "g1", group_name: "Sales" },
        { ...PROJECT, group_id: "g2", group_name: "Finance" },
        { ...STREAM, group_id: "g2", group_name: "Finance" },
      ],
      subtypeDefs: SUBTYPES,
    });
    expect(nameCell("ERP Rollout").dataset.depth).toBe("0");
    expect(nameCell("Finance Stream").dataset.depth).toBe("1");
    // The depth menu is sized per group: no group shows a third level.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Display depth" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Level 1",
      "Level 2",
      "All levels",
    ]);
  });

  it("shows what the filters leave, with a hidden parent's children as roots", () => {
    renderAt("/?hierarchy=1&subtype=Project", { items: TREE, subtypeDefs: SUBTYPES });
    expect(rowNames()).toEqual(["ERP Rollout"]);
    expect(nameCell("ERP Rollout").dataset.depth).toBe("0");
  });

  it("indents and folds the mobile list the same way", () => {
    setViewportWidth(400);
    renderAt("/?hierarchy=1", { items: TREE, subtypeDefs: SUBTYPES });
    const card = (name: string) => screen.getByText(name).closest("[data-depth]") as HTMLElement;
    expect(card("Finance Stream").dataset.depth).toBe("2");
    expect(getComputedStyle(card("ERP Rollout")).paddingLeft).toBe("28px");
    fireEvent.click(
      screen.getByRole("button", { name: "Show or hide the children: ERP Rollout" }),
    );
    expect(screen.queryByText("Finance Stream")).toBeNull();
    expect(screen.getByText("ERP Rollout")).toBeTruthy();
  });
});

const NO_COST = { capex_planned: null, capex_actual: null, opex_planned: null, opex_actual: null };

describe("PpmPortfolioView subtype sub-groups", () => {
  const ROWS: PpmPortfolioItem[] = [
    { ...PROJECT, parent_id: null, group_id: "g1", group_name: "Sales", capex_planned: 100 },
    { ...STREAM, parent_id: null, group_id: "g1", group_name: "Sales", capex_planned: 50 },
    { ...PROGRAM, group_id: "g1", group_name: "Sales", ...NO_COST },
    { ...EPIC, subtype: null, group_id: "g1", group_name: "Sales", ...NO_COST },
  ];
  // The header's two texts, without the icon ligatures beside them.
  const subHeaders = () =>
    Array.from(document.querySelectorAll('[data-group-variant="sub"]')).map((el) =>
      Array.from(el.querySelectorAll("p"))
        .map((t) => t.textContent)
        .join(" "),
    );

  it("splits each group by subtype in metamodel order, none last, and keeps the URL", () => {
    renderAt("/", { items: ROWS, subtypeDefs: SUBTYPES });
    expect(subHeaders()).toEqual([]);
    fireEvent.click(subtypeSwitch());

    expect(location()).toBe("?bySubtype=1");
    expect(subHeaders()).toEqual([
      "Program — 1 project",
      "Project — 1 project",
      "Epic — 1 project",
      "— — 1 project",
    ]);
    // A totals row per sub-group with costs (Program and the none group have
    // none), plus the group's own.
    expect(screen.getAllByText(/Totals/)).toHaveLength(3);
  });

  it("collapses one sub-group on its own", () => {
    renderAt("/?bySubtype=1", { items: ROWS, subtypeDefs: SUBTYPES });
    expect(subtypeSwitch()).toBeChecked();
    fireEvent.click(screen.getByText("Project", { selector: "p" }));
    expect(screen.queryByText("ERP Rollout")).toBeNull();
    expect(screen.getByText("Finance Stream")).toBeTruthy();
    expect(screen.getAllByText(/Totals/)).toHaveLength(2);
  });

  it("is switched off and disabled while the hierarchy is on", () => {
    renderAt("/?bySubtype=1", { items: TREE, subtypeDefs: SUBTYPES });
    expect(subtypeSwitch()).toBeChecked();
    fireEvent.click(hierarchySwitch());

    expect(subtypeSwitch()).not.toBeChecked();
    expect(subtypeSwitch()).toBeDisabled();
    expect(location()).toBe("?hierarchy=1");
    expect(subHeaders()).toEqual([]);

    // Turning the tree off again does not bring the sub-groups back.
    fireEvent.click(hierarchySwitch());
    expect(subtypeSwitch()).not.toBeChecked();
    expect(subtypeSwitch()).toBeEnabled();
    expect(location()).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  Derived costs and dates on a parent without its own                */
/* ------------------------------------------------------------------ */

const COST_TIP = "No budget or cost lines of its own: total of the 1 initiative beneath it";
const DATES_TIP = "No dates of its own: spans the 1 initiative beneath it";

const PARENT: PpmPortfolioItem = {
  ...ITEM,
  id: "77777777-7777-7777-7777-777777777777",
  name: "Program X",
  subtype: "Program",
  start_date: null,
  end_date: null,
  capex_planned: 0,
  capex_actual: 0,
  opex_planned: 0,
  opex_actual: 0,
  latest_report: null,
  rollup: {
    descendant_count: 1,
    capex_planned: 300,
    capex_actual: 120,
    opex_planned: 0,
    opex_actual: 0,
    start_date: "2026-06-01",
    end_date: "2027-02-28",
  },
};
const CHILD: PpmPortfolioItem = {
  ...ITEM,
  id: "88888888-8888-8888-8888-888888888888",
  name: "Child Project",
  parent_id: PARENT.id,
  start_date: "2026-06-01",
  end_date: "2027-02-28",
  capex_planned: 300,
  capex_actual: 120,
  opex_planned: 0,
  opex_actual: 0,
  latest_report: null,
};

const derivedCosts = () => Array.from(document.querySelectorAll('[data-derived="costs"]'));

describe("PpmPortfolioView derived costs and dates", () => {
  it("draws a parent's derived costs outlined, italic and explained, outside the group totals", () => {
    renderBoard({ items: [PARENT, CHILD] });
    const [bar, ...rest] = derivedCosts();
    expect(rest).toHaveLength(0);
    expect(bar).toHaveAttribute("aria-label", COST_TIP);
    const label = within(bar as HTMLElement).getByText("120/300 CHF");
    expect(label).toHaveStyle({ fontStyle: "italic" });
    const fill = bar.firstElementChild!.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ border: "1px solid #1976d2", boxSizing: "border-box" });
    expect(getComputedStyle(fill).backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);

    // The child's own bar and the group totals row: filled, upright, and the
    // totals count the child's lines once (never 240/600).
    const labels = screen.getAllByText("120/300 CHF");
    expect(labels).toHaveLength(3);
    const own = labels.filter((l) => !l.closest("[data-derived]"));
    expect(own).toHaveLength(2);
    for (const l of own) expect(l).not.toHaveStyle({ fontStyle: "italic" });
    expect(screen.queryByText("240/600 CHF")).toBeNull();
    expect(own[0].previousElementSibling?.firstElementChild).toHaveStyle({
      backgroundColor: "#1976d2",
    });
  });

  it("outlines a derived over-budget bar and its band in the over-budget colour", () => {
    renderBoard({
      items: [{ ...PARENT, rollup: { ...PARENT.rollup!, capex_planned: 300, capex_actual: 360 } }],
    });
    const [bar] = derivedCosts();
    const [fill, band] = Array.from(bar.firstElementChild!.children) as HTMLElement[];
    for (const el of [fill, band]) {
      expect(el).toHaveStyle({ border: "1px solid #c62828", boxSizing: "border-box" });
      expect(getComputedStyle(el).backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
    }
    expect(within(bar as HTMLElement).getByText("360/300 CHF")).toHaveStyle({
      fontStyle: "italic",
    });
  });

  it("draws a parent's derived dates as a dashed bar over the span beneath, with italic quarters", () => {
    renderBoard({ items: [PARENT, CHILD] });
    const derived = screen.getByLabelText(`2026-06-01 → 2027-02-28 · ${DATES_TIP}`);
    const own = screen.getByLabelText("2026-06-01 → 2027-02-28");
    expect(derived).toHaveAttribute("data-derived", "dates");
    expect(own).not.toHaveAttribute("data-derived");
    expect(derived).toHaveStyle({ border: "1.5px dashed #1976d2", boxSizing: "border-box" });
    expect(getComputedStyle(derived).backgroundColor).toMatch(
      /^(transparent|rgba\(0, 0, 0, 0\))$/,
    );
    expect(getComputedStyle(own).backgroundColor).toBe("rgb(25, 118, 210)");
    const at = (el: HTMLElement) => [getComputedStyle(el).left, getComputedStyle(el).width];
    expect(at(derived)).toEqual(at(own));
    expect(getComputedStyle(derived).width).toMatch(/%$/);

    const plan = screen.getByLabelText(DATES_TIP);
    expect(plan).toHaveTextContent("Q2'26 / Q1'27");
    expect(plan).toHaveStyle({ fontStyle: "italic" });
    const ownPlans = screen.getAllByText("Q2'26 / Q1'27").filter((el) => el !== plan);
    expect(ownPlans).toHaveLength(1);
    expect(ownPlans[0]).not.toHaveStyle({ fontStyle: "italic" });
    expect(ownPlans[0]).not.toHaveAttribute("aria-label");
  });

  it("mixes own dates with derived costs part by part", () => {
    const parent: PpmPortfolioItem = {
      ...PARENT,
      start_date: "2026-07-01",
      end_date: "2026-08-31",
      rollup: { ...PARENT.rollup!, start_date: null, end_date: null },
    };
    renderBoard({ items: [parent, CHILD] });
    expect(derivedCosts()).toHaveLength(1);
    expect(document.querySelector('[data-derived="dates"]')).toBeNull();
    expect(screen.queryByLabelText(DATES_TIP)).toBeNull();
    expect(screen.getByLabelText("2026-07-01 → 2026-08-31")).toBeTruthy();
    expect(screen.getByText("Q3'26 / Q3'26")).not.toHaveStyle({ fontStyle: "italic" });
  });

  it("words a half-derived bar after the half that is derived", () => {
    // Its own budget against the actuals beneath it.
    renderBoard({
      items: [
        {
          ...PARENT,
          capex_planned: 300,
          rollup: { ...PARENT.rollup!, capex_planned: null, opex_planned: null },
        },
      ],
    });
    const [actualBar, ...rest] = derivedCosts();
    expect(rest).toHaveLength(0);
    expect(actualBar).toHaveAttribute(
      "aria-label",
      "No cost lines of its own: actuals of the 1 initiative beneath it",
    );
    expect(within(actualBar as HTMLElement).getByText("120/300 CHF")).toHaveStyle({
      fontStyle: "italic",
    });
  });

  it("words a derived budget against the row's own actuals", () => {
    renderBoard({
      items: [
        {
          ...PARENT,
          capex_actual: 45,
          rollup: { ...PARENT.rollup!, capex_actual: null, opex_actual: null },
        },
      ],
    });
    const [budgetBar] = derivedCosts();
    expect(budgetBar).toHaveAttribute(
      "aria-label",
      "No budget lines of its own: budget of the 1 initiative beneath it",
    );
    expect(within(budgetBar as HTMLElement).getByText("45/300 CHF")).toBeTruthy();
  });

  it("shows a mobile card's derived cost row and quarters", () => {
    setViewportWidth(400);
    renderBoard({ items: [PARENT] });
    expect(screen.getByText("CapEx")).toBeTruthy();
    const [bar] = derivedCosts();
    expect(bar).toHaveAttribute("aria-label", COST_TIP);
    expect(within(bar as HTMLElement).getByText("120/300 CHF")).toHaveStyle({
      fontStyle: "italic",
    });
    const plan = screen.getByLabelText(DATES_TIP);
    expect(plan).toHaveTextContent("Q2'26 – Q1'27");
    expect(plan).toHaveStyle({ fontStyle: "italic" });
  });
});

/* ------------------------------------------------------------------ */
/*  Grouping by an Initiative subtype                                  */
/* ------------------------------------------------------------------ */

describe("PpmPortfolioView grouped by a subtype", () => {
  // Program X has no lines or dates of its own (its figures are derived from
  // beneath); Program Y carries its own.
  const PROG_X: PpmPortfolioItem = {
    ...PARENT,
    group_id: PARENT.id,
    group_name: "Program X",
    group_anchor: true,
  };
  const IN_X: PpmPortfolioItem = { ...CHILD, group_id: PARENT.id, group_name: "Program X" };
  const PROG_Y: PpmPortfolioItem = {
    ...ITEM,
    id: "99999999-9999-9999-9999-999999999999",
    name: "Program Y",
    subtype: "Program",
    start_date: "2026-03-01",
    end_date: "2026-10-31",
    capex_planned: 500,
    capex_actual: 200,
    group_id: "99999999-9999-9999-9999-999999999999",
    group_name: "Program Y",
    group_anchor: true,
  };
  const IN_Y: PpmPortfolioItem = {
    ...ITEM,
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "Beta Project",
    parent_id: PROG_Y.id,
    group_id: PROG_Y.id,
    group_name: "Program Y",
    latest_report: null,
  };
  const LOOSE: PpmPortfolioItem = {
    ...ITEM,
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    name: "Loose Project",
    latest_report: null,
  };
  const BOARD = [PROG_X, IN_X, PROG_Y, IN_Y, LOOSE];
  const URL = "/?groupBy=subtype%3AProgram";
  const selects = () => screen.getAllByRole("combobox");
  const anchorLines = () =>
    Array.from(document.querySelectorAll("[data-anchor-line]")) as HTMLElement[];
  const headers = () =>
    Array.from(document.querySelectorAll('[data-group-variant="group"]')).map(
      (el) => el.querySelector("p")?.textContent,
    );

  it("offers the related card types and the Initiative subtypes as two sections", () => {
    const onGroupByChange = vi.fn();
    renderAt("/", {
      groupOptions: [{ type_key: "Organization", label: "Organization" }],
      subtypeDefs: SUBTYPES,
      onGroupByChange,
    });
    fireEvent.mouseDown(selects()[0]);
    const list = screen.getByRole("listbox");
    // MUI hands every child of a Select the option role; a section header is
    // the ListSubheader, which carries no tabindex and so cannot be picked.
    const kind = (li: Element) =>
      li.classList.contains("MuiListSubheader-root") ? "section" : "item";
    expect(Array.from(list.children).map((li) => [kind(li), li.textContent])).toEqual([
      ["section", "Related card types"],
      ["item", "Organization"],
      ["section", "Initiative subtypes"],
      ["item", "Program"],
      ["item", "Project"],
      ["item", "Epic"],
    ]);
    fireEvent.click(screen.getByText("Initiative subtypes"));
    expect(onGroupByChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: "Program" }));
    expect(onGroupByChange).toHaveBeenCalledWith("subtype:Program");
    expect(selects()[0]).toHaveTextContent("Program");
    expect(location()).toBe("?groupBy=subtype%3AProgram");
  });

  it("names a subtype by its label, never its key", () => {
    renderAt("/", { subtypeDefs: [{ key: "bigProgram", label: "Big program" }] });
    fireEvent.mouseDown(selects()[0]);
    expect(screen.getByRole("option", { name: "Big program" })).toHaveAttribute(
      "data-value",
      "subtype:bigProgram",
    );
  });

  it("offers no subtype section when Initiative defines no subtypes", () => {
    renderAt("/", {
      groupOptions: [{ type_key: "Organization", label: "Organization" }],
      subtypeDefs: [],
    });
    fireEvent.mouseDown(selects()[0]);
    expect(screen.getByText("Related card types")).toBeTruthy();
    expect(screen.queryByText("Initiative subtypes")).toBeNull();
    expect(
      Array.from(document.querySelectorAll("[role=listbox] .MuiMenuItem-root")).map(
        (o) => o.textContent,
      ),
    ).toEqual(["Organization"]);
  });

  it("shows each program as its group's header only, never as a row", () => {
    renderAt(URL, { items: BOARD, subtypeDefs: SUBTYPES });
    expect(headers()).toEqual(["Program X", "Program Y", "Ungrouped"]);
    expect(rowNames()).toEqual(["Child Project", "Beta Project", "Loose Project"]);
    expect(screen.getAllByText("— 1 project")).toHaveLength(3);
  });

  it("ends a program's group with its own figures, else the ones derived from beneath", () => {
    const onOpen = vi.fn();
    renderAt(URL, { items: BOARD, subtypeDefs: SUBTYPES, onOpen });
    const [x, y] = anchorLines();
    expect(anchorLines()).toHaveLength(2);
    // Labelled by the grouping subtype; only the ungrouped group keeps Totals.
    expect(x.children[0]).toHaveTextContent(/^Program$/);
    expect(y.children[0]).toHaveTextContent(/^Program$/);
    expect(screen.getAllByText(/Totals/)).toHaveLength(1);

    // Program X: derived — outlined costs, dashed dates, italic quarters.
    const [bar] = within(x).getAllByLabelText(COST_TIP);
    expect(bar).toHaveAttribute("data-derived", "costs");
    expect(within(bar).getByText("120/300 CHF")).toHaveStyle({ fontStyle: "italic" });
    const dates = within(x).getByLabelText(`2026-06-01 → 2027-02-28 · ${DATES_TIP}`);
    expect(dates).toHaveAttribute("data-derived", "dates");
    expect(within(x).getByText("Q2'26 / Q1'27")).toHaveStyle({ fontStyle: "italic" });

    // Program Y: its own lines and dates, filled and upright.
    expect(y.querySelector("[data-derived]")).toBeNull();
    expect(within(y).getByText("200/500 CHF")).not.toHaveStyle({ fontStyle: "italic" });
    expect(within(y).getByText("Q1'26 / Q4'26")).toBeTruthy();
    const ownBar = within(y).getByLabelText("2026-03-01 → 2026-10-31");

    // A header, not a row: no health dots, no report link, and nothing to open.
    for (const cell of [4, 5, 6, 9]) expect(y.children[cell].childElementCount).toBe(0);
    fireEvent.click(ownBar);
    fireEvent.click(dates);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("still shows a program with nothing beneath it, as a header over its line", () => {
    renderAt(URL, { items: [PROG_Y], subtypeDefs: SUBTYPES });
    expect(headers()).toEqual(["Program Y"]);
    expect(screen.getByText("— 0 projects")).toBeTruthy();
    expect(rowNames()).toEqual([]);
    expect(within(anchorLines()[0]).getByText("200/500 CHF")).toBeTruthy();
    expect(screen.queryByText("No initiatives found")).toBeNull();
  });

  it("hides the line with its group when the group is collapsed", () => {
    renderAt(URL, { items: BOARD, subtypeDefs: SUBTYPES });
    fireEvent.click(screen.getByText("Program X"));
    expect(anchorLines()).toHaveLength(1);
    expect(screen.queryByText("Child Project")).toBeNull();
  });

  it("offers no hierarchy when the only parents on the board are programs", () => {
    renderAt(URL, { items: BOARD, subtypeDefs: SUBTYPES });
    expect(screen.queryByLabelText("Show hierarchy")).toBeNull();
  });

  it("offers the hierarchy once something nests below a program's children", () => {
    const deeper: PpmPortfolioItem = {
      ...STREAM,
      parent_id: IN_X.id,
      group_id: PARENT.id,
      group_name: "Program X",
    };
    renderAt(`${URL}&hierarchy=1`, { items: [...BOARD, deeper], subtypeDefs: SUBTYPES });
    expect(hierarchySwitch()).toBeChecked();
    // The program's children are the tree's roots; the stream nests below.
    expect(nameCell("Child Project").dataset.depth).toBe("0");
    expect(nameCell("Finance Stream").dataset.depth).toBe("1");
  });

  it("keeps a program whose group kept a row under the search, and drops one that did not", () => {
    renderAt(URL, { items: BOARD, subtypeDefs: SUBTYPES });
    fireEvent.change(screen.getByPlaceholderText("Search initiatives..."), {
      target: { value: "child" },
    });
    expect(headers()).toEqual(["Program X"]);
    expect(anchorLines()).toHaveLength(1);
    expect(rowNames()).toEqual(["Child Project"]);
  });

  it("does not offer the grouping subtype in the subtype filter", () => {
    renderAt(URL, { items: BOARD, subtypeDefs: SUBTYPES });
    fireEvent.mouseDown(selects()[1]);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All", "Project"]);
  });

  it("shows the program's figures under its header on a phone", () => {
    setViewportWidth(400);
    renderAt(URL, { items: BOARD, subtypeDefs: SUBTYPES });
    const [x, y] = anchorLines();
    expect(anchorLines()).toHaveLength(2);
    expect(x.previousElementSibling).toHaveAttribute("data-group-variant", "group");
    expect(within(x).getByText("Program")).toBeTruthy();
    const [bar] = within(x).getAllByLabelText(COST_TIP);
    expect(within(bar).getByText("120/300 CHF")).toHaveStyle({ fontStyle: "italic" });
    const plan = within(x).getByLabelText(DATES_TIP);
    expect(plan).toHaveTextContent("Q2'26 – Q1'27");
    expect(within(y).getByText("200/500 CHF")).not.toHaveStyle({ fontStyle: "italic" });
    expect(within(y).getByText("Q1'26 – Q4'26")).toBeTruthy();
    expect(rowNames()).toEqual(["Child Project", "Beta Project", "Loose Project"]);
  });

  it("leaves out a phone line's cost bars when the program has no costs", () => {
    setViewportWidth(400);
    const bare: PpmPortfolioItem = { ...PROG_Y, capex_planned: 0, capex_actual: 0 };
    renderAt(URL, { items: [bare], subtypeDefs: SUBTYPES });
    expect(within(anchorLines()[0]).queryByText("CapEx")).toBeNull();
  });
});
