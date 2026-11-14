import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { alpha, createTheme } from "@mui/material/styles";
import { PRIORITY_COLORS, RAG_COLORS, brand } from "@/theme/tokens";
import type { PpmTask, PpmWbs } from "@/types";
import PpmScheduleTimeline, { COMPACT_QUARTERS_OVER, MILESTONE_SIZE } from "./PpmScheduleTimeline";

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (s: string) => `D(${s})` }),
}));

const { palette } = createTheme();

const wbs = (o: Partial<PpmWbs> = {}): PpmWbs => ({
  id: "w",
  initiative_id: "i1",
  parent_id: null,
  title: "Package",
  description: null,
  start_date: "2025-01-11",
  end_date: "2025-01-20",
  sort_order: 0,
  is_milestone: false,
  completion: 40,
  assignee_id: null,
  assignee_name: null,
  progress: 0,
  task_count: 0,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  ...o,
});

const task = (o: Partial<PpmTask> = {}): PpmTask => ({
  id: "t",
  initiative_id: "i1",
  title: "Task",
  description: null,
  status: "in_progress",
  priority: "high",
  assignee_id: null,
  assignee_name: null,
  start_date: "2025-01-11",
  due_date: "2025-01-20",
  sort_order: 0,
  tags: [],
  wbs_id: null,
  comment_count: 0,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  ...o,
});

// Every fixture below sits in Q1 2025 (90 days): one day is 100 / 90 %.
const DAY = 100 / 90;
const IN_Q1 = new Date(2025, 1, 15); // day 45
const AFTER = new Date(2030, 0, 1);

const rowOf = (title: string) => screen.getByText(title).closest("[data-export-row]") as HTMLElement;
const markOf = (title: string, kind: string) =>
  rowOf(title).querySelector(`[data-mark="${kind}"]`) as HTMLElement | null;
const pctOf = (el: HTMLElement, prop: string) => parseFloat(getComputedStyle(el).getPropertyValue(prop));

const SPAN = wbs({ id: "range", title: "Range", start_date: "2025-01-01", end_date: "2025-03-31" });

