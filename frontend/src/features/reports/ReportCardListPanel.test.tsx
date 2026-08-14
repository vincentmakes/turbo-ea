import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import ReportCardListPanel, { ReportCardListRows } from "./ReportCardListPanel";
import type { ReportCardListItem } from "./ReportCardListPanel";

const ITEMS: ReportCardListItem[] = [
  { id: "a", name: "Alpha", secondary: "Business Application · 55%" },
  { id: "b", name: "Beta", dotColor: "#ff9800", warn: true },
];

function renderPanel(props: Partial<Parameters<typeof ReportCardListPanel>[0]> = {}) {
  const onItemClick = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <ReportCardListPanel
        open
        title="Applications · Partial"
        items={ITEMS}
        emptyLabel="Nothing here"
        onItemClick={onItemClick}
        onClose={onClose}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onItemClick, onClose };
}

describe("ReportCardListPanel", () => {
  it("renders the title and one row per item", () => {
    renderPanel();
    expect(screen.getByText("Applications · Partial")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Business Application · 55%")).toBeInTheDocument();
  });

  it("reports the clicked item's id", async () => {
    const user = userEvent.setup();
    const { onItemClick } = renderPanel();
    await user.click(screen.getByText("Beta"));
    expect(onItemClick).toHaveBeenCalledWith("b");
  });

  it("shows the inventory link only when given an href", () => {
    renderPanel({ inventoryHref: "/inventory?type=Application" });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/inventory?type=Application");
  });

  it("hides the inventory link when the slice has no inventory equivalent", () => {
    renderPanel();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the empty label instead of rows when there is nothing to list", () => {
    renderPanel({ items: [] });
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("shows a truncation caption only alongside rows", () => {
    renderPanel({ truncatedLabel: "Showing 2 of 400" });
    expect(screen.getByText("Showing 2 of 400")).toBeInTheDocument();
  });

  it("does not claim truncation when the list is empty", () => {
    // "Showing 0 of 400" next to an empty state reads as a broken panel.
    renderPanel({ items: [], truncatedLabel: "Showing 0 of 400" });
    expect(screen.queryByText("Showing 0 of 400")).not.toBeInTheDocument();
  });

  it("replaces the list with a spinner while loading", () => {
    renderPanel({ loading: true });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("renders the three slots in order: header, before-list, after-list", () => {
    renderPanel({
      metrics: [{ value: 2, label: "Cards" }],
      headerContent: <div data-testid="slot-header" />,
      beforeList: <div data-testid="slot-before" />,
      afterList: <div data-testid="slot-after" />,
    });
    const order = ["slot-header", "slot-before", "slot-after"].map(
      (id) => screen.getByTestId(id),
    );
    // compareDocumentPosition: 4 === FOLLOWING
    expect(order[0].compareDocumentPosition(order[1])).toBe(4);
    expect(order[1].compareDocumentPosition(order[2])).toBe(4);
    // The metrics sit between the header slot and the before-list slot.
    const metric = screen.getByText("Cards");
    expect(order[0].compareDocumentPosition(metric)).toBe(4);
    expect(metric.compareDocumentPosition(order[1])).toBe(4);
  });

  it("keeps the after-list slot out of the way while loading", () => {
    renderPanel({ loading: true, afterList: <div data-testid="slot-after" /> });
    expect(screen.queryByTestId("slot-after")).not.toBeInTheDocument();
  });
});

describe("ReportCardListRows", () => {
  it("renders rows a caller can drop into a slot for a second list", async () => {
    // This is what lets ProcessMap's Data Objects list look like every other
    // list without the panel learning about multiple lists.
    const user = userEvent.setup();
    const onItemClick = vi.fn();
    render(<ReportCardListRows items={ITEMS} onItemClick={onItemClick} />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    await user.click(screen.getByText("Alpha"));
    expect(onItemClick).toHaveBeenCalledWith("a");
  });
});
