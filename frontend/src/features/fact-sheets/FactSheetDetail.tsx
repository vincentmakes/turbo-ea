import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import QualitySealBadge from "@/components/QualitySealBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FactSheet, Relation, Comment as CommentType, Todo, EventEntry } from "@/types";

// --- Overview Tab ---
function OverviewTab({ fs, typeConfig, onUpdate }: {
  fs: FactSheet;
  typeConfig: ReturnType<ReturnType<typeof useMetamodel>["getType"]>;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(fs.name);
  const [description, setDescription] = useState(fs.description || "");
  const [attributes, setAttributes] = useState(fs.attributes || {});
  const [lifecycle, setLifecycle] = useState(fs.lifecycle || {});

  useEffect(() => {
    setName(fs.name);
    setDescription(fs.description || "");
    setAttributes(fs.attributes || {});
    setLifecycle(fs.lifecycle || {});
  }, [fs]);

  const handleSave = () => {
    onUpdate({ name, description, attributes, lifecycle });
    setEditing(false);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        {editing ? (
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleSave}>Save</Button>
          </Box>
        ) : (
          <Button
            startIcon={<MaterialSymbol icon="edit" size={18} />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </Box>

      {/* Basic Info */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Basic Information
          </Typography>
          {editing ? (
            <>
              <TextField fullWidth label="Name" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 2 }} />
              <TextField fullWidth label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline rows={3} />
            </>
          ) : (
            <>
              <Typography variant="body1" sx={{ mb: 1 }}>{fs.description || "No description"}</Typography>
            </>
          )}
        </CardContent>
      </Card>

      {/* Lifecycle */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Lifecycle
          </Typography>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {["plan", "phaseIn", "active", "phaseOut", "endOfLife"].map((phase) => (
              <TextField
                key={phase}
                label={phase === "phaseIn" ? "Phase In" : phase === "phaseOut" ? "Phase Out" : phase === "endOfLife" ? "End of Life" : phase.charAt(0).toUpperCase() + phase.slice(1)}
                type="date"
                size="small"
                value={(lifecycle as Record<string, string>)[phase] || ""}
                onChange={(e) => setLifecycle({ ...lifecycle, [phase]: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={!editing}
                sx={{ width: 160 }}
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* Type-specific fields */}
      {typeConfig && typeConfig.fields_schema.map((section) => (
        <Card key={section.section} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              {section.section}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {section.fields.map((field) => {
                const value = (attributes as Record<string, unknown>)[field.key];
                if (field.type === "single_select" && field.options) {
                  if (!editing) {
                    const opt = field.options.find((o) => o.key === value);
                    return (
                      <Box key={field.key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ width: 160 }}>
                          {field.label}:
                        </Typography>
                        {opt ? (
                          <Chip size="small" label={opt.label} sx={opt.color ? { bgcolor: opt.color, color: "#fff" } : {}} />
                        ) : (
                          <Typography variant="body2">—</Typography>
                        )}
                      </Box>
                    );
                  }
                  return (
                    <FormControl key={field.key} size="small" sx={{ maxWidth: 300 }}>
                      <InputLabel>{field.label}</InputLabel>
                      <Select
                        value={(value as string) || ""}
                        label={field.label}
                        onChange={(e) => setAttributes({ ...attributes, [field.key]: e.target.value })}
                      >
                        <MenuItem value=""><em>None</em></MenuItem>
                        {field.options.map((opt) => (
                          <MenuItem key={opt.key} value={opt.key}>{opt.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  );
                }
                if (field.type === "boolean") {
                  return (
                    <FormControlLabel
                      key={field.key}
                      control={
                        <Switch
                          checked={!!value}
                          onChange={(e) => setAttributes({ ...attributes, [field.key]: e.target.checked })}
                          disabled={!editing}
                        />
                      }
                      label={field.label}
                    />
                  );
                }
                if (field.type === "number") {
                  if (!editing) {
                    return (
                      <Box key={field.key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ width: 160 }}>{field.label}:</Typography>
                        <Typography variant="body2">{String(value ?? "—")}</Typography>
                      </Box>
                    );
                  }
                  return (
                    <TextField
                      key={field.key}
                      label={field.label}
                      type="number"
                      size="small"
                      value={value ?? ""}
                      onChange={(e) => setAttributes({ ...attributes, [field.key]: e.target.value ? Number(e.target.value) : undefined })}
                      sx={{ maxWidth: 300 }}
                    />
                  );
                }
                if (!editing) {
                  return (
                    <Box key={field.key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ width: 160 }}>{field.label}:</Typography>
                      <Typography variant="body2">{(value as string) || "—"}</Typography>
                    </Box>
                  );
                }
                return (
                  <TextField
                    key={field.key}
                    label={field.label}
                    size="small"
                    type={field.type === "date" ? "date" : "text"}
                    value={(value as string) || ""}
                    onChange={(e) => setAttributes({ ...attributes, [field.key]: e.target.value })}
                    InputLabelProps={field.type === "date" ? { shrink: true } : undefined}
                    sx={{ maxWidth: 400 }}
                  />
                );
              })}
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

// --- Relations Tab ---
function RelationsTab({ fsId }: { fsId: string }) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const { relationTypes } = useMetamodel();

  useEffect(() => {
    api.get<Relation[]>(`/relations?fact_sheet_id=${fsId}`).then(setRelations);
  }, [fsId]);

  const grouped = relations.reduce<Record<string, Relation[]>>((acc, r) => {
    const rt = relationTypes.find((rt) => rt.key === r.type);
    const label = rt?.label || r.type;
    (acc[label] = acc[label] || []).push(r);
    return acc;
  }, {});

  return (
    <Box>
      {Object.keys(grouped).length === 0 && (
        <Typography color="text.secondary">No relations yet.</Typography>
      )}
      {Object.entries(grouped).map(([label, rels]) => (
        <Card key={label} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>{label}</Typography>
            <List dense>
              {rels.map((r) => {
                const other = r.source_id === fsId ? r.target : r.source;
                return (
                  <ListItem key={r.id} component="a" href={`/fact-sheets/${other?.id}`}
                    sx={{ textDecoration: "none", color: "inherit", "&:hover": { bgcolor: "#f5f5f5" } }}>
                    <ListItemText
                      primary={other?.name || "Unknown"}
                      secondary={other?.type}
                    />
                  </ListItem>
                );
              })}
            </List>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

// --- Comments Tab ---
function CommentsTab({ fsId }: { fsId: string }) {
  const [comments, setComments] = useState<CommentType[]>([]);
  const [newComment, setNewComment] = useState("");

  useEffect(() => {
    api.get<CommentType[]>(`/fact-sheets/${fsId}/comments`).then(setComments);
  }, [fsId]);

  const handleAdd = async () => {
    if (!newComment.trim()) return;
    await api.post(`/fact-sheets/${fsId}/comments`, { content: newComment });
    setNewComment("");
    api.get<CommentType[]>(`/fact-sheets/${fsId}/comments`).then(setComments);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Write a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <Button variant="contained" onClick={handleAdd} disabled={!newComment.trim()}>
          Post
        </Button>
      </Box>
      {comments.map((c) => (
        <Card key={c.id} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography variant="subtitle2">{c.user_display_name || "User"}</Typography>
              <Typography variant="caption" color="text.secondary">
                {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
              </Typography>
            </Box>
            <Typography variant="body2">{c.content}</Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

// --- Todos Tab ---
function TodosTab({ fsId }: { fsId: string }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    api.get<Todo[]>(`/fact-sheets/${fsId}/todos`).then(setTodos);
  }, [fsId]);

  const handleAdd = async () => {
    if (!newDesc.trim()) return;
    await api.post(`/fact-sheets/${fsId}/todos`, { description: newDesc });
    setNewDesc("");
    api.get<Todo[]>(`/fact-sheets/${fsId}/todos`).then(setTodos);
  };

  const toggleStatus = async (todo: Todo) => {
    const newStatus = todo.status === "open" ? "done" : "open";
    await api.patch(`/todos/${todo.id}`, { status: newStatus });
    setTodos(todos.map((t) => (t.id === todo.id ? { ...t, status: newStatus } : t)));
  };

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <TextField
          fullWidth size="small" placeholder="Add a to-do..."
          value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <Button variant="contained" onClick={handleAdd} disabled={!newDesc.trim()}>Add</Button>
      </Box>
      <List dense>
        {todos.map((t) => (
          <ListItem key={t.id}>
            <IconButton size="small" onClick={() => toggleStatus(t)} sx={{ mr: 1 }}>
              <MaterialSymbol icon={t.status === "done" ? "check_circle" : "radio_button_unchecked"} size={20}
                color={t.status === "done" ? "#4caf50" : "#999"} />
            </IconButton>
            <ListItemText
              primary={t.description}
              sx={{ textDecoration: t.status === "done" ? "line-through" : "none" }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

// --- Subscriptions Tab ---
function SubscriptionsTab({ fs }: { fs: FactSheet }) {
  const subs = fs.subscriptions || [];
  const grouped = { responsible: subs.filter((s) => s.role === "responsible"), accountable: subs.filter((s) => s.role === "accountable"), observer: subs.filter((s) => s.role === "observer") };

  return (
    <Box>
      {(["responsible", "accountable", "observer"] as const).map((role) => (
        <Card key={role} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" textTransform="capitalize" gutterBottom>{role}</Typography>
            {grouped[role].length === 0 ? (
              <Typography variant="body2" color="text.secondary">No {role} assigned</Typography>
            ) : (
              <List dense>
                {grouped[role].map((s) => (
                  <ListItem key={s.id}>
                    <MaterialSymbol icon="person" size={20} />
                    <ListItemText primary={s.user_display_name || s.user_email} sx={{ ml: 1 }} />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

// --- History Tab ---
function HistoryTab({ fsId }: { fsId: string }) {
  const [events, setEvents] = useState<EventEntry[]>([]);
  useEffect(() => {
    api.get<EventEntry[]>(`/fact-sheets/${fsId}/history`).then(setEvents);
  }, [fsId]);

  return (
    <Box>
      {events.length === 0 && <Typography color="text.secondary">No history yet.</Typography>}
      {events.map((e) => (
        <Card key={e.id} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip size="small" label={e.event_type} />
              <Typography variant="body2">{e.user_display_name || "System"}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

// --- Main Detail Page ---
export default function FactSheetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const [fs, setFs] = useState<FactSheet | null>(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api.get<FactSheet>(`/fact-sheets/${id}`).then(setFs).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!fs) return <Typography>Loading...</Typography>;

  const typeConfig = getType(fs.type);

  const handleUpdate = async (updates: Record<string, unknown>) => {
    const updated = await api.patch<FactSheet>(`/fact-sheets/${fs.id}`, updates);
    setFs(updated);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <IconButton onClick={() => navigate("/inventory")}>
          <MaterialSymbol icon="arrow_back" size={24} />
        </IconButton>
        {typeConfig && (
          <MaterialSymbol icon={typeConfig.icon} size={28} color={typeConfig.color} />
        )}
        <Box>
          <Typography variant="h5" fontWeight={600}>{fs.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {typeConfig?.label || fs.type}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <LifecycleBadge lifecycle={fs.lifecycle} />
        <QualitySealBadge seal={fs.quality_seal} />
        {fs.quality_seal !== "APPROVED" && (
          <Button
            size="small"
            variant="outlined"
            color="success"
            onClick={async () => {
              await api.post(`/fact-sheets/${fs.id}/quality-seal?action=approve`);
              setFs({ ...fs, quality_seal: "APPROVED" });
            }}
          >
            Approve Seal
          </Button>
        )}
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Overview" />
        <Tab label="Relations" />
        <Tab label="Subscriptions" />
        <Tab label="Comments" />
        <Tab label="Todos" />
        <Tab label="History" />
      </Tabs>

      {tab === 0 && <OverviewTab fs={fs} typeConfig={typeConfig} onUpdate={handleUpdate} />}
      {tab === 1 && <RelationsTab fsId={fs.id} />}
      {tab === 2 && <SubscriptionsTab fs={fs} />}
      {tab === 3 && <CommentsTab fsId={fs.id} />}
      {tab === 4 && <TodosTab fsId={fs.id} />}
      {tab === 5 && <HistoryTab fsId={fs.id} />}
    </Box>
  );
}
