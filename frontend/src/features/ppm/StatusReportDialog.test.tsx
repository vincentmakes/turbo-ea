/**
 * StatusReportDialog — create / edit an initiative status report.
 *
 * Pins the defaults a new report opens with, the values an existing report
 * pre-fills, and the exact POST / PATCH body (empty texts sent as null).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmStatusReport } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { todayIsoDate } from "@/lib/dates";
import { RAG_COLORS } from "@/theme/tokens";
import i18n from "@/i18n";
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
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
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

  it("stays open, says why and re-enables saving when the request fails", async () => {
    mockApi.fail("post", createPath, 500);
    const { user, onSaved } = renderDialog();
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Add Report" });
    await user.click(save);
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(`POST ${createPath} failed`);
    await waitFor(() => expect(save).toBeEnabled());
    expect(mockApi.callsOf("post", createPath)).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("falls back to a generic message when a save fails without one", async () => {
    mockApi.on("post", createPath, () => Promise.reject("network down"));
    const { user, onSaved } = renderDialog();
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add Report" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("closes through Cancel without saving", async () => {
    const { user, onClose } = renderDialog();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.calls).toHaveLength(0);
  });
});

describe("StatusReportDialog — RAG colours", () => {
  it("fills each selected health in the theme's RAG colour", () => {
    renderDialog(REPORT);
    const button = (caption: string, name: string) =>
      within(group(caption)).getByRole("button", { name });
    expect(button("Scope", "On Track")).toHaveStyle({ backgroundColor: RAG_COLORS.green });
    expect(button("Schedule", "At Risk")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
    expect(button("Cost", "Off Track")).toHaveStyle({ backgroundColor: RAG_COLORS.red });
    // In white text (palette.common.white).
  });
});

describe("StatusReportDialog — RAG colours on hover", () => {
  /** The background a selected toggle takes on hover: the last `.Mui-selected:hover` rule for its class. */
  function selectedHoverBackground(button: HTMLElement): string {
    const classes = Array.from(button.classList).filter((c) => c.startsWith("css-"));
    const rules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((r): r is CSSStyleRule => "selectorText" in r)
      .filter((r) =>
        classes.some((c) => r.selectorText.includes(`.${c}.Mui-selected:hover`)) &&
        r.style.getPropertyValue("background-color") !== "",
      );
    return cssColor(rules.at(-1)?.style.getPropertyValue("background-color") ?? "");
  }

  /** A colour in one spelling (a stylesheet keeps hex, an inline style turns it into rgb). */
  function cssColor(value: string): string {
    const probe = document.createElement("div");
    probe.style.backgroundColor = value;
    return probe.style.backgroundColor;
  }

  it("keeps each selected health in its RAG colour while it is hovered", () => {
    renderDialog(REPORT);
    const button = (caption: string, name: string) =>
      within(group(caption)).getByRole("button", { name });
    expect(selectedHoverBackground(button("Scope", "On Track"))).toBe(cssColor(RAG_COLORS.green));
    expect(selectedHoverBackground(button("Schedule", "At Risk"))).toBe(cssColor(RAG_COLORS.amber));
    expect(selectedHoverBackground(button("Cost", "Off Track"))).toBe(cssColor(RAG_COLORS.red));
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

  it("says why when the patch fails, and saves on the next try", async () => {
    mockApi.fail("patch", "/ppm/reports/rep1", 422);
    const { user, onSaved } = renderDialog(REPORT);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "PATCH /ppm/reports/rep1 failed",
    );
    expect(onSaved).not.toHaveBeenCalled();

    mockApi.on("patch", "/ppm/reports/rep1", {});
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("patch", "/ppm/reports/rep1")).toHaveLength(2);
  });
});

describe("StatusReportDialog — pre-filled texts and translated buttons", () => {
  it("pre-fills accomplishments and next steps when the report has them", () => {
    renderDialog({ ...REPORT, accomplishments: "Closed epic 4" });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Accomplishments" })).toHaveValue("Closed epic 4");
    expect(within(dialog).getByRole("textbox", { name: "Next Steps" })).toHaveValue("Re-plan sprint 7");
  });

  it("translates Cancel and Save through the shared common keys", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      renderDialog(REPORT);
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
