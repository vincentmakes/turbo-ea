import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GridApi, IRowNode } from "ag-grid-community";
import { GroupHeaderRow, type GroupRowContext } from "./useRowGrouping";
import type { GroupedRow, GroupInfo } from "./rowGrouping";

/**
 * The header's count chip has three regimes: the plain count when every member
 * is a grid row, `shown/count` when grid filters hide some, and the plain count
 * again when the group is collapsed. The tree layer adds a fourth case: members
 * hidden under a collapsed parent are not grid rows but are not filtered out
 * either, so they are added back before the fraction is decided.
 */
function renderHeader(info: Partial<GroupInfo>, displayedNodes: number, selected = 0) {
  const group: GroupInfo = {
    axis: "lifecycle",
    key: "active",
    label: "Active",
    count: 10,
    memberIds: Array.from({ length: 10 }, (_, i) => `m${i}`),
    collapsed: false,
    index: 0,
    ...info,
  };
  const data = { id: "m0", __group: group } as GroupedRow<{ id: string }>;
  const nodes = Array.from({ length: displayedNodes }, (_, i) => ({
    isSelected: () => i < selected,
  })) as unknown as IRowNode[];
  const api = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as GridApi;
  const context: GroupRowContext = {
    toggleGroupCollapse: vi.fn(),
    selectGroup: vi.fn(),
    getGroupMemberNodes: () => nodes,
    selectable: true,
  };
  render(<GroupHeaderRow data={data} api={api} context={context} />);
  return { context };
}

const countText = () => screen.getByText(/^\d+(\/\d+)?$/).textContent;

describe("GroupHeaderRow count label", () => {
  it("shows the plain count when every member is a grid row", () => {
    renderHeader({}, 10);
    expect(countText()).toBe("10");
  });

  it("shows shown/count when grid filters hide members", () => {
    renderHeader({}, 7);
    expect(countText()).toBe("7/10");
  });

  it("adds members hidden under a collapsed parent back, so a collapsed branch is not a fraction", () => {
    renderHeader({ treeHidden: 3 }, 7);
    expect(countText()).toBe("10");
  });

  it("still shows a fraction when a filter hides members beyond the collapsed branch", () => {
    renderHeader({ treeHidden: 3 }, 5);
    expect(countText()).toBe("8/10");
  });

  it("shows the full count on a collapsed group, whatever the grid holds", () => {
    renderHeader({ collapsed: true }, 0);
    expect(countText()).toBe("10");
  });

  it("checks the box only when every displayed member is selected", () => {
    renderHeader({}, 4, 4);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("shows an indeterminate box when only some displayed members are selected", () => {
    renderHeader({}, 4, 2);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box).not.toBeChecked();
    expect(box.getAttribute("data-indeterminate")).toBe("true");
  });
});
