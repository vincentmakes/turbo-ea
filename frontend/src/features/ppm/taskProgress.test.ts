import { describe, expect, it } from "vitest";

import {
  percentFromStatus,
  statusFromPercent,
  TASK_PROGRESS_MARKS,
  TASK_STATUS_PERCENT,
} from "./taskProgress";

describe("taskProgress", () => {
  it("maps every status to its bar fill", () => {
    expect(percentFromStatus("todo")).toBe(0);
    expect(percentFromStatus("blocked")).toBe(0);
    expect(percentFromStatus("in_progress")).toBe(50);
    expect(percentFromStatus("done")).toBe(100);
    expect(percentFromStatus("something-else")).toBe(0);
  });

  it("maps a percentage back to the status it means", () => {
    expect(statusFromPercent(0)).toBe("todo");
    expect(statusFromPercent(1)).toBe("in_progress");
    expect(statusFromPercent(50)).toBe("in_progress");
    expect(statusFromPercent(99)).toBe("in_progress");
    expect(statusFromPercent(100)).toBe("done");
  });

  it("keeps a Blocked task blocked when its 0 % is picked again", () => {
    // Closing the popover untouched on a Blocked task used to PATCH it to
    // To Do — both statuses sit at 0 %, so the current one must win.
    expect(statusFromPercent(0, "blocked")).toBe("blocked");
    expect(statusFromPercent(50, "blocked")).toBe("in_progress");
    expect(statusFromPercent(100, "done")).toBe("done");
    expect(statusFromPercent(0, "todo")).toBe("todo");
  });

  it("offers three ascending stops that round-trip through both mappings", () => {
    expect(TASK_PROGRESS_MARKS.map((m) => m.value)).toEqual([0, 50, 100]);
    for (const mark of TASK_PROGRESS_MARKS) {
      expect(percentFromStatus(mark.status)).toBe(mark.value);
      expect(statusFromPercent(mark.value)).toBe(mark.status);
    }
    expect(Object.keys(TASK_STATUS_PERCENT).sort()).toEqual(
      ["blocked", "done", "in_progress", "todo"],
    );
  });
});
