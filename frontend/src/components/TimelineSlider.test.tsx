/**
 * The pill row under the transition marks: the persistent answer to "which
 * cards change here?" that the marks themselves only count.
 *
 * jsdom gives every element a zero rect, so these assert on what the row
 * contains rather than where it sits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TimelineSlider from "./TimelineSlider";
import type { TimelineMilestoneCard } from "./TimelineSlider";

const ms = (iso: string) => new Date(iso).getTime();
const TODAY = ms("2026-06-15");
const GO_LIVE = ms("2027-03-01");
const RETIRE = ms("2028-09-01");

const MILESTONES = [
  { value: GO_LIVE, activating: 1, disappearing: 0 },
  { value: RETIRE, activating: 0, disappearing: 2 },
];

const CARDS: Record<number, TimelineMilestoneCard[]> = {
  [GO_LIVE]: [{ id: "a", name: "PLM Analytics Workbench", kind: "activating", color: "#0f7eb5" }],
  [RETIRE]: [
    { id: "b", name: "PTC Windchill", kind: "disappearing", color: "#0f7eb5" },
    { id: "c", name: "Windchill File Vault Server", kind: "disappearing", color: "#d29270" },
  ],
};

beforeEach(() => {
  // The slider measures its own width to thin year labels and merge crowded
  // marks; jsdom has no ResizeObserver and every rect is zero anyway, so the
  // component falls back to its nominal width — which is all these need.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function renderSlider(
  value: number,
  overrides: Partial<React.ComponentProps<typeof TimelineSlider>> = {},
) {
  const milestoneCards = vi.fn((from: number) => CARDS[from] ?? []);
  const utils = render(
    <TimelineSlider
      value={value}
      onChange={vi.fn()}
      dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
      yearMarks={[]}
      todayMs={TODAY}
      milestones={MILESTONES}
      milestoneCards={milestoneCards}
      {...overrides}
    />,
  );
  return { ...utils, milestoneCards };
}

describe("TimelineSlider transition pills", () => {
  it("shows no pills when the slider is between marks", () => {
    renderSlider(TODAY);
    expect(screen.queryByText("PTC Windchill")).toBeNull();
    expect(screen.queryByText("PLM Analytics Workbench")).toBeNull();
  });

  it("names the cards changing at the mark it is standing on", () => {
    renderSlider(RETIRE);
    expect(screen.getByText("PTC Windchill")).toBeInTheDocument();
    expect(screen.getByText("Windchill File Vault Server")).toBeInTheDocument();
    // Only this mark's cards — the other mark's card stays off the row.
    expect(screen.queryByText("PLM Analytics Workbench")).toBeNull();
  });

  it("heads each side of the row with a plus or minus marker", () => {
    // Queried by accessible name: the marker is a bare Material Symbol, so its
    // text content is the ligature ("remove"), not the glyph it renders.
    renderSlider(RETIRE);
    expect(screen.getByRole("img", { name: "2 cards retire" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /goes live/ })).toBeNull();

    renderSlider(GO_LIVE);
    expect(screen.getByRole("img", { name: "1 card goes live" })).toBeInTheDocument();
  });

  it("marks both sides when a date does both", () => {
    render(
      <TimelineSlider
        value={RETIRE}
        onChange={vi.fn()}
        dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
        yearMarks={[]}
        todayMs={TODAY}
        milestones={MILESTONES}
        milestoneCards={() => [
          { id: "in", name: "Successor", kind: "activating" },
          { id: "out", name: "Predecessor", kind: "disappearing" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "1 card goes live" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 card retires" })).toBeInTheDocument();
  });

  it("lists a card on both sides when it arrives and retires in the same span", async () => {
    // Real case on a merged mark: a card goes live and is retired again before
    // the span is out. It gets a pill under the plus AND under the minus, and
    // each one spotlights the change it names — the plus pulses it live, the
    // minus pulses it retiring — even though both name the same card.
    const onMilestoneCardClick = vi.fn();
    render(
      <TimelineSlider
        value={RETIRE}
        onChange={vi.fn()}
        dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
        yearMarks={[]}
        todayMs={TODAY}
        milestones={MILESTONES}
        milestoneCards={() => [
          { id: "stopgap", name: "Interim Bridge", kind: "activating" },
          { id: "stopgap", name: "Interim Bridge", kind: "disappearing" },
        ]}
        onMilestoneCardClick={onMilestoneCardClick}
      />,
    );

    expect(screen.getByRole("img", { name: "1 card goes live" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 card retires" })).toBeInTheDocument();
    const pills = screen.getAllByText("Interim Bridge");
    expect(pills).toHaveLength(2);

    await userEvent.click(pills[0]);
    await userEvent.click(pills[1]);
    expect(onMilestoneCardClick.mock.calls.map(([c]) => c.kind)).toEqual([
      "activating",
      "disappearing",
    ]);
  });

  it("still matches a mark a day off the value, since a drag cannot land exactly", () => {
    // MUI snaps a dragged value to `min + n * step`, which essentially never
    // coincides with a mark's epoch; only a click or an arrow step does.
    renderSlider(GO_LIVE - 86_400_000 + 1);
    expect(screen.getByText("PLM Analytics Workbench")).toBeInTheDocument();
  });

  it("collapses a crowded date into a +N more chip", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `card-${i}`,
      name: `Card ${i}`,
      kind: "disappearing" as const,
    }));
    render(
      <TimelineSlider
        value={RETIRE}
        onChange={vi.fn()}
        dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
        yearMarks={[]}
        todayMs={TODAY}
        milestones={MILESTONES}
        milestoneCards={() => many}
      />,
    );
    expect(screen.getByText("Card 0")).toBeInTheDocument();
    expect(screen.queryByText("Card 10")).toBeNull();
    expect(screen.getByText("+4 more")).toBeInTheDocument();
  });

  it("hands the clicked card back so the consumer can spotlight it", async () => {
    const onMilestoneCardClick = vi.fn();
    renderSlider(RETIRE, { onMilestoneCardClick });
    await userEvent.click(screen.getByText("PTC Windchill"));
    expect(onMilestoneCardClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b", kind: "disappearing" }),
    );
  });

  it("renders no row at all when the consumer supplies no card lookup", () => {
    render(
      <TimelineSlider
        value={RETIRE}
        onChange={vi.fn()}
        dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
        yearMarks={[]}
        todayMs={TODAY}
        milestones={MILESTONES}
      />,
    );
    expect(screen.queryByLabelText("Cards changing on this date")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stepping between marks
// ---------------------------------------------------------------------------

describe("TimelineSlider step-through", () => {
  /** Regression: the arrows called `onChange` alone, so stepping to a mark
   *  navigated without spotlighting while clicking the same mark did both. */
  it("spotlights the mark it steps forward onto, not just the date", async () => {
    const onChange = vi.fn();
    const onMilestoneClick = vi.fn();
    renderSlider(TODAY, { onChange, onMilestoneClick });

    await userEvent.click(screen.getByRole("button", { name: /Next change/i }));

    expect(onChange).toHaveBeenCalledWith(GO_LIVE);
    expect(onMilestoneClick).toHaveBeenCalledWith(GO_LIVE, GO_LIVE);
  });

  it("spotlights the mark it steps back onto", async () => {
    const onChange = vi.fn();
    const onMilestoneClick = vi.fn();
    renderSlider(RETIRE, { onChange, onMilestoneClick });

    await userEvent.click(screen.getByRole("button", { name: /Previous change/i }));

    expect(onChange).toHaveBeenCalledWith(GO_LIVE);
    expect(onMilestoneClick).toHaveBeenCalledWith(GO_LIVE, GO_LIVE);
  });

  it("spotlights the whole cluster when the mark it lands on is a merged one", async () => {
    // Two dates three days apart inside a ten-year range render as one mark
    // (jsdom measures nothing, so the slider falls back to its nominal width).
    // The pill row lists both, so the spotlight has to cover both — stepping
    // onto the bare date would pulse half of what is named right below it.
    const SECOND = GO_LIVE + 3 * 86_400_000;
    const onMilestoneClick = vi.fn();
    render(
      <TimelineSlider
        value={TODAY}
        onChange={vi.fn()}
        dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
        yearMarks={[]}
        todayMs={TODAY}
        milestones={[
          { value: GO_LIVE, activating: 1, disappearing: 0 },
          { value: SECOND, activating: 0, disappearing: 1 },
        ]}
        onMilestoneClick={onMilestoneClick}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Next change/i }));
    expect(onMilestoneClick).toHaveBeenCalledWith(GO_LIVE, SECOND);
  });

  it("names the span it covers when a mark stands for several dates", async () => {
    // A merged mark used to state its earliest date and nothing else, so a
    // change absorbed into a busy one looked unmarked — the report of "I set an
    // active date and got no go-live mark" was an arrival merged into a mark
    // three months away, with 28 cards on it.
    const SECOND = GO_LIVE + 3 * 86_400_000;
    render(
      <TimelineSlider
        value={TODAY}
        onChange={vi.fn()}
        dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
        yearMarks={[]}
        todayMs={TODAY}
        milestones={[
          { value: GO_LIVE, activating: 1, disappearing: 0 },
          { value: SECOND, activating: 0, disappearing: 1 },
        ]}
      />,
    );

    const mark = screen.getByRole("button", { name: /Jump to this change/i });
    expect(mark).toHaveAccessibleName(/Mar 1, 2027 – Mar 4, 2027/);
    expect(mark).toHaveAccessibleName(/1 card goes live/);
    expect(mark).toHaveAccessibleName(/1 card retires/);
  });

  it("widens a merged mark, and colours a mark by what it does", () => {
    // One bar, not two: blue where cards only arrive, red where they only
    // retire, purple where the mark does both — and wider when it stands for
    // more than one date. Width is the only thing on screen saying a mark
    // covers a span, which is what a change absorbed into a crowded neighbour
    // needs in order not to look unmarked.
    const SECOND = GO_LIVE + 3 * 86_400_000;
    const bar = (el: Element) => getComputedStyle(el.firstElementChild!);

    const { unmount } = render(
      <TimelineSlider
        value={TODAY}
        onChange={vi.fn()}
        dateRange={{ min: ms("2020-01-01"), max: ms("2030-01-01") }}
        yearMarks={[]}
        todayMs={TODAY}
        milestones={[
          { value: GO_LIVE, activating: 1, disappearing: 0 },
          { value: SECOND, activating: 0, disappearing: 1 },
        ]}
      />,
    );
    const merged = bar(screen.getByRole("button", { name: /Jump to this change/i }));
    // Merged AND mixed: it absorbed an arrival and a retirement.
    expect(merged.width).toBe("7px");
    expect(merged.backgroundColor).toBe("rgb(156, 39, 176)");
    unmount();

    renderSlider(TODAY);
    const marks = screen.getAllByRole("button", { name: /Jump to this change/i });
    // MILESTONES: one pure go-live, one pure retirement, neither merged.
    expect(bar(marks[0]).width).toBe("3px");
    expect(bar(marks[0]).backgroundColor).toBe("rgb(1, 119, 255)");
    expect(bar(marks[1]).backgroundColor).toBe("rgb(244, 67, 54)");
  });

  it("names a single date when a mark stands for one", () => {
    renderSlider(TODAY);
    const marks = screen.getAllByRole("button", { name: /Jump to this change/i });
    expect(marks[0]).toHaveAccessibleName(/^Mar 1, 2027 —/);
  });

  it("still works as plain navigation when no consumer wants the spotlight", async () => {
    const onChange = vi.fn();
    renderSlider(TODAY, { onChange });
    await userEvent.click(screen.getByRole("button", { name: /Next change/i }));
    expect(onChange).toHaveBeenCalledWith(GO_LIVE);
  });
});

