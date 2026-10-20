/**
 * PpmOverviewTab — the initiative snapshot. Pins the Description panel's
 * heading, which is the shared `common:labels.description` key, so it follows
 * the user's language like the rest of the tab; the completion KPI's load
 * (stale replies ignored, a failure shown as one); the timeline dates in the
 * workspace format; the RAG dots in the theme's RAG colours; and the line
 * naming what the initiatives beneath this one add up to.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type {
  Card,
  PpmBudgetLine,
  PpmCostLine,
  PpmRollupOut,
  PpmStatusReport,
} from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";
import i18n from "@/i18n";
import PpmOverviewTab from "./PpmOverviewTab";

const CARD = {
  id: "i1",
  type: "Initiative",
  name: "ERP Migration",
  description: "Move finance to the new ERP",
  subtype: null,
  attributes: {},
} as unknown as Card;

const ROLLUP_NONE: PpmRollupOut = {
  descendant_count: 0,
  capex_planned: 0,
  capex_actual: 0,
  opex_planned: 0,
  opex_actual: 0,
  total_planned: 0,
  total_actual: 0,
  start_date: null,
  end_date: null,
  has_budget_lines: false,
  has_cost_lines: false,
  by_year: [],
};

function renderTab(card: Card = CARD) {
  render(
    <PpmOverviewTab
      card={card}
      latestReport={null}
      costLines={[]}
      budgetLines={[]}
      rollup={ROLLUP_NONE}
    />,
  );
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  mockApi.on("get", "/ppm/initiatives/i1/completion", { completion: 40, wbs_count: 3 });
});

describe("PpmOverviewTab — description", () => {
  it("heads the initiative's description", async () => {
    renderTab();
    await screen.findByText("40%");
    const heading = screen.getByText("Description");
    expect(heading.nextElementSibling).toHaveTextContent("Move finance to the new ERP");
  });

  it("heads the description in the user's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      renderTab();
      await screen.findByText("40%");
      expect(screen.getByText("Beschreibung").nextElementSibling).toHaveTextContent(
        "Move finance to the new ERP",
      );
      expect(screen.queryByText("Description")).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("leaves the panel out when the initiative has no description", async () => {
    renderTab({ ...CARD, description: null } as unknown as Card);
    await screen.findByText("40%");
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });
});

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Let every pending promise callback run (a macrotask runs after all microtasks). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

const NO_WBS = "No work packages yet";

/**
 * The loading indicator in the Completion panel: an indeterminate progress bar
 * (no value), unlike the budget bars and the completion ring itself.
 */
const completionSpinner = () =>
  (screen.getByText("Completion").parentElement as HTMLElement).querySelector(
    '[role="progressbar"]:not([aria-valuenow])',
  );

