/**
 * PpmOverviewTab — the initiative snapshot. Pins the Description panel's
 * heading, which is the shared `common:labels.description` key, so it follows
 * the user's language like the rest of the tab; the completion KPI's load
 * (stale replies ignored, a failure shown as one); the timeline dates in the
 * workspace format; and the RAG dots in the theme's RAG colours.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Card, PpmStatusReport } from "@/types";

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

function renderTab(card: Card = CARD) {
  render(<PpmOverviewTab card={card} latestReport={null} costLines={[]} budgetLines={[]} />);
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
      <PpmOverviewTab card={CARD} latestReport={null} costLines={[]} budgetLines={[]} />,
    );
    rerender(
      <PpmOverviewTab
        card={{ ...CARD, id: "i2" } as Card}
        latestReport={null}
        costLines={[]}
        budgetLines={[]}
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
      <PpmOverviewTab card={CARD} latestReport={null} costLines={[]} budgetLines={[]} />,
    );
    await screen.findByText("40%");
    rerender(
      <PpmOverviewTab
        card={{ ...CARD, id: "i2" } as Card}
        latestReport={null}
        costLines={[]}
        budgetLines={[]}
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
      <PpmOverviewTab card={CARD} latestReport={report({})} costLines={[]} budgetLines={[]} />,
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
      />,
    );
    await screen.findByText("40%");
    expect(dotOf("Schedule")).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
  });
});
