import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import { fullDateLabel, todayIso } from "@/lib/calendarGrid";
import { dateInputLocale, datePlaceholder, formatLocalDate } from "@/lib/datePlaceholder";
import SafariDateField from "./SafariDateField";

// Expectations are built from the same Intl helpers, so the suite passes
// whatever locale the test runner happens to have.
const LOCALE = dateInputLocale();
const shown = (iso: string) => formatLocalDate(iso, LOCALE);
const pattern = () =>
  datePlaceholder(LOCALE, {
    day: i18n.t("common:dateField.placeholder.day"),
    month: i18n.t("common:dateField.placeholder.month"),
    year: i18n.t("common:dateField.placeholder.year"),
  });

const calendar = () => screen.queryByRole("dialog", { name: i18n.t("common:dateField.calendar") });
const dayButton = (iso: string) =>
  screen.getByRole("button", { name: fullDateLabel(i18n.language, iso) });

function setup(props: Partial<React.ComponentProps<typeof SafariDateField>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <SafariDateField label="Target date" value="" onChange={onChange} touch={false} {...props} />,
  );
  const input = screen.getByLabelText("Target date") as HTMLInputElement;
  return { ...utils, onChange, input };
}

describe("SafariDateField", () => {
  it("is a text field, never a native date input", () => {
    const { input } = setup({ value: "2026-07-24" });
    expect(input.type).toBe("text");
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(input.value).toBe(shown("2026-07-24"));
  });

  it("shows the locale's own pattern as the placeholder when empty", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("placeholder", pattern());
    expect(input.value).toBe("");
  });

  it("opens the themed calendar when the date itself is clicked", () => {
    const { input } = setup({ value: "2026-07-24" });
    fireEvent.click(input);
    expect(calendar()).not.toBeNull();
    expect(input).toHaveAttribute("aria-expanded", "true");
    // Mac: the caret stays in the field so typing can continue.
    expect(dayButton("2026-07-24")).toBeInTheDocument();
  });

  it("opens the same calendar from the icon and from ArrowDown", () => {
    const { input } = setup();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }));
    expect(calendar()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") }));
    expect(calendar()).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(calendar()).not.toBeNull();
  });

  it("commits a day picked in the calendar once, and closes it", async () => {
    const { input, onChange } = setup({ value: "2026-07-24" });
    fireEvent.click(input);
    fireEvent.click(dayButton("2026-07-10"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-07-10");
    expect(input.value).toBe(shown("2026-07-10"));
    await waitFor(() => expect(calendar()).toBeNull());
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  describe("typing on a Mac", () => {
    it("commits a typed date on blur, in the locale's own order", () => {
      const { input, onChange } = setup();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: shown("2026-12-31") } });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith("2026-12-31");
      expect(input.value).toBe(shown("2026-12-31"));
    });

    it("commits on Enter", () => {
      const { input, onChange } = setup();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: shown("2026-01-05") } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("2026-01-05");
    });

    it("flags text that is not a date and keeps the last good value", () => {
      const { input, onChange } = setup({ value: "2026-07-24" });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "31.02.2026x" } });
      fireEvent.blur(input);
      expect(onChange).not.toHaveBeenCalled();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.getByText(i18n.t("common:dateField.invalid", { pattern: pattern() })),
      ).toBeInTheDocument();

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: shown("2026-08-01") } });
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith("2026-08-01");
      expect(input).toHaveAttribute("aria-invalid", "false");
    });

    it("clears when the text is emptied", () => {
      const { input, onChange } = setup({ value: "2026-07-24" });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith("");
    });

    it("keeps what is being typed when the value prop changes mid-edit (#865)", () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <SafariDateField label="Target date" value="" onChange={onChange} touch={false} />,
      );
      const input = screen.getByLabelText("Target date") as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "24.0" } });
      rerender(
        <SafariDateField label="Target date" value="2026-01-01" onChange={onChange} touch={false} />,
      );
      expect(input.value).toBe("24.0");
    });

    it("treats a date outside min / max as invalid", () => {
      const { input, onChange } = setup({
        slotProps: { htmlInput: { min: "2026-01-01", max: "2026-12-31" } },
      });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: shown("2027-01-01") } });
      fireEvent.blur(input);
      expect(onChange).not.toHaveBeenCalled();
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
  });

  describe("on iPhone / iPad", () => {
    it("is read-only with no on-screen keyboard, and a tap opens the calendar", () => {
      const { input } = setup({ touch: true });
      expect(input).toHaveAttribute("readonly");
      expect(input).toHaveAttribute("inputmode", "none");
      fireEvent.click(input);
      expect(calendar()).not.toBeNull();
    });

    it("commits a pick at once", () => {
      const { input, onChange } = setup({ touch: true });
      fireEvent.click(input);
      fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.today") }));
      expect(onChange).toHaveBeenCalledWith(todayIso());
      expect(input.value).toBe(shown(todayIso()));
    });

    it("clears with Backspace", () => {
      const { input, onChange } = setup({ touch: true, value: "2026-07-24" });
      fireEvent.keyDown(input, { key: "Backspace" });
      expect(onChange).toHaveBeenCalledWith("");
    });
  });

  it("clears with the × button and from inside the calendar", () => {
    const { input, onChange, rerender } = setup({ value: "2026-07-24" });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.clear") }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input.value).toBe("");

    rerender(
      <SafariDateField label="Target date" value="2026-07-24" onChange={onChange} touch={false} />,
    );
    fireEvent.click(input);
    fireEvent.click(
      within(calendar() as HTMLElement).getByRole("button", {
        name: i18n.t("common:dateField.clear"),
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("offers no clear on an empty field", () => {
    setup();
    expect(screen.queryByRole("button", { name: i18n.t("common:dateField.clear") })).toBeNull();
  });

  it("does nothing when disabled", () => {
    const { input } = setup({ value: "2026-07-24", disabled: true });
    fireEvent.click(input);
    expect(calendar()).toBeNull();
    expect(screen.getByRole("button", { name: i18n.t("common:dateField.openPicker") })).toBeDisabled();
    expect(screen.queryByRole("button", { name: i18n.t("common:dateField.clear") })).toBeNull();
  });

  it("keeps the caller's deprecated InputProps, inputRef and helper text", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(
      <SafariDateField
        label="Target date"
        value=""
        onChange={vi.fn()}
        touch={false}
        variant="standard"
        InputProps={{ disableUnderline: true }}
        inputRef={ref}
        helperText="Required"
      />,
    );
    const input = screen.getByLabelText("Target date");
    expect(ref.current).toBe(input);
    expect((input.closest(".MuiInputBase-root") as HTMLElement).className).not.toMatch(
      /MuiInput-underline/,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});
