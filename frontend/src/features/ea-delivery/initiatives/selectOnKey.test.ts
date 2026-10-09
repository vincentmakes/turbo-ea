import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { selectOnKey } from "./selectOnKey";

function keyEvent(key: string, nested = false) {
  const row = {};
  return {
    key,
    currentTarget: row,
    // A key pressed on a button inside the row bubbles up with that button as
    // its target; the row itself is the target only when the row has focus.
    target: nested ? {} : row,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("selectOnKey", () => {
  it("selects on Enter and Space pressed on the row itself, and stops the page scrolling", () => {
    const select = vi.fn();
    const onKeyDown = selectOnKey(select);
    const enter = keyEvent("Enter");
    const space = keyEvent(" ");
    onKeyDown(enter);
    onKeyDown(space);
    expect(select).toHaveBeenCalledTimes(2);
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    expect(space.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("ignores every other key", () => {
    const select = vi.fn();
    const e = keyEvent("a");
    selectOnKey(select)(e);
    expect(select).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores Enter pressed on a button inside the row: that key belongs to the button", () => {
    const select = vi.fn();
    const e = keyEvent("Enter", true);
    selectOnKey(select)(e);
    expect(select).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
