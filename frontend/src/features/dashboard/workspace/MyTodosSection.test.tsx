/**
 * MyTodosSection: the user's open todos, six at most, with the due date, an
 * Overdue chip once the date has passed and a mark on recurring ones. A todo
 * on a card opens that card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import MyTodosSection from "./MyTodosSection";

const MINE = "/todos?status=open&assigned_only=true";

interface Todo {
  id: string;
  card_id: string | null;
  card_name: string | null;
  description: string;
  status: string;
  due_date: string | null;
  recurrence_unit?: string;
}

const todo = (id: string, over: Partial<Todo> = {}): Todo => ({
  id,
  card_id: `card-${id}`,
  card_name: `Card ${id}`,
  description: `Todo ${id}`,
  status: "open",
  due_date: null,
  ...over,
});

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function renderSection() {
  return renderWithProviders(<MyTodosSection />, {
    routes: [{ path: "/" }, { path: "/cards/:id", element: <Where /> }],
  });
}

const rowOf = async (description: string) =>
  (await screen.findByText(description)).parentElement as HTMLElement;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  // Noon local time on 10 March 2026: "today" is 2026-03-10 in every zone.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 2, 10, 12) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MyTodosSection", () => {
  it("loads the user's open todos, showing progress until they arrive", async () => {
    mockApi.on("get", MINE, [todo("a")]);
    renderSection();
    expect(screen.getByText("My Open Todos")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Todo a")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", MINE)).toHaveLength(1);
  });

  it("lists six todos at most", async () => {
    mockApi.on(
      "get",
      MINE,
      Array.from({ length: 8 }, (_, i) => todo(`t${i}`)),
    );
    renderSection();
    expect(await screen.findByText("Todo t5")).toBeInTheDocument();
    expect(screen.queryByText("Todo t6")).not.toBeInTheDocument();
  });

  it("says so when nothing is open", async () => {
    mockApi.on("get", MINE, []);
    renderSection();
    expect(await screen.findByText("No open todos. You're all caught up.")).toBeInTheDocument();
  });

  it("shows the empty state when the load fails", async () => {
    mockApi.fail("get", MINE, 500);
    renderSection();
    expect(await screen.findByText("No open todos. You're all caught up.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("marks an open todo overdue only once its due date has passed", async () => {
    mockApi.on("get", MINE, [
      todo("past", { due_date: "2026-03-09T23:00:00Z" }),
      todo("today", { due_date: "2026-03-10" }),
      todo("later", { due_date: "2026-03-11" }),
      todo("none"),
      todo("done", { status: "done", due_date: "2026-01-01" }),
    ]);
    renderSection();
    expect(within(await rowOf("Todo past")).getByText("Overdue")).toBeInTheDocument();
    for (const id of ["today", "later", "none", "done"]) {
      expect(within(await rowOf(`Todo ${id}`)).queryByText("Overdue")).not.toBeInTheDocument();
    }
  });

  it("shows the due date in the workspace format, and none when there is none", async () => {
    hookState.dateFormat = "DD/MM/YYYY";
    mockApi.on("get", MINE, [todo("a", { due_date: "2026-04-02" }), todo("b")]);
    renderSection();
    expect(within(await rowOf("Todo a")).getByText("02/04/2026")).toBeInTheDocument();
    expect((await rowOf("Todo b")).textContent).toBe("Todo b");
  });

  it("marks a recurring todo", async () => {
    mockApi.on("get", MINE, [
      todo("weekly", { recurrence_unit: "weeks" }),
      todo("once", { recurrence_unit: "none" }),
    ]);
    renderSection();
    expect(within(await rowOf("Todo weekly")).getByText("repeat")).toBeInTheDocument();
    expect(within(await rowOf("Todo once")).queryByText("repeat")).not.toBeInTheDocument();
  });

  it("opens the todo's card", async () => {
    mockApi.on("get", MINE, [todo("a")]);
    const { user } = renderSection();
    const row = await rowOf("Todo a");
    expect(row).toHaveStyle({ cursor: "pointer" });
    await user.click(screen.getByText("Todo a"));
    expect(screen.getByTestId("where")).toHaveTextContent("/cards/card-a");
  });

  it("goes nowhere for a todo on no card", async () => {
    mockApi.on("get", MINE, [todo("a", { card_id: null })]);
    const { user } = renderSection();
    const row = await rowOf("Todo a");
    expect(row).toHaveStyle({ cursor: "default" });
    await user.click(screen.getByText("Todo a"));
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
  });

  it("links to every todo", async () => {
    mockApi.on("get", MINE, []);
    renderSection();
    expect(screen.getByRole("link", { name: "View all →" })).toHaveAttribute("href", "/todos");
    await screen.findByText("No open todos. You're all caught up.");
  });
});
