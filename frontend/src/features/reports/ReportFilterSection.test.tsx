import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportFilterSection from "./ReportFilterSection";

function renderSection(
  props: Partial<Parameters<typeof ReportFilterSection>[0]> = {},
) {
  const onToggle = vi.fn();
  const onClearAll = vi.fn();
  render(
    <ReportFilterSection
      label="Application Filters"
      collapsed={false}
      onToggle={onToggle}
      {...props}
    >
      <button type="button">Related By</button>
    </ReportFilterSection>,
  );
  return { onToggle, onClearAll };
}

/** The header toggle — a real button, so it is addressable by role. */
const toggle = () => screen.getByRole("button", { name: /Application Filters/ });

describe("ReportFilterSection", () => {
  it("renders its children and reports itself expanded", () => {
    renderSection();
    expect(screen.getByText("Related By")).toBeVisible();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the body when collapsed but keeps the header readable", () => {
    renderSection({ collapsed: true, count: 2 });
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    // Deliberately NOT asserting absence: the section does not unmount its
    // body, it relies on MUI Collapse's `visibility: hidden` (which is also
    // what keeps the hidden controls out of the tab order).
    expect(screen.getByText("Related By")).not.toBeVisible();
    // The whole point of the count chip: a collapsed section must never look
    // like an unfiltered one.
    expect(screen.getByText("Application Filters")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
  });

  it("points aria-controls at the region it collapses", () => {
    renderSection();
    const bodyId = toggle().getAttribute("aria-controls");
    expect(bodyId).toBeTruthy();
    const region = document.getElementById(bodyId!);
    expect(region).toHaveAttribute("role", "region");
    expect(region).toContainElement(screen.getByText("Related By"));
  });

  it("toggles on click", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderSection();
    await user.click(toggle());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles from the keyboard with Enter and Space", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderSection();
    await user.tab();
    expect(toggle()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("shows the count chip only when there are active filters", () => {
    const { unmount } = render(
      <ReportFilterSection label="F" collapsed={false} onToggle={vi.fn()} count={3}>
        <span>body</span>
      </ReportFilterSection>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    unmount();

    renderSection({ count: 0 });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("clears without toggling — the clear chip is a sibling of the toggle, not a child", async () => {
    // The regression this file exists for. A deletable Chip nested inside the
    // header button would toggle the section on every clear (and be a second
    // tab stop inside the first).
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onClearAll = vi.fn();
    render(
      <ReportFilterSection
        label="Application Filters"
        collapsed={false}
        onToggle={onToggle}
        count={2}
        clearAllLabel="Clear all"
        onClearAll={onClearAll}
      >
        <span>body</span>
      </ReportFilterSection>,
    );

    await user.click(screen.getByTestId("CancelIcon"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("offers the clear affordance while collapsed", () => {
    renderSection({
      collapsed: true,
      count: 2,
      clearAllLabel: "Clear all",
      onClearAll: vi.fn(),
    });
    expect(screen.getByText("Clear all")).toBeVisible();
  });

  it("omits the clear affordance when no handler is supplied", () => {
    renderSection({ clearAllLabel: "Clear all" });
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });
});
