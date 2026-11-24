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
});
