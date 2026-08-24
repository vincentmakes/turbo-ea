/**
 * The Layered Dependency View's "Show on card" button.
 *
 * Mounted on its own, never through `LayeredDependencyView`: React Flow cannot
 * lay out under jsdom, so anything rendered inside that view is untestable —
 * which is exactly how the chip autocomplete this replaces shipped with no
 * coverage. The adapter between the view's settings store and the shared
 * card-display vocabulary is the whole point of this component, so that
 * translation is what is asserted here.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LdvShowOnCard from "./LdvShowOnCard";
import { LDV_DEFAULT_SETTINGS, type LdvDisplaySettings } from "./ldvDisplaySettings";
import type { CardType } from "@/types";

function type(key: string, fields: Array<{ key: string; label: string }>): CardType {
  return {
    key,
    label: key,
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    fields_schema: [{ section: "Details", fields: fields.map((f) => ({ type: "text", ...f })) }],
  } as unknown as CardType;
}

const TYPES = [
  type("Application", [{ key: "owner", label: "Owner" }]),
  type("Provider", [{ key: "tier", label: "Tier" }]),
];

function setup(overrides: Partial<LdvDisplaySettings> = {}) {
  const update = vi.fn();
  render(
    <LdvShowOnCard
      types={TYPES}
      activeTypeKeys={["Application"]}
      settings={{ ...LDV_DEFAULT_SETTINGS, ...overrides }}
      update={update}
    />,
  );
  return { update };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Show on card" }));
  return screen.getByRole("menu");
}

describe("LdvShowOnCard", () => {
  it("writes a picked field to extraFields, not to fields", async () => {
    const { update } = setup({ extraFields: [] });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Owner"));
    expect(update).toHaveBeenCalledWith({
      showType: true,
      showSubtype: false,
      extraFields: ["owner"],
    });
  });

  it("un-picks a field that is already shown", async () => {
    const { update } = setup({ extraFields: ["owner"] });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Owner"));
    expect(update).toHaveBeenCalledWith({
      showType: true,
      showSubtype: false,
      extraFields: [],
    });
  });

  it("carries lifecycle, which the diagram editor has no equivalent for", async () => {
    const { update } = setup({ showLifecycle: true });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Lifecycle"));
    // Its own patch — lifecycle is not part of the shared label shape, so it
    // must not be folded into the extraFields write.
    expect(update).toHaveBeenCalledWith({ showLifecycle: false });
  });

  it("counts every line the card is currently showing", () => {
    setup({ showType: true, showSubtype: true, showLifecycle: true, extraFields: ["owner"] });
    expect(screen.getByRole("button", { name: "Show on card" })).toHaveTextContent("4");
  });

  it("offers no field from a card type that is not on the canvas", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).queryByText("Tier")).not.toBeInTheDocument();
  });

  it("clears the picked fields and the lifecycle line together", async () => {
    const { update } = setup({ showLifecycle: true, extraFields: ["owner"], showType: true });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Clear all" }));
    expect(update).toHaveBeenCalledWith({
      showType: false,
      showSubtype: false,
      extraFields: [],
    });
    expect(update).toHaveBeenCalledWith({ showLifecycle: false });
  });
});
