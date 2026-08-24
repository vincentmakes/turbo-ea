/**
 * Tests for the diagram's "Show on card" dropdown — what each shape says, as
 * distinct from what colours it. Carried over from the combined menu these two
 * buttons replaced.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ShowOnCardSelector from "./ShowOnCardSelector";
import type { CardLabelSettings } from "@/lib/cardDisplayFields";
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
  type("Application", [
    { key: "owner", label: "Owner" },
    { key: "criticality", label: "Criticality" },
  ]),
  type("ITComponent", [
    { key: "owner", label: "Owner" },
    { key: "hosting", label: "Hosting" },
  ]),
  type("Provider", [{ key: "tier", label: "Tier" }]),
];

function setup(labels: CardLabelSettings = { fields: [] }) {
  const onChange = vi.fn();
  const onOpen = vi.fn();
  render(
    <ShowOnCardSelector
      activeTypeKeys={["Application", "ITComponent"]}
      onOpen={onOpen}
      types={TYPES}
      labels={labels}
      onChange={onChange}
    />,
  );
  return { onChange, onOpen };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button"));
  return screen.getByRole("menu");
}

describe("ShowOnCardSelector", () => {
  it("files a field shared by two canvas types under Shared, exactly once", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getByText("Shared")).toBeInTheDocument();
    expect(within(menu).getAllByText("Owner")).toHaveLength(1);
  });

  it("heads each remaining field with the card type that owns it", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getByText("Hosting")).toBeInTheDocument();
    expect(within(menu).getAllByText("Application").length).toBeGreaterThan(0);
  });

  it("offers nothing from a card type that is not on the canvas", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).queryByText("Tier")).not.toBeInTheDocument();
  });

  it("counts what is currently drawn on the shape", async () => {
    setup({ fields: ["owner"], showType: true });
    expect(screen.getByRole("button")).toHaveTextContent("(2)");
  });

  it("adds and removes a field", async () => {
    const { onChange } = setup({ fields: ["owner"] });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Hosting"));
    expect(onChange).toHaveBeenCalledWith({ fields: ["owner", "hosting"] });
    await userEvent.click(within(menu).getByText("Owner"));
    expect(onChange).toHaveBeenCalledWith({ fields: [] });
  });

  it("toggles the card type and subtype lines", async () => {
    const { onChange } = setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Card type"));
    expect(onChange).toHaveBeenCalledWith({ fields: [], showType: true });
  });

  it("re-scans the canvas every time the menu opens, and stays open", async () => {
    const { onOpen } = setup();
    const menu = await openMenu();
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(within(menu).getByText("Subtype"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
