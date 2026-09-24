import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";
import { DateField } from "./DateField";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

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

  it("preserves the caller's error, helper text, input props and sx", () => {
    const onChange = vi.fn();
    render(
      <DateField
        label="Target date"
        value=""
        onChange={onChange}
        error
        helperText="Required"
        slotProps={{ htmlInput: { "data-testid": "the-input" } }}
        sx={{ width: 170 }}
      />,
    );
    const input = screen.getByTestId("the-input");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Required")).toBeInTheDocument();
    // The caller's sx still reaches the root alongside the WebKit backdrop.
    const root = input.closest(".MuiTextField-root") as HTMLElement;
    expect(getComputedStyle(root).width).toBe("170px");
  });

  it("renders Chrome/Firefox's native date input with nothing added", () => {
    // The default jsdom UA is neither WebKit nor Safari, i.e. the Chrome path.
    const { container } = render(
      <DateField label="Target date" value="" onChange={vi.fn()} />,
    );
    const input = screen.getByLabelText("Target date") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input).not.toHaveAttribute("lang");
    expect(input).not.toHaveAttribute("placeholder");
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-date-placeholder]")).toBeNull();
    // No rule paints the input's background: Blink derives its grey
    // placeholder colour from it, and a backdrop once turned it black.
    const root = input.closest(".MuiTextField-root") as HTMLElement;
    const rootClasses = Array.from(root.classList).filter((c) => c.startsWith("css-"));
    const rules = Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules),
    ) as CSSStyleRule[];
    const painting = rules.filter(
      (r) =>
        rootClasses.some((c) => r.selectorText?.includes(`.${c}`)) &&
        /input/.test(r.selectorText) &&
        r.style.getPropertyValue("background-color") !== "",
    );
    expect(painting).toEqual([]);
  });

  it("renders the themed text field on Safari instead", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(SAFARI_MAC);
    try {
      render(<DateField label="Target date" value="2026-07-24" onChange={vi.fn()} />);
      const input = screen.getByLabelText("Target date") as HTMLInputElement;
      expect(input.type).toBe("text");
      expect(document.querySelector('input[type="date"]')).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
