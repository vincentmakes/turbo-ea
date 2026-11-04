/** ComplianceHeatmap's cell wash: the status hue for a cell with findings, a faint grey for an empty one. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { alpha, createTheme } from "@mui/material/styles";
import { RAG_COLORS } from "@/theme/tokens";
import ComplianceHeatmap from "./ComplianceHeatmap";

describe("ComplianceHeatmap colours", () => {
  it("washes a cell in its status colour by count, and an empty cell in grey", () => {
    render(
      <ComplianceHeatmap
        regulations={[{ key: "eu_ai_act", label: "EU AI Act" }]}
        matrix={{ eu_ai_act: { compliant: 2 } }}
        scores={{ eu_ai_act: 50 }}
      />,
    );
    const cellOf = (el: HTMLElement) => el.parentElement as HTMLElement;
    expect(cellOf(screen.getByText("2"))).toHaveStyle({
      backgroundColor: alpha(RAG_COLORS.green, 0.15 + 2 * 0.05),
    });
    const empty = screen.getAllByText("—").map(cellOf);
    expect(empty).toHaveLength(4);
    for (const cell of empty) {
      expect(cell).toHaveStyle({ backgroundColor: alpha(createTheme().palette.grey[600], 0.08) });
    }
  });
});
