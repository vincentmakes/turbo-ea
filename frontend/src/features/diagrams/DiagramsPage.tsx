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
import Collapse from "@mui/material/Collapse";
import Menu from "@mui/material/Menu";
import Autocomplete from "@mui/material/Autocomplete";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Drawer from "@mui/material/Drawer";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { useDateFormat } from "@/hooks/useDateFormat";
import { api } from "@/api/client";
import type { Card, DiagramSummary, DiagramGroup } from "@/types";
import CreateDiagramDialog from "./CreateDiagramDialog";
import ManageGroupsDialog from "./ManageGroupsDialog";
import AssignGroupsDialog from "./AssignGroupsDialog";
import DiagramsFilterSidebar, {
  type DiagramScope,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "./DiagramsFilterSidebar";

type SortKey = "updated_at" | "created_at" | "name";

const FAVORITE_COLOR = "#f5b400";
const DIAGRAM_ICON = "schema";

export default function DiagramsPage() {
  const { t } = useTranslation(["diagrams", "common"]);
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { formatDate } = useDateFormat();
  const { types: metamodelTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [groups, setGroups] = useState<DiagramGroup[]>([]);

  // Filter sidebar: temporary drawer on mobile, inline collapsible rail on desktop
  // (mirrors the inventory sidebar). Collapse state + width persist across visits.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("diagrams_sidebar_collapsed") === "1",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("diagrams_sidebar_width"));
    return stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH ? stored : 240;
  });
  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem("diagrams_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  };
  const changeSidebarWidth = (w: number) => {
    setSidebarWidth(w);
    localStorage.setItem("diagrams_sidebar_width", String(w));
  };

  // Sidebar + search + sort state
  const [scope, setScope] = useState<DiagramScope>({ kind: "all" });
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

  const typeMap = Object.fromEntries(metamodelTypes.map((mt) => [mt.key, mt]));

  // Debounce the search box.
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  const loadDiagrams = useCallback(() => {
    const params = new URLSearchParams();
    if (scope.kind === "mine") params.set("mine", "true");
    if (scope.kind === "favorites") params.set("favorites", "true");
    if (scope.kind === "group") params.set("group_id", scope.id);
    if (search) params.set("search", search);
    params.set("sort_by", sortBy);
    const qs = params.toString();
    api.get<DiagramSummary[]>(`/diagrams${qs ? `?${qs}` : ""}`).then(setDiagrams);
  }, [scope, search, sortBy]);

  const loadGroups = useCallback(() => {
    api
      .get<DiagramGroup[]>("/diagram-groups")
      .then(setGroups)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadDiagrams();
  }, [loadDiagrams]);

  useEffect(() => {
    loadGroups();
    api
      .get<{ items: Card[] }>("/cards?page_size=500")
      .then((res) => setAllCards(res.items))
      .catch(() => {});
  }, [loadGroups]);

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

  const fmtDate = (iso?: string) => (iso ? formatDate(iso) : "");

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Group diagrams by group for the grouped view (only when not filtered to a
  // single group). Multi-group diagrams appear under each of their groups.
  const grouped = useMemo(() => {
    const out: { key: string; label: string; color?: string | null; items: DiagramSummary[] }[] =
      [];
    for (const g of groups) {
      const items = diagrams.filter((d) => (d.group_ids || []).includes(g.id));
      if (items.length) out.push({ key: g.id, label: g.name, color: g.color, items });
    }
    const ungrouped = diagrams.filter((d) => !(d.group_ids || []).length);
    if (ungrouped.length)
      out.push({ key: "__ungrouped", label: t("gallery.ungrouped"), items: ungrouped });
    return out;
  }, [diagrams, groups, t]);

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
            <MaterialSymbol icon={DIAGRAM_ICON} size={36} color="#bbb" />
          )}
        </Box>

        <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
            <MaterialSymbol icon={DIAGRAM_ICON} size={18} color="#1976d2" />
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

  const showGrouped = scope.kind !== "group";

  return (
    <Box sx={{ display: "flex", height: "calc(100vh - 64px)", m: { xs: -1.5, sm: -3 } }}>
      {/* Sidebar — temporary Drawer on mobile, inline collapsible rail on desktop */}
      {isMobile ? (
        <Drawer
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          PaperProps={{ sx: { width: 300 } }}
        >
          <DiagramsFilterSidebar
            scope={scope}
            onScopeChange={setScope}
            groups={groups}
            onManageGroups={() => {
              setFiltersOpen(false);
              setManageOpen(true);
            }}
            collapsed={false}
            onToggleCollapse={() => setFiltersOpen(false)}
            width={300}
            onWidthChange={() => {}}
            onAfterChange={() => setFiltersOpen(false)}
          />
        </Drawer>
      ) : (
        <DiagramsFilterSidebar
          scope={scope}
          onScopeChange={setScope}
          groups={groups}
          onManageGroups={() => setManageOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapse}
          width={sidebarWidth}
          onWidthChange={changeSidebarWidth}
        />
      )}

      <Box sx={{ flex: 1, minWidth: 0, overflow: "auto", p: { xs: 1.5, sm: 2 } }}>
        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
          {isMobile && (
            <Tooltip title={t("gallery.filters")}>
              <IconButton onClick={() => setFiltersOpen(true)} size="small">
                <MaterialSymbol icon="filter_list" size={22} />
              </IconButton>
            </Tooltip>
          )}
          <Typography variant="h5" fontWeight={600}>
            {t("page.title")}
          </Typography>
          <Chip label={`${diagrams.length}`} size="small" />
          <TextField
            size="small"
            placeholder={t("gallery.search.placeholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            sx={{ flexGrow: 1, flexBasis: { xs: "100%", sm: 320 }, minWidth: { sm: 280 } }}
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
            {search || scope.kind !== "all"
              ? t("gallery.noResults")
              : t("gallery.empty")}
          </Typography>
        )}

        {/* Grouped by group */}
        {diagrams.length > 0 && showGrouped && (
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

        {/* Flat (single group selected) */}
        {diagrams.length > 0 && !showGrouped && cardGrid(diagrams)}
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
          <ListItemText>{t("gallery.menu.addToGroups")}</ListItemText>
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

      <ManageGroupsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        groups={groups}
        onChanged={() => {
          loadGroups();
          loadDiagrams();
        }}
      />

      <AssignGroupsDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        diagram={assignDiagram}
        groups={groups}
        onSaved={(groupIds) => {
          // The PUT is authoritative for this diagram's group_ids, so update
          // the gallery in place immediately (same pattern as the favorite
          // toggle) — the group and diagram appear without a refresh.
          if (assignDiagram) {
            setDiagrams((prev) =>
              prev.map((d) =>
                d.id === assignDiagram.id ? { ...d, group_ids: groupIds } : d,
              ),
            );
          }
          // Refresh the group list for updated counts and any inline-created group.
          loadGroups();
        }}
        onGroupsChanged={loadGroups}
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
            groupBy={(opt) => typeLabel(typeMap[opt.type]) || opt.type}
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
