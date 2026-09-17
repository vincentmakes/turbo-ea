/**
 * The Layered Dependency View's "Card types" button.
 *
 * Mounted on its own, never through `LayeredDependencyView`: React Flow cannot
 * lay out under jsdom, so anything rendered inside that view is untestable.
 * What matters here is the two rules the menu encodes — a type stays listed
 * after it is hidden (with the count ticking it would bring back), and the
 * badge counts only what is hidden *and* on this canvas.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LdvTypeFilter from "./LdvTypeFilter";
import type { CardType } from "@/types";

function type(key: string, sort_order: number): CardType {
  return {
    key,
    label: key,
    icon: `icon-${key}`,
    color: "#0f7eb5",
    category: "Application & Data",
    sort_order,
    fields_schema: [],
  } as unknown as CardType;
}

const TYPES = [
  type("ITComponent", 3),
  type("Application", 1),
  type("BusinessCapability", 2),
  // Not on the canvas in these tests.
  type("Provider", 4),
];

function setup(opts: { hidden?: string[]; counts?: Array<[string, number]> } = {}) {
  const onChange = vi.fn();
  render(
    <LdvTypeFilter
      types={TYPES}
      typeCounts={
        new Map(
          opts.counts ?? [
            ["Application", 7],
            ["BusinessCapability", 3],
            ["ITComponent", 2],
          ],
        )
      }
      hiddenTypeKeys={opts.hidden ?? []}
      onChange={onChange}
    />,
  );
  return { onChange };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Card types" }));
  return screen.getByRole("menu");
}

describe("LdvTypeFilter", () => {
  it("lists only the types on the canvas, in metamodel order, with their counts", async () => {
    setup();
    const menu = await openMenu();
    const rows = within(menu).getAllByRole("menuitem");
    // Each row is glyph + label + count, so assert on the label order.
    expect(rows.map((r) => r.textContent)).toEqual([
      "icon-ApplicationApplication7",
      "icon-BusinessCapabilityBusinessCapability3",
      "icon-ITComponentITComponent2",
    ]);
    // A type with no cards here is not offered — there is nothing to hide.
    expect(within(menu).queryByText("Provider")).toBeNull();
  });

  it("hides a type when its row is unticked", async () => {
    const { onChange } = setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("BusinessCapability"));
    expect(onChange).toHaveBeenCalledWith(["BusinessCapability"]);
  });

  it("keeps a hidden type listed, unticked, so it can be brought back", async () => {
    const { onChange } = setup({ hidden: ["Application"] });
    const menu = await openMenu();
    const row = within(menu).getByText("Application").closest("li")!;
    expect(within(row).getByRole("checkbox")).not.toBeChecked();
    // Its count still shows what ticking it would restore.
    expect(row.textContent).toContain("7");
    await userEvent.click(within(menu).getByText("Application"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("badges only the hidden types that are actually on this canvas", async () => {
    // A key left over from another diagram must not put a badge on the button
    // pointing at something the reader cannot see here.
    setup({ hidden: ["Application", "Provider"] });
    expect(screen.getByRole("button", { name: "Card types" }).textContent).toContain("1");
  });

  it("shows nothing on the badge when every type is shown", async () => {
    setup();
    expect(screen.getByRole("button", { name: "Card types" }).textContent).not.toContain("1");
  });

  it("restores every type with Show all, and offers it only when something is hidden", async () => {
    const { onChange } = setup({ hidden: ["Application"] });
    const menu = await openMenu();
    const showAll = within(menu).getByRole("button", { name: "Show all" });
    expect(showAll).toBeEnabled();
    await userEvent.click(showAll);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("disables Show all when nothing is hidden", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getByRole("button", { name: "Show all" })).toBeDisabled();
  });

  it("gives every row its card type's own glyph", async () => {
    // UI_GUIDELINES §3.11 — a card type is never a bare label.
    setup();
    const menu = await openMenu();
    const row = within(menu).getByText("ITComponent").closest("li")!;
    expect(row.textContent).toContain("icon-ITComponent");
  });
});
