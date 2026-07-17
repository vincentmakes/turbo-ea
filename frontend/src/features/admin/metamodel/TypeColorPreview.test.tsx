import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TypeColorPreview from "./TypeColorPreview";
import { readableTypeColor } from "@/lib/color";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("TypeColorPreview", () => {
  it("renders a light and a dark sample canvas", () => {
    render(<TypeColorPreview color="#0f7eb5" icon="apps" typeLabel="Application" />);
    expect(screen.getByText("colorPicker.previewLight")).toBeInTheDocument();
    expect(screen.getByText("colorPicker.previewDark")).toBeInTheDocument();
    // Type label appears in both canvases (header, chip, LDV name + caption)
    expect(screen.getAllByText("Application").length).toBeGreaterThanOrEqual(4);
  });

  it("shows the subtype next to the type label when provided", () => {
    render(
      <TypeColorPreview
        color="#0f7eb5"
        icon="apps"
        typeLabel="Application"
        subtypeLabel="Microservice"
      />,
    );
    expect(screen.getAllByText(/Microservice/).length).toBe(2); // one per canvas
  });

  it("renders for pale and dark colors alike", () => {
    const { rerender } = render(<TypeColorPreview color="#FFFFB5" icon="apps" typeLabel="App" />);
    expect(screen.getAllByText("App").length).toBeGreaterThanOrEqual(4);
    rerender(<TypeColorPreview color="#003399" icon="apps" typeLabel="App" />);
    expect(screen.getAllByText("App").length).toBeGreaterThanOrEqual(4);
  });

  it("dark canvas uses a lightened accent for a dark color", () => {
    // Sanity-check the helper contract the component relies on
    expect(readableTypeColor("#003399", true)).not.toBe("#003399");
    expect(readableTypeColor("#003399", false)).toBe("#003399");
  });

  it("degrades gracefully on a non-hex color", () => {
    render(<TypeColorPreview color="not-a-color" icon="apps" typeLabel="App" />);
    expect(screen.getByText("colorPicker.previewLight")).toBeInTheDocument();
  });
});
