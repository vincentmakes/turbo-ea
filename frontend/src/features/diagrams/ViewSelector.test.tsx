/**
 * Tests for the diagram's card-display dropdown.
 *
 * The menu carries two settings that are deliberately independent — pick ONE
 * colour perspective, pick MANY fields to draw on the shape — and the whole
 * point of its shape is that a reader can tell them apart. These tests pin the
 * behaviour that makes that legible: the two headed blocks, the pick-one rows
 * closing the menu while pick-many rows do not, and every field filed under the
 * card type that owns it with a shared key appearing exactly once.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ViewSelector from "./ViewSelector";
import type { ViewSource } from "./ViewSelector";
import type { CardType } from "@/types";
import type { CardLabelSettings } from "@/lib/cardDisplayFields";

function type(key: string, fields: { key: string; label: string; type?: string }[]): CardType {
  return {
    key,
    label: key,
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    fields_schema: [
      { section: "Details", fields: fields.map((f) => ({ type: "text", ...f })) },
    ],
  } as unknown as CardType;
}

const APPLICATION = type("Application", [
  { key: "owner", label: "Owner" },
  { key: "criticality", label: "Criticality", type: "single_select" },
]);
// `criticality` is a single_select so it is also a colour perspective; give it
// options or the colour list drops it.
(APPLICATION.fields_schema![0].fields[1] as { options?: unknown[] }).options = [
  { key: "high", label: "High" },
];

const ITCOMPONENT = type("ITComponent", [
  { key: "owner", label: "Owner" },
  { key: "hosting", label: "Hosting" },
]);

const PROVIDER = type("Provider", [{ key: "tier", label: "Tier" }]);

const TYPES = [APPLICATION, ITCOMPONENT, PROVIDER];

function setup(over: Partial<{ current: ViewSource; labels: CardLabelSettings }> = {}) {
  const onChange = vi.fn();
  const onLabelsChange = vi.fn();
  render(
    <ViewSelector
      activeTypeKeys={["Application", "ITComponent"]}
      types={TYPES}
      current={over.current ?? { kind: "card_type" }}
      onChange={onChange}
      labels={over.labels ?? { fields: [] }}
      onLabelsChange={onLabelsChange}
    />,
  );
  return { onChange, onLabelsChange };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button"));
  return screen.getByRole("menu");
}

describe("ViewSelector", () => {
  it("opens on two headed blocks, one per setting", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getByText("Color by")).toBeInTheDocument();
    expect(within(menu).getByText("Show on card")).toBeInTheDocument();
  });

  it("gives the pick-one setting radios and the pick-many setting checkboxes", async () => {
    setup();
    const menu = await openMenu();
    // Colour perspectives are mutually exclusive; display fields are not.
    expect(within(menu).getAllByRole("radio").length).toBeGreaterThan(0);
    expect(within(menu).getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("closes on a colour choice — one pick and you are done", async () => {
    const { onChange } = setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Approval status"));
    expect(onChange).toHaveBeenCalledWith({ kind: "approval_status" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("stays open while display fields are ticked — they are a multi-select", async () => {
    const { onLabelsChange } = setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Card type"));
    expect(onLabelsChange).toHaveBeenCalledWith({ fields: [], showType: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("files a field shared by two canvas types under Shared, exactly once", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getByText("Shared")).toBeInTheDocument();
    // `owner` is on both Application and ITComponent — one row, not two.
    expect(within(menu).getAllByText("Owner")).toHaveLength(1);
  });

  it("heads each remaining field with the card type that owns it", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getAllByText("Application").length).toBeGreaterThan(0);
    expect(within(menu).getAllByText("ITComponent").length).toBeGreaterThan(0);
    expect(within(menu).getByText("Hosting")).toBeInTheDocument();
  });

  it("offers nothing from a card type that is not on the canvas", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).queryByText("Provider")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Tier")).not.toBeInTheDocument();
  });

  it("counts what is currently drawn on the shape", async () => {
    setup({ labels: { fields: ["owner"], showType: true } });
    const menu = await openMenu();
    // Card type + one field.
    expect(within(menu).getByText("2")).toBeInTheDocument();
  });

  it("removes a field that is already ticked", async () => {
    const { onLabelsChange } = setup({ labels: { fields: ["owner", "hosting"] } });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Owner"));
    expect(onLabelsChange).toHaveBeenCalledWith({ fields: ["hosting"] });
  });
});
