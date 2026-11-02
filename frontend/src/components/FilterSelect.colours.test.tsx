import { render, screen } from "@testing-library/react";
import { createTheme } from "@mui/material/styles";
import { describe, expect, it } from "vitest";

import FilterSelect from "./FilterSelect";

describe("FilterSelect colours", () => {
  it("prints a coloured option's chip in white on its colour, and leaves a plain one to the theme", () => {
    const palette = createTheme().palette;
    render(
      <FilterSelect
        label="Criticality"
        options={[
          { key: "high", label: "High", color: "#d32f2f" },
          { key: "low", label: "Low" },
        ]}
        value={["high", "low"]}
        onChange={() => {}}
      />,
    );
    const chip = (label: string) => screen.getByText(label).closest(".MuiChip-root");
    expect(chip("High")).toHaveStyle({ backgroundColor: "#d32f2f", color: palette.common.white });
    expect(chip("Low")).toHaveStyle({ color: palette.text.primary });
  });
});
