import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";
import { DateField } from "./DateField";

/** Mark the input as holding a partly-entered date, as browsers do via `validity`. */
function setBadInput(input: HTMLInputElement, bad: boolean) {
  Object.defineProperty(input, "validity", {
    configurable: true,
    get: () => ({ badInput: bad }),
  });
}

describe("DateField", () => {
  it("does not fire onChange while typing — only on blur", () => {
    const onChange = vi.fn();
    render(<DateField label="Target date" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2026-07-24" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-07-24");
  });

  it("does not fire onChange on blur when the value is unchanged", () => {
    const onChange = vi.fn();
    render(<DateField label="Target date" value="2026-07-24" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the in-progress edit when the value prop changes mid-edit (#865)", () => {
    // Simulates an inline auto-save that round-trips and feeds a stale value
    // back into the controlled input while the user is still typing.
    const onChange = vi.fn();
    const { rerender } = render(
      <DateField label="Target date" value="" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2026-07-24" } });

    // Parent re-renders with a different (stale) value while focused.
    rerender(<DateField label="Target date" value="2026-07-01" onChange={onChange} />);

    // The draft the user typed must survive the re-render.
    expect(input.value).toBe("2026-07-24");
  });

  it("mirrors external value updates while not focused", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DateField label="Target date" value="2026-07-24" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Target date") as HTMLInputElement;
    expect(input.value).toBe("2026-07-24");

    rerender(<DateField label="Target date" value="2026-08-01" onChange={onChange} />);
    expect(input.value).toBe("2026-08-01");
  });

  // ── WebKit (issue #1142) ────────────────────────────────────────────────

  it("commits a calendar pick that arrives after the field already blurred", () => {
    // Safari's native picker can take focus: blur, then change, then focus.
    const onChange = vi.fn();
    render(<DateField label="Target date" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "2026-09-23" } });
    fireEvent.focus(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-09-23");
    expect(input.value).toBe("2026-09-23");

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not reset the draft when focus returns mid-edit", () => {
    const onChange = vi.fn();
    render(<DateField label="Target date" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2026-09-23" } });
    fireEvent.focus(input);
    expect(input.value).toBe("2026-09-23");

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("2026-09-23");
  });

  it("never commits the same value twice", () => {
    const onChange = vi.fn();
    render(<DateField label="Target date" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2026-09-23" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "2026-09-23" } });
    fireEvent.input(input, { target: { value: "2026-09-23" } });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("flags a partly-entered date on blur instead of dropping it silently", () => {
    const onChange = vi.fn();
    render(<DateField label="Target date" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    setBadInput(input, true);
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(i18n.t("common:dateField.incomplete"))).toBeInTheDocument();

    // Completing the date clears the warning and commits.
    fireEvent.focus(input);
    setBadInput(input, false);
    fireEvent.change(input, { target: { value: "2026-09-23" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("2026-09-23");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(i18n.t("common:dateField.incomplete"))).toBeNull();
  });

  it("keeps a stored date when the user leaves it half-cleared", () => {
    const onChange = vi.fn();
    render(<DateField label="Target date" value="2026-07-24" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    setBadInput(input, true);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("marks an empty field so WebKit's placeholder date reads as empty", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DateField label="Target date" value="" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Target date") as HTMLInputElement;
    expect(input).toHaveAttribute("data-empty", "true");

    rerender(<DateField label="Target date" value="2026-07-24" onChange={onChange} />);
    expect(input).not.toHaveAttribute("data-empty");
  });

  it("an explicit clear still commits the empty string", () => {
    const onChange = vi.fn();
    render(<DateField label="Target date" value="2026-07-24" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("");
  });

  it.each(["de", "ar", "zh", "en"])(
    "commits ISO yyyy-mm-dd whatever the UI language (%s)",
    async (lng) => {
      const previous = i18n.language;
      await act(async () => {
        await i18n.changeLanguage(lng);
      });
      try {
        const onChange = vi.fn();
        render(<DateField label="Target date" value="" onChange={onChange} />);
        const input = screen.getByLabelText("Target date") as HTMLInputElement;

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "2026-12-31" } });
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledWith("2026-12-31");

        fireEvent.focus(input);
        setBadInput(input, true);
        fireEvent.blur(input);
        expect(
          screen.getByText(i18n.t("common:dateField.incomplete", { lng })),
        ).toBeInTheDocument();
      } finally {
        await act(async () => {
          await i18n.changeLanguage(previous);
        });
      }
    },
  );

  it("preserves the caller's error, helper text and input props", () => {
    const onChange = vi.fn();
    render(
      <DateField
        label="Target date"
        value=""
        onChange={onChange}
        error
        helperText="Required"
        slotProps={{ htmlInput: { "data-testid": "the-input" } }}
      />,
    );
    const input = screen.getByTestId("the-input");
    expect(input).toHaveAttribute("data-empty", "true");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});
