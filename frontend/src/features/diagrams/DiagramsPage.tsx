import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import Menu from "@mui/material/Menu";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { FactSheet } from "@/types";

interface DiagramSummary {
  id: string;
  name: string;
  description?: string;
  type: string;
  initiative_id?: string | null;
  thumbnail?: string;
  fact_sheet_count?: number;
  created_at?: string;
  updated_at?: string;
}

type ViewMode = "card" | "list";

export default function DiagramsPage() {
  const navigate = useNavigate();
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("diagrams_view") as ViewMode) || "card"
  );

  // Initiatives for linking
  const [initiatives, setInitiatives] = useState<FactSheet[]>([]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createType, setCreateType] = useState("free_draw");
  const [createInitiativeId, setCreateInitiativeId] = useState("");

  // Edit dialog (rename + description + initiative)
  const [editOpen, setEditOpen] = useState(false);
  const [editDiagram, setEditDiagram] = useState<DiagramSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editInitiativeId, setEditInitiativeId] = useState("");

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteDiagram, setDeleteDiagram] = useState<DiagramSummary | null>(null);

  // Context menu
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuDiagram, setMenuDiagram] = useState<DiagramSummary | null>(null);

  const loadDiagrams = useCallback(() => {
    api.get<DiagramSummary[]>("/diagrams").then(setDiagrams);
  }, []);

  useEffect(() => {
    loadDiagrams();
    api
      .get<{ items: FactSheet[] }>("/fact-sheets?type=Initiative&page_size=500")
      .then((res) => setInitiatives(res.items))
      .catch(() => {});
  }, [loadDiagrams]);

  const handleViewChange = (_: unknown, mode: ViewMode | null) => {
    if (mode) {
      setViewMode(mode);
      localStorage.setItem("diagrams_view", mode);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    const d = await api.post<{ id: string }>("/diagrams", {
      name: createName,
      description: createDesc.trim() || undefined,
      type: createType,
      initiative_id: createInitiativeId || null,
    });
    setCreateOpen(false);
    setCreateName("");
    setCreateDesc("");
    setCreateType("free_draw");
    setCreateInitiativeId("");
    navigate(`/diagrams/${d.id}`);
  };

  const openEdit = (d: DiagramSummary) => {
    setEditDiagram(d);
    setEditName(d.name);
    setEditDesc(d.description || "");
    setEditInitiativeId(d.initiative_id || "");
    setEditOpen(true);
    setMenuAnchor(null);
  };

  const handleEdit = async () => {
    if (!editDiagram || !editName.trim()) return;
    await api.patch(`/diagrams/${editDiagram.id}`, {
      name: editName.trim(),
      description: editDesc.trim() || null,
      initiative_id: editInitiativeId || null,
    });
    setEditOpen(false);
    setEditDiagram(null);
    loadDiagrams();
  };

  const openDelete = (d: DiagramSummary) => {
    setDeleteDiagram(d);
    setDeleteOpen(true);
    setMenuAnchor(null);
  };

  const handleDelete = async () => {
    if (!deleteDiagram) return;
    await api.delete(`/diagrams/${deleteDiagram.id}`);
    setDeleteOpen(false);
    setDeleteDiagram(null);
    loadDiagrams();
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, d: DiagramSummary) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuDiagram(d);
  };

  const typeLabel = (t: string) => (t === "data_flow" ? "Data Flow" : "Free Draw");
  const typeIcon = (t: string) => (t === "data_flow" ? "device_hub" : "draw");
  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString() : "";

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Diagrams
        </Typography>
        <Chip label={`${diagrams.length}`} size="small" />
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={handleViewChange}
          size="small"
        >
          <ToggleButton value="card">
            <MaterialSymbol icon="grid_view" size={18} />
          </ToggleButton>
          <ToggleButton value="list">
            <MaterialSymbol icon="view_list" size={18} />
          </ToggleButton>
        </ToggleButtonGroup>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => setCreateOpen(true)}
          sx={{ textTransform: "none" }}
        >
          New Diagram
        </Button>
      </Box>

      {/* Card View */}
      {viewMode === "card" && (
        <Grid container spacing={2}>
          {diagrams.map((d) => (
            <Grid item xs={12} sm={6} md={4} key={d.id}>
              <Card sx={{ position: "relative" }}>
                <CardActionArea onClick={() => navigate(`/diagrams/${d.id}`)}>
                  {/* Thumbnail */}
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

                  <CardContent sx={{ pb: "12px !important" }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 0.5,
                      }}
                    >
                      <MaterialSymbol
                        icon={typeIcon(d.type)}
                        size={24}
                        color="#1976d2"
                      />
                      <Typography
                        variant="subtitle1"
                        fontWeight={600}
                        noWrap
                        sx={{ flex: 1 }}
                      >
                        {d.name}
                      </Typography>
                    </Box>
                    {d.description && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mb: 0.75,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          fontSize: 13,
                        }}
                      >
                        {d.description}
                      </Typography>
                    )}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        flexWrap: "wrap",
                      }}
                    >
                      <Chip size="small" label={typeLabel(d.type)} />
                      {!!d.fact_sheet_count && (
                        <Chip
                          size="small"
                          label={`${d.fact_sheet_count} fact sheet${d.fact_sheet_count > 1 ? "s" : ""}`}
                          variant="outlined"
                        />
                      )}
                      {d.updated_at && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: "auto" }}
                        >
                          {fmtDate(d.updated_at)}
                        </Typography>
                      )}
                    </Box>
                  </CardContent>
                </CardActionArea>

                {/* More menu button */}
                <IconButton
                  size="small"
                  sx={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    bgcolor: "rgba(255,255,255,0.85)",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.95)" },
                  }}
                  onClick={(e) => openMenu(e, d)}
                >
                  <MaterialSymbol icon="more_vert" size={18} />
                </IconButton>
              </Card>
            </Grid>
          ))}
          {diagrams.length === 0 && (
            <Grid item xs={12}>
              <Typography
                color="text.secondary"
                sx={{ textAlign: "center", py: 4 }}
              >
                No diagrams yet. Create one to get started.
              </Typography>
            </Grid>
          )}
        </Grid>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 120 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 100 }} align="center">
                  Fact Sheets
                </TableCell>
                <TableCell sx={{ fontWeight: 600, width: 120 }}>Updated</TableCell>
                <TableCell sx={{ width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {diagrams.map((d) => (
                <TableRow
                  key={d.id}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => navigate(`/diagrams/${d.id}`)}
                >
                  <TableCell>
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 1 }}
                    >
                      <MaterialSymbol
                        icon={typeIcon(d.type)}
                        size={20}
                        color="#1976d2"
                      />
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {d.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      noWrap
                      sx={{ maxWidth: 300 }}
                      title={d.description}
                    >
                      {d.description || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={typeLabel(d.type)} />
                  </TableCell>
                  <TableCell align="center">
                    {d.fact_sheet_count || 0}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {fmtDate(d.updated_at)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={(e) => openMenu(e, d)}
                    >
                      <MaterialSymbol icon="more_vert" size={18} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {diagrams.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      No diagrams yet. Create one to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Context menu */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            if (menuDiagram) navigate(`/diagrams/${menuDiagram.id}`);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="open_in_new" size={18} />
          </ListItemIcon>
          <ListItemText>Open</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuDiagram) openEdit(menuDiagram);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="edit" size={18} />
          </ListItemIcon>
          <ListItemText>Rename / Edit</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuDiagram) openDelete(menuDiagram);
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="delete" size={18} color="#d32f2f" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>New Diagram</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && createName.trim()) handleCreate();
            }}
          />
          <TextField
            fullWidth
            label="Description"
            value={createDesc}
            onChange={(e) => setCreateDesc(e.target.value)}
            multiline
            rows={2}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={createType}
              label="Type"
              onChange={(e) => setCreateType(e.target.value)}
            >
              <MenuItem value="free_draw">Free Draw</MenuItem>
              <MenuItem value="data_flow">Data Flow</MenuItem>
            </Select>
          </FormControl>
          <TextField
            select
            fullWidth
            label="Initiative"
            value={createInitiativeId}
            onChange={(e) => setCreateInitiativeId(e.target.value)}
            helperText="Link this diagram to an initiative (optional)"
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {initiatives.map((init) => (
              <MenuItem key={init.id} value={init.id}>
                {init.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!createName.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Edit Diagram</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && editName.trim()) handleEdit();
            }}
          />
          <TextField
            fullWidth
            label="Description"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            multiline
            rows={3}
            sx={{ mb: 2 }}
          />
          <TextField
            select
            fullWidth
            label="Initiative"
            value={editInitiativeId}
            onChange={(e) => setEditInitiativeId(e.target.value)}
            helperText="Link this diagram to an initiative (optional)"
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {initiatives.map((init) => (
              <MenuItem key={init.id} value={init.id}>
                {init.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEdit}
            disabled={!editName.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Diagram</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete{" "}
            <strong>{deleteDiagram?.name}</strong>? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
