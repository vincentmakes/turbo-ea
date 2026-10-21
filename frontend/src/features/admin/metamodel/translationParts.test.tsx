import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TranslationGroup, TranslationRow } from "./translationParts";

describe("TranslationRow", () => {
  it("renders a single-line row by default, with the reference as placeholder", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TranslationRow reference="criticality" value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText("criticality");
    expect(input.tagName).toBe("INPUT");
    expect(screen.getByText("criticality")).toHaveAttribute("title", "criticality");
    await user.type(input, "K");
    expect(onChange).toHaveBeenLastCalledWith("K");
  });

  it("renders no caption unless one is given", () => {
    const { container } = render(
      <TranslationRow reference="owner" value="" onChange={vi.fn()} />,
    );
    // Only the reference text and the input — nothing labelling the row.
    expect(container.querySelector(".MuiTypography-caption")).toBeNull();
    expect(screen.getByPlaceholderText("owner").closest(".MuiInputBase-multiline")).toBeNull();
  });

  it("renders a multiline row with a caption above its reference", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const help = "How bad an outage is.\nAsk the owner.";
    render(
      <TranslationRow
        multiline
        caption="Help text"
        reference={help}
        value="Wie schlimm"
        onChange={onChange}
      />,
    );

    const input = screen.getByDisplayValue("Wie schlimm");
    expect(input.tagName).toBe("TEXTAREA");
    expect(input).toHaveAttribute("placeholder", help);
    expect(input.closest(".MuiInputBase-multiline")).not.toBeNull();
    // The full text stays reachable even when the visible reference is clamped.
    const reference = screen.getByTitle(help, { normalizer: (s) => s });
    expect(reference).toHaveTextContent("How bad an outage is.");
    // The caption names the row and sits before its reference.
    const caption = screen.getByText("Help text");
    expect(caption.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.type(input, "!");
    expect(onChange).toHaveBeenLastCalledWith("Wie schlimm!");
  });
});

describe("TranslationGroup", () => {
  it("shows its title, an optional count and its rows", () => {
    const { rerender } = render(
      <TranslationGroup title="Subtypes" count={2}>
        <span>row</span>
      </TranslationGroup>,
    );
    expect(screen.getByText("Subtypes")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("row")).toBeInTheDocument();

    rerender(
      <TranslationGroup title="Subtypes">
        <span>row</span>
      </TranslationGroup>,
    );
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });
});
