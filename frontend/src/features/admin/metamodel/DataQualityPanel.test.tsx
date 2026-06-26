import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DataQualityPanel from "./DataQualityPanel";
import type { CardType } from "@/types";

vi.mock("@/api/client", () => ({
  api: { patch: vi.fn().mockResolvedValue({}) },
}));

function makeType(overrides: Partial<CardType> = {}): CardType {
  return {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    has_hierarchy: false,
    has_successors: false,
    subtypes: [],
    fields_schema: [
      { section: "Details", fields: [{ key: "vendor", label: "Vendor", type: "text", weight: 2 }] },
    ],
    built_in: true,
    is_hidden: false,
    sort_order: 0,
    ...overrides,
  };
}

describe("DataQualityPanel built-in factors", () => {
  it("renders all five built-in factors, each with a weight tier", () => {
    render(<DataQualityPanel cardType={makeType()} onRefresh={() => {}} />);

    // All five built-in factor rows are present.
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Lifecycle")).toBeInTheDocument();
    expect(screen.getByText("Mandatory relations")).toBeInTheDocument();
    expect(screen.getByText("Mandatory tags")).toBeInTheDocument();
    expect(screen.getByText("Stakeholder roles")).toBeInTheDocument();

    // One slider per built-in (5) + one per field (1) = 6.
    expect(screen.getAllByRole("slider")).toHaveLength(6);
  });

  it("shows the configured weight for lifecycle (and defaults the rest to Normal)", () => {
    const cardType = makeType({
      section_config: { __dataQuality: { lifecycle: 3, description: 0 } },
    });
    render(<DataQualityPanel cardType={cardType} onRefresh={() => {}} />);

    // Lifecycle configured to Critical (3), description to Ignore (0),
    // relations/tags default to Normal (1).
    expect(screen.getByText("Critical (3)")).toBeInTheDocument();
    expect(screen.getByText("Ignore (0)")).toBeInTheDocument();
    expect(screen.getAllByText("Normal (1)").length).toBeGreaterThanOrEqual(2);
  });
});
