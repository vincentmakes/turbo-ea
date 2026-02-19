import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Autocomplete from "@mui/material/Autocomplete";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { CardType, Bookmark, FieldDef, RelationType, User } from "@/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Filters {
  types: string[];
  search: string;
  subtypes: string[];
  lifecyclePhases: string[];
  dataQualityMin: number | null;
  approvalStatuses: string[];
  showArchived: boolean;
  attributes: Record<string, string | string[]>; // select fields → string[], text/number → string
  relations: Record<string, string[]>; // relTypeKey → related card names (multi-select)
}

interface Props {
  types: CardType[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  relevantRelTypes?: RelationType[];
  relationsMap?: Map<string, Map<string, string[]>>;
  canArchive?: boolean;
  currentUserId?: string;
}

const APPROVAL_STATUS_OPTIONS = [
  { key: "DRAFT", label: "Draft", color: "#9e9e9e" },
  { key: "APPROVED", label: "Approved", color: "#4caf50" },
  { key: "BROKEN", label: "Broken", color: "#ff9800" },
  { key: "REJECTED", label: "Rejected", color: "#f44336" },
];

const LIFECYCLE_PHASES = [
  { key: "plan", label: "Plan", color: "#90a4ae" },
  { key: "phaseIn", label: "Phase In", color: "#42a5f5" },
  { key: "active", label: "Active", color: "#66bb6a" },
  { key: "phaseOut", label: "Phase Out", color: "#ffa726" },
  { key: "endOfLife", label: "End of Life", color: "#ef5350" },
];

const DATA_QUALITY_THRESHOLDS = [
  { key: 80, label: "Good (80%+)", color: "#4caf50" },
  { key: 50, label: "Medium (50%+)", color: "#ff9800" },
  { key: 0, label: "Poor (< 50%)", color: "#f44336" },
];

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InventoryFilterSidebar({
  types,
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  relevantRelTypes = [],
  relationsMap,
  canArchive = false,
  currentUserId,
}: Props) {
  const [tab, setTab] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    types: true,
    search: true,
    subtypes: false,
    lifecycle: false,
    dataQuality: false,
    approvalStatus: false,
    attributes: false,
    relationships: false,
  });

  // Search-within-dropdown state: keyed by field key or relation type key
  const [dropdownSearch, setDropdownSearch] = useState<Record<string, string>>({});

  // Views state
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [viewName, setViewName] = useState("");
  const [dialogVisibility, setDialogVisibility] = useState<"private" | "public" | "shared">("private");
  const [dialogOdata, setDialogOdata] = useState(false);
  const [dialogSharedWith, setDialogSharedWith] = useState<(User & { can_edit?: boolean })[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Load bookmarks
  const loadBookmarks = useCallback(async () => {
    try {
      const bms = await api.get<Bookmark[]>("/bookmarks");
      setBookmarks(bms);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  // Derive subtype options from selected type
  const subtypeOptions = useMemo(() => {
    if (filters.types.length !== 1) return [];
    const t = types.find((t) => t.key === filters.types[0]);
    return t?.subtypes ?? [];
  }, [types, filters.types]);

  // Derive attribute filter fields from selected types (all field types)
  const attributeFields = useMemo(() => {
    const selectedTypes = filters.types.length > 0
      ? types.filter((t) => filters.types.includes(t.key))
      : [];
    if (selectedTypes.length !== 1) return [];
    const t = selectedTypes[0];
    const fields: FieldDef[] = [];
    for (const section of t.fields_schema) {
      for (const f of section.fields) {
        fields.push(f);
      }
    }
    return fields;
  }, [types, filters.types]);

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleType = (key: string) => {
    const next = filters.types.includes(key)
      ? filters.types.filter((t) => t !== key)
      : [...filters.types, key];
    onFiltersChange({ ...filters, types: next, subtypes: [], attributes: {} });
  };

  const toggleSubtype = (key: string) => {
    const next = filters.subtypes.includes(key)
      ? filters.subtypes.filter((s) => s !== key)
      : [...filters.subtypes, key];
    onFiltersChange({ ...filters, subtypes: next });
  };

  const toggleLifecyclePhase = (key: string) => {
    const next = filters.lifecyclePhases.includes(key)
      ? filters.lifecyclePhases.filter((p) => p !== key)
      : [...filters.lifecyclePhases, key];
    onFiltersChange({ ...filters, lifecyclePhases: next });
  };

  const toggleApprovalStatus = (key: string) => {
    const next = filters.approvalStatuses.includes(key)
      ? filters.approvalStatuses.filter((s) => s !== key)
      : [...filters.approvalStatuses, key];
    onFiltersChange({ ...filters, approvalStatuses: next });
  };

  const setAttr = (key: string, value: string | string[]) => {
    const next = { ...filters.attributes };
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (empty) delete next[key];
    else next[key] = value;
    onFiltersChange({ ...filters, attributes: next });
  };

  const setRelFilter = (relTypeKey: string, value: string[]) => {
    const next = { ...(filters.relations || {}) };
    if (value.length === 0) delete next[relTypeKey];
    else next[relTypeKey] = value;
    onFiltersChange({ ...filters, relations: next });
  };

  // Compute unique related names per relation type for filter dropdowns
  const relFilterOptions = useMemo(() => {
    if (!relationsMap || relevantRelTypes.length === 0) return new Map<string, string[]>();
    const result = new Map<string, string[]>();
    for (const rt of relevantRelTypes) {
      const index = relationsMap.get(rt.key);
      if (!index) continue;
      const names = new Set<string>();
      for (const arr of index.values()) {
        for (const name of arr) names.add(name);
      }
      if (names.size > 0) {
        result.set(rt.key, Array.from(names).sort());
      }
    }
    return result;
  }, [relationsMap, relevantRelTypes]);

  const clearAll = () =>
    onFiltersChange({ types: [], search: "", subtypes: [], lifecyclePhases: [], dataQualityMin: null, approvalStatuses: [], showArchived: false, attributes: {}, relations: {} });

  const activeCount =
    filters.types.length +
    (filters.search ? 1 : 0) +
    filters.subtypes.length +
    filters.lifecyclePhases.length +
    (filters.dataQualityMin !== null ? 1 : 0) +
    filters.approvalStatuses.length +
    (filters.showArchived ? 1 : 0) +
    Object.keys(filters.attributes).length +
    Object.keys(filters.relations || {}).length;

  // Categorize bookmarks into My / Shared / Public sections
  const myViews = useMemo(() => bookmarks.filter((b) => b.is_owner), [bookmarks]);
  const sharedViews = useMemo(
    () => bookmarks.filter((b) => !b.is_owner && b.visibility === "shared"),
    [bookmarks],
  );
  const publicViews = useMemo(
    () => bookmarks.filter((b) => !b.is_owner && b.visibility === "public"),
    [bookmarks],
  );

  /* ---- Views actions ---- */

  const openCreateDialog = () => {
    setEditingBookmark(null);
    setViewName("");
    setDialogVisibility("private");
    setDialogOdata(false);
    setDialogSharedWith([]);
    setSaveDialogOpen(true);
  };

  const handleSaveView = async () => {
    if (!viewName.trim()) return;
    const sharedWithPayload =
      dialogVisibility === "shared"
        ? dialogSharedWith.map((u) => ({ user_id: u.id, can_edit: u.can_edit ?? false }))
        : null;
    const payload: Record<string, unknown> = {
      name: viewName.trim(),
      card_type: filters.types.length === 1 ? filters.types[0] : undefined,
      filters: {
        types: filters.types,
        search: filters.search,
        subtypes: filters.subtypes,
        lifecyclePhases: filters.lifecyclePhases,
        dataQualityMin: filters.dataQualityMin,
        approvalStatuses: filters.approvalStatuses,
        showArchived: filters.showArchived,
        attributes: filters.attributes,
        relations: filters.relations,
      },
      visibility: dialogVisibility,
      odata_enabled: dialogOdata,
      shared_with: sharedWithPayload,
    };
    if (editingBookmark) {
      await api.patch(`/bookmarks/${editingBookmark.id}`, payload);
    } else {
      await api.post("/bookmarks", payload);
    }
    setSaveDialogOpen(false);
    setEditingBookmark(null);
    setViewName("");
    loadBookmarks();
  };

  const handleApplyView = (bm: Bookmark) => {
    const f = bm.filters as Filters | undefined;
    if (f) {
      onFiltersChange({
        types: f.types || [],
        search: f.search || "",
        subtypes: f.subtypes || [],
        lifecyclePhases: f.lifecyclePhases || [],
        dataQualityMin: f.dataQualityMin ?? null,
        approvalStatuses: f.approvalStatuses || [],
        showArchived: f.showArchived || false,
        attributes: f.attributes || {},
        relations: f.relations || {},
      });
    }
    setTab(0);
  };

  const handleDeleteView = async (bm: Bookmark) => {
    await api.delete(`/bookmarks/${bm.id}`);
    loadBookmarks();
  };

  const handleEditView = (bm: Bookmark) => {
    setEditingBookmark(bm);
    setViewName(bm.name);
    setDialogVisibility(bm.visibility || "private");
    setDialogOdata(bm.odata_enabled || false);
    // Pre-populate shared users with can_edit flag
    const shared = (bm.shared_with || []).map((s) => ({
      id: s.user_id,
      display_name: s.display_name || "",
      email: s.email || "",
      role: "",
      is_active: true,
      can_edit: s.can_edit,
    }));
    setDialogSharedWith(shared);
    setSaveDialogOpen(true);
  };

  // Load all users when shared visibility is selected
  useEffect(() => {
    if (saveDialogOpen && dialogVisibility === "shared" && allUsers.length === 0) {
      api.get<User[]>("/users").then(setAllUsers).catch(() => {});
    }
  }, [saveDialogOpen, dialogVisibility, allUsers.length]);

  /* ---- Resize drag ---- */

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (ev.clientX - startX)));
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  /* ---- Collapsed rail ---- */

  if (collapsed) {
    return (
      <Box
        sx={{
          width: 44,
          minWidth: 44,
          borderRight: "1px solid #e0e0e0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "#fafafa",
        }}
      >
        <Tooltip title="Expand filters" placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 12 }}
          />
        )}
      </Box>
    );
  }

  /* ---- Expanded sidebar ---- */

  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          minWidth: MIN_WIDTH,
          borderRight: "1px solid #e0e0e0",
          display: "flex",
          flexDirection: "column",
          bgcolor: "#fafafa",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 0.5,
            borderBottom: "1px solid #e0e0e0",
          }}
        >
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{
              minHeight: 36,
              "& .MuiTab-root": { minHeight: 36, py: 0, textTransform: "none", fontSize: 14 },
            }}
          >
            <Tab label="Filters" />
            <Tab label="Views" />
          </Tabs>
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {tab === 0 ? (
            /* ======================= FILTERS TAB ======================= */
            <>
              {/* Search */}
              <SectionHeader
                label="Search"
                icon="search"
                expanded={expandedSections.search}
                onToggle={() => toggleSection("search")}
              />
              <Collapse in={expandedSections.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search cards..."
                  value={filters.search}
                  onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                  sx={{ mb: 2 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <MaterialSymbol icon="search" size={16} color="#999" />
                      </InputAdornment>
                    ),
                    ...(filters.search
                      ? {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                size="small"
                                onClick={() => onFiltersChange({ ...filters, search: "" })}
                              >
                                <MaterialSymbol icon="close" size={14} />
                              </IconButton>
                            </InputAdornment>
                          ),
                        }
                      : {}),
                  }}
                />
              </Collapse>

              {/* Card Types */}
              <SectionHeader
                label="Types"
                icon="category"
                expanded={expandedSections.types}
                onToggle={() => toggleSection("types")}
                count={filters.types.length}
              />
              <Collapse in={expandedSections.types}>
                <List dense disablePadding sx={{ mb: 1 }}>
                  {types
                    .filter((t) => !t.is_hidden)
                    .map((t) => (
                      <ListItemButton
                        key={t.key}
                        dense
                        onClick={() => toggleType(t.key)}
                        sx={{ py: 0.25, px: 1, borderRadius: 1 }}
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <Checkbox
                            size="small"
                            checked={filters.types.includes(t.key)}
                            disableRipple
                            sx={{ p: 0 }}
                          />
                        </ListItemIcon>
                        <MaterialSymbol icon={t.icon} size={16} color={t.color} />
                        <ListItemText
                          primary={t.label}
                          primaryTypographyProps={{
                            fontSize: 14,
                            ml: 0.75,
                            noWrap: true,
                          }}
                        />
                      </ListItemButton>
                    ))}
                </List>
              </Collapse>

              {/* Subtypes (only when single type with subtypes selected) */}
              {subtypeOptions.length > 0 && (
                <>
                  <SectionHeader
                    label="Subtypes"
                    icon="label"
                    expanded={expandedSections.subtypes}
                    onToggle={() => toggleSection("subtypes")}
                    count={filters.subtypes.length}
                  />
                  <Collapse in={expandedSections.subtypes}>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                      {subtypeOptions.map((st) => (
                        <Chip
                          key={st.key}
                          label={st.label}
                          size="small"
                          onClick={() => toggleSubtype(st.key)}
                          variant={filters.subtypes.includes(st.key) ? "filled" : "outlined"}
                          color={filters.subtypes.includes(st.key) ? "primary" : "default"}
                        />
                      ))}
                    </Box>
                  </Collapse>
                </>
              )}

              {/* Approval Status */}
              <SectionHeader
                label="Approval Status"
                icon="verified"
                expanded={expandedSections.approvalStatus}
                onToggle={() => toggleSection("approvalStatus")}
                count={filters.approvalStatuses.length}
              />
              <Collapse in={expandedSections.approvalStatus}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                  {APPROVAL_STATUS_OPTIONS.map((s) => (
                    <Chip
                      key={s.key}
                      label={s.label}
                      size="small"
                      onClick={() => toggleApprovalStatus(s.key)}
                      variant={filters.approvalStatuses.includes(s.key) ? "filled" : "outlined"}
                      sx={
                        filters.approvalStatuses.includes(s.key)
                          ? { bgcolor: s.color, color: "#fff", borderColor: s.color }
                          : { borderColor: s.color, color: s.color }
                      }
                    />
                  ))}
                </Box>
              </Collapse>

              {/* Lifecycle */}
              <SectionHeader
                label="Lifecycle"
                icon="schedule"
                expanded={expandedSections.lifecycle}
                onToggle={() => toggleSection("lifecycle")}
                count={filters.lifecyclePhases.length}
              />
              <Collapse in={expandedSections.lifecycle}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                  {LIFECYCLE_PHASES.map((p) => (
                    <Chip
                      key={p.key}
                      label={p.label}
                      size="small"
                      onClick={() => toggleLifecyclePhase(p.key)}
                      variant={filters.lifecyclePhases.includes(p.key) ? "filled" : "outlined"}
                      sx={
                        filters.lifecyclePhases.includes(p.key)
                          ? { bgcolor: p.color, color: "#fff", borderColor: p.color }
                          : { borderColor: p.color, color: p.color }
                      }
                    />
                  ))}
                </Box>
              </Collapse>

              {/* Data Quality */}
              <SectionHeader
                label="Data Quality"
                icon="bar_chart"
                expanded={expandedSections.dataQuality}
                onToggle={() => toggleSection("dataQuality")}
                count={filters.dataQualityMin !== null ? 1 : 0}
              />
              <Collapse in={expandedSections.dataQuality}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                  {DATA_QUALITY_THRESHOLDS.map((t) => (
                    <Chip
                      key={t.key}
                      label={t.label}
                      size="small"
                      onClick={() => onFiltersChange({ ...filters, dataQualityMin: filters.dataQualityMin === t.key ? null : t.key })}
                      variant={filters.dataQualityMin === t.key ? "filled" : "outlined"}
                      sx={
                        filters.dataQualityMin === t.key
                          ? { bgcolor: t.color, color: "#fff", borderColor: t.color }
                          : { borderColor: t.color, color: t.color }
                      }
                    />
                  ))}
                </Box>
              </Collapse>

              {/* Attribute Filters (only when single type selected) */}
              {attributeFields.length > 0 && (
                <>
                  <SectionHeader
                    label="Attributes"
                    icon="tune"
                    expanded={expandedSections.attributes}
                    onToggle={() => toggleSection("attributes")}
                    count={Object.keys(filters.attributes).length}
                  />
                  <Collapse in={expandedSections.attributes}>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 2, px: 0.5 }}>
                      {attributeFields.map((field) => {
                        if ((field.type === "single_select" || field.type === "multiple_select") && field.options?.length) {
                          const selected = (filters.attributes[field.key] ?? []) as string[];
                          const optionMap = new Map(field.options.map((o) => [o.key, o]));
                          const searchTerm = (dropdownSearch[field.key] || "").toLowerCase();
                          const filteredOpts = searchTerm
                            ? field.options.filter((o) => o.label.toLowerCase().includes(searchTerm))
                            : field.options;
                          return (
                            <FormControl key={field.key} size="small" fullWidth>
                              <InputLabel sx={{ fontSize: 14 }}>{field.label}</InputLabel>
                              <Select
                                multiple
                                value={Array.isArray(selected) ? selected : []}
                                label={field.label}
                                onChange={(e) => setAttr(field.key, e.target.value as string[])}
                                onClose={() => setDropdownSearch((s) => ({ ...s, [field.key]: "" }))}
                                sx={{ fontSize: 14 }}
                                MenuProps={{ autoFocus: false, PaperProps: { sx: { maxHeight: 300 } } }}
                                renderValue={(vals) => (
                                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25 }}>
                                    {(vals as string[]).map((v) => {
                                      const opt = optionMap.get(v);
                                      return (
                                        <Chip
                                          key={v}
                                          label={opt?.label ?? v}
                                          size="small"
                                          sx={{
                                            height: 20, fontSize: 12,
                                            ...(opt?.color ? { bgcolor: opt.color, color: "#fff" } : {}),
                                          }}
                                          onDelete={() => setAttr(field.key, selected.filter((s) => s !== v))}
                                          onMouseDown={(e) => e.stopPropagation()}
                                        />
                                      );
                                    })}
                                  </Box>
                                )}
                              >
                                <ListSubheader sx={{ p: 0.5, lineHeight: "unset" }}>
                                  <TextField
                                    size="small"
                                    autoFocus
                                    placeholder="Search…"
                                    fullWidth
                                    value={dropdownSearch[field.key] || ""}
                                    onChange={(e) => setDropdownSearch((s) => ({ ...s, [field.key]: e.target.value }))}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    InputProps={{
                                      startAdornment: (
                                        <InputAdornment position="start">
                                          <MaterialSymbol icon="search" size={18} />
                                        </InputAdornment>
                                      ),
                                      sx: { fontSize: 14 },
                                    }}
                                  />
                                </ListSubheader>
                                {filteredOpts.map((opt) => (
                                  <MenuItem key={opt.key} value={opt.key}>
                                    <Checkbox size="small" checked={selected.includes(opt.key)} sx={{ p: 0, mr: 1 }} />
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                      {opt.color && (
                                        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: opt.color }} />
                                      )}
                                      {opt.label}
                                    </Box>
                                  </MenuItem>
                                ))}
                                {filteredOpts.length === 0 && (
                                  <MenuItem disabled>
                                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 14 }}>
                                      No matches
                                    </Typography>
                                  </MenuItem>
                                )}
                              </Select>
                            </FormControl>
                          );
                        }
                        if (field.type === "boolean") {
                          return (
                            <FormControl key={field.key} size="small" fullWidth>
                              <InputLabel sx={{ fontSize: 14 }}>{field.label}</InputLabel>
                              <Select
                                value={(filters.attributes[field.key] as string) ?? ""}
                                label={field.label}
                                onChange={(e) => setAttr(field.key, e.target.value as string)}
                                sx={{ fontSize: 14 }}
                              >
                                <MenuItem value=""><em>Any</em></MenuItem>
                                <MenuItem value="true">Yes</MenuItem>
                                <MenuItem value="false">No</MenuItem>
                              </Select>
                            </FormControl>
                          );
                        }
                        if (field.type === "number" || field.type === "cost") {
                          return (
                            <TextField
                              key={field.key}
                              size="small"
                              fullWidth
                              label={field.label}
                              placeholder="Min value"
                              type="number"
                              value={(filters.attributes[field.key] as string) || ""}
                              onChange={(e) => setAttr(field.key, e.target.value)}
                              sx={{ "& .MuiInputBase-input": { fontSize: 14 } }}
                              InputLabelProps={{ sx: { fontSize: 14 } }}
                            />
                          );
                        }
                        // text, date, etc. → text search
                        return (
                          <TextField
                            key={field.key}
                            size="small"
                            fullWidth
                            label={field.label}
                            type={field.type === "date" ? "date" : "text"}
                            placeholder={field.type === "date" ? "" : "Contains..."}
                            value={(filters.attributes[field.key] as string) || ""}
                            onChange={(e) => setAttr(field.key, e.target.value)}
                            sx={{ "& .MuiInputBase-input": { fontSize: 14 } }}
                            InputLabelProps={{ shrink: field.type === "date" ? true : undefined, sx: { fontSize: 14 } }}
                          />
                        );
                      })}
                    </Box>
                  </Collapse>
                </>
              )}

              {/* Relationship Filters (only when single type selected and relations exist) */}
              {relFilterOptions.size > 0 && (
                <>
                  <SectionHeader
                    label="Relationships"
                    icon="share"
                    expanded={expandedSections.relationships}
                    onToggle={() => toggleSection("relationships")}
                    count={Object.keys(filters.relations || {}).length}
                  />
                  <Collapse in={expandedSections.relationships}>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 2, px: 0.5 }}>
                      {relevantRelTypes.map((rt) => {
                        const options = relFilterOptions.get(rt.key);
                        if (!options || options.length === 0) return null;
                        const isSource = rt.source_type_key === (filters.types.length === 1 ? filters.types[0] : "");
                        const otherTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
                        const otherType = types.find((t) => t.key === otherTypeKey);
                        const label = otherType?.label || otherTypeKey;
                        const selected = (filters.relations || {})[rt.key] || [];
                        const searchKey = `rel_${rt.key}`;
                        const searchTerm = (dropdownSearch[searchKey] || "").toLowerCase();
                        const filteredOpts = searchTerm
                          ? options.filter((n) => n.toLowerCase().includes(searchTerm))
                          : options;
                        return (
                          <FormControl key={rt.key} size="small" fullWidth>
                            <InputLabel sx={{ fontSize: 14 }}>{label}</InputLabel>
                            <Select
                              multiple
                              value={selected}
                              label={label}
                              onChange={(e) => setRelFilter(rt.key, e.target.value as string[])}
                              onClose={() => setDropdownSearch((s) => ({ ...s, [searchKey]: "" }))}
                              sx={{ fontSize: 14 }}
                              MenuProps={{ autoFocus: false, PaperProps: { sx: { maxHeight: 300 } } }}
                              renderValue={(vals) => (
                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25 }}>
                                  {(vals as string[]).map((v) => (
                                    <Chip
                                      key={v}
                                      label={v}
                                      size="small"
                                      sx={{ height: 20, fontSize: 12 }}
                                      onDelete={() => setRelFilter(rt.key, selected.filter((s) => s !== v))}
                                      onMouseDown={(e) => e.stopPropagation()}
                                    />
                                  ))}
                                </Box>
                              )}
                            >
                              <ListSubheader sx={{ p: 0.5, lineHeight: "unset" }}>
                                <TextField
                                  size="small"
                                  autoFocus
                                  placeholder="Search…"
                                  fullWidth
                                  value={dropdownSearch[searchKey] || ""}
                                  onChange={(e) => setDropdownSearch((s) => ({ ...s, [searchKey]: e.target.value }))}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  InputProps={{
                                    startAdornment: (
                                      <InputAdornment position="start">
                                        <MaterialSymbol icon="search" size={18} />
                                      </InputAdornment>
                                    ),
                                    sx: { fontSize: 14 },
                                  }}
                                />
                              </ListSubheader>
                              {filteredOpts.map((name) => (
                                <MenuItem key={name} value={name}>
                                  <Checkbox size="small" checked={selected.includes(name)} sx={{ p: 0, mr: 1 }} />
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    {otherType && (
                                      <MaterialSymbol icon={otherType.icon} size={14} color={otherType.color} />
                                    )}
                                    {name}
                                  </Box>
                                </MenuItem>
                              ))}
                              {filteredOpts.length === 0 && (
                                <MenuItem disabled>
                                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: 14 }}>
                                    No matches
                                  </Typography>
                                </MenuItem>
                              )}
                            </Select>
                          </FormControl>
                        );
                      })}
                    </Box>
                  </Collapse>
                </>
              )}

              {/* Include Archived toggle */}
              {canArchive && (
                <Box sx={{ px: 0.5, mb: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={filters.showArchived}
                        onChange={(e) => onFiltersChange({ ...filters, showArchived: e.target.checked })}
                      />
                    }
                    label={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                        <MaterialSymbol icon="archive" size={16} color="#666" />
                        <Typography variant="body2" fontSize={13}>Show archived only</Typography>
                      </Box>
                    }
                    sx={{ ml: 0 }}
                  />
                </Box>
              )}

              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: "flex", gap: 1 }}>
                {activeCount > 0 && (
                  <Button
                    size="small"
                    onClick={clearAll}
                    startIcon={<MaterialSymbol icon="filter_alt_off" size={16} />}
                    sx={{ textTransform: "none", fontSize: 13 }}
                  >
                    Clear all ({activeCount})
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  onClick={openCreateDialog}
                  startIcon={<MaterialSymbol icon="bookmark_add" size={16} />}
                  sx={{ textTransform: "none", fontSize: 13, ml: "auto" }}
                >
                  Save view
                </Button>
              </Box>
            </>
          ) : (
            /* ======================= VIEWS TAB ======================= */
            <>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography variant="body2" fontWeight={600} fontSize={14}>
                  Saved Views
                </Typography>
                <Button
                  size="small"
                  onClick={openCreateDialog}
                  startIcon={<MaterialSymbol icon="add" size={16} />}
                  sx={{ textTransform: "none", fontSize: 13 }}
                >
                  Save current
                </Button>
              </Box>

              {bookmarks.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 4, fontSize: 14 }}
                >
                  No saved views yet.
                  <br />
                  Apply filters and click "Save current".
                </Typography>
              ) : (
                <>
                  {/* My Views */}
                  {myViews.length > 0 && (
                    <>
                      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 11, px: 0.5 }}>
                        My Views
                      </Typography>
                      <List dense disablePadding sx={{ mb: 1 }}>
                        {myViews.map((bm) => (
                          <BookmarkListItem
                            key={bm.id}
                            bm={bm}
                            types={types}
                            onApply={handleApplyView}
                            onEdit={handleEditView}
                            onDelete={handleDeleteView}
                          />
                        ))}
                      </List>
                    </>
                  )}

                  {/* Shared with me */}
                  {sharedViews.length > 0 && (
                    <>
                      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 11, px: 0.5 }}>
                        Shared with me
                      </Typography>
                      <List dense disablePadding sx={{ mb: 1 }}>
                        {sharedViews.map((bm) => (
                          <BookmarkListItem
                            key={bm.id}
                            bm={bm}
                            types={types}
                            onApply={handleApplyView}
                            onEdit={bm.can_edit ? handleEditView : undefined}
                          />
                        ))}
                      </List>
                    </>
                  )}

                  {/* Public */}
                  {publicViews.length > 0 && (
                    <>
                      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 11, px: 0.5 }}>
                        Public
                      </Typography>
                      <List dense disablePadding>
                        {publicViews.map((bm) => (
                          <BookmarkListItem
                            key={bm.id}
                            bm={bm}
                            types={types}
                            onApply={handleApplyView}
                          />
                        ))}
                      </List>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 5,
          cursor: "col-resize",
          bgcolor: "transparent",
          "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
          transition: "background-color 0.2s",
          zIndex: 1,
        }}
      />

      {/* Save / Edit view dialog */}
      <Dialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MaterialSymbol icon={editingBookmark ? "edit" : "bookmark_add"} size={22} color="#1976d2" />
          {editingBookmark ? "Edit View" : "Save Current View"}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="View name"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && viewName.trim()) handleSaveView();
            }}
          />
          {!editingBookmark && activeCount > 0 && (
            <Typography variant="caption" color="text.secondary">
              This will save your current {activeCount} active filter{activeCount > 1 ? "s" : ""}.
            </Typography>
          )}

          {/* Visibility */}
          <TextField
            select
            label="Visibility"
            value={dialogVisibility}
            onChange={(e) => setDialogVisibility(e.target.value as "private" | "public" | "shared")}
            fullWidth
            size="small"
            disabled={editingBookmark != null && !editingBookmark.is_owner}
          >
            <MenuItem value="private">
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <MaterialSymbol icon="lock" size={16} />
                Private — Only me
              </Box>
            </MenuItem>
            <MenuItem value="public">
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <MaterialSymbol icon="public" size={16} />
                Public — All users
              </Box>
            </MenuItem>
            <MenuItem value="shared">
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <MaterialSymbol icon="group" size={16} />
                Shared — Specific users
              </Box>
            </MenuItem>
          </TextField>

          {/* User picker when shared */}
          {dialogVisibility === "shared" && (
            <>
              <Autocomplete
                multiple
                options={allUsers.filter((u) => u.is_active && u.id !== currentUserId)}
                getOptionLabel={(u) => `${u.display_name} (${u.email})`}
                value={dialogSharedWith}
                onChange={(_, v) =>
                  setDialogSharedWith(v.map((u) => ({ ...u, can_edit: (u as User & { can_edit?: boolean }).can_edit ?? false })))
                }
                isOptionEqualToValue={(o, v) => o.id === v.id}
                renderTags={(value, getTagProps) =>
                  value.map((u, idx) => (
                    <Chip label={u.display_name} size="small" {...getTagProps({ index: idx })} key={u.id} />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Share with" size="small" placeholder="Search users..." />
                )}
                size="small"
                disabled={editingBookmark != null && !editingBookmark.is_owner}
              />

              {/* Can-edit toggles per shared user */}
              {dialogSharedWith.length > 0 && (
                <Box sx={{ pl: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                    Permissions (shared users can view by default)
                  </Typography>
                  {dialogSharedWith.map((u) => (
                    <FormControlLabel
                      key={u.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={u.can_edit ?? false}
                          onChange={(e) =>
                            setDialogSharedWith((prev) =>
                              prev.map((p) => (p.id === u.id ? { ...p, can_edit: e.target.checked } : p)),
                            )
                          }
                          disabled={editingBookmark != null && !editingBookmark.is_owner}
                        />
                      }
                      label={
                        <Typography variant="body2" fontSize={13}>
                          {u.display_name} — can edit
                        </Typography>
                      }
                      sx={{ ml: 0 }}
                    />
                  ))}
                </Box>
              )}
            </>
          )}

          {/* OData toggle */}
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={dialogOdata}
                onChange={(e) => setDialogOdata(e.target.checked)}
                disabled={editingBookmark != null && !editingBookmark.is_owner}
              />
            }
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <MaterialSymbol icon="cloud" size={16} color="#666" />
                <Typography variant="body2" fontSize={13}>Enable OData feed</Typography>
              </Box>
            }
            sx={{ ml: 0 }}
          />
          {dialogOdata && editingBookmark?.odata_url && (
            <Box sx={{ bgcolor: "#f5f5f5", borderRadius: 1, p: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                OData Feed URL (requires authentication)
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: 12,
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                    flex: 1,
                  }}
                >
                  {editingBookmark.odata_url}
                </Typography>
                <Tooltip title="Copy URL">
                  <IconButton
                    size="small"
                    onClick={() => navigator.clipboard.writeText(editingBookmark.odata_url || "")}
                  >
                    <MaterialSymbol icon="content_copy" size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveView}
            disabled={!viewName.trim()}
          >
            {editingBookmark ? "Update" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Section header helper                                              */
/* ------------------------------------------------------------------ */

function SectionHeader({
  label,
  icon,
  expanded,
  onToggle,
  count,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        py: 0.5,
        px: 0.5,
        cursor: "pointer",
        borderRadius: 1,
        userSelect: "none",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <MaterialSymbol
        icon={expanded ? "expand_more" : "chevron_right"}
        size={16}
        color="#666"
      />
      <MaterialSymbol icon={icon} size={16} color="#666" />
      <Typography variant="body2" fontWeight={600} fontSize={13} sx={{ flex: 1 }}>
        {label}
      </Typography>
      {count != null && count > 0 && (
        <Chip label={count} size="small" color="primary" sx={{ height: 18, fontSize: 11 }} />
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Bookmark list item helper                                          */
/* ------------------------------------------------------------------ */

function BookmarkListItem({
  bm,
  types,
  onApply,
  onEdit,
  onDelete,
}: {
  bm: Bookmark;
  types: CardType[];
  onApply: (bm: Bookmark) => void;
  onEdit?: (bm: Bookmark) => void;
  onDelete?: (bm: Bookmark) => void;
}) {
  const bmFilters = bm.filters as Record<string, unknown> | undefined;
  const bmTypes = (bmFilters?.types as string[]) || [];
  const matchedType = bmTypes.length === 1 ? types.find((t) => t.key === bmTypes[0]) : null;

  const visIcon = bm.visibility === "public" ? "public" : bm.visibility === "shared" ? "group" : null;

  return (
    <ListItemButton
      sx={{ py: 0.5, px: 1, borderRadius: 1 }}
      onClick={() => onApply(bm)}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        {matchedType ? (
          <MaterialSymbol icon={matchedType.icon} size={18} color={matchedType.color} />
        ) : (
          <MaterialSymbol icon="bookmark" size={18} color="#999" />
        )}
      </ListItemIcon>
      <ListItemText
        primary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" fontSize={14} noWrap sx={{ flex: 1 }}>
              {bm.name}
            </Typography>
            {visIcon && <MaterialSymbol icon={visIcon} size={13} color="#999" />}
            {bm.odata_enabled && <MaterialSymbol icon="cloud" size={13} color="#1976d2" />}
          </Box>
        }
        secondary={
          !bm.is_owner
            ? `by ${bm.owner_name || "Unknown"}`
            : matchedType
            ? matchedType.label
            : bmTypes.length > 1
            ? `${bmTypes.length} types`
            : "All types"
        }
        secondaryTypographyProps={{ fontSize: 12 }}
      />
      {(onEdit || onDelete) && (
        <Box
          sx={{ display: "flex", gap: 0.25, ml: 0.5 }}
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <IconButton size="small" onClick={() => onEdit(bm)} sx={{ p: 0.25 }}>
              <MaterialSymbol icon="edit" size={14} color="#999" />
            </IconButton>
          )}
          {onDelete && (
            <IconButton size="small" onClick={() => onDelete(bm)} sx={{ p: 0.25 }}>
              <MaterialSymbol icon="delete" size={14} color="#999" />
            </IconButton>
          )}
        </Box>
      )}
    </ListItemButton>
  );
}
