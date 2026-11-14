/**
 * The two chips a PPM task is shown with in a list: its status (filled in the
 * status colour, white text) and its priority (outlined in the priority
 * colour). The task board's list view draws its rows with them and the
 * Initiative Report its schedule, so a task looks the same on both.
 */
import { useTranslation } from "react-i18next";
import Chip from "@mui/material/Chip";
import type { PpmTaskPriority } from "@/types";
import {
  TASK_PRIORITY_LABEL_KEYS,
  hasOwnKey,
  taskPriorityColor,
  taskStatusColor,
  taskStatusLabelKey,
} from "./ppmTaskModel";

/** Re-exported for the task board's columns, which read it with the chips. */
export { TASK_STATUS_COLORS } from "./ppmTaskModel";

/** A task status, filled in its colour. An unknown status is shown as stored. */
export function TaskStatusChip({ status }: { status: string }) {
  const { t } = useTranslation("ppm");
  const key = taskStatusLabelKey(status);
  const label = key ? t(key) : status;
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: taskStatusColor(status),
        color: "common.white",
        fontWeight: 600,
        fontSize: "0.7rem",
      }}
    />
  );
}

/** A task priority, outlined in its colour. An unknown priority is shown as stored. */
export function TaskPriorityChip({ priority }: { priority: string }) {
  const { t } = useTranslation("ppm");
  const label = hasOwnKey(TASK_PRIORITY_LABEL_KEYS, priority)
    ? t(TASK_PRIORITY_LABEL_KEYS[priority as PpmTaskPriority])
    : priority;
  const color = taskPriorityColor(priority);
  return (
    <Chip
      label={label}
      size="small"
      variant="outlined"
      sx={{ borderColor: color, color, fontWeight: 600 }}
    />
  );
}
