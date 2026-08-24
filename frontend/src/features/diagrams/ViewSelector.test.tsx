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

function setup(
  over: Partial<{
    current: ViewSource;
    labels: CardLabelSettings;
    activeTypeKeys: string[];
  }> = {},
) {
  const onChange = vi.fn();
  const onLabelsChange = vi.fn();
  const onOpen = vi.fn();
  render(
    <ViewSelector
      activeTypeKeys={over.activeTypeKeys ?? ["Application", "ITComponent"]}
      onOpen={onOpen}
      types={TYPES}
      current={over.current ?? { kind: "card_type" }}
      onChange={onChange}
      labels={over.labels ?? { fields: [] }}
      onLabelsChange={onLabelsChange}
    />,
  );
  return { onChange, onLabelsChange, onOpen };
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

  it("stays open on a colour choice — the other setting lives here too", async () => {
    // Two settings share this menu, so dismissing on a colour pick would force
    // a reopen to carry on with the display fields.
    const { onChange } = setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Approval status"));
    expect(onChange).toHaveBeenCalledWith({ kind: "approval_status" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("stays open while display fields are ticked — they are a multi-select", async () => {
    const { onLabelsChange } = setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Card type"));
    expect(onLabelsChange).toHaveBeenCalledWith({ fields: [], showType: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("lets a colour and a display field be set without reopening", async () => {
    const { onChange, onLabelsChange } = setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Approval status"));
    await userEvent.click(within(menu).getByText("Hosting"));
    expect(onChange).toHaveBeenCalledWith({ kind: "approval_status" });
    expect(onLabelsChange).toHaveBeenCalledWith({ fields: ["hosting"] });
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

  it("re-scans the canvas every time the menu opens", async () => {
    // Regression: the type list used to be populated only as a side effect of
    // applying a colour perspective, and that effect ran before DrawIO had a
    // graph — so the attribute rows stayed empty until the user picked a
    // colour, which made two independent settings feel ordered.
    const { onOpen } = setup();
    await openMenu();
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("still offers both settings when the canvas scan has not landed yet", async () => {
    // No card types known: the colour perspectives that need none, and the
    // card-type/subtype rows, must all still be reachable.
    setup({ activeTypeKeys: [] });
    const menu = await openMenu();
    expect(within(menu).getByText("Color by")).toBeInTheDocument();
    expect(within(menu).getByText("Approval status")).toBeInTheDocument();
    expect(within(menu).getByText("Show on card")).toBeInTheDocument();
    expect(within(menu).getByText("Subtype")).toBeInTheDocument();
  });
});
