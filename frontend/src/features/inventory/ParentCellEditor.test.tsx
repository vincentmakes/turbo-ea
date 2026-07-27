import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ParentCellEditor from "./ParentCellEditor";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  }),
}));

import { api } from "@/api/client";

const CANDIDATES = {
  items: [
    { id: "p1", name: "Finance Suite", type: "Application" },
    { id: "p2", name: "Treasury Hub", type: "Application" },
  ],
  total: 2,
  page: 1,
  page_size: 50,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(CANDIDATES);
});

function renderEditor(overrides: Record<string, unknown> = {}) {
  const onValueChange = vi.fn();
  const stopEditing = vi.fn();
  render(
    <ParentCellEditor
      value="p1"
      typeKey="Application"
      excludeIds={["c9"]}
      currentParent={{ id: "p1", name: "Finance Suite", type: "Application" }}
      onValueChange={onValueChange}
      stopEditing={stopEditing}
      api={{ stopEditing: vi.fn() } as never}
      {...overrides}
    />,
  );
  return { onValueChange, stopEditing };
}

describe("ParentCellEditor", () => {
  it("shows the current parent", () => {
    renderEditor();
    expect(screen.getByRole("combobox")).toHaveValue("Finance Suite");
  });

  it("emits the picked card's id, not the card object", async () => {
    // The column's valueGetter reads `data.parent_id`, so the editor has to
    // hand AG Grid a plain id. Emitting an object here is what made the
    // post-setter re-read disagree with the setter and silently drop the move.
    const { onValueChange } = renderEditor();

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByText("Treasury Hub"));

    expect(onValueChange).toHaveBeenCalledWith("p2");
  });

  it("emits null when the picker is cleared", async () => {
    const { onValueChange } = renderEditor();

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.clear(screen.getByRole("combobox"));
    await userEvent.keyboard("{Backspace}");

    expect(onValueChange).toHaveBeenCalledWith(null);
  });

  it("starts empty for a card with no parent", () => {
    renderEditor({ value: null, currentParent: null });
    expect(screen.getByRole("combobox")).toHaveValue("");
  });
});
