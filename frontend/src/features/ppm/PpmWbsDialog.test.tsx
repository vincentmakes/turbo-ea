import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PpmWbs } from "@/types";

import PpmWbsDialog from "./PpmWbsDialog";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/api/client", () => ({
  api: {
    get,
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}));

function wbs(overrides: Partial<PpmWbs> = {}): PpmWbs {
  return {
    id: "w1",
    initiative_id: "i1",
    title: "Phase 1",
    description: null,
    parent_id: null,
    start_date: "2026-01-01",
    end_date: "2026-03-31",
    is_milestone: false,
    completion: 0,
    assignee_id: null,
    ...overrides,
  } as PpmWbs;
}

function renderDialog(props: Partial<React.ComponentProps<typeof PpmWbsDialog>> = {}) {
  return render(
    <PpmWbsDialog
      initiativeId="i1"
      wbsList={[]}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  get.mockResolvedValue([]);
});

describe("PpmWbsDialog labels", () => {
  it("names the milestone when opened from the Add milestone action", () => {
    renderDialog({ defaultMilestone: true });

    // Both the title and the submit button, hence getAllBy.
    expect(screen.getAllByText("Add Milestone").length).toBeGreaterThan(0);
    expect(screen.queryByText("Add Work Package")).not.toBeInTheDocument();
  });

  it("names the work package when opened from the Add work package action", () => {
    renderDialog({ defaultMilestone: false });

    expect(screen.getAllByText("Add Work Package").length).toBeGreaterThan(0);
    expect(screen.queryByText("Add Milestone")).not.toBeInTheDocument();
  });

  it("follows the Milestone toggle live", async () => {
    const user = userEvent.setup();
    renderDialog({ defaultMilestone: false });

    expect(screen.getAllByText("Add Work Package").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("checkbox", { name: /milestone/i }));

    expect(screen.getAllByText("Add Milestone").length).toBeGreaterThan(0);
    expect(screen.queryByText("Add Work Package")).not.toBeInTheDocument();
  });

  it("uses milestone wording when editing an existing milestone", async () => {
    const user = userEvent.setup();
    renderDialog({ wbs: wbs({ is_milestone: true, title: "Go live" }) });

    expect(screen.getByText("Edit Milestone")).toBeInTheDocument();
    expect(screen.getByText("Delete Milestone")).toBeInTheDocument();

    await user.click(screen.getByText("Delete Milestone"));

    expect(screen.getByText("Delete this milestone?")).toBeInTheDocument();
  });

  it("uses work-package wording when editing an existing work package", async () => {
    const user = userEvent.setup();
    renderDialog({ wbs: wbs() });

    expect(screen.getByText("Edit Work Package")).toBeInTheDocument();
    expect(screen.getByText("Delete Work Package")).toBeInTheDocument();

    await user.click(screen.getByText("Delete Work Package"));

    expect(
      screen.getByText(/Delete this work package\? Tasks assigned to it/),
    ).toBeInTheDocument();
  });
});