/**
 * Year labels. jsdom reports `clientWidth` 0, so these stub it — deliberately
 * per-test rather than globally, because the merged-mark tests above lean on
 * the component's nominal-width fallback.
 */
describe("TimelineSlider year labels", () => {
  const jan1 = (y: number) => new Date(y, 0, 1).getTime();
  const YEAR_MARKS = Array.from({ length: 18 }, (_, i) => ({
    value: jan1(2017 + i),
    label: String(2017 + i),
  }));
  // The axis the reported screenshot had: 2017…2034 with a year of padding.
  const RANGE = { min: jan1(2017) - 365.25 * 86_400_000, max: jan1(2034) + 365.25 * 86_400_000 };
  // Must stay within ten years of the first mark, or the slider's own cap
  // truncates the axis before the labels are ever thinned.
  const YEARS_TODAY = TODAY;

  function stubTrackWidth(px: number) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => px,
    });
  }

  afterEach(() => {
    // An own property on the prototype; deleting it re-exposes jsdom's getter.
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  const renderYears = (width: number, overrides = {}) => {
    stubTrackWidth(width);
    return render(
      <TimelineSlider
        value={YEARS_TODAY}
        onChange={vi.fn()}
        dateRange={RANGE}
        yearMarks={YEAR_MARKS}
        todayMs={YEARS_TODAY}
        {...overrides}
      />,
    );
  };

  const labelEls = () => Array.from(document.querySelectorAll(".MuiSlider-markLabel"));
  const labelText = () => labelEls().map((e) => e.textContent);

  it("spaces the labels evenly and does not force the final year", () => {
    renderYears(480);
    expect(labelText()).toEqual([
      "2017",
      "2019",
      "2021",
      "2023",
      "2025",
      "2027",
      "2029",
      "2031",
      "2033",
    ]);
    expect(labelText()).not.toContain("2034");
  });

  it("labels a single stride of marks", () => {
    // The assertion that would have caught the bug: the old code produced
    // …,"16","17" — the last label one stride after its neighbour instead of
    // two, which is why 2033 and 2034 overlapped.
    renderYears(480);
    expect(labelEls().map((e) => e.getAttribute("data-index"))).toEqual([
      "0",
      "2",
      "4",
      "6",
      "8",
      "10",
      "12",
      "14",
      "16",
    ]);
  });

  it("keeps a tick for every year it labels only some of", () => {
    renderYears(480);
    expect(document.querySelectorAll(".MuiSlider-mark")).toHaveLength(18);
    expect(labelEls()).toHaveLength(9);
  });

  it("renders no empty label spans for the thinned years", () => {
    renderYears(480);
    expect(labelText().every((t) => t !== "")).toBe(true);
  });

  it("labels every year when there is room", () => {
    renderYears(1600);
    expect(labelEls()).toHaveLength(18);
    expect(labelText()).toContain("2034");
  });

  it("falls back to a single label on a very narrow slider", () => {
    renderYears(24);
    expect(labelText()).toEqual(["2017"]);
    expect(document.querySelectorAll(".MuiSlider-mark")).toHaveLength(18);
  });

  it("drops marks older than the ten-year cap", () => {
    stubTrackWidth(480);
    render(
      <TimelineSlider
        value={TODAY}
        onChange={vi.fn()}
        dateRange={{ min: jan1(2010), max: jan1(2030) }}
        yearMarks={[{ value: jan1(2010), label: "2010" }, ...YEAR_MARKS.slice(0, 8)]}
        todayMs={TODAY}
      />,
    );
    expect(labelText()).not.toContain("2010");
    // today − 10y is mid-2016, so 2017 onwards survive the cap.
    expect(labelText()).toContain("2017");
  });
});

describe("TimelineSlider out-of-range value", () => {
  it("pins the thumb to the axis while the read-out keeps the real date", () => {
    // A saved report can carry a date the current data no longer spans.
    const max = ms("2030-01-01");
    renderSlider(ms("2032-06-01"), { dateRange: { min: ms("2020-01-01"), max } });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", String(max));
    expect(screen.getByText("Jun 1, 2032")).toBeInTheDocument();
  });

  it("pins a date before the axis start to the axis start", () => {
    const min = ms("2020-01-01");
    renderSlider(ms("2011-01-01"), { dateRange: { min, max: ms("2030-01-01") } });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", String(min));
  });
});
