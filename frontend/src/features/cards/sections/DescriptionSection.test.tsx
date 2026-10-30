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

describe("DescriptionSection — links in the description", () => {
  it("renders a pasted address as a link that opens in a new tab", () => {
    render(
      <DescriptionSection
        card={{ ...card, description: "Runbook: https://wiki.example.com/erp." } as Card}
        onSave={async () => {}}
        extraFields={[]}
      />,
    );
    const link = screen.getByRole("link", { name: "https://wiki.example.com/erp" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    // The full stop after the address stays text.
    expect(screen.getByText(/Runbook:/)).toHaveTextContent("Runbook: https://wiki.example.com/erp.");
  });
});

describe("DescriptionSection — data-quality jump", () => {
  it("carries its jump anchor and opens on a jump request", () => {
    const { container, rerender } = render(
      <DescriptionSection card={card} onSave={async () => {}} initialExpanded={false} />,
    );
    const root = container.querySelector(".MuiAccordion-root")!;
    const summary = container.querySelector(".MuiAccordionSummary-root")!;
    expect(root.id).toBe("card-section-description");
    expect(summary.getAttribute("aria-expanded")).toBe("false");

    rerender(
      <DescriptionSection card={card} onSave={async () => {}} initialExpanded={false} expandOn={1} />,
    );
    expect(summary.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("DescriptionSection — a jump opens it in edit mode", () => {
  const owner: FieldDef = { key: "owner", label: "Owner", type: "text" };
  const withOwner = { ...card, attributes: { progress: 40, owner: "Ann" } } as unknown as Card;
  const request = (fieldKey?: string, nonce = 1) => ({
    anchor: "card-section-description",
    nonce,
    fieldKey,
  });

  it("enters edit mode on a description jump with the description focused", () => {
    const { rerender } = render(<DescriptionSection card={card} onSave={async () => {}} />);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    rerender(<DescriptionSection card={card} onSave={async () => {}} editOn={request()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: "Description" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("Some text");
    expect(document.activeElement).toBe(textarea);
  });

  it("focuses the __description field a field jump names", () => {
    const { container } = render(
      <DescriptionSection
        card={withOwner}
        onSave={async () => {}}
        extraFields={[progress, owner]}
        editOn={request("owner")}
      />,
    );
    const input = container.querySelector('[data-field-key="owner"] input');
    expect(input).toHaveValue("Ann");
    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Description" }));
  });

  it("stays read-only on a jump without edit rights", () => {
    render(
      <DescriptionSection card={card} onSave={async () => {}} canEdit={false} editOn={request()} />,
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("acts once per jump: after Cancel the same jump does not reopen it", () => {
    const jump = request();
    const { rerender } = render(<DescriptionSection card={card} onSave={async () => {}} editOn={jump} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(<DescriptionSection card={card} onSave={async () => {}} editOn={jump} />);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    rerender(<DescriptionSection card={card} onSave={async () => {}} editOn={request(undefined, 2)} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
