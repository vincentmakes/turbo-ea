/**
 * UnassignedTodosSection: the oldest overdue todos across the instance, plus
 * a count of open todos nobody owns. A todo on a card opens that card.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import UnassignedTodosSection, { type OverdueTodoRow } from "./UnassignedTodosSection";

const todo = (id: string, over: Partial<OverdueTodoRow> = {}): OverdueTodoRow => ({
  id,
  title: `Todo ${id}`,
  due_date: "2026-01-05",
  card_id: `card-${id}`,
  assignee_id: "u1",
  assignee_name: "Ada",
  ...over,
});

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function renderSection(rows: OverdueTodoRow[], unassignedCount = 0, loading = false) {
  return renderWithProviders(
    <UnassignedTodosSection rows={rows} unassignedCount={unassignedCount} loading={loading} />,
    { routes: [{ path: "/" }, { path: "/cards/:id", element: <Where /> }] },
  );
}

const rowOf = (title: string) => screen.getByText(title).parentElement!.parentElement!;

beforeEach(() => {
  hookState.reset();
});

describe("UnassignedTodosSection", () => {
  it("shows a progress bar while loading", () => {
    renderSection([todo("a")], 3, true);
    expect(screen.getByText("Oldest overdue todos")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Todo a")).not.toBeInTheDocument();
    expect(screen.queryByText(/without an assignee/)).not.toBeInTheDocument();
  });

  it("says so when nothing is overdue", () => {
    renderSection([]);
    expect(screen.getByText("No overdue todos in the system.")).toBeInTheDocument();
    expect(screen.queryByText(/without an assignee/)).not.toBeInTheDocument();
  });

  it.each([
    [1, "1 open todo without an assignee"],
    [4, "4 open todos without an assignee"],
  ])("counts %i open todo(s) nobody owns", (count, text) => {
    renderSection([], count);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText("No overdue todos in the system.")).toBeInTheDocument();
  });

  it("lists each todo with its assignee and due date", () => {
    renderSection([
      todo("a"),
      todo("b", { assignee_id: null, assignee_name: null, due_date: "2026-02-10" }),
      todo("c", { due_date: null }),
    ]);
    expect(within(rowOf("Todo a")).getByText("Ada")).toBeInTheDocument();
    expect(within(rowOf("Todo a")).getByText("2026-01-05")).toBeInTheDocument();
    expect(within(rowOf("Todo b")).getByText("Unassigned")).toBeInTheDocument();
    expect(within(rowOf("Todo b")).getByText("2026-02-10")).toBeInTheDocument();
    expect(rowOf("Todo c").textContent).toBe("Todo cAda");
  });

  it("writes the due date in the workspace format", () => {
    hookState.dateFormat = "DD/MM/YYYY";
    renderSection([todo("a")]);
    expect(screen.getByText("05/01/2026")).toBeInTheDocument();
  });

  it("opens the todo's card", async () => {
    const { user } = renderSection([todo("a")]);
    expect(rowOf("Todo a")).toHaveStyle({ cursor: "pointer" });
    await user.click(screen.getByText("Todo a"));
    expect(screen.getByTestId("where")).toHaveTextContent("/cards/card-a");
  });

  it("goes nowhere for a todo on no card", async () => {
    const { user } = renderSection([todo("a", { card_id: null })]);
    expect(rowOf("Todo a")).toHaveStyle({ cursor: "default" });
    await user.click(screen.getByText("Todo a"));
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
    expect(screen.getByText("Todo a")).toBeInTheDocument();
  });
});
