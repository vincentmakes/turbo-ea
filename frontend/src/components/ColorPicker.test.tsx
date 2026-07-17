import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ColorPicker from "./ColorPicker";

// i18next is not initialised in unit tests — return the key itself.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function openPopover() {
  fireEvent.click(screen.getByText(/#/));
}

describe("ColorPicker warnLowContrast", () => {
  it("shows the advisory warning for a near-invisible pale color", () => {
    render(<ColorPicker value="#FFFFB5" onChange={() => {}} warnLowContrast />);
    openPopover();
    expect(screen.getByText("colorPicker.contrastWarning")).toBeInTheDocument();
  });

  it("shows no warning for a mid-toned color", () => {
    render(<ColorPicker value="#0f7eb5" onChange={() => {}} warnLowContrast />);
    openPopover();
    expect(screen.queryByText("colorPicker.contrastWarning")).toBeNull();
  });

  it("shows no warning when the prop is not set", () => {
    render(<ColorPicker value="#FFFFB5" onChange={() => {}} />);
    openPopover();
    expect(screen.queryByText("colorPicker.contrastWarning")).toBeNull();
  });

  it("never blocks saving a low-contrast color", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#FFFFB5" onChange={onChange} warnLowContrast />);
    openPopover();
    fireEvent.click(screen.getByText("actions.save"));
    expect(onChange).toHaveBeenCalledWith("#FFFFB5");
  });
});
