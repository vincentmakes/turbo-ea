import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PpmInitiativeTimeline from "./PpmInitiativeTimeline";

describe("PpmInitiativeTimeline", () => {
  it("shows the protected actual date and one-date marker", () => {
    render(
      <PpmInitiativeTimeline
        name="Example"
        schedule={{
          initiative_id: "i1",
          start_date: "2026-04-01",
          end_date: "2026-09-30",
          plan_start_date: "2026-04-01",
          plan_end_date: "2026-09-30",
          actual_start_date: "2026-05-15",
          actual_start_label: "Aruba Actual Start",
          plan_derived: false,
        }}
        now={new Date(2026, 6, 1)}
      />,
    );
    expect(screen.getByText("Aruba Actual Start")).toBeInTheDocument();
    expect(screen.getByTestId("actual-marker")).toBeInTheDocument();
    expect(screen.getByText(/Q2.*26/)).toBeInTheDocument();
  });
  it("shows today on both tracks and leaves health indicators to Health Summary", () => {
    render(
      <PpmInitiativeTimeline
        name="Example"
        schedule={{
          initiative_id: "i1",
          plan_start_date: "2026-04-01",
          plan_end_date: "2026-09-30",
          plan_derived: false,
          schedule_health: "offTrack",
          cost_health: "atRisk",
          scope_health: "atRisk",
        }}
        now={new Date(2026, 6, 1)}
      />,
    );
    expect(screen.getAllByTestId("today-marker")).toHaveLength(2);
    expect(screen.queryByText("On Time")).not.toBeInTheDocument();
    expect(screen.queryByText("On Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("On Scope")).not.toBeInTheDocument();
  });
});
