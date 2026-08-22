/**
 * The pill row under the transition marks: the persistent answer to "which
 * cards change here?" that the marks themselves only count.
 *
 * jsdom gives every element a zero rect, so these assert on what the row
 * contains rather than where it sits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("still works as plain navigation when no consumer wants the spotlight", async () => {
    const onChange = vi.fn();
    renderSlider(TODAY, { onChange });
    await userEvent.click(screen.getByRole("button", { name: /Next change/i }));
    expect(onChange).toHaveBeenCalledWith(GO_LIVE);
  });
});
