import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PpmTask } from "@/types";

import PpmTaskDialog from "./PpmTaskDialog";

const { get, post, patch } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  api: {
    get,
    post,
    patch,
    delete: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}));

// Thirty lines: far more than the three the field used to show.
const LONG_DESCRIPTION = Array.from(
  { length: 30 },
  (_, i) => `Line ${i + 1} of the acceptance criteria`,
).join("\n");

function task(overrides: Partial<PpmTask> = {}): PpmTask {
  return {
    id: "t1",
    initiative_id: "i1",
    title: "Migrate the billing service",
    description: LONG_DESCRIPTION,
    status: "todo",
    priority: "medium",
    assignee_id: null,
    assignee_name: null,
    start_date: null,
    due_date: null,
    sort_order: 0,
    tags: [],
    wbs_id: null,
    comment_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof PpmTaskDialog>> = {},
) {
  const onSaved = vi.fn();
  render(
    <PpmTaskDialog
      initiativeId="i1"
      onClose={vi.fn()}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onSaved };
}

function descriptionField(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: "Description",
  }) as HTMLTextAreaElement;
}

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
});

describe("PpmTaskDialog description", () => {
  it("opens a long description with the whole text in the field", () => {
    renderDialog({ task: task() });

    const field = descriptionField();
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveValue(LONG_DESCRIPTION);
    expect(field.value.split("\n")).toHaveLength(30);
  });

  it("grows with its content instead of sitting at three fixed rows", () => {
    renderDialog({ task: task() });

    const field = descriptionField();
    // A fixed `rows` prop renders a plain textarea carrying the attribute;
    // minRows/maxRows switch MUI to its autosizing textarea instead, which
    // measures the text in a hidden, read-only twin.
    expect(field).not.toHaveAttribute("rows");
    const shadow = field.parentElement?.querySelector(
      'textarea[aria-hidden="true"]',
    );
    expect(shadow).not.toBeNull();
    expect(shadow).toHaveAttribute("readonly");
    expect(shadow).toHaveAttribute("tabindex", "-1");
    expect(shadow).not.toBe(field);
  });

  it("sends the edited description when an existing task is saved", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderDialog({ task: task() });

    const field = descriptionField();
    await user.clear(field);
    await user.type(field, "First line{Enter}Second line");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith("/ppm/tasks/t1", {
      title: "Migrate the billing service",
      description: "First line\nSecond line",
      status: "todo",
      priority: "medium",
      assignee_id: null,
      start_date: null,
      due_date: null,
      wbs_id: null,
    });
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("keeps a long description intact when only the title changes", async () => {
    const user = userEvent.setup();
    renderDialog({ task: task() });

    const title = screen.getByRole("textbox", { name: /Title/ });
    await user.type(title, " now");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({
      title: "Migrate the billing service now",
      description: LONG_DESCRIPTION,
    });
  });

  it("sends a cleared description as null", async () => {
    const user = userEvent.setup();
    renderDialog({ task: task() });

    await user.clear(descriptionField());
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0]).toBe("/ppm/tasks/t1");
    expect(patch.mock.calls[0][1].description).toBeNull();
  });

  it("creates a new task with its description", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByRole("textbox", { name: /Title/ }), "Write runbook");
    await user.type(descriptionField(), "Steps{Enter}and checks");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe("/ppm/initiatives/i1/tasks");
    expect(post.mock.calls[0][1]).toMatchObject({
      title: "Write runbook",
      description: "Steps\nand checks",
    });
    expect(patch).not.toHaveBeenCalled();
  });
});
