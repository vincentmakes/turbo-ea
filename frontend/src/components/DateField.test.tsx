import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";
import { getLuminance } from "@mui/material/styles";
import { buildTheme } from "@/theme";
import {
  datePlaceholder,
  dateInputLocale,
  webkitPlaceholderBackdrop,
} from "@/lib/datePlaceholder";
import { DateField } from "./DateField";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function useUserAgent(ua: string, maxTouchPoints = 0) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
  // jsdom does not implement maxTouchPoints.
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    get: () => maxTouchPoints,
  });
}

function expectedPlaceholder() {
  return datePlaceholder(dateInputLocale(), {
    day: i18n.t("common:dateField.placeholder.day"),
    month: i18n.t("common:dateField.placeholder.month"),
    year: i18n.t("common:dateField.placeholder.year"),
  });
}

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

  // WebKit colours an empty segment's placeholder (today's date) by comparing
  // the input's text colour with the input's own background, alpha ignored
  // (RenderTheme::datePlaceholderTextColor). The backdrop must sit on the
  // correct side of the text colour, or today's date renders like a real one.
  it.each(["light", "dark"] as const)(
    "gives WebKit a backdrop that greys the placeholder in %s mode",
    (mode) => {
      const theme = buildTheme(mode);
      const backdrop = webkitPlaceholderBackdrop(theme);
      const alphaChannel = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(backdrop)?.[1]);
      expect(alphaChannel).toBeLessThanOrEqual(0.02);

      const text = getLuminance(theme.palette.text.primary);
      const background = getLuminance(backdrop);
      if (mode === "light") expect(text).toBeLessThan(background);
      else expect(text).toBeGreaterThan(background);
    },
  );

  it("applies the backdrop to the rendered date input", () => {
    render(<DateField label="Target date" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;
    const root = input.closest(".MuiTextField-root") as HTMLElement;
    const rootClass = Array.from(root.classList).find((c) => c.startsWith("css-"));
    const expected = webkitPlaceholderBackdrop(buildTheme("light")).replace(/\s/g, "");

    // Asserted on the emitted rule rather than getComputedStyle: jsdom's
    // cascade ignores specificity, so MUI's `background: none` on the input's
    // single class wins there, whereas every browser lets this
    // root-class-plus-element selector override it.
    const rules = Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules),
    ) as CSSStyleRule[];
    const rule = rules.find(
      (r) =>
        r.selectorText?.includes(`.${rootClass}`) &&
        r.selectorText.includes("input[type=date]"),
    );
    expect(rule).toBeDefined();
    expect(rule!.style.getPropertyValue("background-color").replace(/\s/g, "")).toBe(expected);
  });
});

