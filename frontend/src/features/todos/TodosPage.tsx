import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Todo } from "@/types";

export default function TodosPage() {
  const navigate = useNavigate();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    const params = tab === 0 ? "?status=open" : tab === 1 ? "?status=done" : "";
    api.get<Todo[]>(`/todos${params}`).then(setTodos);
  }, [tab]);

  const toggleStatus = async (todo: Todo) => {
    const newStatus = todo.status === "open" ? "done" : "open";
    await api.patch(`/todos/${todo.id}`, { status: newStatus });
    setTodos(todos.map((t) => (t.id === todo.id ? { ...t, status: newStatus } : t)));
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Todos</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Open" />
        <Tab label="Done" />
        <Tab label="All" />
      </Tabs>

      <List>
        {todos.map((t) => (
          <Card key={t.id} sx={{ mb: 1 }}>
            <ListItem>
              <IconButton size="small" onClick={() => toggleStatus(t)} sx={{ mr: 1 }}>
                <MaterialSymbol
                  icon={t.status === "done" ? "check_circle" : "radio_button_unchecked"}
                  size={22}
                  color={t.status === "done" ? "#4caf50" : "#999"}
                />
              </IconButton>
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    sx={{ textDecoration: t.status === "done" ? "line-through" : "none" }}
                  >
                    {t.description}
                  </Typography>
                }
                secondary={
                  <Box sx={{ display: "flex", gap: 1, mt: 0.5, alignItems: "center" }}>
                    {t.fact_sheet_name && (
                      <Chip
                        size="small"
                        label={t.fact_sheet_name}
                        onClick={() => navigate(`/fact-sheets/${t.fact_sheet_id}`)}
                        sx={{ cursor: "pointer" }}
                      />
                    )}
                    {t.assignee_name && (
                      <Typography variant="caption">Assigned to: {t.assignee_name}</Typography>
                    )}
                    {t.due_date && (
                      <Typography variant="caption">Due: {t.due_date}</Typography>
                    )}
                  </Box>
                }
              />
            </ListItem>
          </Card>
        ))}
        {todos.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            No todos found.
          </Typography>
        )}
      </List>
    </Box>
  );
}
