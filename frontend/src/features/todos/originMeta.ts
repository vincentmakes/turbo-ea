import { CATEGORICAL_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { TodoOrigin } from "@/types";

/**
 * Display metadata for the computed todo `origin` (see `derive_origin` in
 * backend/app/services/todo_service.py). Drives the filter chips and the
 * per-row origin badge on the My Tasks page. Icons reuse the nav/notification
 * vocabulary (`view_timeline` = PPM, `policy` = GRC, `route` = BPM, …) so a
 * todo's badge matches the module it links to; colors are existing tokens.
 */
export const ORIGIN_ORDER: readonly TodoOrigin[] = [
  "ppm",
  "risk",
  "adr",
  "soaw",
  "bpm",
  "extension",
  "manual",
] as const;

export interface OriginMeta {
  icon: string;
  color: string;
  labelKey: string;
}

export const ORIGIN_META: Record<TodoOrigin, OriginMeta> = {
  ppm: { icon: "view_timeline", color: CATEGORICAL_COLORS[0], labelKey: "todos.origin.ppm" },
  risk: { icon: "policy", color: STATUS_COLORS.error, labelKey: "todos.origin.risk" },
  adr: { icon: "gavel", color: CATEGORICAL_COLORS[1], labelKey: "todos.origin.adr" },
  soaw: { icon: "draw", color: CATEGORICAL_COLORS[2], labelKey: "todos.origin.soaw" },
  bpm: { icon: "route", color: CATEGORICAL_COLORS[8], labelKey: "todos.origin.bpm" },
  extension: { icon: "extension", color: CATEGORICAL_COLORS[3], labelKey: "todos.origin.extension" },
  manual: { icon: "edit_note", color: STATUS_COLORS.neutral, labelKey: "todos.origin.manual" },
};

/** Server omits `origin` only on stale cached payloads — treat as manual. */
export function originOf(todo: { origin?: TodoOrigin }): TodoOrigin {
  return todo.origin ?? "manual";
}
