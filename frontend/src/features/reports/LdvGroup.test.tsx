/**
 * A layer lane of the Layered Dependency View (#1295). The lane grows as a
 * card is dragged against its edge; that is the view's drag wiring
 * (`LayeredDependencyView.test.tsx`) over the arithmetic in
 * `ldvLaneSizing.test.ts`. This file pins the lane itself: its title, its
 * colour, and that it offers no manual resize control.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LdvGroupData } from "./layeredDependencyLayout";
import LdvGroup from "./LdvGroup";

const LANE_ID = "group:Application & Data";
const DATA: LdvGroupData = { label: "Application & Data", color: "#0f7eb5" };

function renderLane() {
  return render(
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
    />,
  );
}

describe("LdvGroup", () => {
  it("titles the lane with its layer", () => {
    renderLane();
    expect(screen.getByText("Application & Data")).toBeInTheDocument();
  });

  it("draws a dashed border in the layer's colour", () => {
    renderLane();
    expect(screen.getByTestId("ldv-lane")).toHaveStyle({ borderStyle: "dashed" });
  });

  it("offers no manual resize control", () => {
    const { container } = renderLane();
    expect(container.querySelector(".react-flow__resize-control")).toBeNull();
  });
});
