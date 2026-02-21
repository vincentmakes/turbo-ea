import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import KeyInput, { isValidKey, coerceKey } from "./KeyInput";

// ---------------------------------------------------------------------------
// Pure logic: isValidKey
// ---------------------------------------------------------------------------
describe("isValidKey", () => {
  it("accepts simple lowercase keys", () => {
    expect(isValidKey("application")).toBe(true);
  });

  it("accepts camelCase keys", () => {
    expect(isValidKey("businessCriticality")).toBe(true);
    expect(isValidKey("costTotalAnnual")).toBe(true);
  });

  it("accepts PascalCase keys", () => {
    expect(isValidKey("BusinessCapability")).toBe(true);
  });

  it("accepts keys with digits", () => {
    expect(isValidKey("field1")).toBe(true);
    expect(isValidKey("a1b2c3")).toBe(true);
  });

  it("rejects keys starting with a digit", () => {
    expect(isValidKey("1field")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidKey("")).toBe(false);
  });

  it("rejects keys with underscores", () => {
    expect(isValidKey("my_field")).toBe(false);
  });

  it("rejects keys with spaces", () => {
    expect(isValidKey("my field")).toBe(false);
  });

  it("rejects keys with special characters", () => {
    expect(isValidKey("field!")).toBe(false);
    expect(isValidKey("field-name")).toBe(false);
    expect(isValidKey("field.name")).toBe(false);
  });

  it("rejects keys with accented characters", () => {
    expect(isValidKey("café")).toBe(false);
    expect(isValidKey("naïve")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pure logic: coerceKey
// ---------------------------------------------------------------------------
describe("coerceKey", () => {
  it("strips spaces", () => {
    expect(coerceKey("my field")).toBe("myfield");
  });

  it("strips underscores", () => {
    expect(coerceKey("my_field")).toBe("myfield");
  });

  it("strips special characters", () => {
    expect(coerceKey("field!@#$%")).toBe("field");
  });

  it("strips diacritics and normalizes", () => {
    expect(coerceKey("café")).toBe("cafe");
    expect(coerceKey("naïve")).toBe("naive");
  });

  it("preserves valid camelCase", () => {
    expect(coerceKey("businessFit")).toBe("businessFit");
  });

  it("handles empty string", () => {
    expect(coerceKey("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------
describe("KeyInput component", () => {
  it("renders with value", () => {
    render(<KeyInput value="testKey" onChange={vi.fn()} label="Key" />);
    const input = screen.getByDisplayValue("testKey");
    expect(input).toBeDefined();
  });

  it("calls onChange with coerced value when autoFormat is true", () => {
    const onChange = vi.fn();
    render(<KeyInput value="" onChange={onChange} autoFormat={true} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "my_field!" } });
    expect(onChange).toHaveBeenCalledWith("myfield");
  });

  it("calls onChange with raw value when autoFormat is false", () => {
    const onChange = vi.fn();
    render(<KeyInput value="" onChange={onChange} autoFormat={false} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "my_field!" } });
    expect(onChange).toHaveBeenCalledWith("my_field!");
  });

  it("shows locked message when locked", () => {
    render(
      <KeyInput
        value="lockedKey"
        onChange={vi.fn()}
        locked={true}
        lockedReason="Cannot change this key"
      />,
    );
    expect(screen.getByText("Cannot change this key")).toBeDefined();
  });

  it("shows external error when provided", () => {
    render(
      <KeyInput
        value="duplicate"
        onChange={vi.fn()}
        externalError="Key already exists"
      />,
    );
    expect(screen.getByText("Key already exists")).toBeDefined();
  });

  it("disables input when locked", () => {
    render(<KeyInput value="lockedKey" onChange={vi.fn()} locked={true} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveProperty("disabled", true);
  });
});
