import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { PpmTask } from "@/types";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#d32f2f",
  high: "#f57c00",
  medium: "#fbc02d",
  low: "#66bb6a",
};

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
  onClick: () => void;
  isDragOverlay?: boolean;
}

export default function PpmTaskCard({ task, onClick, isDragOverlay }: Props) {
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

  const isOverdue =
    task.due_date && new Date(task.due_date) < new Date() && task.status !== "done";

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
        borderLeft: `3px solid ${PRIORITY_COLORS[task.priority] || "#bdbdbd"}`,
        "&:hover": { elevation: 3, bgcolor: "action.hover" },
        userSelect: "none",
      }}
    >
      <Typography variant="body2" fontWeight={600} noWrap>
        {task.title}
      </Typography>
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
              <MaterialSymbol icon="comment" size={14} style={{ color: "#9e9e9e" }} />
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
            {new Date(task.due_date).toLocaleDateString()}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
