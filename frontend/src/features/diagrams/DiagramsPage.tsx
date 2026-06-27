import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Collapse from "@mui/material/Collapse";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import Menu from "@mui/material/Menu";
import Autocomplete from "@mui/material/Autocomplete";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useDateFormat } from "@/hooks/useDateFormat";
import { api } from "@/api/client";
import type { Card, DiagramSummary, DiagramSection } from "@/types";
import CreateDiagramDialog from "./CreateDiagramDialog";
import ManageSectionsDialog from "./ManageSectionsDialog";
import AssignSectionsDialog from "./AssignSectionsDialog";
import DiagramsFilterSidebar, {
  type DiagramScope,
  type DiagramTypeFilter,
} from "./DiagramsFilterSidebar";

type ViewMode = "card" | "list";
type SortKey = "updated_at" | "created_at" | "name";

const FAVORITE_COLOR = "#f5b400";

export default function DiagramsPage() {
  const { t } = useTranslation(["diagrams", "common"]);
  const navigate = useNavigate();
  const { formatDate } = useDateFormat();
  const { types: metamodelTypes } = useMetamodel();
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [sections, setSections] = useState<DiagramSection[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("diagrams_view") as ViewMode) || "card",
  );

  // Sidebar + search + sort state
  const [scope, setScope] = useState<DiagramScope>({ kind: "all" });
  const [typeFilter, setTypeFilter] = useState<DiagramTypeFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("updated_at");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Cards for linking
  const [allCards, setAllCards] = useState<Card[]>([]);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDiagram, setAssignDiagram] = useState<DiagramSummary | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editDiagram, setEditDiagram] = useState<DiagramSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCardIds, setEditCardIds] = useState<string[]>([]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteDiagram, setDeleteDiagram] = useState<DiagramSummary | null>(null);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuDiagram, setMenuDiagram] = useState<DiagramSummary | null>(null);

  const typeMap = Object.fromEntries(
    metamodelTypes.map((mt) => [mt.key, { color: mt.color, icon: mt.icon, label: mt.label }]),
  );

  // Debounce the search box.
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  const loadDiagrams = useCallback(() => {
    const params = new URLSearchParams();
    if (scope.kind === "mine") params.set("mine", "true");
    if (scope.kind === "favorites") params.set("favorites", "true");
    if (scope.kind === "section") params.set("section_id", scope.id);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (search) params.set("search", search);
    params.set("sort_by", sortBy);
    const qs = params.toString();
    api.get<DiagramSummary[]>(`/diagrams${qs ? `?${qs}` : ""}`).then(setDiagrams);
  }, [scope, typeFilter, search, sortBy]);

  const loadSections = useCallback(() => {
    api
      .get<DiagramSection[]>("/diagram-sections")
      .then(setSections)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadDiagrams();
  }, [loadDiagrams]);

  useEffect(() => {
    loadSections();
    api
      .get<{ items: Card[] }>("/cards?page_size=500")
      .then((res) => setAllCards(res.items))
      .catch(() => {});
  }, [loadSections]);

  const handleViewChange = (_: unknown, mode: ViewMode | null) => {
    if (mode) {
      setViewMode(mode);
      localStorage.setItem("diagrams_view", mode);
    }
  };

  const toggleFavorite = useCallback(
    async (d: DiagramSummary, e: React.MouseEvent) => {
      e.stopPropagation();
      const next = !d.is_favorite;
      // Optimistic update
      setDiagrams((prev) =>
        prev.map((x) => (x.id === d.id ? { ...x, is_favorite: next } : x)),
      );
      try {
        if (next) await api.post(`/diagrams/${d.id}/favorite`);
        else await api.delete(`/diagrams/${d.id}/favorite`);
      } catch {
        // Revert on failure
        setDiagrams((prev) =>
          prev.map((x) => (x.id === d.id ? { ...x, is_favorite: !next } : x)),
        );
        return;
      }
      // When viewing the Favorites scope, an un-favorite should drop the card.
      if (scope.kind === "favorites" && !next) loadDiagrams();
    },
    [scope, loadDiagrams],
  );

  const openEdit = (d: DiagramSummary) => {
    setEditDiagram(d);
    setEditName(d.name);
    setEditDesc(d.description || "");
    setEditCardIds(d.card_ids || []);
    setEditOpen(true);
    setMenuAnchor(null);
  };

  const handleEdit = async () => {
    if (!editDiagram || !editName.trim()) return;
    await api.patch(`/diagrams/${editDiagram.id}`, {
      name: editName.trim(),
      description: editDesc.trim() || null,
      card_ids: editCardIds,
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

  const openAssign = (d: DiagramSummary) => {
    setAssignDiagram(d);
    setAssignOpen(true);
    setMenuAnchor(null);
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, d: DiagramSummary) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuDiagram(d);
  };

  const typeLabel = (typeKey: string) =>
    typeKey === "data_flow" ? t("gallery.types.dataFlow") : t("gallery.types.freeDraw");
  const typeIcon = (typeKey: string) => (typeKey === "data_flow" ? "device_hub" : "draw");
  const fmtDate = (iso?: string) => (iso ? formatDate(iso) : "");

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Group diagrams by section for the grouped view (only when not filtered to a
  // single section). Multi-section diagrams appear under each of their sections.
  const grouped = useMemo(() => {
    const groups: { key: string; label: string; color?: string | null; items: DiagramSummary[] }[] =
      [];
    for (const s of sections) {
      const items = diagrams.filter((d) => (d.section_ids || []).includes(s.id));
      if (items.length) groups.push({ key: s.id, label: s.name, color: s.color, items });
    }
    const ungrouped = diagrams.filter((d) => !(d.section_ids || []).length);
    if (ungrouped.length)
      groups.push({ key: "__ungrouped", label: t("gallery.ungrouped"), items: ungrouped });
    return groups;
  }, [diagrams, sections, t]);

  const renderCard = (d: DiagramSummary) => (
    <MuiCard key={d.id} sx={{ position: "relative" }}>
      <CardActionArea onClick={() => navigate(`/diagrams/${d.id}`)}>
        {/* Thumbnail */}
        <Box
          sx={{
            height: 104,
            overflow: "hidden",
            bgcolor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          {d.thumbnail ? (
            <img
              src={
                d.thumbnail.startsWith("data:")
                  ? d.thumbnail
                  : `data:image/svg+xml;base64,${btoa(d.thumbnail)}`
              }
              alt={d.name}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : (
            <MaterialSymbol icon={typeIcon(d.type)} size={36} color="#bbb" />
          )}
        </Box>

        <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
            <MaterialSymbol icon={typeIcon(d.type)} size={18} color="#1976d2" />
            <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
              {d.name}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              flexWrap: "wrap",
              minHeight: 20,
            }}
          >
            {!!d.card_count && (
              <Chip
                size="small"
                label={d.card_count}
                icon={<MaterialSymbol icon="widgets" size={12} />}
                variant="outlined"
                sx={{ height: 20, "& .MuiChip-label": { px: 0.5, fontSize: 11 } }}
              />
            )}
            <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: "auto" }}>
              {d.created_by_name ? `${t("gallery.byAuthor", { name: d.created_by_name })} · ` : ""}
              {fmtDate(d.updated_at)}
            </Typography>
          </Box>
        </CardContent>
      </CardActionArea>

      {/* Favorite star */}
      <Tooltip title={d.is_favorite ? t("gallery.favorite.remove") : t("gallery.favorite.add")}>
        <IconButton
          size="small"
          onClick={(e) => toggleFavorite(d, e)}
          sx={{
            position: "absolute",
            top: 2,
            left: 2,
            bgcolor: "rgba(255,255,255,0.85)",
            "&:hover": { bgcolor: "rgba(255,255,255,0.95)" },
          }}
        >
          <MaterialSymbol
            icon="star"
            size={16}
            color={d.is_favorite ? FAVORITE_COLOR : "#999"}
            style={d.is_favorite ? { fontVariationSettings: "'FILL' 1" } : undefined}
          />
        </IconButton>
      </Tooltip>

      {/* More menu */}
      <IconButton
        size="small"
        sx={{
          position: "absolute",
          top: 2,
          right: 2,
          bgcolor: "rgba(255,255,255,0.85)",
          "&:hover": { bgcolor: "rgba(255,255,255,0.95)" },
        }}
        onClick={(e) => openMenu(e, d)}
      >
        <MaterialSymbol icon="more_vert" size={16} />
      </IconButton>
    </MuiCard>
  );

  const cardGrid = (items: DiagramSummary[]) => (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 1.5,
      }}
    >
      {items.map(renderCard)}
    </Box>
  );

  const showGrouped = viewMode === "card" && scope.kind !== "section";

  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
      <DiagramsFilterSidebar
        scope={scope}
        onScopeChange={setScope}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        sections={sections}
        onManageSections={() => setManageOpen(true)}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
          <Typography variant="h5" fontWeight={600}>
            {t("page.title")}
          </Typography>
          <Chip label={`${diagrams.length}`} size="small" />
          <TextField
            size="small"
            placeholder={t("gallery.search.placeholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            sx={{ flex: 1, minWidth: 240, maxWidth: 460 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={18} />
                </InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearchInput("")}>
                    <MaterialSymbol icon="close" size={16} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            }}
          />
          <Box sx={{ flex: 1 }} />
          <Select
            size="small"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="updated_at">{t("gallery.sort.updated")}</MenuItem>
            <MenuItem value="created_at">{t("gallery.sort.created")}</MenuItem>
            <MenuItem value="name">{t("gallery.sort.name")}</MenuItem>
          </Select>
          <ToggleButtonGroup value={viewMode} exclusive onChange={handleViewChange} size="small">
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
            {t("gallery.newDiagram")}
          </Button>
        </Box>

        {/* Empty state */}
        {diagrams.length === 0 && (
          <Typography color="text.secondary" sx={{ textAlign: "center", py: 6 }}>
            {search || scope.kind !== "all" || typeFilter !== "all"
              ? t("gallery.noResults")
              : t("gallery.empty")}
          </Typography>
        )}

        {/* Card view — grouped by section */}
        {viewMode === "card" && diagrams.length > 0 && showGrouped && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {grouped.map((g) => (
              <Box key={g.key}>
                <Box
                  onClick={() => toggleCollapse(g.key)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    cursor: "pointer",
                    mb: 1,
                    userSelect: "none",
                  }}
                >
                  <MaterialSymbol
                    icon={collapsed.has(g.key) ? "chevron_right" : "expand_more"}
                    size={20}
                  />
                  {g.color && (
                    <Box
                      sx={{ width: 12, height: 12, borderRadius: "3px", bgcolor: g.color }}
                    />
                  )}
                  <Typography variant="subtitle2" fontWeight={600}>
                    {g.label}
                  </Typography>
                  <Chip size="small" label={g.items.length} />
                </Box>
                <Collapse in={!collapsed.has(g.key)}>{cardGrid(g.items)}</Collapse>
              </Box>
            ))}
          </Box>
        )}

        {/* Card view — flat (single section selected) */}
        {viewMode === "card" && diagrams.length > 0 && !showGrouped && cardGrid(diagrams)}

        {/* List view */}
        {viewMode === "list" && diagrams.length > 0 && (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t("common:labels.name")}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {t("common:labels.description")}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120 }}>
                    {t("common:labels.type")}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 160 }}>
                    {t("gallery.author")}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 100 }} align="center">
                    {t("common:labels.cards")}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120 }}>
                    {t("common:labels.updatedAt")}
                  </TableCell>
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
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <IconButton size="small" onClick={(e) => toggleFavorite(d, e)}>
                          <MaterialSymbol
                            icon="star"
                            size={16}
                            color={d.is_favorite ? FAVORITE_COLOR : "#bbb"}
                            style={
                              d.is_favorite ? { fontVariationSettings: "'FILL' 1" } : undefined
                            }
                          />
                        </IconButton>
                        <MaterialSymbol icon={typeIcon(d.type)} size={20} color="#1976d2" />
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
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {d.created_by_name || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">{d.card_count || 0}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {fmtDate(d.updated_at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={(e) => openMenu(e, d)}>
                        <MaterialSymbol icon="more_vert" size={18} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      {/* Context menu */}
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (menuDiagram) navigate(`/diagrams/${menuDiagram.id}`);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="open_in_new" size={18} />
          </ListItemIcon>
          <ListItemText>{t("gallery.menu.open")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuDiagram) openEdit(menuDiagram);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="edit" size={18} />
          </ListItemIcon>
          <ListItemText>{t("gallery.menu.renameEdit")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuDiagram) openAssign(menuDiagram);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="folder" size={18} />
          </ListItemIcon>
          <ListItemText>{t("gallery.menu.addToSections")}</ListItemText>
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
          <ListItemText>{t("common:actions.delete")}</ListItemText>
        </MenuItem>
      </Menu>

      <CreateDiagramDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <ManageSectionsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        sections={sections}
        onChanged={() => {
          loadSections();
          loadDiagrams();
        }}
      />

      <AssignSectionsDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        diagram={assignDiagram}
        sections={sections}
        onSaved={() => {
          loadDiagrams();
          loadSections();
        }}
        onSectionsChanged={loadSections}
      />

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("gallery.editDiagram")}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label={t("common:labels.name")}
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
            label={t("common:labels.description")}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            multiline
            rows={3}
            sx={{ mb: 2 }}
          />
          <Autocomplete
            multiple
            options={allCards}
            getOptionLabel={(opt) => opt.name}
            groupBy={(opt) => typeMap[opt.type]?.label || opt.type}
            value={allCards.filter((c) => editCardIds.includes(c.id))}
            onChange={(_, newVal) => setEditCardIds(newVal.map((v) => v.id))}
            disableCloseOnSelect
            renderOption={(props, option, { selected }) => (
              <li {...props} key={option.id}>
                <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                <MaterialSymbol
                  icon={typeMap[option.type]?.icon || "apps"}
                  size={18}
                  color={typeMap[option.type]?.color}
                />
                <Box component="span" sx={{ ml: 0.5 }}>
                  {option.name}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("gallery.linkedCards")}
                helperText={t("gallery.linkedCardsHelperText")}
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleEdit} disabled={!editName.trim()}>
            {t("common:actions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("gallery.delete.title")}</DialogTitle>
        <DialogContent>
          <Typography>
            <Trans
              i18nKey="gallery.delete.confirm"
              ns="diagrams"
              values={{ name: deleteDiagram?.name }}
              components={{ strong: <strong /> }}
            />
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
