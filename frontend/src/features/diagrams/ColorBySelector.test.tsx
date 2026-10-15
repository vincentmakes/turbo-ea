/**
 * Tests for the diagram's "Colour by" dropdown.
 *
 * The setting it edits is a set of rules — one per card type — so the cases
 * that matter are the transitions: one rule per type, several types at once,
 * and a global perspective that cannot coexist with any of them.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ColorBySelector from "./ColorBySelector";
import type { ViewSource } from "./viewSource";
import type { CardType } from "@/types";

function type(key: string, fields: Array<{ key: string; label: string }>): CardType {
  return {
    key,
    label: key,
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    fields_schema: [
      {
        section: "Details",
        fields: fields.map((f) => ({
          ...f,
          type: "single_select",
          options: [{ key: "high", label: "High" }],
        })),
      },
    ],
  } as unknown as CardType;
}

const TYPES = [
  type("Application", [
    { key: "criticality", label: "Criticality" },
    { key: "lifecycle", label: "Lifecycle" },
  ]),
  type("ITComponent", [{ key: "hosting", label: "Hosting" }]),
  type("Provider", [{ key: "tier", label: "Tier" }]),
];

function setup(current: ViewSource = { kind: "card_type" }) {
  const onChange = vi.fn();
  const onOpen = vi.fn();
  render(
    <ColorBySelector
      activeTypeKeys={["Application", "ITComponent"]}
      onOpen={onOpen}
      types={TYPES}
      current={current}
      onChange={onChange}
    />,
  );
  return { onChange, onOpen };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button"));
  return screen.getByRole("menu");
}

describe("ColorBySelector", () => {
  it("offers the two whole-canvas perspectives as radios and the fields as checkboxes", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).getAllByRole("radio")).toHaveLength(2);
    expect(within(menu).getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("offers nothing from a card type that is not on the canvas", async () => {
    setup();
    const menu = await openMenu();
    expect(within(menu).queryByText("Tier")).not.toBeInTheDocument();
  });

  it("adds a rule for a second card type rather than replacing the first", async () => {
    const { onChange } = setup({
      kind: "card_fields",
      fields: { Application: "criticality" },
    });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Hosting"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "card_fields",
      fields: { Application: "criticality", ITComponent: "hosting" },
    });
  });

  it("replaces the rule within one card type — a card has one fill", async () => {
    const { onChange } = setup({
      kind: "card_fields",
      fields: { Application: "criticality" },
    });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Lifecycle"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "card_fields",
      fields: { Application: "lifecycle" },
    });
  });

  it("collapses to card colours when the last rule is unticked", async () => {
    const { onChange } = setup({
      kind: "card_fields",
      fields: { Application: "criticality" },
    });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Criticality"));
    expect(onChange).toHaveBeenCalledWith({ kind: "card_type" });
  });

  it("ticking a field discards the global perspective", async () => {
    const { onChange } = setup({ kind: "approval_status" });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Criticality"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "card_fields",
      fields: { Application: "criticality" },
    });
  });

  it("choosing a global perspective clears every field rule", async () => {
    const { onChange } = setup({
      kind: "card_fields",
      fields: { Application: "criticality", ITComponent: "hosting" },
    });
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Approval status"));
    expect(onChange).toHaveBeenCalledWith({ kind: "approval_status" });
  });

  it("labels the button by rule count", async () => {
    setup();
    expect(screen.getByRole("button")).toHaveTextContent("Card colors");
  });

  it("shows the first rule and a count when several are active", async () => {
    setup({ kind: "card_fields", fields: { Application: "criticality", ITComponent: "hosting" } });
    // `viewSelector.buttonMore` = "{{first}} +{{count}}"
    expect(screen.getByRole("button")).toHaveTextContent("Application · Criticality +1");
  });

  it("re-scans the canvas every time the menu opens", async () => {
    const { onOpen } = setup();
    await openMenu();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("stays open so several rules can be set in one visit", async () => {
    setup();
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Criticality"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("ColorBySelector facet fields (#1256)", () => {
  const SERVER = {
    key: "Server",
    label: "Server",
    icon: "dns",
    color: "#0f7eb5",
    category: "Technical Architecture",
    fields_schema: [
      {
        section: "Details",
        fields: [
          { key: "notes", label: "Notes", type: "text" },
          { key: "isCloud", label: "Cloud Hosted", type: "boolean" },
          { key: "regions", label: "Regions", type: "multiple_select", options: [{ key: "eu", label: "EU" }] },
          { key: "empty", label: "No Options", type: "single_select", options: [] },
        ],
      },
    ],
  } as unknown as CardType;

  it("offers a yes/no and a multi-select field, never a text or option-less one", async () => {
    const onChange = vi.fn();
    render(
      <ColorBySelector
        activeTypeKeys={["Server"]}
        onOpen={vi.fn()}
        types={[SERVER]}
        current={{ kind: "card_type" }}
        onChange={onChange}
      />,
    );
    const menu = await openMenu();
    expect(within(menu).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(menu).getByText("Cloud Hosted")).toBeInTheDocument();
    expect(within(menu).getByText("Regions")).toBeInTheDocument();
    expect(within(menu).queryByText("Notes")).not.toBeInTheDocument();
    expect(within(menu).queryByText("No Options")).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByText("Cloud Hosted"));
    expect(onChange).toHaveBeenCalledWith({ kind: "card_fields", fields: { Server: "isCloud" } });
  });
});
