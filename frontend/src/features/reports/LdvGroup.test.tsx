/**
 * A layer lane of the Layered Dependency View (#1295). The lane grows and
 * shrinks back with its cards; that is the view's drag wiring
 * (`LayeredDependencyView.test.tsx`) over the arithmetic in
 * `ldvLaneSizing.test.ts`. This file pins the lane itself: its title, its
 * colours in either theme, and that it offers no manual resize control.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { readableTypeColor } from "@/lib/color";
import type { LdvGroupData } from "./layeredDependencyLayout";
import LdvGroup from "./LdvGroup";

const LANE_ID = "group:Application & Data";
const COLOR = "#0f7eb5";
const DATA: LdvGroupData = { label: "Application & Data", color: COLOR };

function renderLane(mode: "light" | "dark" = "light") {
  return render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <LdvGroup
        id={LANE_ID}
        type="ldvGroup"
        data={DATA}
        selected={false}
        zIndex={0}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        {...({} as never)}
      />
    </ThemeProvider>,
  );
}

describe("LdvGroup", () => {
  it("titles the lane with its layer", () => {
    renderLane();
    expect(screen.getByText("Application & Data")).toBeInTheDocument();
  });

  it("fills its node with a dashed, rounded box in the layer's colour", () => {
    renderLane();
    const accent = readableTypeColor(COLOR, false);
    expect(screen.getByTestId("ldv-lane")).toHaveStyle({
      width: "100%",
      height: "100%",
      border: `1.5px dashed ${accent}`,
      borderRadius: "12px",
      backgroundColor: "rgba(0, 0, 0, 0.012)",
      position: "relative",
    });
  });

  it("pins the title to the top-left corner in the layer's colour", () => {
    renderLane();
    expect(screen.getByText("Application & Data")).toHaveStyle({
      position: "absolute",
      top: "8px",
      left: "14px",
      fontWeight: "700",
      fontSize: "0.8rem",
      color: readableTypeColor(COLOR, false),
    });
  });

  it("uses a light tint and the dark-mode accent under the dark theme", () => {
    renderLane("dark");
    const accent = readableTypeColor(COLOR, true);
    // The dark accent is a different colour, so this pins the mode switch.
    expect(accent).not.toBe(readableTypeColor(COLOR, false));
    expect(screen.getByTestId("ldv-lane")).toHaveStyle({
      border: `1.5px dashed ${accent}`,
      backgroundColor: "rgba(255, 255, 255, 0.02)",
    });
    expect(screen.getByText("Application & Data")).toHaveStyle({ color: accent });
  });

  it("offers no manual resize control", () => {
    const { container } = renderLane();
    expect(container.querySelector(".react-flow__resize-control")).toBeNull();
  });

  it("is named for React DevTools and error reports", () => {
    expect(LdvGroup.displayName).toBe("LdvGroup");
  });
});
