import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import i18n from "@/i18n";
import { fullDateLabel, todayIso } from "@/lib/calendarGrid";
import DateCalendarPopover from "./DateCalendarPopover";

function setup(props: Partial<React.ComponentProps<typeof DateCalendarPopover>> = {}) {
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <DateCalendarPopover
      open
      anchorEl={anchor}
      value="2026-09-23"
      weekLocale="de-DE"
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...utils, onSelect, onClose };
}

const day = (iso: string) =>
  screen.getByRole("button", { name: fullDateLabel(i18n.language, iso) });

describe("DateCalendarPopover", () => {
  it("opens on the month of the value with it selected", () => {
    setup();
    expect(screen.getByRole("grid", { name: "September 2026" })).toBeInTheDocument();
    const cell = day("2026-09-23").closest('[role="gridcell"]');
    expect(cell).toHaveAttribute("aria-selected", "true");
    expect(day("2026-09-23")).toHaveAttribute("tabindex", "0");
  });

  it("picks a day as an ISO date", () => {
    const { onSelect } = setup();
    fireEvent.click(day("2026-09-05"));
    expect(onSelect).toHaveBeenCalledWith("2026-09-05");
  });

  it("moves between months", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.nextMonth") }));
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common:dateField.previousMonth") }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common:dateField.previousMonth") }),
    );
    expect(screen.getByRole("grid", { name: "August 2026" })).toBeInTheDocument();
  });

  it("jumps years through the year list", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.chooseYear") }));
    const list = screen.getByRole("listbox");
    fireEvent.click(within(list).getByRole("option", { name: "2030" }));
    expect(screen.getByRole("grid", { name: "September 2030" })).toBeInTheDocument();
  });

  it("navigates and selects with the keyboard", () => {
    const { onSelect } = setup();
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("2026-10-01");

    fireEvent.keyDown(grid, { key: "PageDown" });
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeInTheDocument();
  });

  it("starts the week on the locale's first day", () => {
    setup({ weekLocale: "de-DE" });
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("aria-label", "Monday");
  });

  it("offers Today, and Clear only when given", () => {
    const onClear = vi.fn();
    const { onSelect } = setup({ onClear });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.today") }));
    expect(onSelect).toHaveBeenCalledWith(todayIso());
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:dateField.clear") }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("hides Clear without a handler", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: i18n.t("common:dateField.clear") }),
    ).toBeNull();
  });

  it("disables days outside min / max", () => {
    const { onSelect } = setup({ min: "2026-09-10", max: "2026-09-20" });
    expect(day("2026-09-09")).toBeDisabled();
    expect(day("2026-09-21")).toBeDisabled();
    fireEvent.click(day("2026-09-15"));
    expect(onSelect).toHaveBeenCalledWith("2026-09-15");
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
