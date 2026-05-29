import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import MaterialSymbol from "@/components/MaterialSymbol";
import SectionPaper, { EmptyState, ViewAllLink } from "./SectionPaper";

interface TodoRow {
  id: string;
  card_id: string | null;
  card_name: string | null;
  description: string;
  status: string;
  due_date: string | null;
  recurrence_unit?: string;
}

const MAX_VISIBLE = 6;

function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function MyTodosSection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { formatDate } = useDateFormat();
  const [loading, setLoading] = useState(true);
  const [todos, setTodos] = useState<TodoRow[]>([]);

  useEffect(() => {
    api
      .get<TodoRow[]>("/todos?status=open&assigned_only=true")
      .then((rows) => setTodos(rows.slice(0, MAX_VISIBLE)))
      .finally(() => setLoading(false));
  }, []);

  const today = todayIsoDate();

  return (
    <SectionPaper
      icon="task_alt"
      iconColor="#43a047"
      title={t("dashboard.workspace.myTodos")}
      action={<ViewAllLink to="/todos" label={t("dashboard.workspace.viewAll")} />}
    >
      {loading ? (
        <LinearProgress />
      ) : todos.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.todos")} />
      ) : (
        <Box>
          {todos.map((todo) => {
            const overdue =
              todo.status === "open" &&
              !!todo.due_date &&
              todo.due_date.slice(0, 10) < today;
            return (
              <Box
                key={todo.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  cursor: todo.card_id ? "pointer" : "default",
                  "&:hover": todo.card_id ? { bgcolor: "action.hover" } : {},
                }}
                onClick={() => todo.card_id && navigate(`/cards/${todo.card_id}`)}
              >
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {todo.description}
                </Typography>
                {todo.recurrence_unit && todo.recurrence_unit !== "none" && (
                  <MaterialSymbol
                    icon="repeat"
                    size={16}
                    color="#888"
                    style={{ flexShrink: 0 }}
                  />
                )}
                {overdue && (
                  <Chip
                    size="small"
                    label={t("todos.overdue")}
                    color="error"
                    sx={{ height: 20, fontSize: "0.7rem", fontWeight: 600, flexShrink: 0 }}
                  />
                )}
                {todo.due_date && (
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {formatDate(todo.due_date)}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}
