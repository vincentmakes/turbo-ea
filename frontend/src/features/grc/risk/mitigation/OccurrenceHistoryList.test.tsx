/**
 * OccurrenceHistoryList — the read-only audit list under a mitigation task.
 *
 * One block per cycle, newest first, with the owner snapshot taken at
 * completion rendered beside the completer; the latest five show by default.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MitigationTaskOccurrence } from "@/types";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { hookState } from "@/test/hooks";
import OccurrenceHistoryList from "./OccurrenceHistoryList";

function makeOcc(
  overrides: Partial<MitigationTaskOccurrence> & { id: string; sequence: number },
): MitigationTaskOccurrence {
  return {
    task_id: "t1",
    assigned_owner_id: null,
    assigned_owner_name: null,
    due_date: "2026-03-01",
    status: "open",
    activated_at: null,
    completed_at: null,
    completed_by: null,
    completed_by_name: null,
    owner_at_completion: null,
    owner_at_completion_name: null,
    completion_notes: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  hookState.reset();
});

describe("OccurrenceHistoryList", () => {
  it("renders the empty state when there are no occurrences", () => {
    render(<OccurrenceHistoryList occurrences={[]} />);
    expect(screen.getByText("No occurrences yet.")).toBeInTheDocument();
  });

  it("renders a completed cycle with its target date, completer and owner snapshot", () => {
    render(
      <OccurrenceHistoryList
        occurrences={[
          makeOcc({
            id: "o1",
            sequence: 2,
            status: "done",
            due_date: "2026-03-01",
            completed_at: "2026-03-02T09:30:00",
            completed_by_name: "Alice",
            owner_at_completion_name: "Bob",
            completion_notes: "Evidence at https://wiki.example.com/review",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Cycle #2")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText(/Target:\s*2026-03-01/)).toBeInTheDocument();
    expect(screen.getByText(/Completed:\s*2026-03-02 09:30/)).toBeInTheDocument();
    expect(screen.getByText("By Alice · owner at the time: Bob")).toBeInTheDocument();
    // Completion notes are linkified.
    expect(screen.getByRole("link", { name: "https://wiki.example.com/review" })).toHaveAttribute(
      "href",
      "https://wiki.example.com/review",
    );
  });

  it("labels a skipped cycle and falls back to dashes for missing names", () => {
    render(
      <OccurrenceHistoryList
        occurrences={[
          makeOcc({ id: "o1", sequence: 1, status: "skipped", due_date: null, completed_at: null }),
        ]}
      />,
    );
    expect(screen.getByText(/Target:\s*—/)).toBeInTheDocument();
    expect(screen.getByText(/^Skipped:\s*—/)).toBeInTheDocument();
    expect(screen.getByText("By — · owner at the time: —")).toBeInTheDocument();
  });

  it("shows activation and assignee on an open cycle, or Unassigned", () => {
    render(
      <OccurrenceHistoryList
        occurrences={[
          makeOcc({
            id: "o2",
            sequence: 2,
            status: "open",
            activated_at: "2026-02-20T08:00:00",
            assigned_owner_name: "Carol",
          }),
          makeOcc({ id: "o1", sequence: 1, status: "open", activated_at: null }),
        ]}
      />,
    );
    expect(screen.getByText("Activated on 2026-02-20 08:00")).toBeInTheDocument();
    expect(screen.getByText("Assigned to Carol")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows when a scheduled cycle activates, derived from the task lead time", () => {
    render(
      <OccurrenceHistoryList
        occurrences={[
          makeOcc({ id: "o1", sequence: 1, status: "scheduled", due_date: "2026-03-10", assigned_owner_name: "Dan" }),
        ]}
        leadTimeDays={7}
      />,
    );
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Activates 2026-03-03")).toBeInTheDocument();
    expect(screen.getByText("Assigned to Dan")).toBeInTheDocument();
  });

  it("hides the cycle header for one-shot tasks", () => {
    render(
      <OccurrenceHistoryList
        occurrences={[makeOcc({ id: "o1", sequence: 1, status: "done" })]}
        hideCycleLabel
      />,
    );
    expect(screen.queryByText(/Cycle #/)).not.toBeInTheDocument();
    expect(screen.getByText(/Target:/)).toBeInTheDocument();
  });

  it("sorts newest first, shows five, and expands/collapses the older cycles", async () => {
    const user = userEvent.setup();
    const occurrences = Array.from({ length: 7 }, (_, i) =>
      makeOcc({ id: `o${i + 1}`, sequence: i + 1, status: "done" }),
    );
    render(<OccurrenceHistoryList occurrences={occurrences} />);

    const labels = () => screen.getAllByText(/^Cycle #\d+$/).map((el) => el.textContent);
    expect(labels()).toEqual(["Cycle #7", "Cycle #6", "Cycle #5", "Cycle #4", "Cycle #3"]);

    await user.click(screen.getByRole("button", { name: /Show 2 older cycles/ }));
    expect(labels()).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /Show 2 older cycles/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Collapse history/ }));
    expect(labels()).toHaveLength(5);
  });

  it("uses the singular label for exactly one hidden cycle", () => {
    const occurrences = Array.from({ length: 6 }, (_, i) =>
      makeOcc({ id: `o${i + 1}`, sequence: i + 1, status: "done" }),
    );
    render(<OccurrenceHistoryList occurrences={occurrences} />);
    expect(screen.getByRole("button", { name: /Show 1 older cycle$/ })).toBeInTheDocument();
  });
});
