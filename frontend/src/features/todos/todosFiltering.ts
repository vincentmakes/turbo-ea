import { searchRank } from "@/lib/searchRank";
import type { Todo, TodoOrigin } from "@/types";
import { ORIGIN_ORDER, originOf } from "./originMeta";

/**
 * Pure view logic for the My Tasks list — origin filtering, free-text search
 * and sorting — kept out of the component so it is testable without
 * rendering. The whole list is already in memory (the server scopes only by
 * tab + status), so search filters on the raw input with no debounce, per the
 * house search-box rule.
 */

export type TodoSort = "dueDate" | "created" | "origin";

export interface TodoViewState {
  /** Selected origins; empty set means "all". */
  origins: ReadonlySet<TodoOrigin>;
  search: string;
  sort: TodoSort;
}

export function isOverdue(todo: Todo): boolean {
  if (todo.status !== "open" || !todo.due_date) return false;
  // due_date is an ISO date (YYYY-MM-DD); compare against today in the
  // user's local timezone using the same YYYY-MM-DD shape.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return todo.due_date.slice(0, 10) < todayStr;
}

export function compareByDueDateAsc(a: Todo, b: Todo): number {
  // Due date ascending so the most urgent items (overdue first, then nearest
  // due) land at the top. Rows without a due date go last.
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

function compareByCreatedDesc(a: Todo, b: Todo): number {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

function compareByOrigin(a: Todo, b: Todo): number {
  const diff = ORIGIN_ORDER.indexOf(originOf(a)) - ORIGIN_ORDER.indexOf(originOf(b));
  return diff !== 0 ? diff : compareByDueDateAsc(a, b);
}

const SORT_COMPARATORS: Record<TodoSort, (a: Todo, b: Todo) => number> = {
  dueDate: compareByDueDateAsc,
  created: compareByCreatedDesc,
  origin: compareByOrigin,
};

/** Per-origin counts over the loaded (tab/status-scoped) list — feeds the
 *  filter-chip badges, so counts ignore the origin selection itself. */
export function countByOrigin(todos: Todo[]): Partial<Record<TodoOrigin, number>> {
  const counts: Partial<Record<TodoOrigin, number>> = {};
  for (const todo of todos) {
    const origin = originOf(todo);
    counts[origin] = (counts[origin] ?? 0) + 1;
  }
  return counts;
}

/** Best searchRank across the fields a user would scan for; -1 = no match. */
function todoSearchRank(todo: Todo, query: string): number {
  let best = -1;
  for (const field of [
    todo.description,
    todo.card_name,
    todo.creator_name,
    todo.assignee_name,
    todo.external_ref,
  ]) {
    if (!field) continue;
    const rank = searchRank(field, query);
    if (rank >= 0 && (best < 0 || rank < best)) best = rank;
  }
  return best;
}

export interface TodoOriginGroup {
  origin: TodoOrigin;
  todos: Todo[];
  overdueCount: number;
}

/** Bucket an already filtered/sorted list (the output of `applyTodoView`)
 *  into per-origin sections for the grouped view. Groups follow
 *  `ORIGIN_ORDER`; rows keep their incoming order; empty groups are
 *  omitted. `overdueCount` powers the red hint on a collapsed header. */
export function groupTodosByOrigin(todos: Todo[]): TodoOriginGroup[] {
  const buckets = new Map<TodoOrigin, TodoOriginGroup>();
  for (const todo of todos) {
    const origin = originOf(todo);
    let group = buckets.get(origin);
    if (!group) {
      group = { origin, todos: [], overdueCount: 0 };
      buckets.set(origin, group);
    }
    group.todos.push(todo);
    if (isOverdue(todo)) group.overdueCount += 1;
  }
  return ORIGIN_ORDER.filter((origin) => buckets.has(origin)).map(
    (origin) => buckets.get(origin) as TodoOriginGroup,
  );
}

/** Apply origin filter, search and sort. When a query is active the results
 *  are ranked by relevance first (exact → starts-with → word → contains,
 *  mirroring `searchRank`), with the selected sort as tie-breaker. */
export function applyTodoView(todos: Todo[], view: TodoViewState): Todo[] {
  const query = view.search.trim();
  const compare = SORT_COMPARATORS[view.sort];

  const ranks = new Map<string, number>();
  const visible = todos.filter((todo) => {
    if (view.origins.size > 0 && !view.origins.has(originOf(todo))) return false;
    if (!query) return true;
    const rank = todoSearchRank(todo, query);
    ranks.set(todo.id, rank);
    return rank >= 0;
  });

  return visible.sort((a, b) => {
    if (query) {
      const diff = (ranks.get(a.id) ?? 3) - (ranks.get(b.id) ?? 3);
      if (diff !== 0) return diff;
    }
    return compare(a, b);
  });
}