// Safari fills an empty date field with today's date and has no calendar
// button on macOS; DateField draws Chrome's look itself there (#1142).
describe("DateField on WebKit", () => {
  const showPicker = vi.fn();

  beforeEach(() => {
    showPicker.mockReset();
    (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker = showPicker;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker;
    delete (window.navigator as { maxTouchPoints?: number }).maxTouchPoints;
  });

  function placeholderEl(container: HTMLElement) {
    return container.querySelector("[data-date-placeholder]");
  }

  it("shows a day/month/year placeholder built from the input's locale while empty", () => {
    useUserAgent(SAFARI_MAC);
    const { container } = render(
      <DateField label="Target date" value="" onChange={vi.fn()} />,
    );
    const placeholder = placeholderEl(container);
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveTextContent(expectedPlaceholder());
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the placeholder in the same light grey Chrome uses for an unset date", () => {
    // Chrome paints its native day/month/year placeholder at about #9D9D9D on
    // white; MUI's text.disabled (black at 38%) resolves to #9E9E9E there.
    useUserAgent(SAFARI_MAC);
    const { container } = render(
      <DateField label="Target date" value="" onChange={vi.fn()} />,
    );
    const placeholder = placeholderEl(container) as HTMLElement;
    expect(getComputedStyle(placeholder).color.replace(/\s/g, "")).toBe(
      buildTheme("light").palette.text.disabled.replace(/\s/g, ""),
    );
  });

  it("pins the input's lang to the placeholder's locale so the orders agree", () => {
    useUserAgent(SAFARI_MAC);
    render(<DateField label="Target date" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Target date");
    expect(input).toHaveAttribute("lang", dateInputLocale());
  });

  it("drops the placeholder once a date is set", () => {
    useUserAgent(SAFARI_MAC);
    const { container, rerender } = render(
      <DateField label="Target date" value="" onChange={vi.fn()} />,
    );
    expect(placeholderEl(container)).not.toBeNull();
    rerender(<DateField label="Target date" value="2026-07-24" onChange={vi.fn()} />);
    expect(placeholderEl(container)).toBeNull();
  });

  it("drops the placeholder while the entry is incomplete, so the typed segments show", () => {
    useUserAgent(SAFARI_MAC);
    const { container } = render(
      <DateField label="Target date" value="" onChange={vi.fn()} />,
    );
    const input = screen.getByLabelText("Target date") as HTMLInputElement;
    fireEvent.focus(input);
    setBadInput(input, true);
    fireEvent.blur(input);
    expect(placeholderEl(container)).toBeNull();
  });

  it("follows the UI language for the field labels", async () => {
    useUserAgent(SAFARI_MAC);
    const previous = i18n.language;
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      const { container } = render(
        <DateField label="Target date" value="" onChange={vi.fn()} />,
      );
      const text = placeholderEl(container)?.textContent ?? "";
      expect(text).toContain("tt");
      expect(text).toContain("jjjj");
    } finally {
      await act(async () => {
        await i18n.changeLanguage(previous);
      });
    }
  });

  it("offers a calendar button on macOS that opens the native picker", () => {
    useUserAgent(SAFARI_MAC);
    render(<DateField label="Target date" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Target date");
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }),
    );
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it("disables the calendar button with the field", () => {
    useUserAgent(SAFARI_MAC);
    render(<DateField label="Target date" value="" onChange={vi.fn()} disabled />);
    expect(
      screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }),
    ).toBeDisabled();
  });

  it("falls back to focusing when showPicker is unavailable", () => {
    useUserAgent(SAFARI_MAC);
    delete (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker;
    render(<DateField label="Target date" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Target date");
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }),
    );
    expect(document.activeElement).toBe(input);
  });

  it.each([
    ["iPad (desktop-mode UA)", SAFARI_MAC, 5],
    ["iPhone", SAFARI_IPHONE, 5],
  ])("shows the calendar button and placeholder on %s", (_name, ua, touch) => {
    useUserAgent(ua as string, touch as number);
    const { container } = render(
      <DateField label="Target date" value="" onChange={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }),
    );
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(placeholderEl(container)).not.toBeNull();
  });

  it("offers no clear button while the field is empty", () => {
    useUserAgent(SAFARI_MAC);
    render(<DateField label="Target date" value="" onChange={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: i18n.t("common:dateField.clear") }),
    ).toBeNull();
  });

  it("clears a set date at once with its own button, bypassing the native picker", () => {
    useUserAgent(SAFARI_IPHONE, 5);
    const onChange = vi.fn();
    const { container } = render(
      <DateField label="Target date" value="2026-07-24" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Target date") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.clear") }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
    expect(input.value).toBe("");
    expect(placeholderEl(container)).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: i18n.t("common:dateField.clear") }),
    ).toBeNull();

    // Leaving the field afterwards does not commit a second time.
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("offers no clear button on a disabled field", () => {
    useUserAgent(SAFARI_MAC);
    render(
      <DateField label="Target date" value="2026-07-24" onChange={vi.fn()} disabled />,
    );
    expect(
      screen.queryByRole("button", { name: i18n.t("common:dateField.clear") }),
    ).toBeNull();
  });

  it("commits iOS picker Reset at once, without waiting for a blur", () => {
    // Reset sets the value to "" through input/change while the field is focused.
    useUserAgent(SAFARI_IPHONE, 5);
    const onChange = vi.fn();
    render(<DateField label="Target date" value="2026-07-24" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");

    fireEvent.change(input, { target: { value: "2026-09-23" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-09-23");

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps commit-on-blur on desktop Safari, where segments are typed (#865)", () => {
    useUserAgent(SAFARI_MAC);
    const onChange = vi.fn();
    render(<DateField label="Target date" value="" onChange={onChange} />);
    const input = screen.getByLabelText("Target date") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0002-07-24" } });
    fireEvent.change(input, { target: { value: "2026-07-24" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-07-24");
  });

  it("leaves Chrome and Firefox to their own native placeholder and button", () => {
    // The default jsdom UA is neither WebKit nor Safari.
    const { container } = render(
      <DateField label="Target date" value="" onChange={vi.fn()} />,
    );
    expect(placeholderEl(container)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Target date")).not.toHaveAttribute("lang");
  });

  it("keeps the caller's deprecated InputProps and inputRef", () => {
    useUserAgent(SAFARI_MAC);
    const ref = { current: null as HTMLInputElement | null };
    render(
      <DateField
        label="Target date"
        value=""
        onChange={vi.fn()}
        variant="standard"
        InputProps={{ disableUnderline: true }}
        inputRef={ref}
      />,
    );
    const input = screen.getByLabelText("Target date");
    expect(ref.current).toBe(input);
    const root = input.closest(".MuiInputBase-root") as HTMLElement;
    // disableUnderline is what removes MUI's `underline` class.
    expect(root.className).not.toMatch(/MuiInput-underline/);
    expect(
      screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }),
    ).toBeInTheDocument();
  });

  it("still commits a calendar pick through the new button", () => {
    useUserAgent(SAFARI_MAC);
    const onChange = vi.fn();
    const { container } = render(
      <DateField label="Target date" value="" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Target date") as HTMLInputElement;
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }),
    );
    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "2026-09-23" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-23");
    expect(placeholderEl(container)).toBeNull();
  });
});
