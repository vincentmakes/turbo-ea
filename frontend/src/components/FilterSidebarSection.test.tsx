/**
 * FilterSectionHeader: the shared section header of every grid filter
 * sidebar. The per-section clear button is the part under test here — it
 * shows only while the section has something to clear, clears without
 * folding or unfolding the section, and is its own keyboard stop.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import i18n from "@/i18n";
import { FilterSectionHeader } from "./FilterSidebarSection";

const clearLabel = (section: string) =>
  i18n.t("common:filter.clearSection", { section }) as string;

function setup(over: Partial<React.ComponentProps<typeof FilterSectionHeader>> = {}) {
  const onToggle = vi.fn();
  const onClear = vi.fn();
  render(
    <FilterSectionHeader
      label="Types"
      icon="category"
      expanded
      onToggle={onToggle}
      count={2}
      onClear={onClear}
      {...over}
    />,
  );
  return { onToggle, onClear };
}

describe("FilterSectionHeader", () => {
  it("names the clear button after the section", () => {
    setup();
    expect(clearLabel("Types")).toBe("Clear Types filters");
    expect(screen.getByRole("button", { name: "Clear Types filters" })).toBeInTheDocument();
  });

  it("renders the label and the count chip", () => {
    setup({ count: 3 });
    expect(screen.getByText("Types")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the clear button when the section has nothing selected", () => {
    setup({ count: 0 });
    expect(screen.queryByRole("button", { name: clearLabel("Types") })).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("hides the clear button when no count is given", () => {
    setup({ count: undefined });
    expect(screen.queryByRole("button", { name: clearLabel("Types") })).toBeNull();
  });

  it("hides the clear button when the sidebar wires no handler", () => {
    setup({ onClear: undefined });
    expect(screen.queryByRole("button", { name: clearLabel("Types") })).toBeNull();
    // The count chip still shows — only the button depends on the handler.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("clears without toggling the section", async () => {
    const { onToggle, onClear } = setup();
    await userEvent.click(screen.getByRole("button", { name: clearLabel("Types") }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("still toggles when the label is clicked", async () => {
    const { onToggle, onClear } = setup();
    await userEvent.click(screen.getByText("Types"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });

  it("makes the clear button its own tab stop after the toggle", async () => {
    const { onToggle, onClear } = setup();
    await userEvent.tab();
    expect(document.querySelector("[data-section-icon='category']")).toHaveFocus();
    await userEvent.tab();
    const button = screen.getByRole("button", { name: clearLabel("Types") });
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("toggles from the keyboard with Enter and Space, not other keys", async () => {
    const { onToggle, onClear } = setup();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("a");
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onClear).not.toHaveBeenCalled();
  });

  it("exposes the expanded state and the count chip", () => {
    setup({ expanded: false, count: 4 });
    const toggle = document.querySelector("[data-section-icon='category']") as HTMLElement;
    expect(toggle).toHaveAttribute("role", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("section-count")).toHaveTextContent("4");
    // The clear button is a sibling of the toggle, never inside it.
    expect(
      toggle.contains(screen.getByRole("button", { name: clearLabel("Types") })),
    ).toBe(false);
  });

  it("shows the matching chevron for the expanded state", () => {
    const { rerender } = render(
      <FilterSectionHeader label="A" icon="category" expanded onToggle={() => {}} />,
    );
    expect(screen.getByText("expand_more")).toBeInTheDocument();
    rerender(<FilterSectionHeader label="A" icon="category" expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("chevron_right")).toBeInTheDocument();
  });
});
