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

describe("ColorPicker presetGroups", () => {
  const archimate = {
    label: "ArchiMate",
    colors: [
      { value: "#FFFFB5", title: "Business — #FFFFB5" },
      { value: "#B5FFFF", title: "Application — #B5FFFF" },
    ],
  };

  it("renders the group label and its swatches", () => {
    render(<ColorPicker value="#0f7eb5" onChange={() => {}} presetGroups={[archimate]} />);
    openPopover();
    expect(screen.getByText("ArchiMate")).toBeInTheDocument();
    expect(screen.getByLabelText("Business — #FFFFB5")).toBeInTheDocument();
    expect(screen.getByLabelText("Application — #B5FFFF")).toBeInTheDocument();
  });

  it("clicking a swatch then Save applies its color", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#0f7eb5" onChange={onChange} presetGroups={[archimate]} />);
    openPopover();
    fireEvent.click(screen.getByLabelText("Business — #FFFFB5"));
    fireEvent.click(screen.getByText("actions.save"));
    expect(onChange).toHaveBeenCalledWith("#FFFFB5");
  });

  it("still shows the contrast hint for a low-contrast curated swatch", () => {
    render(
      <ColorPicker value="#0f7eb5" onChange={() => {}} presetGroups={[archimate]} warnLowContrast />,
    );
    openPopover();
    fireEvent.click(screen.getByLabelText("Business — #FFFFB5"));
    expect(screen.getByText("colorPicker.contrastWarning")).toBeInTheDocument();
  });
});
