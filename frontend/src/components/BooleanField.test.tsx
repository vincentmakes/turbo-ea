import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BooleanField, type BooleanFieldProps } from "./BooleanField";
import { BOOLEAN_COLORS } from "@/theme/tokens";

function renderField(value: unknown, extra: Partial<BooleanFieldProps> = {}) {
  const onChange = vi.fn();
  const view = render(<BooleanField label="Commercial" value={value} onChange={onChange} {...extra} />);
  return { onChange, ...view };
}

const inputLabel = (c: HTMLElement) => c.querySelector(".MuiInputLabel-root") as HTMLElement;

async function pick(name: string) {
  await userEvent.click(screen.getByRole("combobox"));
  const listbox = await screen.findByRole("listbox");
  await userEvent.click(within(listbox).getByRole("option", { name }));
}

describe("BooleanField", () => {
  it.each([undefined, null, "", "maybe", 1])("shows nothing selected for an unset value (%j)", async (value) => {
    renderField(value);
    const box = screen.getByRole("combobox");
    expect(box).not.toHaveTextContent(/Yes|No/);
    await userEvent.click(box);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Yes" })).toHaveAttribute("aria-selected", "false");
    expect(within(listbox).getByRole("option", { name: "No" })).toHaveAttribute("aria-selected", "false");
    expect(within(listbox).getByRole("option", { name: "Not set" })).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    [true, "Yes"],
    [false, "No"],
    ["true", "Yes"],
    [" Yes ", "Yes"],
    ["FALSE", "No"],
    ["no", "No"],
  ])("shows %j as %s", (value, text) => {
    renderField(value);
    expect(screen.getByRole("combobox")).toHaveTextContent(text);
  });

  // The empty choice reads "Not set", not "None" — "Has AI features? None"
  // reads as an answer rather than the absence of one (#1266).
  it("offers Not set, Yes and No, the last two with the report colours", async () => {
    renderField(null);
    await userEvent.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Not set",
      "Yes",
      "No",
    ]);
    expect(screen.getByTestId("boolean-dot-true")).toHaveStyle({ backgroundColor: BOOLEAN_COLORS.true });
    expect(screen.getByTestId("boolean-dot-false")).toHaveStyle({ backgroundColor: BOOLEAN_COLORS.false });
  });

  it("writes true for Yes", async () => {
    const { onChange } = renderField(undefined);
    await pick("Yes");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("writes false for No, in one pick", async () => {
    const { onChange } = renderField(undefined);
    await pick("No");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("writes null for Not set", async () => {
    const { onChange } = renderField(true);
    await pick("Not set");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("labels the field when a label is given", () => {
    const { container } = renderField(null);
    expect(screen.getByRole("combobox", { name: /Commercial/ })).toBeInTheDocument();
    expect(inputLabel(container)).toHaveTextContent("Commercial");
  });

  it("renders no label when none is given", () => {
    const { container } = render(<BooleanField value={null} onChange={() => {}} />);
    expect(inputLabel(container)).toBeNull();
    expect(screen.queryByText("Commercial")).not.toBeInTheDocument();
  });

  it("shows an error message as helper text in the error state", () => {
    const { container } = renderField(null, { error: "Pick a value" });
    expect(screen.getByText("Pick a value")).toHaveClass("MuiFormHelperText-root", "Mui-error");
    expect(inputLabel(container)).toHaveClass("Mui-error");
  });

  it("is not in the error state without an error, and shows a plain hint", () => {
    const { container } = renderField(null, { helperText: "A hint" });
    expect(screen.getByText("A hint")).not.toHaveClass("Mui-error");
    expect(container.querySelector(".Mui-error")).toBeNull();
  });

  it("renders no helper text for a bare error flag", () => {
    const { container } = renderField(null, { error: true });
    expect(inputLabel(container)).toHaveClass("Mui-error");
    expect(container.querySelector(".MuiFormHelperText-root")).toBeNull();
  });

  it("renders no helper text when there is neither an error nor a hint", () => {
    const { container } = renderField(null);
    expect(container.querySelector(".MuiFormHelperText-root")).toBeNull();
  });

  it("marks a required field with the asterisk", () => {
    const { container } = renderField(null, { required: true });
    expect(inputLabel(container).querySelector(".MuiFormLabel-asterisk")).not.toBeNull();
  });

  it("has no asterisk when not required", () => {
    const { container } = renderField(null);
    expect(inputLabel(container).querySelector(".MuiFormLabel-asterisk")).toBeNull();
  });

  it("is small by default and medium on request", () => {
    const { container, unmount } = renderField(null);
    expect(container.querySelector(".MuiInputBase-sizeSmall")).not.toBeNull();
    unmount();
    const medium = renderField(null, { size: "medium" });
    expect(medium.container.querySelector(".MuiInputBase-sizeSmall")).toBeNull();
  });

  it("keeps a minimum width unless it fills its row", () => {
    const { container, unmount } = renderField(null);
    expect(container.querySelector(".MuiFormControl-root")).toHaveStyle({ minWidth: "200px" });
    expect(container.querySelector(".MuiFormControl-root")).not.toHaveClass("MuiFormControl-fullWidth");
    unmount();
    const full = renderField(null, { fullWidth: true, sx: { mb: 2 } });
    const root = full.container.querySelector(".MuiFormControl-root")!;
    expect(root).toHaveClass("MuiFormControl-fullWidth");
    expect(root).not.toHaveStyle({ minWidth: "200px" });
    expect(root).toHaveStyle({ marginBottom: "16px" });
  });

  it("can be disabled", () => {
    renderField(true, { disabled: true });
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-disabled", "true");
  });
});
