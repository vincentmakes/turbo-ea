import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SubtypeBucket, useCollapsedBuckets, useSubtypeGrouping } from "./SubtypeBucket";

describe("SubtypeBucket", () => {
  it("renders the label, the count and its rows while open", () => {
    render(
      <SubtypeBucket label="Region" isNoSubtype={false} count={3} open onToggle={vi.fn()}>
        <div>row</div>
      </SubtypeBucket>,
    );
    const header = screen.getByRole("button", { name: /Region/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header).toHaveTextContent("Region3");
    expect(screen.getByText("row")).toBeInTheDocument();
  });

  it("hides its rows when closed and reports the click", async () => {
    const onToggle = vi.fn();
    render(
      <SubtypeBucket label="No subtype" isNoSubtype count={1} open={false} onToggle={onToggle}>
        <div>row</div>
      </SubtypeBucket>,
    );
    const header = screen.getByRole("button", { name: /No subtype/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("row")).not.toBeInTheDocument();
    expect(screen.getByText("No subtype")).toHaveStyle({ fontStyle: "italic" });
    await userEvent.click(header);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("useCollapsedBuckets", () => {
  it("starts every bucket open and toggles them one at a time", () => {
    const { result } = renderHook(() => useCollapsedBuckets());
    expect(result.current.isOpen("a")).toBe(true);
    act(() => result.current.toggle("a"));
    expect(result.current.isOpen("a")).toBe(false);
    expect(result.current.isOpen("b")).toBe(true);
    act(() => result.current.toggle("a"));
    expect(result.current.isOpen("a")).toBe(true);
  });
});

describe("useSubtypeGrouping", () => {
  it("follows the automatic decision until the user toggles", async () => {
    const { result, rerender } = renderHook(({ auto }) => useSubtypeGrouping(auto), {
      initialProps: { auto: false },
    });
    expect(result.current.grouped).toBe(false);
    rerender({ auto: true });
    await waitFor(() => expect(result.current.grouped).toBe(true));

    act(() => result.current.toggleGrouped());
    expect(result.current.grouped).toBe(false);
    rerender({ auto: false });
    rerender({ auto: true });
    expect(result.current.grouped).toBe(false);
  });
});
