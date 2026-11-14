/**
 * A PPM task's status and priority as data: their colours and the `ppm` keys
 * that label them. Shared by the chips (`ppmTaskChips.tsx`), the task board's
 * columns and the Initiative Report's timeline.
 */
import { PRIORITY_COLORS, RAG_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import type { PpmTaskPriority, PpmTaskStatus } from "@/types";

/** A task status's colour: to do grey, in progress blue, done green, blocked red. */
export const TASK_STATUS_COLORS: Record<PpmTaskStatus, string> = {
  todo: STATUS_COLORS.neutral,
  in_progress: brand.primary,
  done: RAG_COLORS.green,
  blocked: RAG_COLORS.red,
};

/** Spelled out so the unused-key scan sees every key a status reads. */
export const TASK_STATUS_LABEL_KEYS: Record<PpmTaskStatus, string> = {
  todo: "statusTodo",
  in_progress: "statusInProgress",
  done: "statusDone",
  blocked: "statusBlocked",
};

export const TASK_PRIORITY_LABEL_KEYS: Record<PpmTaskPriority, string> = {
  critical: "priorityCritical",
  high: "priorityHigh",
  medium: "priorityMedium",
  low: "priorityLow",
};

export const hasOwnKey = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The `ppm` key that labels a status, or null for one this build does not know. */
export function taskStatusLabelKey(status: string): string | null {
  return hasOwnKey(TASK_STATUS_LABEL_KEYS, status)
    ? TASK_STATUS_LABEL_KEYS[status as PpmTaskStatus]
    : null;
}

/** A status's colour; one this build does not know (a newer server) is neutral. */
export function taskStatusColor(status: string): string {
  return hasOwnKey(TASK_STATUS_COLORS, status)
    ? TASK_STATUS_COLORS[status as PpmTaskStatus]
    : STATUS_COLORS.neutral;
}

/** A priority's colour; one this build does not know is neutral. */
export function taskPriorityColor(priority: string): string {
  return hasOwnKey(PRIORITY_COLORS, priority)
    ? PRIORITY_COLORS[priority as PpmTaskPriority]
    : STATUS_COLORS.neutral;
}