describe("PpmOverviewTab — completion", () => {
  it("shows progress, not the no-work-packages state, while the completion loads", () => {
    mockApi.on("get", "/ppm/initiatives/i1/completion", () => new Promise(() => {}));
    renderTab();
    expect(completionSpinner()).not.toBeNull();
    expect(screen.queryByText(NO_WBS)).not.toBeInTheDocument();
  });

  it("says there are no work packages yet when the initiative has none, instead of a 0% ring", async () => {
    mockApi.on("get", "/ppm/initiatives/i1/completion", { completion: 0, wbs_count: 0 });
    renderTab();
    expect(await screen.findByText("No work packages yet")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows a 0% ring, not the no-work-packages state, when the work packages exist but nothing is done", async () => {
    mockApi.on("get", "/ppm/initiatives/i1/completion", { completion: 0, wbs_count: 2 });
    renderTab();
    expect(await screen.findByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("No work packages yet")).not.toBeInTheDocument();
  });

  it("shows a failed completion load as an error, not as no work packages", async () => {
    mockApi.fail("get", "/ppm/initiatives/i1/completion", 500);
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GET /ppm/initiatives/i1/completion failed",
    );
    expect(screen.queryByText(NO_WBS)).not.toBeInTheDocument();
    expect(screen.queryByText("Average completion across work packages")).not.toBeInTheDocument();
  });

  it("falls back to a generic message when the completion fails without one", async () => {
    mockApi.on("get", "/ppm/initiatives/i1/completion", () => Promise.reject(new Error("")));
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("ignores a completion that lands after it was pointed at another initiative", async () => {
    const slow = deferred<{ completion: number }>();
    mockApi.on("get", "/ppm/initiatives/i1/completion", () => slow.promise);
    mockApi.on("get", "/ppm/initiatives/i2/completion", { completion: 70 });
    const { rerender } = render(
      <PpmOverviewTab card={CARD} latestReport={null} costLines={[]} budgetLines={[]} rollup={null} />,
    );
    rerender(
      <PpmOverviewTab
        card={{ ...CARD, id: "i2" } as Card}
        latestReport={null}
        costLines={[]}
        budgetLines={[]}
        rollup={null}
      />,
    );
    expect(await screen.findByText("70%")).toBeInTheDocument();

    // The first initiative's figure lands last; it must not replace the second's.
    slow.resolve({ completion: 40 });
    await settle();
    expect(screen.queryByText("40%")).not.toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("does not show the previous initiative's figure while the next one loads", async () => {
    mockApi.on("get", "/ppm/initiatives/i2/completion", () => new Promise(() => {}));
    const { rerender } = render(
      <PpmOverviewTab card={CARD} latestReport={null} costLines={[]} budgetLines={[]} rollup={null} />,
    );
    await screen.findByText("40%");
    rerender(
      <PpmOverviewTab
        card={{ ...CARD, id: "i2" } as Card}
        latestReport={null}
        costLines={[]}
        budgetLines={[]}
        rollup={null}
      />,
    );
    await waitFor(() => expect(screen.queryByText("40%")).not.toBeInTheDocument());
    expect(completionSpinner()).not.toBeNull();
  });
});

describe("PpmOverviewTab — timeline", () => {
  it("shows the start and end dates in the workspace date format", async () => {
    hookState.dateFormat = "DD/MM/YYYY";
    renderTab({
      ...CARD,
      attributes: { startDate: "2026-03-01", endDate: "2026-11-30" },
    } as unknown as Card);
    await screen.findByText("40%");
    expect(screen.getByText("Start Date").nextElementSibling).toHaveTextContent("01/03/2026");
    expect(screen.getByText("End Date").nextElementSibling).toHaveTextContent("30/11/2026");
  });

  it("shows a dash for a date that is not set", async () => {
    renderTab();
    await screen.findByText("40%");
    expect(screen.getByText("Start Date").nextElementSibling).toHaveTextContent("—");
    expect(screen.getByText("End Date").nextElementSibling).toHaveTextContent("—");
  });
});

describe("PpmOverviewTab — health summary", () => {
  const report = (overrides: Partial<PpmStatusReport>): PpmStatusReport => ({
    id: "r1",
    initiative_id: "i1",
    reporter_id: "u1",
    reporter: null,
    report_date: "2026-09-01",
    schedule_health: "onTrack",
    cost_health: "atRisk",
    scope_health: "offTrack",
    summary: null,
    accomplishments: null,
    next_steps: null,
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    ...overrides,
  });

  /** The dot drawn before a health dimension's label. */
  const dotOf = (label: string) => screen.getByText(label).previousElementSibling as HTMLElement;

  it("paints each dimension's dot in the theme's RAG colour", async () => {
    render(
      <PpmOverviewTab card={CARD} latestReport={report({})} costLines={[]} budgetLines={[]} rollup={null} />,
    );
    await screen.findByText("40%");
    expect(dotOf("Schedule")).toHaveStyle({ backgroundColor: RAG_COLORS.green });
    expect(dotOf("Cost")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
    expect(dotOf("Scope")).toHaveStyle({ backgroundColor: RAG_COLORS.red });
  });

  it("paints a health value it does not know in the neutral colour", async () => {
    render(
      <PpmOverviewTab
        card={CARD}
        latestReport={report({ schedule_health: "unknown" })}
        costLines={[]}
        budgetLines={[]}
        rollup={null}
      />,
    );
    await screen.findByText("40%");
    expect(dotOf("Schedule")).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
  });
});

describe("PpmOverviewTab — beneath this initiative", () => {
  const ROLLUP: PpmRollupOut = {
    ...ROLLUP_NONE,
    descendant_count: 3,
    capex_planned: 1000,
    capex_actual: 400,
    opex_planned: 200,
    opex_actual: 50,
    total_planned: 1200,
    total_actual: 450,
    start_date: "2026-02-01",
    end_date: "2027-03-31",
    by_year: [
      {
        year: 2026,
        capex_budget: 1000,
        opex_budget: 200,
        capex_actual: 400,
        opex_actual: 50,
      },
    ],
  };
  const OWN_BUDGET: PpmBudgetLine[] = [
    {
      id: "b1",
      initiative_id: "i1",
      fiscal_year: 2026,
      category: "capex",
      description: null,
      amount: 70,
      created_at: "2026-01-01T00:00:00",
      updated_at: "2026-01-01T00:00:00",
    },
  ];
  const OWN_COSTS = [
    {
      id: "c1",
      initiative_id: "i1",
      description: "Licences",
      category: "opex",
      planned: 0,
      actual: 30,
      date: "2026-03-01",
    },
  ] as unknown as PpmCostLine[];
  const beneath = () => screen.queryByTestId("ppm-beneath");
  const show = (
    rollup: PpmRollupOut | null,
    budgetLines: PpmBudgetLine[] = OWN_BUDGET,
    costLines: PpmCostLine[] = OWN_COSTS,
  ) =>
    render(
      <PpmOverviewTab
        card={CARD}
        latestReport={null}
        costLines={costLines}
        budgetLines={budgetLines}
        rollup={rollup}
      />,
    );
  /** The KPI value under a caption. */
  const kpi = (caption: string) => screen.getByText(caption).nextElementSibling as HTMLElement;
  /** The LinearProgress of a budget bar, by its label. */
  const barOf = (label: string) =>
    (screen.getByText(label).parentElement!.nextElementSibling as HTMLElement);
  /** The [actual, budget] figures of a budget bar's caption. */
  const captionOf = (label: string) =>
    Array.from(
      (screen.getByText(label).nextElementSibling as HTMLElement).querySelectorAll("span"),
    );
  const BUDGET_TIP = "No budget lines of its own: budget of the 3 initiatives beneath it";
  const ACTUAL_TIP = "No cost lines of its own: actuals of the 3 initiatives beneath it";

  it("names the count, the summed figures and the span of the initiatives beneath", async () => {
    hookState.dateFormat = "DD/MM/YYYY";
    show(ROLLUP);
    const block = await screen.findByTestId("ppm-beneath");
    expect(block.children).toHaveLength(3);
    expect(block.children[0]).toHaveTextContent("Beneath this initiative: 3 initiatives");
    expect(block.children[1]).toHaveTextContent("Budget $1200 · Actual $450");
    expect(block.children[2]).toHaveTextContent("From 01/02/2026 to 31/03/2027");
  });

  it("uses the singular for one initiative and a dash for a missing side of the span", async () => {
    show({ ...ROLLUP, descendant_count: 1, start_date: null });
    const block = await screen.findByTestId("ppm-beneath");
    expect(block.children[0]).toHaveTextContent("Beneath this initiative: 1 initiative");
    expect(block.children[0]).not.toHaveTextContent("initiatives");
    expect(block.children[2]).toHaveTextContent("From — to 2027-03-31");
  });

  it("leaves the span out when the initiatives beneath have no dates", async () => {
    show({ ...ROLLUP, start_date: null, end_date: null });
    const block = await screen.findByTestId("ppm-beneath");
    expect(block.children).toHaveLength(2);
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument();
  });

  it("is absent when nothing is beneath the initiative", async () => {
    renderTab();
    await screen.findByText("40%");
    expect(beneath()).toBeNull();
  });

  it("is absent, with no error, when the roll-up could not be read", async () => {
    show(null, [], []);
    await screen.findByText("40%");
    expect(beneath()).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(kpi("Total Budget")).toHaveTextContent("$0");
    expect(kpi("Total Budget").querySelector("[data-derived]")).toBeNull();
  });

  it("reads the KPI figures in thousands or millions so the derived mark cannot wrap them", async () => {
    // 5.71M beneath against 70 of its own budget: the derived actual reads in
    // millions, the own budget (below a thousand) exactly, the variance in millions.
    show(
      {
        ...ROLLUP,
        capex_actual: 5_700_000,
        opex_actual: 10_000,
        total_actual: 5_710_000,
        by_year: [{ ...ROLLUP.by_year[0], capex_actual: 5_700_000, opex_actual: 10_000 }],
      },
      OWN_BUDGET,
      [],
    );
    await screen.findByTestId("ppm-beneath");
    expect(kpi("Total Actual")).toHaveTextContent("subdirectory_arrow_right5.7 MUSD");
    expect(kpi("Total Budget")).toHaveTextContent("$70");
    expect(kpi("Variance")).toHaveTextContent("-5.7 MUSD");
    // The explanation line keeps the exact figures: it is a sentence, not a cell.
    expect(beneath()!.children[1]).toHaveTextContent("Budget $1200 · Actual $5710000");
  });

  it("keeps both sides its own when it has lines of both kinds", async () => {
    show(ROLLUP);
    await screen.findByTestId("ppm-beneath");
    expect(kpi("Total Budget")).toHaveTextContent("$70");
    expect(kpi("Total Actual")).toHaveTextContent("$30");
    expect(kpi("Variance")).toHaveTextContent("$40");
    for (const caption of ["Total Budget", "Total Actual", "Variance"]) {
      expect(kpi(caption).querySelector("[data-derived]")).toBeNull();
    }
    const bar = barOf("Total");
    expect(bar).not.toHaveAttribute("data-derived-budget");
    expect(bar).not.toHaveAttribute("data-derived-actual");
    expect(bar).toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0.04)" });
    expect(bar.firstElementChild).toHaveStyle({ backgroundColor: "rgb(25, 118, 210)" });
  });

  it("derives only the budget when the initiative has no budget lines", async () => {
    show(ROLLUP, []);
    await screen.findByTestId("ppm-beneath");
    const budget = within(kpi("Total Budget")).getByLabelText(BUDGET_TIP);
    expect(budget).toHaveTextContent("subdirectory_arrow_right1.2 kUSD");
    expect(budget).toHaveStyle({ fontStyle: "italic" });
    expect(budget).toHaveAttribute("data-derived", "true");
    expect(kpi("Total Actual")).toHaveTextContent("$30");
    expect(kpi("Total Actual").querySelector("[data-derived]")).toBeNull();
    // The variance compares the derived budget with the own actuals.
    expect(screen.getAllByLabelText(BUDGET_TIP)).toHaveLength(2);
    expect(kpi("Variance")).toHaveTextContent("1.2 kUSD");

    const bar = barOf("Total");
    expect(bar).toHaveAttribute("data-derived-budget", "true");
    expect(bar).not.toHaveAttribute("data-derived-actual");
    expect(bar).toHaveStyle({ border: "1px solid #1976d2", boxSizing: "border-box" });
    expect(getComputedStyle(bar).backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
    expect(bar.firstElementChild).toHaveStyle({ backgroundColor: "rgb(25, 118, 210)" });
    const [ownActual, derivedBudget] = captionOf("Total");
    expect(ownActual).toHaveTextContent("0");
    expect(ownActual).not.toHaveStyle({ fontStyle: "italic" });
    expect(derivedBudget).toHaveTextContent("1");
    expect(derivedBudget).toHaveStyle({ fontStyle: "italic" });
    // CapEx reads the derived CapEx budget against the own (zero) CapEx actuals,
    // OpEx the derived OpEx budget against the own OpEx actuals.
    expect(screen.getByText("CapEx").nextElementSibling).toHaveTextContent("0/1 kUSD (0%)");
    expect(screen.getByText("OpEx").nextElementSibling).toHaveTextContent("30/200 USD (15%)");
    // Only one side derived: the beneath line still gives both figures.
    expect(beneath()!.children[1]).toHaveTextContent("Budget $1200 · Actual $450");
  });

  it("derives only the actuals when the initiative has no cost lines", async () => {
    show(ROLLUP, OWN_BUDGET, []);
    await screen.findByTestId("ppm-beneath");
    const actual = within(kpi("Total Actual")).getByLabelText(ACTUAL_TIP);
    expect(actual).toHaveTextContent("$450");
    expect(actual).toHaveStyle({ fontStyle: "italic" });
    expect(kpi("Total Budget")).toHaveTextContent("$70");
    expect(kpi("Total Budget").querySelector("[data-derived]")).toBeNull();
    expect(within(kpi("Variance")).getByLabelText(ACTUAL_TIP)).toHaveTextContent("$-380");

    const bar = barOf("Total");
    expect(bar).toHaveAttribute("data-derived-actual", "true");
    expect(bar).not.toHaveAttribute("data-derived-budget");
    expect(bar).toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0.04)" });
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ border: "1px solid #c62828", boxSizing: "border-box" });
    expect(getComputedStyle(fill).backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
    const [derivedActual, ownBudget] = captionOf("Total");
    expect(derivedActual).toHaveTextContent("450");
    expect(derivedActual).toHaveStyle({ fontStyle: "italic" });
    expect(ownBudget).toHaveTextContent("70");
    expect(ownBudget).not.toHaveStyle({ fontStyle: "italic" });
    expect(screen.getByText("CapEx").nextElementSibling).toHaveTextContent("400/70 USD (571%)");
    expect(screen.getByText("OpEx").nextElementSibling).toHaveTextContent("50/0 USD");
  });

  it("derives both sides, explains the variance with both and drops the figures line", async () => {
    show(ROLLUP, [], []);
    const block = await screen.findByTestId("ppm-beneath");
    expect(within(kpi("Total Budget")).getByLabelText(BUDGET_TIP)).toHaveTextContent("1.2 kUSD");
    expect(within(kpi("Total Actual")).getByLabelText(ACTUAL_TIP)).toHaveTextContent("$450");
    expect(
      within(kpi("Variance")).getByLabelText(`${BUDGET_TIP} · ${ACTUAL_TIP}`),
    ).toHaveTextContent("$750");
    const bar = barOf("Total");
    expect(bar).toHaveAttribute("data-derived-budget", "true");
    expect(bar).toHaveAttribute("data-derived-actual", "true");
    // The KPIs carry the figures: the block keeps the count and the span.
    expect(block.children).toHaveLength(2);
    expect(block).not.toHaveTextContent("Budget $1200");
    expect(block.children[1]).toHaveTextContent("From");
  });

  it("names a single initiative beneath in the singular", async () => {
    show({ ...ROLLUP, descendant_count: 1 }, [], OWN_COSTS);
    await screen.findByTestId("ppm-beneath");
    expect(
      screen.getAllByLabelText(
        "No budget lines of its own: budget of the 1 initiative beneath it",
      ),
    ).toHaveLength(2);
  });
});
