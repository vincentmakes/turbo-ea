import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Menu from "@mui/material/Menu";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { FactSheet, SoAW } from "@/types";

// ─── helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, "default" | "warning" | "success"> = {
  draft: "default",
  in_review: "warning",
  approved: "success",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
};

interface InitiativeGroup {
  initiative: FactSheet;
  soaws: SoAW[];
}

// ─── component ──────────────────────────────────────────────────────────────

export default function EADeliveryPage() {
  const navigate = useNavigate();

  const [initiatives, setInitiatives] = useState<FactSheet[]>([]);
  const [soaws, setSoaws] = useState<SoAW[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInitiativeId, setNewInitiativeId] = useState("");
  const [creating, setCreating] = useState(false);

  // context menu for SoAW card
  const [ctxMenu, setCtxMenu] = useState<{
    anchor: HTMLElement;
    soaw: SoAW;
  } | null>(null);

  // ── data fetching ───────────────────────────────────────────────────────

  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [initRes, soawRes] = await Promise.all([
        api.get<{ items: FactSheet[] }>("/fact-sheets?type=Initiative&page_size=500"),
        api.get<SoAW[]>("/soaw"),
      ]);
      setInitiatives(initRes.items);
      setSoaws(soawRes);
      // Auto-expand first initiative
      if (initRes.items.length > 0 && Object.keys(expanded).length === 0) {
        setExpanded({ [initRes.items[0].id]: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── group artefacts by initiative ───────────────────────────────────────

  const groups: InitiativeGroup[] = useMemo(() => {
    return initiatives.map((init) => ({
      initiative: init,
      soaws: soaws.filter((s) => s.initiative_id === init.id),
    }));
  }, [initiatives, soaws]);

  const unlinkedSoaws = useMemo(
    () => soaws.filter((s) => !s.initiative_id),
    [soaws],
  );

  // ── create SoAW ────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post<SoAW>("/soaw", {
        name: newName.trim(),
        initiative_id: newInitiativeId || null,
      });
      setCreateOpen(false);
      setNewName("");
      setNewInitiativeId("");
      navigate(`/ea-delivery/soaw/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateForInitiative = (initiativeId: string) => {
    setNewInitiativeId(initiativeId);
    setCreateOpen(true);
  };

  // ── delete SoAW ────────────────────────────────────────────────────────

  const handleDeleteSoaw = async (id: string) => {
    if (!confirm("Delete this Statement of Architecture Work?")) return;
    try {
      await api.delete(`/soaw/${id}`);
      setSoaws((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
    setCtxMenu(null);
  };

  // ── toggle expansion ───────────────────────────────────────────────────

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // ── render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
        <MaterialSymbol icon="architecture" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ ml: 1, fontWeight: 700 }}>
          EA Delivery
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => {
            setNewInitiativeId("");
            setCreateOpen(true);
          }}
        >
          New Statement of Architecture Work
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {initiatives.length === 0 && soaws.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No initiatives found. Create initiatives in the Inventory first, then
          come back here to manage artefacts.
        </Alert>
      )}

      {/* Initiative groups */}
      {groups.map(({ initiative, soaws: initSoaws }) => {
        const isOpen = expanded[initiative.id] ?? false;
        const artefactCount = initSoaws.length;

        return (
          <Card
            key={initiative.id}
            sx={{
              mb: 2,
              borderLeft: "4px solid #33cc58",
            }}
          >
            {/* Initiative header */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                px: 2,
                py: 1.5,
                cursor: "pointer",
                "&:hover": { bgcolor: "grey.50" },
              }}
              onClick={() => toggle(initiative.id)}
            >
              <IconButton size="small" sx={{ mr: 1 }}>
                <MaterialSymbol
                  icon={isOpen ? "expand_more" : "chevron_right"}
                  size={20}
                />
              </IconButton>
              <MaterialSymbol icon="rocket_launch" size={22} color="#33cc58" />
              <Typography sx={{ ml: 1, fontWeight: 600, flex: 1 }}>
                {initiative.name}
              </Typography>
              {initiative.subtype && (
                <Chip
                  label={initiative.subtype}
                  size="small"
                  sx={{ mr: 1, textTransform: "capitalize" }}
                />
              )}
              <Chip
                label={`${artefactCount} artefact${artefactCount !== 1 ? "s" : ""}`}
                size="small"
                variant="outlined"
                sx={{ mr: 1 }}
              />
              <Tooltip title="Create artefact for this initiative">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateForInitiative(initiative.id);
                  }}
                >
                  <MaterialSymbol icon="add_circle_outline" size={20} />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Artefact list */}
            <Collapse in={isOpen}>
              <Box sx={{ px: 2, pb: 2 }}>
                {artefactCount === 0 && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ py: 2, textAlign: "center" }}
                  >
                    No artefacts yet.{" "}
                    <Box
                      component="span"
                      sx={{
                        color: "primary.main",
                        cursor: "pointer",
                        "&:hover": { textDecoration: "underline" },
                      }}
                      onClick={() =>
                        handleCreateForInitiative(initiative.id)
                      }
                    >
                      Create a Statement of Architecture Work
                    </Box>
                  </Typography>
                )}

                {/* SoAW cards */}
                {initSoaws.map((s) => (
                  <Card
                    key={s.id}
                    variant="outlined"
                    sx={{ mb: 1 }}
                  >
                    <CardActionArea
                      onClick={() => navigate(`/ea-delivery/soaw/${s.id}`)}
                      sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
                    >
                      <MaterialSymbol
                        icon="description"
                        size={20}
                        color="#e65100"
                      />
                      <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
                        {s.name}
                      </Typography>
                      <Chip
                        label={STATUS_LABELS[s.status] ?? s.status}
                        size="small"
                        color={STATUS_COLORS[s.status] ?? "default"}
                        sx={{ mr: 1 }}
                      />
                      <Chip label="SoAW" size="small" variant="outlined" />
                      <IconButton
                        size="small"
                        sx={{ ml: 0.5 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setCtxMenu({ anchor: e.currentTarget, soaw: s });
                        }}
                      >
                        <MaterialSymbol icon="more_vert" size={18} />
                      </IconButton>
                    </CardActionArea>
                  </Card>
                ))}
              </Box>
            </Collapse>
          </Card>
        );
      })}

      {/* Unlinked SoAWs */}
      {unlinkedSoaws.length > 0 && (
        <Card sx={{ mb: 2, borderLeft: "4px solid #999" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 2,
              py: 1.5,
              cursor: "pointer",
              "&:hover": { bgcolor: "grey.50" },
            }}
            onClick={() => toggle("__unlinked__")}
          >
            <IconButton size="small" sx={{ mr: 1 }}>
              <MaterialSymbol
                icon={
                  expanded["__unlinked__"]
                    ? "expand_more"
                    : "chevron_right"
                }
                size={20}
              />
            </IconButton>
            <MaterialSymbol icon="folder_open" size={22} color="#999" />
            <Typography
              sx={{ ml: 1, fontWeight: 600, flex: 1, color: "text.secondary" }}
            >
              Not linked to an Initiative
            </Typography>
            <Chip
              label={`${unlinkedSoaws.length} artefact${unlinkedSoaws.length !== 1 ? "s" : ""}`}
              size="small"
              variant="outlined"
            />
          </Box>
          <Collapse in={expanded["__unlinked__"] ?? false}>
            <Box sx={{ px: 2, pb: 2 }}>
              {unlinkedSoaws.map((s) => (
                <Card key={s.id} variant="outlined" sx={{ mb: 1 }}>
                  <CardActionArea
                    onClick={() => navigate(`/ea-delivery/soaw/${s.id}`)}
                    sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
                  >
                    <MaterialSymbol
                      icon="description"
                      size={20}
                      color="#e65100"
                    />
                    <Typography
                      sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}
                    >
                      {s.name}
                    </Typography>
                    <Chip
                      label={STATUS_LABELS[s.status] ?? s.status}
                      size="small"
                      color={STATUS_COLORS[s.status] ?? "default"}
                      sx={{ mr: 1 }}
                    />
                    <Chip label="SoAW" size="small" variant="outlined" />
                    <IconButton
                      size="small"
                      sx={{ ml: 0.5 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setCtxMenu({ anchor: e.currentTarget, soaw: s });
                      }}
                    >
                      <MaterialSymbol icon="more_vert" size={18} />
                    </IconButton>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </Collapse>
        </Card>
      )}

      {/* Context menu for SoAW */}
      <Menu
        anchorEl={ctxMenu?.anchor}
        open={!!ctxMenu}
        onClose={() => setCtxMenu(null)}
      >
        <MenuItem
          onClick={() => {
            if (ctxMenu) navigate(`/ea-delivery/soaw/${ctxMenu.soaw.id}`);
            setCtxMenu(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="edit" size={18} />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => ctxMenu && handleDeleteSoaw(ctxMenu.soaw.id)}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="delete" size={18} color="#d32f2f" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>New Statement of Architecture Work</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Document name"
            fullWidth
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <TextField
            select
            label="Initiative"
            fullWidth
            value={newInitiativeId}
            onChange={(e) => setNewInitiativeId(e.target.value)}
            helperText="Link this document to an initiative (optional)"
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
            disabled={!newName.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
