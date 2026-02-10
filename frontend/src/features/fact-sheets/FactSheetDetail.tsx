import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import {
  FactSheet,
  FACT_SHEET_TYPE_LABELS,
  FACT_SHEET_TYPE_ICONS,
} from "../../types/fact-sheet";

export default function FactSheetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [fs, setFs] = useState<FactSheet | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (id) loadFactSheet();
  }, [id]);

  async function loadFactSheet() {
    try {
      const data = await api.get<FactSheet>(`/fact-sheets/${id}`);
      setFs(data);
      setEditName(data.name);
      setEditDescription(data.description || "");
    } catch {
      navigate("/fact-sheets");
    }
  }

  async function handleSave() {
    if (!id) return;
    try {
      const updated = await api.patch<FactSheet>(`/fact-sheets/${id}`, {
        name: editName,
        description: editDescription || null,
      });
      setFs(updated);
      setEditing(false);
    } catch {
      // handle error
    }
  }

  async function handleArchive() {
    if (!id) return;
    try {
      await api.patch(`/fact-sheets/${id}`, { status: "archived" });
      navigate("/fact-sheets");
    } catch {
      // handle error
    }
  }

  if (!fs) return null;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Button
          startIcon={<MaterialSymbol icon="arrow_back" size={20} />}
          onClick={() => navigate(-1)}
        >
          Back
        </Button>
        <MaterialSymbol icon={FACT_SHEET_TYPE_ICONS[fs.type]} size={32} />
        <Box sx={{ flexGrow: 1 }}>
          {editing ? (
            <TextField
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              variant="standard"
              sx={{ fontSize: "1.5rem" }}
              fullWidth
            />
          ) : (
            <Typography variant="h4">{fs.name}</Typography>
          )}
          <Chip
            label={FACT_SHEET_TYPE_LABELS[fs.type]}
            size="small"
            sx={{ mt: 0.5 }}
          />
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          {editing ? (
            <>
              <Button variant="contained" onClick={handleSave}>
                Save
              </Button>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button
                variant="outlined"
                startIcon={<MaterialSymbol icon="edit" size={18} />}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<MaterialSymbol icon="archive" size={18} />}
                onClick={handleArchive}
              >
                Archive
              </Button>
            </>
          )}
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Overview" />
        <Tab label="Relations" />
        <Tab label="History" />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Description
                </Typography>
                {editing ? (
                  <TextField
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    multiline
                    rows={4}
                    fullWidth
                  />
                ) : (
                  <Typography color={fs.description ? "text.primary" : "text.secondary"}>
                    {fs.description || "No description provided."}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Details
                </Typography>
                <DetailRow label="Status" value={fs.status} />
                <DetailRow label="Completion" value={`${Math.round(fs.completion)}%`} />
                <DetailRow label="Quality Seal" value={fs.quality_seal || "N/A"} />
                <DetailRow label="External ID" value={fs.external_id || "None"} />
                <DetailRow label="Created" value={new Date(fs.created_at).toLocaleDateString()} />
                <DetailRow label="Updated" value={new Date(fs.updated_at).toLocaleDateString()} />
              </CardContent>
            </Card>

            {fs.lifecycle && Object.keys(fs.lifecycle).length > 0 && (
              <Card sx={{ mt: 2 }}>
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Lifecycle
                  </Typography>
                  {Object.entries(fs.lifecycle).map(([phase, date]) => (
                    <DetailRow key={phase} label={phase.replace("_", " ")} value={date} />
                  ))}
                </CardContent>
              </Card>
            )}
          </Grid>
        </Grid>
      )}

      {tab === 1 && (
        <Card>
          <CardContent>
            <Typography color="text.secondary">
              Relations will be displayed here in Phase 2.
            </Typography>
          </CardContent>
        </Card>
      )}

      {tab === 2 && (
        <Card>
          <CardContent>
            <Typography color="text.secondary">
              Event history will be displayed here.
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
        {value}
      </Typography>
    </Box>
  );
}
