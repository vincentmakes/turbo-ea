/**
 * PpmReportsTab regressions: the edit and delete icon buttons had no
 * accessible names, and a failed delete was an unhandled rejection that told
 * the user nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmStatusReport } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import i18n from "@/i18n";
import PpmReportsTab from "./PpmReportsTab";

function report(overrides: Partial<PpmStatusReport> = {}): PpmStatusReport {
  return {
    id: "rep1",
    initiative_id: "i1",
    reporter_id: "u1",
    reporter: { id: "u1", display_name: "Ada" },
    report_date: "2026-04-30",
    schedule_health: "onTrack",
    cost_health: "onTrack",
    scope_health: "onTrack",
    summary: null,
    accomplishments: null,
    next_steps: null,
    created_at: "2026-04-30T09:00:00",
    updated_at: "2026-04-30T09:00:00",
    ...overrides,
  };
}

const REPORTS = [
  report({ id: "rep1", report_date: "2026-04-30" }),
  report({ id: "rep2", report_date: "2026-03-31" }),
];

/** The report card holding the report dated `date` (as the date mock prints it). */
const cardOf = (date: string) => screen.getByText(date).closest(".MuiPaper-root") as HTMLElement;

/** Records unhandled promise rejections (an async handler that threw) for one test. */
let rejections: unknown[] = [];
const onRejection = (reason: unknown) => rejections.push(reason);

function renderTab(reports: PpmStatusReport[] = REPORTS) {
  const onRefresh = vi.fn();
  const user = userEvent.setup();
  render(<PpmReportsTab initiativeId="i1" reports={reports} onRefresh={onRefresh} />);
  return { user, onRefresh };
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  mockApi.on("delete", /^\/ppm\/reports\//, null);
  rejections = [];
  process.on("unhandledRejection", onRejection);
});

afterEach(() => {
  process.off("unhandledRejection", onRejection);
});

describe("PpmReportsTab — accessible names", () => {
  it("names every report's edit and delete buttons", () => {
    renderTab();
    for (const date of ["2026-04-30", "2026-03-31"]) {
      expect(within(cardOf(date)).getByRole("button", { name: "Edit Report" })).toBeInTheDocument();
      expect(within(cardOf(date)).getByRole("button", { name: "Delete Report" })).toBeInTheDocument();
    }
  });

  it("names them in the user's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      renderTab([report()]);
      expect(screen.getByRole("button", { name: "Bericht bearbeiten" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Bericht löschen" })).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("opens the report dialog from the named edit button", async () => {
    const { user } = renderTab();
    await user.click(within(cardOf("2026-03-31")).getByRole("button", { name: "Edit Report" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("PpmReportsTab — deleting", () => {
  it("deletes a report through the named button and refreshes the parent", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(within(cardOf("2026-03-31")).getByRole("button", { name: "Delete Report" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("delete")).toEqual([
      { method: "delete", path: "/ppm/reports/rep2", body: undefined },
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a failed delete above the reports instead of failing silently", async () => {
    mockApi.fail("delete", "/ppm/reports/rep2", 409);
    const { user, onRefresh } = renderTab();
    await user.click(within(cardOf("2026-03-31")).getByRole("button", { name: "Delete Report" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DELETE /ppm/reports/rep2 failed");
    // Spaced off the first report below it.
    expect(alert.compareDocumentPosition(cardOf("2026-04-30"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);

    // It can be dismissed.
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("says something went wrong when the delete fails without a message", async () => {
    mockApi.on("delete", "/ppm/reports/rep1", () => Promise.reject("offline"));
    const { user } = renderTab();
    await user.click(within(cardOf("2026-04-30")).getByRole("button", { name: "Delete Report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(rejections).toEqual([]);
  });

  it("clears a failed delete once the next one succeeds", async () => {
    mockApi.fail("delete", "/ppm/reports/rep2", 409);
    const { user, onRefresh } = renderTab();
    await user.click(within(cardOf("2026-03-31")).getByRole("button", { name: "Delete Report" }));
    await screen.findByRole("alert");

    await user.click(within(cardOf("2026-04-30")).getByRole("button", { name: "Delete Report" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
