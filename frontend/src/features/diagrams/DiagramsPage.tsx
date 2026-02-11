import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Grid from "@mui/material/Grid";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface DiagramSummary {
  id: string;
  name: string;
  type: string;
  thumbnail?: string;
  fact_sheet_count?: number;
  created_at?: string;
  updated_at?: string;
}

export default function DiagramsPage() {
  const navigate = useNavigate();
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("free_draw");

  useEffect(() => {
    api.get<DiagramSummary[]>("/diagrams").then(setDiagrams);
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const d = await api.post<{ id: string }>("/diagrams", { name, type });
    setCreateOpen(false);
    setName("");
    navigate(`/diagrams/${d.id}`);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>Diagrams</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => setCreateOpen(true)}
        >
          New Diagram
        </Button>
      </Box>

      <Grid container spacing={2}>
        {diagrams.map((d) => (
          <Grid item xs={12} sm={6} md={4} key={d.id}>
            <Card>
              <CardActionArea onClick={() => navigate(`/diagrams/${d.id}`)}>
                {/* Thumbnail preview */}
                {d.thumbnail ? (
                  <Box
                    sx={{
                      height: 160,
                      overflow: "hidden",
                      bgcolor: "#fafafa",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <img
                      src={
                        d.thumbnail.startsWith("data:")
                          ? d.thumbnail
                          : `data:image/svg+xml;base64,${btoa(d.thumbnail)}`
                      }
                      alt={d.name}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        objectFit: "contain",
                      }}
                    />
                  </Box>
                ) : (
                  <Box
                    sx={{
                      height: 160,
                      bgcolor: "#fafafa",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <MaterialSymbol icon="draw" size={48} color="#ccc" />
                  </Box>
                )}

                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <MaterialSymbol icon={d.type === "data_flow" ? "device_hub" : "draw"} size={24} color="#1976d2" />
                    <Typography variant="subtitle1" fontWeight={600} noWrap>{d.name}</Typography>
                  </Box>
                  <Chip size="small" label={d.type === "data_flow" ? "Data Flow" : "Free Draw"} />
                  {!!d.fact_sheet_count && (
                    <Chip
                      size="small"
                      label={`${d.fact_sheet_count} fact sheet${d.fact_sheet_count > 1 ? "s" : ""}`}
                      variant="outlined"
                      sx={{ ml: 0.5 }}
                    />
                  )}
                  {d.updated_at && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      Updated: {new Date(d.updated_at).toLocaleDateString()}
                    </Typography>
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
        {diagrams.length === 0 && (
          <Grid item xs={12}>
            <Typography color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
              No diagrams yet. Create one to get started.
            </Typography>
          </Grid>
        )}
      </Grid>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New Diagram</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth label="Name" value={name} onChange={(e) => setName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select value={type} label="Type" onChange={(e) => setType(e.target.value)}>
              <MenuItem value="free_draw">Free Draw</MenuItem>
              <MenuItem value="data_flow">Data Flow</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!name.trim()}>Create</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
