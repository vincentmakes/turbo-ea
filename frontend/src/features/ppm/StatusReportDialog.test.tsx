/**
 * StatusReportDialog — create / edit an initiative status report.
 *
 * Pins the defaults a new report opens with, the values an existing report
 * pre-fills, and the exact POST / PATCH body (empty texts sent as null).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmStatusReport } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { todayIsoDate } from "@/lib/dates";
import StatusReportDialog from "./StatusReportDialog";

const REPORT: PpmStatusReport = {
  id: "rep1",
  initiative_id: "i1",
  reporter_id: "u1",
  reporter: { id: "u1", display_name: "Ada" },
  report_date: "2026-04-30",
  schedule_health: "atRisk",
  cost_health: "offTrack",
  scope_health: "onTrack",
  summary: "Slipping by two weeks",
  accomplishments: null,
  next_steps: "Re-plan sprint 7",
  created_at: "2026-04-30T09:00:00",
  updated_at: "2026-04-30T09:00:00",
};

const createPath = "/ppm/initiatives/i1/reports";

function renderDialog(report?: PpmStatusReport) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<StatusReportDialog initiativeId="i1" report={report} onClose={onClose} onSaved={onSaved} />);
  return { user, onClose, onSaved };
}

/** The toggle group under a health caption ("Schedule", "Cost", "Scope"). */
const group = (caption: string) =>
  screen.getByText(caption).parentElement?.querySelector('[role="group"]') as HTMLElement;
const pressed = (caption: string) =>
  within(group(caption))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", createPath, {});
  mockApi.on("patch", /^\/ppm\/reports\//, {});
});

describe("StatusReportDialog — new report", () => {
  it("opens dated today with every dimension on track", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add Report", { selector: "h2" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Report Date")).toHaveValue(todayIsoDate());
    expect(pressed("Schedule")).toEqual(["On Track"]);
    expect(pressed("Cost")).toEqual(["On Track"]);
    expect(pressed("Scope")).toEqual(["On Track"]);
  });

  it("posts the chosen health, date and texts, sending empty texts as null", async () => {
    const { user, onSaved } = renderDialog();
    const dialog = screen.getByRole("dialog");

    await user.click(within(group("Schedule")).getByRole("button", { name: "At Risk" }));
    await user.click(within(group("Cost")).getByRole("button", { name: "Off Track" }));
    // Clicking the selected button would deselect it; the dialog keeps it.
    await user.click(within(group("Scope")).getByRole("button", { name: "On Track" }));
    expect(pressed("Scope")).toEqual(["On Track"]);

    const date = within(dialog).getByLabelText("Report Date");
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: "2026-05-15" } });
    fireEvent.blur(date);

    await user.type(within(dialog).getByRole("textbox", { name: "Summary" }), "On plan");
    await user.type(within(dialog).getByRole("textbox", { name: "Accomplishments" }), "Shipped v1");

    await user.click(within(dialog).getByRole("button", { name: "Add Report" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", createPath)).toHaveLength(1);
    expect(mockApi.callsOf("post", createPath)[0].body).toEqual({
      report_date: "2026-05-15",
      schedule_health: "atRisk",
      cost_health: "offTrack",
      scope_health: "onTrack",
      summary: "On plan",
      accomplishments: "Shipped v1",
      next_steps: null,
    });
  });

  it("disables the save button while the request is in flight", async () => {
    const pending = deferred<unknown>();
    mockApi.on("post", createPath, () => pending.promise);
    const { user, onSaved } = renderDialog();
    const save = within(screen.getByRole("dialog")).getByRole("button", { name: "Add Report" });
    await user.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(within(save).getByRole("progressbar")).toBeInTheDocument();

    pending.resolve({});
    await waitFor(() => expect(save).toBeEnabled());
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("stays open and re-enables saving when the request fails", async () => {
    mockApi.fail("post", createPath, 500);
    const { user, onSaved } = renderDialog();
    const save = within(screen.getByRole("dialog")).getByRole("button", { name: "Add Report" });
    await user.click(save);
    await waitFor(() => expect(mockApi.callsOf("post", createPath)).toHaveLength(1));
    await waitFor(() => expect(save).toBeEnabled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes through Cancel without saving", async () => {
    const { user, onClose } = renderDialog();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.calls).toHaveLength(0);
  });
});

describe("StatusReportDialog — editing", () => {
  it("pre-fills the report and patches it", async () => {
    const { user, onSaved } = renderDialog(REPORT);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit Report")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Report Date")).toHaveValue("2026-04-30");
    expect(pressed("Schedule")).toEqual(["At Risk"]);
    expect(pressed("Cost")).toEqual(["Off Track"]);
    expect(pressed("Scope")).toEqual(["On Track"]);
    expect(within(dialog).getByRole("textbox", { name: "Summary" })).toHaveValue("Slipping by two weeks");
    expect(within(dialog).getByRole("textbox", { name: "Accomplishments" })).toHaveValue("");

    await user.click(within(group("Cost")).getByRole("button", { name: "At Risk" }));
    await user.clear(within(dialog).getByRole("textbox", { name: "Next Steps" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("patch", "/ppm/reports/rep1")[0].body).toEqual({
      report_date: "2026-04-30",
      schedule_health: "atRisk",
      cost_health: "atRisk",
      scope_health: "onTrack",
      summary: "Slipping by two weeks",
      accomplishments: null,
      next_steps: null,
    });
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });
});
