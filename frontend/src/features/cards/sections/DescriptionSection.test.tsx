import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));

import "@/i18n";
import type { Card, FieldDef } from "@/types";
import DescriptionSection from "./DescriptionSection";

const progress: FieldDef = { key: "progress", label: "Progress", type: "percentage" };
const card = {
  id: "card-1",
  type: "Initiative",
  name: "Test",
  description: "Some text",
  attributes: { progress: 40 },
} as unknown as Card;

function renderSection(props: { extraFields: FieldDef[]; calculatedFieldKeys?: string[]; onSave?: () => Promise<void> }) {
  return render(
    <DescriptionSection
      card={card}
      onSave={props.onSave ?? (async () => {})}
      extraFields={props.extraFields}
      calculatedFieldKeys={props.calculatedFieldKeys}
    />,
  );
}

function enterEdit() {
  // The pencil is the last icon button in the summary row.
  const buttons = screen.getAllByRole("button");
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("DescriptionSection — calculated fields in the __description section", () => {
  it("locks a calculated percentage field in edit mode: value + chip, no editor", () => {
    renderSection({ extraFields: [progress], calculatedFieldKeys: ["progress"] });
    enterEdit();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("calculated")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("locks a readonly field with the auto chip", () => {
    renderSection({ extraFields: [{ ...progress, readonly: true }] });
    enterEdit();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByText("auto")).toBeInTheDocument();
  });

  it("still offers the slider for a plain percentage field", () => {
    renderSection({ extraFields: [progress] });
    enterEdit();
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("spinbutton")).toHaveValue(40);
  });

  it("shows the calculated chip beside the label in read mode", () => {
    renderSection({ extraFields: [progress], calculatedFieldKeys: ["progress"] });
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("calculated")).toBeInTheDocument();
  });

  it("does not block saving on an empty required field a calculation owns", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <DescriptionSection
        card={{ ...card, attributes: {} } as unknown as Card}
        onSave={onSave}
        extraFields={[{ ...progress, required: true }]}
        calculatedFieldKeys={["progress"]}
      />,
    );
    enterEdit();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
