/**
 * Status ↔ percentage for PPM tasks — the single source of truth.
 *
 * A task has no completion of its own: its bar fill and its chip on the Gantt
 * follow the status (To Do 0 %, In Progress 50 %, Done 100 %), and the parent
 * work package rolls those up duration-weighted on the backend
 * (`_rollup_wbs_from_tasks`, whose factor table mirrors `TASK_STATUS_PERCENT`
 * — keep the two aligned). Four places used to inline the same ternary and
 * the reverse mapping; #1111 showed how illegible that was when the slider
 * offered stops nobody had labelled.
 */

import type { PpmTaskStatus } from "@/types";

export const TASK_STATUS_PERCENT: Record<PpmTaskStatus, number> = {
  todo: 0,
  blocked: 0,
  in_progress: 50,
  done: 100,
};

/** The three slider stops, ascending; `labelKey` is a `ppm` namespace key. */
export const TASK_PROGRESS_MARKS: readonly {
  value: number;
  status: PpmTaskStatus;
  labelKey: string;
}[] = [
  { value: 0, status: "todo", labelKey: "statusTodo" },
  { value: 50, status: "in_progress", labelKey: "statusInProgress" },
  { value: 100, status: "done", labelKey: "statusDone" },
];

export function percentFromStatus(status: PpmTaskStatus | string): number {
  return TASK_STATUS_PERCENT[status as PpmTaskStatus] ?? 0;
}

/**
 * The status a dragged or picked percentage means: ≥ 100 → done, > 0 →
 * in_progress, else todo — unless `current` already maps to that percentage,
 * in which case `current` stands. That guard is what keeps a Blocked task
 * (0 %) blocked when the popover is closed without a change, instead of
 * silently flipping it back to To Do.
 */
export function statusFromPercent(
  percent: number,
  current?: PpmTaskStatus | string,
): PpmTaskStatus {
  const next: PpmTaskStatus = percent >= 100 ? "done" : percent > 0 ? "in_progress" : "todo";
  if (current && percentFromStatus(current) === percentFromStatus(next)) {
    return current as PpmTaskStatus;
  }
  return next;
}