describe("PpmScheduleTimeline", () => {
  it("renders nothing for an initiative with no packages and no tasks", () => {
    const { container } = render(<PpmScheduleTimeline wbs={[]} tasks={[]} now={IN_Q1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists packages and tasks in schedule order, indented by depth, unassigned last under their heading", () => {
    const { container } = render(
      <PpmScheduleTimeline
        wbs={[
          wbs({ id: "w2", title: "Second root", sort_order: 2 }),
          wbs({ id: "w1", title: "First root", sort_order: 1 }),
          wbs({ id: "w1a", parent_id: "w1", title: "Child", sort_order: 1 }),
        ]}
        tasks={[
          task({ id: "t1", wbs_id: "w1", title: "Root task" }),
          task({ id: "t2", wbs_id: "w1a", title: "Deep task" }),
          task({ id: "t3", wbs_id: null, title: "Loose task" }),
        ]}
        now={IN_Q1}
      />,
    );
    // The body's rows, read through the table's roles: the head row is not among them.
    const [, body] = screen.getAllByRole("rowgroup");
    const rows = within(body).getAllByRole("row");
    expect(rows.every((r) => r.hasAttribute("data-export-row"))).toBe(true);
    expect(container.querySelectorAll("[data-export-row]")).toHaveLength(rows.length);
    expect(
      rows.map((r) => (r.dataset.group !== undefined ? `#${r.textContent}` : `${r.dataset.kind}`)),
    ).toEqual([
      "#account_treeWork Breakdown5",
      "wbs",
      "task",
      "wbs",
      "task",
      "wbs",
      "#assignmentUnassigned Tasks1",
      "task",
    ]);
    // A group heading spans every column.
    expect(within(rows[0]).getByRole("cell")).toHaveAttribute("colspan", "4");
    expect(rows.filter((r) => r.dataset.kind).map((r) => r.querySelector("p")!.textContent)).toEqual([
      "First root",
      "Root task",
      "Child",
      "Deep task",
      "Second root",
      "Loose task",
    ]);
    const depth = (title: string) =>
      screen.getByText(title).closest("[data-depth]")!.getAttribute("data-depth");
    expect(["First root", "Root task", "Child", "Deep task", "Loose task"].map(depth)).toEqual([
      "0",
      "1",
      "1",
      "2",
      "0",
    ]);
    // The title cell keeps a table cell's own 16 px, then 16 px a level, as the board nests.
    expect(screen.getByText("Deep task").closest("[data-depth]")).toHaveStyle({ paddingLeft: "48px" });
    expect(screen.getByText("Root task").closest("[data-depth]")).toHaveStyle({ paddingLeft: "32px" });
    expect(screen.getByText("First root").closest("[data-depth]")).toHaveStyle({ paddingLeft: "16px" });
    expect(screen.getByText("Deep task").closest("[data-depth]")!.tagName).toBe("TD");
    // A root package reads bold, anything nested regular.
    expect(screen.getByText("First root")).toHaveStyle({ fontWeight: 600 });
    expect(screen.getByText("Child")).toHaveStyle({ fontWeight: 400 });
  });

  it("has no group headings when every task sits in a package, or none does", () => {
    const { container, rerender } = render(
      <PpmScheduleTimeline wbs={[wbs({ id: "w1" })]} tasks={[task({ wbs_id: "w1" })]} now={IN_Q1} />,
    );
    expect(container.querySelector("[data-group]")).toBeNull();
    rerender(<PpmScheduleTimeline wbs={[]} tasks={[task({ title: "Alone" })]} now={IN_Q1} />);
    expect(container.querySelector("[data-group]")).toBeNull();
    expect(rowOf("Alone")).toBeInTheDocument();
  });

  it("gives every row its dates and owner beneath the title", () => {
    render(
      <PpmScheduleTimeline
        wbs={[wbs({ title: "Owned", assignee_name: "Grace" }), wbs({ id: "x", title: "Bare", start_date: null, end_date: null })]}
        tasks={[task({ title: "Half", start_date: null, due_date: "2025-02-01", assignee_name: null })]}
        now={IN_Q1}
      />,
    );
    expect(within(rowOf("Owned")).getByText("D(2025-01-11) – D(2025-01-20) · Owner: Grace")).toBeInTheDocument();
    expect(within(rowOf("Half")).getByText("– D(2025-02-01)")).toBeInTheDocument();
    expect(within(rowOf("Bare")).queryByText(/D\(|Owner/)).toBeNull();
    expect(
      screen.getByText("Bare").closest("[data-depth]")!.querySelector(".MuiTypography-caption"),
    ).toBeNull();
  });

  it("places bars at their dates on the quarter scale, a package's filled to its completion", () => {
    render(
      <PpmScheduleTimeline
        wbs={[SPAN, wbs({ id: "p", title: "Pkg", completion: 40 })]}
        tasks={[task({ title: "Tsk", start_date: "2025-01-31", due_date: "2025-02-09", status: "done" })]}
        now={AFTER}
      />,
    );
    const pkg = markOf("Pkg", "bar")!;
    expect(pctOf(pkg, "inset-inline-start")).toBeCloseTo(10 * DAY, 3);
    expect(pctOf(pkg, "width")).toBeCloseTo(10 * DAY, 3);
    expect(pkg).toHaveStyle({ backgroundColor: brand.primaryLight, height: "16px", borderRadius: "8px" });
    const fill = pkg.querySelector("[data-fill]") as HTMLElement;
    expect(fill).toHaveStyle({ width: "40%", backgroundColor: brand.primary });
    const tsk = markOf("Tsk", "bar")!;
    expect(pctOf(tsk, "inset-inline-start")).toBeCloseTo(30 * DAY, 3);
    expect(pctOf(tsk, "width")).toBeCloseTo(10 * DAY, 3);
    expect(tsk).toHaveStyle({ backgroundColor: RAG_COLORS.green, height: "16px" });
    expect(tsk.querySelector("[data-fill]")).toBeNull();
    const range = markOf("Range", "bar")!;
    expect(pctOf(range, "inset-inline-start")).toBe(0);
    expect(pctOf(range, "width")).toBeCloseTo(100, 3);
  });

  it("caps a package's fill at 0 and 100 %", () => {
    render(
      <PpmScheduleTimeline
        wbs={[wbs({ id: "a", title: "Over", completion: 140 }), wbs({ id: "b", title: "Under", completion: -5 })]}
        tasks={[]}
        now={AFTER}
      />,
    );
    expect(markOf("Over", "bar")!.querySelector("[data-fill]")).toHaveStyle({ width: "100%" });
    expect(markOf("Under", "bar")!.querySelector("[data-fill]")).toHaveStyle({ width: "0%" });
  });

  it("shows a package's completion with a PercentBar and a task's status and priority chips", () => {
    render(
      <PpmScheduleTimeline
        wbs={[wbs({ id: "p", title: "Pkg", completion: 63 })]}
        tasks={[task({ title: "Tsk", status: "blocked", priority: "critical" })]}
        now={AFTER}
      />,
    );
    const bar = within(rowOf("Pkg")).getByRole("img", { name: "63%" });
    expect(bar.querySelector(".MuiLinearProgress-root")).not.toBeNull();
    expect(within(rowOf("Pkg")).queryByText("Blocked")).toBeNull();
    const status = within(rowOf("Tsk")).getByText("Blocked").closest(".MuiChip-root");
    expect(status).toHaveStyle({ backgroundColor: RAG_COLORS.red, color: palette.common.white });
    const priority = within(rowOf("Tsk")).getByText("Critical").closest(".MuiChip-root");
    expect(priority).toHaveClass("MuiChip-outlined");
    expect(priority).toHaveStyle({ borderColor: PRIORITY_COLORS.critical });
    expect(within(rowOf("Tsk")).queryByRole("img")).toBeNull();
  });

  it("marks a milestone with the Gantt's diamond at its end date, else its start", () => {
    render(
      <PpmScheduleTimeline
        wbs={[
          SPAN,
          wbs({ id: "m1", title: "Go live", is_milestone: true, start_date: "2025-01-11", end_date: "2025-01-31" }),
          wbs({ id: "m2", title: "Kick-off", is_milestone: true, start_date: "2025-01-11", end_date: null }),
          wbs({ id: "m3", title: "Someday", is_milestone: true, start_date: null, end_date: null }),
        ]}
        tasks={[]}
        now={AFTER}
      />,
    );
    expect(MILESTONE_SIZE).toEqual({ lane: 12, title: 9 });
    const m1 = markOf("Go live", "milestone")!;
    // A shape, not an icon-font glyph: the PowerPoint export drops those.
    expect(m1.querySelector(".material-symbols-outlined")).toBeNull();
    expect(m1).toHaveTextContent("");
    const diamond = m1.querySelector("[data-milestone-diamond]") as HTMLElement;
    expect(diamond).toHaveStyle({
      width: "12px",
      height: "12px",
      transform: "rotate(45deg)",
      backgroundColor: brand.primary,
    });
    expect(pctOf(m1, "inset-inline-start")).toBeCloseTo(30 * DAY, 3);
    expect(getComputedStyle(m1).marginInlineStart).toBe("-6px");
    expect(getComputedStyle(m1).marginTop).toBe("-6px");
    expect(markOf("Go live", "bar")).toBeNull();
    expect(pctOf(markOf("Kick-off", "milestone")!, "inset-inline-start")).toBeCloseTo(10 * DAY, 3);
    expect(markOf("Someday", "milestone")).toBeNull();
    // The title carries a smaller diamond too, so the row says it without the lane.
    const titleCell = rowOf("Someday").querySelector("td") as HTMLElement;
    expect(titleCell.querySelector("[data-milestone-diamond]")).toHaveStyle({ width: "9px", height: "9px" });
    expect(rowOf("Range").querySelector("[data-milestone-diamond]")).toBeNull();
    expect(rowOf("Someday").querySelector(".material-symbols-outlined")).toBeNull();
  });

  it("gives a one-date item a dot at that date and an undated one no mark", () => {
    render(
      <PpmScheduleTimeline
        wbs={[SPAN, wbs({ id: "one", title: "One date", start_date: null, end_date: "2025-01-31" })]}
        tasks={[
          task({ title: "Due only", start_date: null, due_date: "2025-01-11", status: "todo" }),
          task({ id: "u", title: "Undated", start_date: null, due_date: null }),
        ]}
        now={AFTER}
      />,
    );
    const pkgDot = markOf("One date", "point")!;
    expect(pctOf(pkgDot, "inset-inline-start")).toBeCloseTo(30 * DAY, 3);
    expect(pkgDot).toHaveStyle({ backgroundColor: brand.primary, width: "10px", height: "10px" });
    // Centred on its date: pulled back by half its width along the inline axis.
    expect(getComputedStyle(pkgDot).marginInlineStart).toBe("-5px");
    const taskDot = markOf("Due only", "point")!;
    expect(pctOf(taskDot, "inset-inline-start")).toBeCloseTo(10 * DAY, 3);
    expect(markOf("Due only", "bar")).toBeNull();
    const undated = rowOf("Undated");
    expect(undated.querySelector("[data-mark]")).toBeNull();
    // Its lane is still there, so the rules run through it.
    expect(undated.querySelector("[data-lane]")).not.toBeNull();
  });

  it("draws the now line through every lane when today is on the scale, and keys it in the legend", () => {
    const { container } = render(
      <PpmScheduleTimeline wbs={[SPAN]} tasks={[task({ title: "Tsk" })]} now={IN_Q1} />,
    );
    const lines = [...container.querySelectorAll("[data-now-line]")] as HTMLElement[];
    expect(lines).toHaveLength(2);
    expect(pctOf(lines[0], "inset-inline-start")).toBeCloseTo(45 * DAY, 3);
    expect(lines[0]).toHaveStyle({ backgroundColor: palette.error.main, opacity: "0.3" });
    expect(container.querySelector('[data-legend-item="today"]')).toHaveTextContent("Today");
  });

  it("has no now line and no today key when today is off the scale", () => {
    const { container } = render(<PpmScheduleTimeline wbs={[SPAN]} tasks={[]} now={AFTER} />);
    expect(container.querySelector("[data-now-line]")).toBeNull();
    expect(container.querySelector('[data-legend-item="today"]')).toBeNull();
    expect(container.querySelector("[data-schedule-legend]")).not.toBeNull();
  });

  it("labels the quarters as the Portfolio does and rules them through the lanes, year starts darker", () => {
    const { container } = render(
      <PpmScheduleTimeline
        wbs={[wbs({ title: "Long", start_date: "2024-11-01", end_date: "2025-05-01" })]}
        tasks={[]}
        now={AFTER}
      />,
    );
    const labels = [...container.querySelectorAll("[data-qlabel]")].map((el) => el.textContent);
    expect(labels).toEqual(["Q4'24", "Q1'25", "Q2'25"]);
    // The scale is the table's header row, inside <thead>, so print repeats it on every page.
    const head = container.querySelector("[data-schedule-head]") as HTMLElement;
    expect(head.closest("thead")).not.toBeNull();
    expect(head).toHaveStyle({ backgroundColor: palette.action.hover });
    const headers = within(head).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Title", "Q4'24Q1'25Q2'25", "Progress", "Priority"]);
    expect(headers[1]).toHaveAttribute("data-scale");
    expect(within(head).getByText("Q1'25")).toHaveClass("MuiTypography-caption");
    expect(screen.getByRole("table")).toHaveClass("MuiTable-root");
    expect(screen.getByRole("table").closest(".MuiTableContainer-root")).toHaveClass(
      "MuiPaper-outlined",
    );
    const rules = [...rowOf("Long").querySelectorAll("[data-rule]")] as HTMLElement[];
    // No rule at the scale's own start edge.
    expect(rules.map((r) => r.dataset.rule)).toEqual(["year", "quarter"]);
    expect(rules[0]).toHaveStyle({ backgroundColor: palette.divider });
    expect(rules[1]).toHaveStyle({ backgroundColor: alpha(palette.text.primary, 0.05) });
  });

  it(`labels only each year's first quarter past ${COMPACT_QUARTERS_OVER} quarters`, () => {
    const { container, rerender } = render(
      <PpmScheduleTimeline
        wbs={[wbs({ start_date: "2024-04-01", end_date: "2027-03-31" })]}
        tasks={[]}
        now={AFTER}
      />,
    );
    // Q2'24 .. Q1'27: exactly 12 quarters, all labelled.
    expect(container.querySelectorAll("[data-qlabel]")).toHaveLength(COMPACT_QUARTERS_OVER);
    rerender(
      <PpmScheduleTimeline
        wbs={[wbs({ start_date: "2024-04-01", end_date: "2027-04-01" })]}
        tasks={[]}
        now={AFTER}
      />,
    );
    const labels = [...container.querySelectorAll("[data-qlabel]")].map((el) => el.textContent);
    expect(labels).toEqual(["Q2'24", "Q1'25", "Q1'26", "Q1'27"]);
  });

  it("leaves the lane column, the scale and the legend out when nothing has dates", () => {
    const { container } = render(
      <PpmScheduleTimeline
        wbs={[wbs({ title: "No dates", start_date: null, end_date: null })]}
        tasks={[task({ title: "Nor this", start_date: null, due_date: null })]}
        now={IN_Q1}
      />,
    );
    expect(container.querySelector("[data-lane]")).toBeNull();
    expect(container.querySelector("[data-qlabel]")).toBeNull();
    expect(container.querySelector("[data-schedule-legend]")).toBeNull();
    expect(container.querySelector("[data-scale]")).toBeNull();
    expect(
      within(container.querySelector("[data-schedule-head]") as HTMLElement)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Title", "Progress", "Priority"]);
    expect(rowOf("No dates").children).toHaveLength(3);
    expect(rowOf("Nor this")).toHaveTextContent("In Progress");
    expect(rowOf("Nor this").children).toHaveLength(3);
  });

  it("keys every mark the lanes use", () => {
    const { container } = render(<PpmScheduleTimeline wbs={[SPAN]} tasks={[]} now={AFTER} />);
    const items = [...container.querySelectorAll("[data-legend-item]")] as HTMLElement[];
    expect(items.map((el) => el.textContent)).toEqual([
      "Work package (fill shows completion)",
      "Task: To Do",
      "Task: In Progress",
      "Task: Done",
      "Task: Blocked",
      "Milestone",
      "One date only",
    ]);
    const swatch = (key: string) =>
      container.querySelector(`[data-legend-item="${key}"] [data-legend-swatch]`) as HTMLElement;
    expect(swatch("wbs")).toHaveStyle({ backgroundColor: brand.primaryLight });
    expect(swatch("blocked")).toHaveStyle({ backgroundColor: RAG_COLORS.red });
    expect(swatch("in_progress")).toHaveStyle({ backgroundColor: brand.primary });
    expect(swatch("point")).toHaveStyle({ borderRadius: "50%", width: "10px" });
    expect(items[5].querySelector("[data-milestone-diamond]")).toHaveStyle({
      width: "9px",
      transform: "rotate(45deg)",
      backgroundColor: brand.primary,
    });
  });

  it("marks every item row and group heading as an unsplittable print row", () => {
    const { container } = render(
      <PpmScheduleTimeline
        wbs={[wbs({ id: "w1", title: "P" })]}
        tasks={[task({ id: "a", wbs_id: "w1", title: "A" }), task({ id: "b", title: "B" })]}
        now={IN_Q1}
      />,
    );
    expect(container.querySelectorAll("[data-export-row]")).toHaveLength(5);
    for (const title of ["P", "A", "B"]) expect(rowOf(title)).toHaveAttribute("data-export-row");
    // The two group headings, and nothing else, never end a slide in the deck.
    const headings = [...container.querySelectorAll("[data-export-heading]")];
    expect(headings).toHaveLength(2);
    for (const h of headings) expect(h).toHaveAttribute("data-group");
  });
  it("closes an open-ended date line on its dash, and starts an end-only one on it", () => {
    render(
      <PpmScheduleTimeline
        wbs={[wbs({ title: "Open", start_date: "2025-01-11", end_date: null })]}
        tasks={[task({ title: "Due", start_date: null, due_date: "2025-02-01" })]}
        now={IN_Q1}
      />,
    );
    // Exact text, not the normalising matcher: no dangling space on either side.
    const caption = (title: string) =>
      screen.getByText(title).closest("[data-depth]")!.querySelector(".MuiTypography-caption")!;
    expect(caption("Open").textContent).toBe("D(2025-01-11) –");
    expect(caption("Due").textContent).toBe("– D(2025-02-01)");
  });

  it("puts the small diamond before a package milestone's title only, never a task's", () => {
    render(
      <PpmScheduleTimeline
        wbs={[wbs({ id: "m", title: "Gate", is_milestone: true })]}
        tasks={[task({ title: "Plain task" }), task({ id: "t2", title: "Loose" })]}
        now={IN_Q1}
      />,
    );
    expect(rowOf("Gate").querySelector("td [data-milestone-diamond]")).not.toBeNull();
    expect(rowOf("Plain task").querySelector("[data-milestone-diamond]")).toBeNull();
    expect(rowOf("Loose").querySelector("[data-milestone-diamond]")).toBeNull();
  });

  describe("row keys", () => {
    const errors = vi.spyOn(console, "error");
    afterEach(() => errors.mockClear());

    it("keys every package and task row on its own id", () => {
      errors.mockImplementation(() => {});
      render(
        <PpmScheduleTimeline
          wbs={[wbs({ id: "a", title: "A" }), wbs({ id: "b", title: "B" })]}
          tasks={[
            task({ id: "x", wbs_id: "a", title: "X" }),
            task({ id: "y", wbs_id: "a", title: "Y" }),
            task({ id: "u", title: "U" }),
            task({ id: "v", title: "V" }),
          ]}
          now={IN_Q1}
        />,
      );
      expect(errors.mock.calls.map((c) => String(c[0]))).not.toContainEqual(
        expect.stringMatching(/same key/),
      );
    });
  });

  it("draws every mark absolutely inside its lane, centred on the lane's middle", () => {
    const { container } = render(
      <PpmScheduleTimeline
        wbs={[
          wbs({ id: "long", title: "Long", start_date: "2024-11-01", end_date: "2025-05-01" }),
          wbs({ id: "m", title: "Gate", is_milestone: true, start_date: "2025-01-11", end_date: null }),
          wbs({ id: "one", title: "One date", start_date: null, end_date: "2025-01-31" }),
        ]}
        tasks={[task({ title: "Tsk" })]}
        now={new Date(2025, 1, 15)}
      />,
    );
    // The lane and scale cells are the marks' containing block, with no padding of their own.
    for (const cell of container.querySelectorAll("[data-lane], [data-scale]")) {
      expect(cell).toHaveStyle({ position: "relative", padding: "0px" });
    }
    const rule = rowOf("Long").querySelector("[data-rule]") as HTMLElement;
    expect(rule).toHaveStyle({ position: "absolute", width: "1px", top: "0px", bottom: "0px" });
    const now = rowOf("Long").querySelector("[data-now-line]") as HTMLElement;
    expect(now).toHaveStyle({ position: "absolute", pointerEvents: "none" });
    const bar = markOf("Long", "bar")!;
    expect(bar).toHaveStyle({ position: "absolute", top: "50%", marginTop: "-8px", overflow: "hidden" });
    expect(bar.querySelector("[data-fill]")).toHaveStyle({ position: "absolute", top: "0px" });
    expect(markOf("Tsk", "bar")).toHaveStyle({ marginTop: "-8px" });
    const dot = markOf("One date", "point")!;
    expect(dot).toHaveStyle({ position: "absolute", top: "50%", marginTop: "-5px", borderRadius: "50%" });
    const diamond = markOf("Gate", "milestone")!;
    expect(diamond).toHaveStyle({ position: "absolute", top: "50%", display: "flex" });
  });

  it("sizes the table and its fixed columns with a lane, and drops the fixed widths without", () => {
    const { container, rerender } = render(
      <PpmScheduleTimeline wbs={[SPAN]} tasks={[]} now={AFTER} />,
    );
    expect(screen.getByRole("table")).toHaveStyle({ tableLayout: "fixed", minWidth: "760px" });
    const headers = () =>
      within(container.querySelector("[data-schedule-head]") as HTMLElement).getAllByRole(
        "columnheader",
      );
    expect(headers()[0]).toHaveStyle({ width: "30%" });
    expect(headers()[2]).toHaveStyle({ width: "132px" });
    expect(headers()[3]).toHaveStyle({ width: "104px" });
    rerender(
      <PpmScheduleTimeline wbs={[wbs({ start_date: null, end_date: null })]} tasks={[]} now={AFTER} />,
    );
    expect(screen.getByRole("table")).toHaveStyle({ tableLayout: "fixed", minWidth: "480px" });
    expect(getComputedStyle(headers()[0]).width).not.toBe("30%");
  });

  it("sets each quarter label at its quarter's start, on one line", () => {
    const { container } = render(
      <PpmScheduleTimeline
        wbs={[wbs({ title: "Long", start_date: "2024-10-01", end_date: "2025-06-30" })]}
        tasks={[]}
        now={AFTER}
      />,
    );
    const labels = [...container.querySelectorAll("[data-qlabel]")] as HTMLElement[];
    expect(labels.map((l) => l.textContent)).toEqual(["Q4'24", "Q1'25", "Q2'25"]);
    const starts = labels.map((l) => pctOf(l, "inset-inline-start"));
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeGreaterThan(30);
    expect(starts[1]).toBeLessThan(36);
    expect(starts[2]).toBeGreaterThan(starts[1]);
    for (const l of labels) expect(l).toHaveStyle({ position: "absolute", whiteSpace: "nowrap" });
  });

  it("draws the legend's work-package swatch half filled, and the today key as a thin red line", () => {
    const { container } = render(<PpmScheduleTimeline wbs={[SPAN]} tasks={[]} now={IN_Q1} />);
    const swatch = (key: string) =>
      container.querySelector(`[data-legend-item="${key}"] [data-legend-swatch]`) as HTMLElement;
    expect(swatch("wbs")).toHaveStyle({ position: "relative", overflow: "hidden" });
    const half = swatch("wbs").firstElementChild as HTMLElement;
    expect(half).toHaveStyle({
      position: "absolute",
      width: "50%",
      backgroundColor: brand.primary,
    });
    expect(swatch("today")).toHaveStyle({
      width: "2px",
      backgroundColor: palette.error.main,
    });
    // Each key is named by what it keys, the milestone's too.
    const milestone = container.querySelector('[data-legend-item="milestone"]') as HTMLElement;
    expect(milestone).toHaveTextContent("Milestone");
    expect(milestone.querySelector("[data-milestone-diamond]")).not.toBeNull();
  });
});
