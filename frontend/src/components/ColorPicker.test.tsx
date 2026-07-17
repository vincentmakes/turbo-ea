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

describe("ColorPicker renderPreview", () => {
  it("renders the preview panel with the current draft color", () => {
    render(
      <ColorPicker
        value="#0f7eb5"
        onChange={() => {}}
        renderPreview={(draft) => <div data-testid="preview">{draft}</div>}
      />,
    );
    openPopover();
    expect(screen.getByTestId("preview")).toHaveTextContent("#0f7eb5");
  });

  it("does not render a preview panel when the prop is omitted", () => {
    render(<ColorPicker value="#0f7eb5" onChange={() => {}} />);
    openPopover();
    expect(screen.queryByTestId("preview")).toBeNull();
  });
});
