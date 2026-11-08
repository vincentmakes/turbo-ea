import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GroupByMenuButton } from "./useRowGrouping";

const AXES = [
  { key: "lifecycle", label: "Lifecycle" },
  { key: "approval_status", label: "Approval status" },
];

function openMenu() {
  fireEvent.click(screen.getByRole("button"));
  return screen.getByRole("menu");
}

/** A controlled harness, like the page: the tree flag lives in the parent. */
function Harness({
  initialTree = false,
  groupBy = null,
  onTree,
}: {
  initialTree?: boolean;
  groupBy?: string | null;
  onTree?: (v: boolean) => void;
}) {
  const [tree, setTree] = useState(initialTree);
  return (
    <GroupByMenuButton
      axes={AXES}
      groupBy={groupBy}
      onChange={() => {}}
      tree={{
        enabled: tree,
        onChange: (v) => {
          onTree?.(v);
          setTree(v);
        },
      }}
    />
  );
}

describe("GroupByMenuButton", () => {
  it("offers no tree item without the `tree` prop", () => {
    render(<GroupByMenuButton axes={AXES} groupBy={null} onChange={() => {}} />);
    const menu = openMenu();
    expect(within(menu).queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "No grouping",
      "Lifecycle",
      "Approval status",
    ]);
  });

  it("puts the tree toggle first, above 'No grouping'", () => {
    const { unmount } = render(<Harness />);
    let items = Array.from(openMenu().querySelectorAll('[role^="menuitem"]'));
    expect(items[0]).toHaveAttribute("role", "menuitemcheckbox");
    expect(items[1]).toHaveAttribute("role", "menuitem");
    expect(items[1]).toHaveTextContent("No grouping");
    unmount();
    render(<GroupByMenuButton axes={AXES} groupBy={null} onChange={() => {}} />);
    items = Array.from(openMenu().querySelectorAll('[role^="menuitem"]'));
    expect(items[0]).toHaveAttribute("role", "menuitem");
    expect(items[0]).toHaveTextContent("No grouping");
  });

  it("toggles the tree without closing the menu and reflects aria-checked", () => {
    const onTree = vi.fn();
    render(<Harness onTree={onTree} />);
    const menu = openMenu();
    const item = within(menu).getByRole("menuitemcheckbox", {
      name: "Parent",
    });
    expect(item).toHaveAttribute("aria-checked", "false");
    fireEvent.click(item);
    expect(onTree).toHaveBeenLastCalledWith(true);
    // Still open, now checked.
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemcheckbox"));
    expect(onTree).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("menuitemcheckbox")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("picking an axis still closes the menu", () => {
    const onChange = vi.fn();
    render(
      <GroupByMenuButton
        axes={AXES}
        groupBy={null}
        onChange={onChange}
        tree={{ enabled: true, onChange: () => {} }}
      />,
    );
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Lifecycle" }));
    expect(onChange).toHaveBeenCalledWith("lifecycle");
  });

  it.each([
    [null, false, "Group by"],
    ["lifecycle", false, "Group by: Lifecycle"],
    [null, true, "Group by: Parent"],
    ["lifecycle", true, "Group by: Lifecycle · Parent"],
  ])("labels groupBy=%s tree=%s as %s", (groupBy, tree, label) => {
    render(
      <GroupByMenuButton
        axes={AXES}
        groupBy={groupBy}
        onChange={() => {}}
        tree={{ enabled: tree, onChange: () => {} }}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent(label);
  });

  it("keeps 'No grouping' selected when only the tree is on", () => {
    render(<Harness initialTree />);
    const menu = openMenu();
    expect(within(menu).getByRole("menuitem", { name: "No grouping" })).toHaveClass(
      "Mui-selected",
    );
  });

  it("highlights the button in primary when only the tree is on", () => {
    const { rerender } = render(
      <GroupByMenuButton
        axes={AXES}
        groupBy={null}
        onChange={() => {}}
        tree={{ enabled: false, onChange: () => {} }}
      />,
    );
    expect(screen.getByRole("button")).not.toHaveClass("MuiButton-colorPrimary");
    rerender(
      <GroupByMenuButton
        axes={AXES}
        groupBy={null}
        onChange={() => {}}
        tree={{ enabled: true, onChange: () => {} }}
      />,
    );
    expect(screen.getByRole("button")).toHaveClass("MuiButton-colorPrimary");
  });

  it("compact mode is primary with the tree on and opens the same menu", () => {
    render(
      <GroupByMenuButton
        axes={AXES}
        groupBy={null}
        onChange={() => {}}
        compact
        tree={{ enabled: true, onChange: () => {} }}
      />,
    );
    const button = screen.getByRole("button", { name: "Group by" });
    expect(button).toHaveClass("MuiIconButton-colorPrimary");
    fireEvent.click(button);
    expect(
      within(screen.getByRole("menu")).getByRole("menuitemcheckbox", {
        name: "Parent",
      }),
    ).toBeInTheDocument();
  });

  it("compact mode without anything active is not primary", () => {
    render(<GroupByMenuButton axes={AXES} groupBy={null} onChange={() => {}} compact />);
    expect(screen.getByRole("button", { name: "Group by" })).not.toHaveClass(
      "MuiIconButton-colorPrimary",
    );
  });
});
