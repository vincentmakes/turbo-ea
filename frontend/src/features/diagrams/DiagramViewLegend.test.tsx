/**
 * The legend has to carry several scales at once now that several card types
 * can be coloured simultaneously — and two types' scales can legitimately share
 * an option key, which is what makes the section titles load-bearing rather
 * than decoration.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DiagramViewLegend from "./DiagramViewLegend";
import { colorKey, NO_VALUE, NO_VALUE_COLOR, type ColorEntry } from "./viewSource";

function entry(typeKey: string, fieldKey: string, value: string, label: string): ColorEntry {
  return {
    key: colorKey(typeKey, fieldKey, value),
    value,
    label,
    color: "#ff0000",
    typeKey,
    fieldKey,
  };
}

const APP_SECTION = {
  key: "app",
  title: "Application · Criticality",
  entries: [entry("Application", "criticality", "high", "High")],
};
const ITC_SECTION = {
  key: "itc",
  title: "IT Component · Criticality",
  // Same option key as the Application scale — distinct only by its composite key.
  entries: [entry("ITComponent", "criticality", "high", "High")],
};

describe("DiagramViewLegend", () => {
  it("renders one titled block per active rule", () => {
    render(
      <DiagramViewLegend sections={[APP_SECTION, ITC_SECTION]} appliedCount={5} onReset={vi.fn()} />,
    );
    expect(screen.getByText("Application · Criticality")).toBeInTheDocument();
    expect(screen.getByText("IT Component · Criticality")).toBeInTheDocument();
    // Two swatches share the option label; the titles are what tell them apart.
    expect(screen.getAllByText("High")).toHaveLength(2);
  });

  it("renders nothing when no section has any entries", () => {
    const { container } = render(
      <DiagramViewLegend
        sections={[{ key: "a", title: "Empty", entries: [] }]}
        appliedCount={0}
        onReset={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a no-value swatch only in the section that carries one", () => {
    const withNone = {
      ...ITC_SECTION,
      entries: [
        ...ITC_SECTION.entries,
        {
          ...entry("ITComponent", "criticality", NO_VALUE, "No value"),
          color: NO_VALUE_COLOR,
        },
      ],
    };
    render(
      <DiagramViewLegend sections={[APP_SECTION, withNone]} appliedCount={3} onReset={vi.fn()} />,
    );
    expect(screen.getAllByText("No value")).toHaveLength(1);
  });

  it("reports how many cells a rule coloured", () => {
    render(<DiagramViewLegend sections={[APP_SECTION]} appliedCount={7} onReset={vi.fn()} />);
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });
});
