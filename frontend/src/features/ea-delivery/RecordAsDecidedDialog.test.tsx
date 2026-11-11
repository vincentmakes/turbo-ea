import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({ api: { post: vi.fn(), get: vi.fn() } }));

import { api } from "@/api/client";
import type { DecisionPerson } from "@/types";
import RecordAsDecidedDialog, { recordPayload, recordProblems, todayIso } from "./RecordAsDecidedDialog";

const ADA: DecisionPerson = { user_id: "u1", display_name: "Ada" };
const BOARD: DecisionPerson = { user_id: null, display_name: "Architecture board" };

/** A mock answer that rejects only when called (no eager rejected promise). */
const rejecting = (err: unknown) => async () => {
  throw err;
};

beforeEach(() => {
  vi.mocked(api.post).mockReset();
});

describe("helpers", () => {
  it("formats today as a local ISO date", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 10, 30))).toBe("2026-11-30");
  });

  it("needs a decided date not after today and a decision maker", () => {
    expect(recordProblems("", [], "2026-11-10")).toEqual(["decided_on_missing", "no_decision_maker"]);
    expect(recordProblems("2026-11-11", [ADA], "2026-11-10")).toEqual(["decided_on_future"]);
    expect(recordProblems("2026-11-10", [ADA], "2026-11-10")).toEqual([]);
    expect(recordProblems("2026-11-09", [BOARD], "2026-11-10")).toEqual([]);
  });

  it("leaves an empty effective date to the server's default", () => {
    expect(recordPayload("2026-01-02", "")).toEqual({ decided_on: "2026-01-02" });
    expect(recordPayload("2026-01-02", "2026-02-01")).toEqual({
      decided_on: "2026-01-02",
      effective_from: "2026-02-01",
    });
  });
});

function renderDialog(makers: DecisionPerson[] = [ADA, BOARD], prepare?: () => Promise<void>) {
  const onRecorded = vi.fn();
  const onClose = vi.fn();
  render(
    <RecordAsDecidedDialog
      open
      adrId="a1"
      decisionMakers={makers}
      onClose={onClose}
      onRecorded={onRecorded}
      prepare={prepare}
      today="2026-11-10"
    />,
  );
  return { onRecorded, onClose };
}

const setDate = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("RecordAsDecidedDialog", () => {
  it("explains that the decision is locked and labelled as recorded, and names the makers", () => {
    renderDialog();
    expect(screen.getByText(/labelled as recorded, not signed in Turbo EA/)).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Architecture board")).toBeInTheDocument();
    expect(screen.getByTestId("record-decided-on")).toHaveAttribute("max", "2026-11-10");
  });

  it("asks for the decided date before submitting", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByText("Enter the date the decision was taken.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  it("refuses a future date", () => {
    renderDialog();
    setDate("record-decided-on", "2026-11-11");
    expect(screen.getByText("The decided date cannot be in the future.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  it("refuses to submit without a decision maker and says so", () => {
    renderDialog([]);
    setDate("record-decided-on", "2026-11-01");
    expect(
      screen.getByText("Add at least one decision maker to the decision before recording it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  it("saves first, then records with the dates, and hands back the decision", async () => {
    const order: string[] = [];
    const prepare = vi.fn(async () => {
      order.push("prepare");
    });
    vi.mocked(api.post).mockImplementation(async () => {
      order.push("record");
      return { id: "a1", status: "signed" } as never;
    });
    const { onRecorded } = renderDialog([ADA], prepare);
    setDate("record-decided-on", "2026-11-10");
    setDate("record-effective-from", "2026-12-01");
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({ id: "a1", status: "signed" }));
    expect(api.post).toHaveBeenCalledWith("/adr/a1/record", {
      decided_on: "2026-11-10",
      effective_from: "2026-12-01",
    });
    expect(order).toEqual(["prepare", "record"]);
  });

  it("does not record when the save before it fails", async () => {
    renderDialog([ADA], async () => {
      throw new Error("save failed");
    });
    setDate("record-decided-on", "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByText("Failed to record the decision")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the server's problem codes as readable messages", async () => {
    vi.mocked(api.post).mockImplementation(rejecting(
      Object.assign(new Error("x"), {
        detail: { error: "link_target_not_locked", problems: ["link_target_not_locked", "valid_until_past"] },
      }),
    ));
    const { onRecorded } = renderDialog([ADA]);
    setDate("record-decided-on", "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(
      await screen.findByText(
        "Every linked decision must be signed first. Valid until is already in the past.",
      ),
    ).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/adr/a1/record", { decided_on: "2026-11-01" });
    expect(onRecorded).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
  });

  it("closes on cancel", async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
