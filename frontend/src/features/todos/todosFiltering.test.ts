import { describe, it, expect } from "vitest";
import type { Todo, TodoOrigin } from "@/types";
import { applyTodoView, compareByDueDateAsc, countByOrigin } from "./todosFiltering";

let seq = 0;
function makeTodo(overrides: Partial<Todo> = {}): Todo {
  seq += 1;
  return {
    id: `t${seq}`,
    description: `Task ${seq}`,
    status: "open",
    ...overrides,
  };
}

const view = (overrides: Partial<Parameters<typeof applyTodoView>[1]> = {}) => ({
  origins: new Set<TodoOrigin>(),
  search: "",
  sort: "dueDate" as const,
  ...overrides,
});

describe("countByOrigin", () => {
  it("counts per origin, treating a missing origin as manual", () => {
    const todos = [
      makeTodo({ origin: "ppm" }),
      makeTodo({ origin: "ppm" }),
      makeTodo({ origin: "risk" }),
      makeTodo(),
    ];
    expect(countByOrigin(todos)).toEqual({ ppm: 2, risk: 1, manual: 1 });
  });
});

describe("applyTodoView — origin filter", () => {
  const todos = [
    makeTodo({ origin: "ppm", description: "PPM one" }),
    makeTodo({ origin: "risk", description: "Risk one" }),
    makeTodo({ origin: "manual", description: "Manual one" }),
  ];

  it("empty selection means all", () => {
    expect(applyTodoView(todos, view())).toHaveLength(3);
  });

  it("single origin narrows the list", () => {
    const out = applyTodoView(todos, view({ origins: new Set<TodoOrigin>(["risk"]) }));
    expect(out.map((t) => t.description)).toEqual(["Risk one"]);
  });

  it("multi-select is a union", () => {
    const out = applyTodoView(todos, view({ origins: new Set<TodoOrigin>(["ppm", "manual"]) }));
    expect(out.map((t) => t.description).sort()).toEqual(["Manual one", "PPM one"]);
  });
});

describe("applyTodoView — search", () => {
  it("matches description, card name, creator and assignee names", () => {
    const todos = [
      makeTodo({ description: "Upgrade billing" }),
      makeTodo({ description: "x", card_name: "Billing Service" }),
      makeTodo({ description: "y", creator_name: "Bill Evans" }),
      makeTodo({ description: "z", assignee_name: "Jo Billson" }),
      makeTodo({ description: "unrelated" }),
    ];
    const out = applyTodoView(todos, view({ search: "bill" }));
    expect(out).toHaveLength(4);
    expect(out.map((t) => t.description)).not.toContain("unrelated");
  });

  it("ranks better matches first (starts-with beats contains)", () => {
    const todos = [
      makeTodo({ description: "Review billing" }),
      makeTodo({ description: "Billing review" }),
    ];
    const out = applyTodoView(todos, view({ search: "billing" }));
    expect(out[0].description).toBe("Billing review");
  });
});

describe("applyTodoView — sorting", () => {
  it("dueDate: ascending with missing dates last", () => {
    const todos = [
      makeTodo({ description: "no date" }),
      makeTodo({ description: "later", due_date: "2026-09-01" }),
      makeTodo({ description: "sooner", due_date: "2026-08-01" }),
    ];
    const out = applyTodoView(todos, view({ sort: "dueDate" }));
    expect(out.map((t) => t.description)).toEqual(["sooner", "later", "no date"]);
  });

  it("created: newest first", () => {
    const todos = [
      makeTodo({ description: "old", created_at: "2026-01-01T00:00:00" }),
      makeTodo({ description: "new", created_at: "2026-08-01T00:00:00" }),
    ];
    const out = applyTodoView(todos, view({ sort: "created" }));
    expect(out.map((t) => t.description)).toEqual(["new", "old"]);
  });

  it("origin: grouped in ORIGIN_ORDER, due date within a group", () => {
    const todos = [
      makeTodo({ description: "manual", origin: "manual" }),
      makeTodo({ description: "risk-late", origin: "risk", due_date: "2026-09-01" }),
      makeTodo({ description: "ppm", origin: "ppm" }),
      makeTodo({ description: "risk-soon", origin: "risk", due_date: "2026-08-01" }),
    ];
    const out = applyTodoView(todos, view({ sort: "origin" }));
    expect(out.map((t) => t.description)).toEqual(["ppm", "risk-soon", "risk-late", "manual"]);
  });

  it("does not mutate the input array", () => {
    const todos = [
      makeTodo({ due_date: "2026-09-01" }),
      makeTodo({ due_date: "2026-08-01" }),
    ];
    const before = [...todos];
    applyTodoView(todos, view());
    expect(todos).toEqual(before);
  });
});

describe("compareByDueDateAsc", () => {
  it("treats two undated todos as equal", () => {
    expect(compareByDueDateAsc(makeTodo(), makeTodo())).toBe(0);
  });
});
