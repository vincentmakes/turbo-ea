import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateField } from "./DateField";

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
});
