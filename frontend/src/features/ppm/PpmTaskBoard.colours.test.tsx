/**
 * The task board's colours: each status column's accent, the list view's
 * status chip, and on every task card the priority stripe and the icons.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTheme } from "@mui/material/styles";

import { AuthProvider } from "@/hooks/AuthContext";
import { PRIORITY_COLORS, RAG_COLORS, STATUS_CHIP_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import type { PpmTask, PpmWbs, User } from "@/types";

import PpmTaskBoard from "./PpmTaskBoard";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/client", () => ({
  api: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const ME = { id: "u1", email: "me@example.com", display_name: "Me", role: "member", is_active: true } as User;
const base = { initiative_id: "i1", description: null, assignee_id: null, assignee_name: null, start_date: null, due_date: null, sort_order: 0, tags: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const TASKS = [
  { ...base, id: "t1", title: "Ship it", status: "done", priority: "high", wbs_id: "w1", comment_count: 2 },
  { ...base, id: "t2", title: "Odd one", status: "todo", priority: "whenever", wbs_id: null, comment_count: 0 },
] as PpmTask[];
const WBS = [{ id: "w1", initiative_id: "i1", title: "Phase 1", parent_id: null, is_milestone: false } as PpmWbs];
const { palette } = createTheme();

const renderBoard = (entry = "/ppm/i1") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider user={ME} refreshUser={async () => {}}>
        <PpmTaskBoard initiativeId="i1" />
      </AuthProvider>
    </MemoryRouter>,
  );
const paperOf = (text: string) => screen.getByText(text).closest(".MuiPaper-root") as HTMLElement;

beforeEach(() => {
  get.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith("/tasks") ? TASKS : path.endsWith("/wbs") ? WBS : []),
  );
});

describe("PpmTaskBoard colours", () => {
  it.each([
    ["To Do", STATUS_COLORS.neutral],
    ["In Progress", brand.primary],
    ["Done", RAG_COLORS.green],
    ["Blocked", RAG_COLORS.red],
  ])("tops the %s column with its status colour", async (label, color) => {
    renderBoard();
    await screen.findByText("Ship it");
    expect(paperOf(label)).toHaveStyle({ borderTopColor: color, borderTopWidth: "3px" });
  });

  it("fills the list view's status chip, white on the status colour", async () => {
    renderBoard("/ppm/i1?view=list");
    await screen.findByText("Ship it");
    const chip = screen.getAllByText("Done").map((el) => el.closest(".MuiChip-root")).find(Boolean)!;
    expect(chip).toHaveStyle({ backgroundColor: RAG_COLORS.green, color: palette.common.white });
  });
});

describe("PpmTaskCard colours", () => {
  it("stripes a card by priority, grey for an unknown one, and tints its icons", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByText("Odd one")).toBeInTheDocument());
    expect(paperOf("Ship it")).toHaveStyle({ borderLeftColor: PRIORITY_COLORS.high });
    expect(paperOf("Odd one")).toHaveStyle({ borderLeftColor: palette.grey[400] });
    const done = within(paperOf("Ship it"));
    expect(done.getByText("check_circle")).toHaveStyle({ color: STATUS_CHIP_COLORS.success.text });
    expect(within(paperOf("Odd one")).getByText("circle")).toHaveStyle({ color: palette.action.disabled });
    expect(done.getByText("account_tree")).toHaveStyle({ color: palette.text.disabled });
    expect(done.getByText("comment")).toHaveStyle({ color: palette.text.disabled });
  });
});
