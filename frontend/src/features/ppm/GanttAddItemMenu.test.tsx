import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import GanttAddItemMenu from "./GanttAddItemMenu";

describe("GanttAddItemMenu", () => {
  it("offers a work package, a milestone and a task, and fires the pick", async () => {
    const user = userEvent.setup();
    const onAddWbs = vi.fn();
    const onAddMilestone = vi.fn();
    const onAddTask = vi.fn();
    const onClose = vi.fn();
    render(
      <GanttAddItemMenu
        anchorEl={document.body}
        onClose={onClose}
        onAddWbs={onAddWbs}
        onAddMilestone={onAddMilestone}
        onAddTask={onAddTask}
      />,
    );
    expect(screen.getByRole("menuitem", { name: /Add Work Package/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Add Milestone/ })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /Create Task/ }));
    expect(onAddTask).toHaveBeenCalledTimes(1);
    expect(onAddWbs).not.toHaveBeenCalled();
    expect(onAddMilestone).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing without an anchor", () => {
    render(
      <GanttAddItemMenu
        anchorEl={null}
        onClose={() => {}}
        onAddWbs={() => {}}
        onAddMilestone={() => {}}
        onAddTask={() => {}}
      />,
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
