/**
 * The confirmation shown before a diagram is created from an aggregated
 * Layered Dependency View. Mounted on its own, never through the view —
 * React Flow cannot lay out under jsdom (see `LdvAggregateSelect.test.tsx`).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LdvExportAggregatedDialog from "./LdvExportAggregatedDialog";

describe("LdvExportAggregatedDialog", () => {
  it("says what stays live and what is decoration", () => {
    render(<LdvExportAggregatedDialog open onClose={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText(/cards stay live/i)).toBeInTheDocument();
    expect(screen.getByText(/container you can move as one/i)).toBeInTheDocument();
    expect(screen.getByText(/connectors between boxes are decoration/i)).toBeInTheDocument();
  });

  it("continues to the name prompt, or cancels", async () => {
    const onContinue = vi.fn();
    const onClose = vi.fn();
    render(<LdvExportAggregatedDialog open onClose={onClose} onContinue={onContinue} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while closed", () => {
    render(<LdvExportAggregatedDialog open={false} onClose={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.queryByText(/cards stay live/i)).not.toBeInTheDocument();
  });
});
