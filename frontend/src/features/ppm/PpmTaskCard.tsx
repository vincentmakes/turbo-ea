import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PRIORITY_COLORS, STATUS_CHIP_COLORS } from "@/theme/tokens";
import { useDateFormat } from "@/hooks/useDateFormat";
import { todayIsoDate } from "@/lib/dates";
import type { PpmTask } from "@/types";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface Props {
  task: PpmTask;
  wbsName?: string;
  onClick: () => void;
  onMarkDone?: (taskId: string) => void;
  isDragOverlay?: boolean;
}

export default function PpmTaskCard({ task, wbsName, onClick, onMarkDone, isDragOverlay }: Props) {
  const theme = useTheme();
  const { t } = useTranslation("ppm");
  const { formatDate } = useDateFormat();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // See PpmTaskBoard: local date-string comparison, so a task due today is
  // not overdue until tomorrow, in every timezone.
  const isOverdue =
    task.due_date && task.due_date < todayIsoDate() && task.status !== "done";
  const isDone = task.status === "done";

  return (
    <Paper
      ref={isDragOverlay ? undefined : setNodeRef}
      style={isDragOverlay ? undefined : style}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      elevation={isDragOverlay ? 4 : 1}
      onClick={onClick}
      sx={{
        p: 1.5,
        mb: 1,
        cursor: "grab",
        borderLeft: `3px solid ${
          PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS] || theme.palette.grey[400]
        }`,
        "&:hover": { elevation: 3, bgcolor: "action.hover" },
        userSelect: "none",
        opacity: isDone ? 0.7 : 1,
      }}
    >
      <Box display="flex" alignItems="flex-start" gap={0.5}>
        {onMarkDone && !isDragOverlay && (
          <Tooltip title={isDone ? t("statusDone") : t("markDone")}>
            <IconButton
              size="small"
              sx={{ mt: -0.25, ml: -0.5, p: 0.25 }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isDone) onMarkDone(task.id);
              }}
            >
              <MaterialSymbol
                icon={isDone ? "check_circle" : "circle"}
                size={18}
                style={{ color: isDone ? STATUS_CHIP_COLORS.success.text : theme.palette.action.disabled }}
              />
            </IconButton>
          </Tooltip>
        )}
        <Typography
          variant="body2"
          fontWeight={600}
          noWrap
          sx={{ textDecoration: isDone ? "line-through" : "none", flex: 1 }}
        >
          {task.title}
        </Typography>
      </Box>
      {wbsName && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            mt: 0.5,
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            fontSize: "0.65rem",
          }}
        >
          <MaterialSymbol icon="account_tree" size={12} style={{ color: theme.palette.text.disabled }} />
          {wbsName}
        </Typography>
      )}
      <Box display="flex" justifyContent="space-between" alignItems="center" mt={1}>
        <Box display="flex" alignItems="center" gap={0.5}>
          {task.assignee_name ? (
            <Avatar
              sx={{ width: 24, height: 24, fontSize: "0.65rem", bgcolor: "primary.main" }}
            >
              {initials(task.assignee_name)}
            </Avatar>
          ) : (
            <Box />
          )}
          {task.comment_count > 0 && (
            <Box display="flex" alignItems="center" gap={0.25} ml={0.5}>
              <MaterialSymbol icon="comment" size={14} style={{ color: theme.palette.text.disabled }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                {task.comment_count}
              </Typography>
            </Box>
          )}
        </Box>
        {task.due_date && (
          <Typography
            variant="caption"
            color={isOverdue ? "error" : "text.secondary"}
            fontWeight={isOverdue ? 600 : 400}
          >
            {formatDate(task.due_date)}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
