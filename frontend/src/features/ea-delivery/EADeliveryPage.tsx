import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
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
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { FactSheet, SoAW, DiagramSummary } from "@/types";

// ─── helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, "default" | "warning" | "success" | "info"> = {
  draft: "default",
  in_review: "warning",
  approved: "success",
  signed: "info",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  signed: "Signed",
};

interface InitiativeGroup {
  initiative: FactSheet;
  diagrams: DiagramSummary[];
  soaws: SoAW[];
}

// ─── component ──────────────────────────────────────────────────────────────

export default function EADeliveryPage() {
  const navigate = useNavigate();

  const [initiatives, setInitiatives] = useState<FactSheet[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [soaws, setSoaws] = useState<SoAW[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // create SoAW dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInitiativeId, setNewInitiativeId] = useState("");
  const [creating, setCreating] = useState(false);

  // link diagram dialog
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitiativeId, setLinkInitiativeId] = useState("");
  const [linkSelected, setLinkSelected] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);

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
      const [initRes, diagRes, soawRes] = await Promise.all([
        api.get<{ items: FactSheet[] }>("/fact-sheets?type=Initiative&page_size=500"),
        api.get<DiagramSummary[]>("/diagrams"),
        api.get<SoAW[]>("/soaw"),
      ]);
      setInitiatives(initRes.items);
      setDiagrams(diagRes);
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
      diagrams: diagrams.filter((d) => d.initiative_ids.includes(init.id)),
      soaws: soaws.filter((s) => s.initiative_id === init.id),
    }));
  }, [initiatives, diagrams, soaws]);

  const unlinkedSoaws = useMemo(
    () => soaws.filter((s) => !s.initiative_id),
    [soaws],
  );

  const unlinkedDiagrams = useMemo(
    () => diagrams.filter((d) => d.initiative_ids.length === 0),
    [diagrams],
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

  // ── link diagram dialog ────────────────────────────────────────────────

  const openLinkDialog = (initiativeId: string) => {
    setLinkInitiativeId(initiativeId);
    // Pre-select diagrams already linked to this initiative
    const alreadyLinked = diagrams
      .filter((d) => d.initiative_ids.includes(initiativeId))
      .map((d) => d.id);
    setLinkSelected(alreadyLinked);
    setLinkOpen(true);
  };

  const toggleLinkDiagram = (diagramId: string) => {
    setLinkSelected((prev) =>
      prev.includes(diagramId)
        ? prev.filter((id) => id !== diagramId)
        : [...prev, diagramId],
    );
  };

  const handleLinkDiagrams = async () => {
    if (!linkInitiativeId) return;
    setLinking(true);
    try {
      // For each diagram, update its initiative_ids:
      // - If newly selected: add this initiative to its existing initiative_ids
      // - If deselected: remove this initiative from its initiative_ids
      const promises = diagrams.map((d) => {
        const wasLinked = d.initiative_ids.includes(linkInitiativeId);
        const isNowLinked = linkSelected.includes(d.id);

        if (wasLinked === isNowLinked) return null; // no change

        const newIds = isNowLinked
          ? [...d.initiative_ids, linkInitiativeId]
          : d.initiative_ids.filter((id) => id !== linkInitiativeId);

        return api.patch(`/diagrams/${d.id}`, { initiative_ids: newIds });
      });

      await Promise.all(promises.filter(Boolean));
      setLinkOpen(false);
      await fetchAll(); // refresh
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link diagrams");
    } finally {
      setLinking(false);
    }
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

  // ── unlink a single diagram from an initiative ─────────────────────────

  const handleUnlinkDiagram = async (diagram: DiagramSummary, initiativeId: string) => {
    try {
      const newIds = diagram.initiative_ids.filter((id) => id !== initiativeId);
      await api.patch(`/diagrams/${diagram.id}`, { initiative_ids: newIds });
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlink diagram");
    }
  };

  // ── toggle expansion ───────────────────────────────────────────────────

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // ── shared card renderers ──────────────────────────────────────────────

  const renderDiagramCard = (d: DiagramSummary, initiativeId?: string) => (
    <Card key={`d-${d.id}-${initiativeId ?? ""}`} variant="outlined" sx={{ mb: 1 }}>
      <CardActionArea
        onClick={() => navigate(`/diagrams/${d.id}`)}
        sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
      >
        <MaterialSymbol icon="schema" size={20} color="#1976d2" />
        <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
          {d.name}
        </Typography>
        {d.initiative_ids.length > 1 && (
          <Tooltip title={`Linked to ${d.initiative_ids.length} initiatives`}>
            <Chip
              label={`${d.initiative_ids.length} initiatives`}
              size="small"
              variant="outlined"
              sx={{ mr: 0.5 }}
            />
          </Tooltip>
        )}
        <Chip label="Diagram" size="small" color="info" variant="outlined" />
        {initiativeId && (
          <Tooltip title="Unlink from this initiative">
            <IconButton
              size="small"
              sx={{ ml: 0.5 }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleUnlinkDiagram(d, initiativeId);
              }}
            >
              <MaterialSymbol icon="link_off" size={18} />
            </IconButton>
          </Tooltip>
        )}
      </CardActionArea>
    </Card>
  );

  const renderSoawCard = (s: SoAW) => (
    <Card key={`s-${s.id}`} variant="outlined" sx={{ mb: 1 }}>
      <CardActionArea
        onClick={() => navigate(`/ea-delivery/soaw/${s.id}`)}
        sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
      >
        <MaterialSymbol icon="description" size={20} color="#e65100" />
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
        <Tooltip title="Preview">
          <IconButton
            size="small"
            sx={{ ml: 0.5 }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              navigate(`/ea-delivery/soaw/${s.id}/preview`);
            }}
          >
            <MaterialSymbol icon="visibility" size={18} />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
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
  );

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

      {initiatives.length === 0 && soaws.length === 0 && diagrams.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No initiatives found. Create initiatives in the Inventory first, then
          come back here to manage artefacts.
        </Alert>
      )}

      {/* Initiative groups */}
      {groups.map(({ initiative, soaws: initSoaws, diagrams: initDiagrams }) => {
        const isOpen = expanded[initiative.id] ?? false;
        const artefactCount = initSoaws.length + initDiagrams.length;

        return (
          <Card
            key={initiative.id}
            sx={{ mb: 2, borderLeft: "4px solid #33cc58" }}
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
              <Tooltip title="Link diagrams to this initiative">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    openLinkDialog(initiative.id);
                  }}
                  sx={{ mr: 0.5 }}
                >
                  <MaterialSymbol icon="link" size={20} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Create SoAW for this initiative">
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
                      onClick={() => openLinkDialog(initiative.id)}
                    >
                      Link a diagram
                    </Box>
                    {" or "}
                    <Box
                      component="span"
                      sx={{
                        color: "primary.main",
                        cursor: "pointer",
                        "&:hover": { textDecoration: "underline" },
                      }}
                      onClick={() => handleCreateForInitiative(initiative.id)}
                    >
                      create a Statement of Architecture Work
                    </Box>
                    .
                  </Typography>
                )}

                {/* Diagram cards */}
                {initDiagrams.map((d) => renderDiagramCard(d, initiative.id))}

                {/* SoAW cards */}
                {initSoaws.map(renderSoawCard)}
              </Box>
            </Collapse>
          </Card>
        );
      })}

      {/* Unlinked artefacts */}
      {(unlinkedSoaws.length > 0 || unlinkedDiagrams.length > 0) && (
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
                icon={expanded["__unlinked__"] ? "expand_more" : "chevron_right"}
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
              label={`${unlinkedSoaws.length + unlinkedDiagrams.length} artefact${unlinkedSoaws.length + unlinkedDiagrams.length !== 1 ? "s" : ""}`}
              size="small"
              variant="outlined"
            />
          </Box>
          <Collapse in={expanded["__unlinked__"] ?? false}>
            <Box sx={{ px: 2, pb: 2 }}>
              {unlinkedDiagrams.map((d) => renderDiagramCard(d))}
              {unlinkedSoaws.map(renderSoawCard)}
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
            if (ctxMenu) navigate(`/ea-delivery/soaw/${ctxMenu.soaw.id}/preview`);
            setCtxMenu(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="visibility" size={18} />
          </ListItemIcon>
          <ListItemText>Preview</ListItemText>
        </MenuItem>
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

      {/* Create SoAW dialog */}
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

      {/* Link diagrams dialog */}
      <Dialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Link Diagrams to Initiative
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select diagrams to link to{" "}
            <strong>
              {initiatives.find((i) => i.id === linkInitiativeId)?.name ?? ""}
            </strong>
            . A diagram can be linked to multiple initiatives.
          </Typography>

          {diagrams.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
              No diagrams available. Create one from the Diagrams page first.
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 400, overflow: "auto" }}>
              {diagrams.map((d) => {
                const isChecked = linkSelected.includes(d.id);
                return (
                  <ListItem key={d.id} disablePadding>
                    <ListItemButton onClick={() => toggleLinkDiagram(d.id)} dense>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          edge="start"
                          checked={isChecked}
                          tabIndex={-1}
                          disableRipple
                          size="small"
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <MaterialSymbol icon="schema" size={18} color="#1976d2" />
                      </ListItemIcon>
                      <ListItemText
                        primary={d.name}
                        secondary={
                          d.initiative_ids.length > 0
                            ? `Linked to ${d.initiative_ids.length} initiative${d.initiative_ids.length > 1 ? "s" : ""}`
                            : "Not linked"
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={linking}
            onClick={handleLinkDiagrams}
          >
            {linking ? "Saving..." : "Save Links"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
