import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTheme } from "@mui/material/styles";
import { PRIORITY_COLORS, RAG_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import { TASK_STATUS_COLORS, TaskPriorityChip, TaskStatusChip } from "./ppmTaskChips";
import {
  TASK_PRIORITY_LABEL_KEYS,
  TASK_STATUS_LABEL_KEYS,
  hasOwnKey,
  taskPriorityColor,
  taskStatusColor,
  taskStatusLabelKey,
} from "./ppmTaskModel";

const { palette } = createTheme();
const chipOf = (container: HTMLElement) => container.querySelector(".MuiChip-root") as HTMLElement;

describe("TASK_STATUS_COLORS", () => {
  it("is grey to do, blue in progress, green done, red blocked", () => {
    expect(TASK_STATUS_COLORS).toEqual({
      todo: STATUS_COLORS.neutral,
      in_progress: brand.primary,
      done: RAG_COLORS.green,
      blocked: RAG_COLORS.red,
    });
  });

  it("reads neutral for a status or priority it does not know, inherited names included", () => {
    expect(taskStatusColor("done")).toBe(RAG_COLORS.green);
    expect(taskStatusColor("parked")).toBe(STATUS_COLORS.neutral);
    expect(taskStatusColor("toString")).toBe(STATUS_COLORS.neutral);
    expect(taskPriorityColor("critical")).toBe(PRIORITY_COLORS.critical);
    expect(taskPriorityColor("whenever")).toBe(STATUS_COLORS.neutral);
    expect(taskPriorityColor("constructor")).toBe(STATUS_COLORS.neutral);
  });

  it("names the key of every status and none for an unknown one", () => {
    expect(taskStatusLabelKey("todo")).toBe("statusTodo");
    expect(taskStatusLabelKey("in_progress")).toBe("statusInProgress");
    expect(taskStatusLabelKey("done")).toBe("statusDone");
    expect(taskStatusLabelKey("blocked")).toBe("statusBlocked");
    expect(taskStatusLabelKey("parked")).toBeNull();
    expect(taskStatusLabelKey("toString")).toBeNull();
  });
});

describe("ppmTaskModel", () => {
  it("spells out every status and priority key", () => {
    expect(TASK_STATUS_LABEL_KEYS).toEqual({
      todo: "statusTodo",
      in_progress: "statusInProgress",
      done: "statusDone",
      blocked: "statusBlocked",
    });
    expect(TASK_PRIORITY_LABEL_KEYS).toEqual({
      critical: "priorityCritical",
      high: "priorityHigh",
      medium: "priorityMedium",
      low: "priorityLow",
    });
  });

  it("reads own keys only", () => {
    expect(hasOwnKey({ a: 1 }, "a")).toBe(true);
    expect(hasOwnKey({ a: 1 }, "toString")).toBe(false);
  });
});

describe("TaskStatusChip", () => {
  it.each([
    ["todo", "To Do", STATUS_COLORS.neutral],
    ["in_progress", "In Progress", brand.primary],
    ["done", "Done", RAG_COLORS.green],
    ["blocked", "Blocked", RAG_COLORS.red],
  ])("fills %s with its colour behind white text", (status, label, color) => {
    const { container } = render(<TaskStatusChip status={status} />);
    const chip = chipOf(container);
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveClass("MuiChip-filled", "MuiChip-sizeSmall");
    expect(chip).toHaveStyle({
      backgroundColor: color,
      color: palette.common.white,
      fontWeight: 600,
      fontSize: "0.7rem",
    });
  });

  it("shows a status it does not know as stored, on neutral grey", () => {
    const { container } = render(<TaskStatusChip status="parked" />);
    expect(screen.getByText("parked")).toBeInTheDocument();
    expect(chipOf(container)).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral });
  });
});

describe("TaskPriorityChip", () => {
  it.each([
    ["critical", "Critical"],
    ["high", "High"],
    ["medium", "Medium"],
    ["low", "Low"],
  ] as const)("outlines %s in its priority colour", (priority, label) => {
    const { container } = render(<TaskPriorityChip priority={priority} />);
    const chip = chipOf(container);
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveClass("MuiChip-outlined", "MuiChip-sizeSmall");
    expect(chip).toHaveStyle({
      borderColor: PRIORITY_COLORS[priority],
      color: PRIORITY_COLORS[priority],
      fontWeight: 600,
    });
  });

  it("does not take an inherited property for a priority", () => {
    render(<TaskPriorityChip priority="toString" />);
    expect(screen.getByText("toString")).toBeInTheDocument();
  });

  it("shows a priority it does not know as stored, outlined in neutral grey", () => {
    const { container } = render(<TaskPriorityChip priority="whenever" />);
    expect(screen.getByText("whenever")).toBeInTheDocument();
    expect(chipOf(container)).toHaveStyle({
      borderColor: STATUS_COLORS.neutral,
      color: STATUS_COLORS.neutral,
    });
  });
});
