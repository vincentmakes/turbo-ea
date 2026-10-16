import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TriStateBooleanField } from "./TriStateBooleanField";

function renderField(value: unknown, extra: Partial<Parameters<typeof TriStateBooleanField>[0]> = {}) {
  const onChange = vi.fn();
  render(<TriStateBooleanField label="Commercial" value={value} onChange={onChange} {...extra} />);
  return onChange;
}

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("TriStateBooleanField", () => {
  it("renders the label and the three choices", () => {
    renderField(null);
    expect(screen.getByText("Commercial")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Commercial" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not set" })).toBeInTheDocument();
  });

  it("presses Yes for true and No for false", () => {
    renderField(true);
    expect(pressed("Yes")).toBe("true");
    expect(pressed("No")).toBe("false");
    expect(pressed("Not set")).toBe("false");
  });

  it("presses No for false, not nothing", () => {
    renderField(false);
    expect(pressed("No")).toBe("true");
    expect(pressed("Yes")).toBe("false");
  });

  it.each([undefined, null, ""])("presses nothing for an unset value (%s)", (value) => {
    renderField(value);
    expect(pressed("Yes")).toBe("false");
    expect(pressed("No")).toBe("false");
    expect(pressed("Not set")).toBe("false");
  });

  it.each([
    ["true", "Yes"],
    ["yes", "Yes"],
    ["False", "No"],
    [" no ", "No"],
  ])("reads the legacy string %j as %s", (value, name) => {
    renderField(value);
    expect(pressed(name)).toBe("true");
  });

  it("reads any other value as unset", () => {
    renderField("maybe");
    expect(pressed("Yes")).toBe("false");
    expect(pressed("No")).toBe("false");
  });

  it("writes true, false and null", () => {
    const onChange = renderField(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Not set" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("clears a set value through Not set", () => {
    const onChange = renderField(false);
    fireEvent.click(screen.getByRole("button", { name: "Not set" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("ignores a click on the button already pressed", () => {
    const onChange = renderField(true);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an error message as helper text", () => {
    renderField(null, { error: "Required" });
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("prefers explicit helper text", () => {
    renderField(null, { error: true, helperText: "Pick one" });
    expect(screen.getByText("Pick one")).toBeInTheDocument();
  });

  it("can hide the visible label and keep the accessible name", () => {
    renderField(null, { hideLabel: true });
    expect(screen.queryByText("Commercial")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Commercial" })).toBeInTheDocument();
  });

  it("disables every choice", () => {
    renderField(true, { disabled: true });
    expect(screen.getByRole("button", { name: "Yes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not set" })).toBeDisabled();
  });
});
