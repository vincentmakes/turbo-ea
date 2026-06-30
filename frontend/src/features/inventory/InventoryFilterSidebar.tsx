import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
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
import { useTypeLabel, useSubtypeLabel, useFieldLabel, useOptionLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type {
  CardType,
  Bookmark,
  ColumnLayoutItem,
  FieldDef,
  RelationType,
  TagGroup,
  User,
} from "@/types";

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
  tagIds: string[]; // selected tag ids (OR within a group, AND across groups)
  // Restricts the result to cards related to the current user. Currently only
  // `"stakeholder"` (cards the user holds at least one stakeholder role on)
  // is wired up — kept as a string union so we can add more scopes (creator,
  // both, …) without changing every call site.
  mineScope: "stakeholder" | null;
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
  tagGroups?: TagGroup[];
  canArchive?: boolean;
  canShareBookmarks?: boolean;
  canOdataBookmarks?: boolean;
  currentUserId?: string;
  selectedColumns: Set<string>;
  onSelectedColumnsChange: (cols: Set<string>) => void;
  defaultColumns?: Set<string>;
  onResetColumns?: () => void;
  // Current grid column layout (order/width/pinning), captured by InventoryPage.
  // Saved into a view's `column_state`; applied back via `onApplyColumnState`.
  columnState?: ColumnLayoutItem[];
  onApplyColumnState?: (state: ColumnLayoutItem[] | null) => void;
}

const APPROVAL_STATUS_OPTIONS = [
  { key: "DRAFT", tKey: "common:status.draft" as const, color: "#9e9e9e" },
  { key: "APPROVED", tKey: "common:status.approved" as const, color: "#4caf50" },
  { key: "BROKEN", tKey: "common:status.broken" as const, color: "#ff9800" },
  { key: "REJECTED", tKey: "common:status.rejected" as const, color: "#f44336" },
];

const LIFECYCLE_PHASES = [
  { key: "plan", tKey: "common:lifecycle.plan" as const, color: "#90a4ae" },
  { key: "phaseIn", tKey: "common:lifecycle.phaseIn" as const, color: "#42a5f5" },
  { key: "active", tKey: "common:lifecycle.active" as const, color: "#66bb6a" },
  { key: "phaseOut", tKey: "common:lifecycle.phaseOut" as const, color: "#ffa726" },
  { key: "endOfLife", tKey: "common:lifecycle.endOfLife" as const, color: "#ef5350" },
];

const DATA_QUALITY_THRESHOLDS = [
  { key: 80, tKey: "filter.dataQualityGood" as const, color: "#4caf50" },
  { key: 50, tKey: "filter.dataQualityMedium" as const, color: "#ff9800" },
  { key: 0, tKey: "filter.dataQualityPoor" as const, color: "#f44336" },
];

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

/**
 * Sentinel filter value that matches cards which have *no* value for a facet
 * (blank lifecycle, no subtype, empty attribute, no relation, untagged group).
 * Real option/subtype/relation keys are slugs / UUIDs / card names, so this
 * never collides. For tag groups it is scoped per group as
 * `${EMPTY_VALUE}:${groupId}` so "no tag from group A" and "from group B" stay
 * distinguishable inside the single flat `tagIds` array.
 */
export const EMPTY_VALUE = "__empty__";

/** Group-scoped empty token for tag filters. */
export const tagEmptyToken = (groupId: string) => `${EMPTY_VALUE}:${groupId}`;

/**
 * Flatten a card's tags to a plain searchable string (tag names joined).
 * Used as the AG Grid `filterValueGetter` for the Tags column: the cell value
 * is a `TagRef[]`, and AG Grid's default text filter would otherwise stringify
 * it to "[object Object]" and never match a typed tag name (issue #728).
 */
export function tagsToFilterText(tags?: { name: string }[]): string {
  return (tags || []).map((t) => t.name).join(", ");
}

/** True when a card value should count as "empty" for filtering purposes. */
export function valueIsEmpty(actual: unknown): boolean {
  return (
    actual === null ||
    actual === undefined ||
    actual === "" ||
    (Array.isArray(actual) && actual.length === 0)
  );
}

/**
 * Compute the next filter state when a card type is toggled on/off.
 *
 * Subtypes, custom attributes, and relationship filters are all type-specific
 * — they only make sense for the currently selected type(s) and their UI is
 * hidden once the selection no longer applies. They must therefore be reset on
 * every type change, otherwise a stale (and now-invisible) filter keeps being
 * applied client-side and silently empties the result list. See issue #686.
 */
export function filtersAfterTypeToggle(filters: Filters, key: string): Filters {
  const next = filters.types.includes(key)
    ? filters.types.filter((t) => t !== key)
    : [...filters.types, key];
  return { ...filters, types: next, subtypes: [], attributes: {}, relations: {} };
}

/* ------------------------------------------------------------------ */
/*  Sidebar UI persistence (active tab + applied view)                 */
/* ------------------------------------------------------------------ */

// Persisted separately from the grid config (InventoryPage's localStorage):
// this is purely sidebar UI state — which tab is open and which saved view is
// currently applied — so a page refresh restores the same view, shown active,
// on the same tab.
const SIDEBAR_LS_KEY = "turboea_inventory_sidebar";

interface SidebarPrefs {
  tab?: number;
  activeViewId?: string | null;
}

function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(SIDEBAR_LS_KEY);
    return raw ? (JSON.parse(raw) as SidebarPrefs) : {};
  } catch {
    return {};
  }
}

function saveSidebarPrefs(prefs: SidebarPrefs) {
  try {
    localStorage.setItem(SIDEBAR_LS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

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
  tagGroups = [],
  canArchive = false,
  canShareBookmarks = false,
  canOdataBookmarks = false,
  currentUserId,
  selectedColumns,
  onSelectedColumnsChange,
  defaultColumns,
  onResetColumns,
  columnState,
  onApplyColumnState,
}: Props) {
  const { t } = useTranslation(["inventory", "common"]);
  const typeLabel = useTypeLabel();
  const stLabel = useSubtypeLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const sidebarPrefsRef = useRef(loadSidebarPrefs());
  const [tab, setTab] = useState(() => sidebarPrefsRef.current.tab ?? 0);
  // Which saved view is currently applied (highlighted in the list). Persisted
  // so a refresh keeps showing the same view as active.
  const [activeViewId, setActiveViewId] = useState<string | null>(
    () => sidebarPrefsRef.current.activeViewId ?? null,
  );

  // Persist active tab + applied view across refreshes.
  useEffect(() => {
    saveSidebarPrefs({ tab, activeViewId });
  }, [tab, activeViewId]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    types: true,
    search: true,
    subtypes: false,
    lifecycle: false,
    dataQuality: false,
    approvalStatus: false,
    attributes: false,
    relationships: false,
    tags: false,
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
    onFiltersChange(filtersAfterTypeToggle(filters, key));
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
    onFiltersChange({ types: [], search: "", subtypes: [], lifecyclePhases: [], dataQualityMin: null, approvalStatuses: [], showArchived: false, attributes: {}, relations: {}, tagIds: [], mineScope: null });

  const activeCount =
    filters.types.length +
    (filters.search ? 1 : 0) +
    filters.subtypes.length +
    filters.lifecyclePhases.length +
    (filters.dataQualityMin !== null ? 1 : 0) +
    filters.approvalStatuses.length +
    (filters.showArchived ? 1 : 0) +
    Object.keys(filters.attributes).length +
    Object.keys(filters.relations || {}).length +
    (filters.tagIds?.length ?? 0) +
    (filters.mineScope ? 1 : 0);

  // Check if columns differ from default
  const columnsChanged = useMemo(() => {
    if (!defaultColumns || defaultColumns.size === 0) return false;
    if (selectedColumns.size !== defaultColumns.size) return true;
    for (const k of defaultColumns) {
      if (!selectedColumns.has(k)) return true;
    }
    return false;
  }, [selectedColumns, defaultColumns]);

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
        tagIds: filters.tagIds,
        mineScope: filters.mineScope,
      },
      columns: Array.from(selectedColumns),
      column_state: columnState ?? null,
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
        tagIds: f.tagIds || [],
        mineScope: f.mineScope ?? null,
      });
    }
    // Restore saved columns if present
    const bmColumns = (bm as unknown as Record<string, unknown>).columns as string[] | undefined;
    if (bmColumns && Array.isArray(bmColumns)) {
      onSelectedColumnsChange(new Set(bmColumns));
    }
    // Restore the saved column layout (order/width/pinning). Applied after the
    // visibility set above so the grid's columnDefs have rebuilt first.
    if (onApplyColumnState) {
      const layout = (bm.column_state as ColumnLayoutItem[] | undefined) ?? null;
      onApplyColumnState(layout && layout.length > 0 ? layout : null);
    }
    // Mark this view active so it stays highlighted (and survives a refresh).
    setActiveViewId(bm.id);
    // Stay on the Views tab so the user can switch between views quickly.
  };

  const handleDeleteView = async (bm: Bookmark) => {
    await api.delete(`/bookmarks/${bm.id}`);
    if (activeViewId === bm.id) setActiveViewId(null);
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
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={t("filter.expand")} placement="right">
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
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "action.hover",
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
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{
              minHeight: 36,
              "& .MuiTab-root": { minHeight: 36, py: 0, textTransform: "none", fontSize: 14, minWidth: 0 },
            }}
          >
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {t("filter.title")}
                  {activeCount > 0 && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "primary.main",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {t("columns.title")}
                  {columnsChanged && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "primary.main",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
              }
            />
            <Tab label={t("views.title")} />
          </Tabs>
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {tab === 0 ? (
            /* ====================== FILTERS TAB ====================== */
            <>
              {/* Search */}
              <SectionHeader
                label={t("common:actions.search")}
                icon="search"
                expanded={expandedSections.search}
                onToggle={() => toggleSection("search")}
              />
              <Collapse in={expandedSections.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("filter.searchPlaceholder")}
                  value={filters.search}
                  onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                  sx={{ mb: 2 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <MaterialSymbol icon="search" size={16} />
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

              {/* Scope: only cards I'm a stakeholder on */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  mb: 1.5,
                  borderRadius: 1,
                  bgcolor: filters.mineScope === "stakeholder" ? "action.selected" : "transparent",
                }}
              >
                <MaterialSymbol icon="person" size={16} />
                <FormControlLabel
                  sx={{ flex: 1, mr: 0, ml: 0.5 }}
                  control={
                    <Switch
                      size="small"
                      checked={filters.mineScope === "stakeholder"}
                      onChange={(e) =>
                        onFiltersChange({
                          ...filters,
                          mineScope: e.target.checked ? "stakeholder" : null,
                        })
                      }
                    />
                  }
                  label={
                    <Tooltip title={t("filter.mineStakeholderHint") as string}>
                      <Typography variant="body2">
                        {t("filter.mineStakeholder")}
                      </Typography>
                    </Tooltip>
                  }
                  labelPlacement="start"
                />
              </Box>

              {/* Card Types */}
              <SectionHeader
                label={t("filter.types")}
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
                          primary={typeLabel(t)}
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
                    label={t("filter.subtypes")}
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
                          label={stLabel(st)}
                          size="small"
                          onClick={() => toggleSubtype(st.key)}
                          variant={filters.subtypes.includes(st.key) ? "filled" : "outlined"}
                          color={filters.subtypes.includes(st.key) ? "primary" : "default"}
                        />
                      ))}
                      <EmptyChip
                        label={t("filter.emptyValue")}
                        selected={filters.subtypes.includes(EMPTY_VALUE)}
                        onClick={() => toggleSubtype(EMPTY_VALUE)}
                      />
                    </Box>
                  </Collapse>
                </>
              )}

              {/* Approval Status */}
              <SectionHeader
                label={t("filter.approvalStatus")}
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
                      label={t(s.tKey)}
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
                label={t("filter.lifecycle")}
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
                      label={t(p.tKey)}
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
                  <EmptyChip
                    label={t("filter.emptyValue")}
                    selected={filters.lifecyclePhases.includes(EMPTY_VALUE)}
                    onClick={() => toggleLifecyclePhase(EMPTY_VALUE)}
                  />
                </Box>
              </Collapse>

              {/* Data Quality */}
              <SectionHeader
                label={t("filter.dataQuality")}
                icon="bar_chart"
                expanded={expandedSections.dataQuality}
                onToggle={() => toggleSection("dataQuality")}
                count={filters.dataQualityMin !== null ? 1 : 0}
              />
              <Collapse in={expandedSections.dataQuality}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                  {DATA_QUALITY_THRESHOLDS.map((dq) => (
                    <Chip
                      key={dq.key}
                      label={t(dq.tKey)}
                      size="small"
                      onClick={() => onFiltersChange({ ...filters, dataQualityMin: filters.dataQualityMin === dq.key ? null : dq.key })}
                      variant={filters.dataQualityMin === dq.key ? "filled" : "outlined"}
                      sx={
                        filters.dataQualityMin === dq.key
                          ? { bgcolor: dq.color, color: "#fff", borderColor: dq.color }
                          : { borderColor: dq.color, color: dq.color }
                      }
                    />
                  ))}
                </Box>
              </Collapse>

              {/* Attribute Filters (only when single type selected) */}
              {attributeFields.length > 0 && (
                <>
                  <SectionHeader
                    label={t("filter.attributes")}
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
                            ? field.options.filter((o) => optLabel(o).toLowerCase().includes(searchTerm))
                            : field.options;
                          return (
                            <FormControl key={field.key} size="small" fullWidth>
                              <InputLabel sx={{ fontSize: 14 }}>{fieldLabel(field)}</InputLabel>
                              <Select
                                multiple
                                value={Array.isArray(selected) ? selected : []}
                                label={fieldLabel(field)}
                                onChange={(e) => setAttr(field.key, e.target.value as string[])}
                                onClose={() => setDropdownSearch((s) => ({ ...s, [field.key]: "" }))}
                                sx={{ fontSize: 14 }}
                                MenuProps={{ autoFocus: false, PaperProps: { sx: { maxHeight: 300 } } }}
                                renderValue={(vals) => (
                                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25 }}>
                                    {(vals as string[]).map((v) => {
                                      const opt = optionMap.get(v);
                                      const isEmpty = v === EMPTY_VALUE;
                                      return (
                                        <Chip
                                          key={v}
                                          label={isEmpty ? t("filter.emptyValue") : opt ? optLabel(opt) : v}
                                          size="small"
                                          sx={{
                                            height: 20, fontSize: 12,
                                            ...(isEmpty ? { fontStyle: "italic" } : {}),
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
                                    placeholder={t("filter.searchEllipsis")}
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
                                {(!searchTerm || t("filter.emptyValue").toLowerCase().includes(searchTerm)) && (
                                  <MenuItem value={EMPTY_VALUE}>
                                    <Checkbox size="small" checked={selected.includes(EMPTY_VALUE)} sx={{ p: 0, mr: 1 }} />
                                    <Typography variant="body2" sx={{ fontSize: 14, fontStyle: "italic" }}>
                                      {t("filter.emptyValue")}
                                    </Typography>
                                  </MenuItem>
                                )}
                                {filteredOpts.map((opt) => (
                                  <MenuItem key={opt.key} value={opt.key}>
                                    <Checkbox size="small" checked={selected.includes(opt.key)} sx={{ p: 0, mr: 1 }} />
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                      {opt.color && (
                                        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: opt.color }} />
                                      )}
                                      {optLabel(opt)}
                                    </Box>
                                  </MenuItem>
                                ))}
                                {filteredOpts.length === 0 && (
                                  <MenuItem disabled>
                                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 14 }}>
                                      {t("filter.noMatches")}
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
                              <InputLabel sx={{ fontSize: 14 }}>{fieldLabel(field)}</InputLabel>
                              <Select
                                value={(filters.attributes[field.key] as string) ?? ""}
                                label={fieldLabel(field)}
                                onChange={(e) => setAttr(field.key, e.target.value as string)}
                                sx={{ fontSize: 14 }}
                              >
                                <MenuItem value=""><em>{t("filter.any")}</em></MenuItem>
                                <MenuItem value="true">{t("common:labels.yes")}</MenuItem>
                                <MenuItem value="false">{t("common:labels.no")}</MenuItem>
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
                              label={fieldLabel(field)}
                              placeholder={t("filter.minValue")}
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
                            label={fieldLabel(field)}
                            type={field.type === "date" ? "date" : "text"}
                            placeholder={field.type === "date" ? "" : t("filter.contains")}
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
                    label={t("filter.relationships")}
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
                        const label = otherType ? typeLabel(otherType) : otherTypeKey;
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
                                      label={v === EMPTY_VALUE ? t("filter.emptyValue") : v}
                                      size="small"
                                      sx={{ height: 20, fontSize: 12, ...(v === EMPTY_VALUE ? { fontStyle: "italic" } : {}) }}
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
                              {(!searchTerm || t("filter.emptyValue").toLowerCase().includes(searchTerm)) && (
                                <MenuItem value={EMPTY_VALUE}>
                                  <Checkbox size="small" checked={selected.includes(EMPTY_VALUE)} sx={{ p: 0, mr: 1 }} />
                                  <Typography variant="body2" sx={{ fontSize: 14, fontStyle: "italic" }}>
                                    {t("filter.emptyValue")}
                                  </Typography>
                                </MenuItem>
                              )}
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
                                    {t("filter.noMatches")}
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

              {/* Tag filters (scoped by restrict_to_types when a single type is selected) */}
              {(() => {
                const applicableGroups = tagGroups.filter((g) => {
                  if (!g.restrict_to_types || g.restrict_to_types.length === 0) return true;
                  if (filters.types.length !== 1) return true;
                  return g.restrict_to_types.includes(filters.types[0]);
                }).filter((g) => g.tags.length > 0);
                if (applicableGroups.length === 0) return null;

                const selectedIds = new Set(filters.tagIds || []);
                const setGroupSelection = (groupId: string, next: string[]) => {
                  const group = applicableGroups.find((g) => g.id === groupId);
                  if (!group) return;
                  const groupIds = new Set(group.tags.map((tg) => tg.id));
                  const emptyTok = tagEmptyToken(groupId);
                  // Drop this group's own ids (and its empty token) before re-adding the new selection.
                  const kept = (filters.tagIds || []).filter((id) => !groupIds.has(id) && id !== emptyTok);
                  onFiltersChange({ ...filters, tagIds: [...kept, ...next] });
                };

                return (
                  <>
                    <SectionHeader
                      label={t("filter.tags")}
                      icon="sell"
                      expanded={expandedSections.tags}
                      onToggle={() => toggleSection("tags")}
                      count={(filters.tagIds || []).length}
                    />
                    <Collapse in={expandedSections.tags}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 2, px: 0.5 }}>
                        {applicableGroups.map((group) => {
                          const emptyTok = tagEmptyToken(group.id);
                          const groupSelected = [
                            ...(selectedIds.has(emptyTok) ? [emptyTok] : []),
                            ...group.tags.filter((tg) => selectedIds.has(tg.id)).map((tg) => tg.id),
                          ];
                          const searchKey = `tag_${group.id}`;
                          const searchTerm = (dropdownSearch[searchKey] || "").toLowerCase();
                          const filteredTags = searchTerm
                            ? group.tags.filter((tg) => tg.name.toLowerCase().includes(searchTerm))
                            : group.tags;
                          return (
                            <FormControl key={group.id} size="small" fullWidth>
                              <InputLabel sx={{ fontSize: 14 }}>{group.name}</InputLabel>
                              <Select
                                multiple
                                value={groupSelected}
                                label={group.name}
                                onChange={(e) => setGroupSelection(group.id, e.target.value as string[])}
                                onClose={() => setDropdownSearch((s) => ({ ...s, [searchKey]: "" }))}
                                sx={{ fontSize: 14 }}
                                MenuProps={{ autoFocus: false, PaperProps: { sx: { maxHeight: 300 } } }}
                                renderValue={(vals) => (
                                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25 }}>
                                    {(vals as string[]).map((id) => {
                                      const isEmpty = id === emptyTok;
                                      const tag = isEmpty ? null : group.tags.find((tg) => tg.id === id);
                                      if (!isEmpty && !tag) return null;
                                      return (
                                        <Chip
                                          key={id}
                                          label={isEmpty ? t("filter.emptyValue") : tag!.name}
                                          size="small"
                                          sx={{
                                            height: 20,
                                            fontSize: 12,
                                            ...(isEmpty ? { fontStyle: "italic" } : {}),
                                            ...(tag?.color ? { bgcolor: tag.color, color: "#fff" } : {}),
                                          }}
                                          onDelete={() =>
                                            setGroupSelection(
                                              group.id,
                                              groupSelected.filter((s) => s !== id),
                                            )
                                          }
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
                                {(!searchTerm || t("filter.emptyValue").toLowerCase().includes(searchTerm)) && (
                                  <MenuItem value={emptyTok}>
                                    <Checkbox size="small" checked={selectedIds.has(emptyTok)} sx={{ p: 0, mr: 1 }} />
                                    <Typography variant="body2" sx={{ fontSize: 14, fontStyle: "italic" }}>
                                      {t("filter.emptyValue")}
                                    </Typography>
                                  </MenuItem>
                                )}
                                {filteredTags.map((tag) => (
                                  <MenuItem key={tag.id} value={tag.id}>
                                    <Checkbox size="small" checked={groupSelected.includes(tag.id)} sx={{ p: 0, mr: 1 }} />
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                      {tag.color && (
                                        <Box
                                          sx={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: "50%",
                                            bgcolor: tag.color,
                                            flexShrink: 0,
                                          }}
                                        />
                                      )}
                                      {tag.name}
                                    </Box>
                                  </MenuItem>
                                ))}
                                {filteredTags.length === 0 && (
                                  <MenuItem disabled>
                                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 14 }}>
                                      {t("filter.noMatches")}
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
                );
              })()}

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
                        <MaterialSymbol icon="archive" size={16} />
                        <Typography variant="body2" fontSize={13}>{t("filter.showArchivedOnly")}</Typography>
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
                    {t("filter.clearAll", { count: activeCount })}
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  onClick={openCreateDialog}
                  startIcon={<MaterialSymbol icon="bookmark_add" size={16} />}
                  sx={{ textTransform: "none", fontSize: 13, ml: "auto" }}
                >
                  {t("views.saveView")}
                </Button>
              </Box>
            </>
          ) : tab === 1 ? (
            /* ====================== COLUMNS TAB ====================== */
            <ColumnsTab
              types={types}
              filters={filters}
              selectedColumns={selectedColumns}
              onSelectedColumnsChange={onSelectedColumnsChange}
              relevantRelTypes={relevantRelTypes}
              onResetColumns={onResetColumns}
              columnsChanged={columnsChanged}
              t={t}
            />
          ) : (
            /* ====================== VIEWS TAB ====================== */
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
                  {t("views.savedViews")}
                </Typography>
                <Button
                  size="small"
                  onClick={openCreateDialog}
                  startIcon={<MaterialSymbol icon="add" size={16} />}
                  sx={{ textTransform: "none", fontSize: 13 }}
                >
                  {t("views.saveCurrent")}
                </Button>
              </Box>

              {bookmarks.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 4, fontSize: 14 }}
                >
                  {t("views.noSavedViews")}
                  <br />
                  {t("views.noSavedViewsHint")}
                </Typography>
              ) : (
                <>
                  {/* My Views */}
                  {myViews.length > 0 && (
                    <>
                      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 11, px: 0.5 }}>
                        {t("views.myViews")}
                      </Typography>
                      <List dense disablePadding sx={{ mb: 1 }}>
                        {myViews.map((bm) => (
                          <BookmarkListItem
                            key={bm.id}
                            bm={bm}
                            types={types}
                            active={bm.id === activeViewId}
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
                        {t("views.sharedWithMe")}
                      </Typography>
                      <List dense disablePadding sx={{ mb: 1 }}>
                        {sharedViews.map((bm) => (
                          <BookmarkListItem
                            key={bm.id}
                            bm={bm}
                            types={types}
                            active={bm.id === activeViewId}
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
                        {t("views.public")}
                      </Typography>
                      <List dense disablePadding>
                        {publicViews.map((bm) => (
                          <BookmarkListItem
                            key={bm.id}
                            bm={bm}
                            types={types}
                            active={bm.id === activeViewId}
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
          {editingBookmark ? t("views.editView") : t("views.saveCurrentView")}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t("views.viewName")}
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && viewName.trim()) handleSaveView();
            }}
          />
          {!editingBookmark && activeCount > 0 && (
            <Typography variant="caption" color="text.secondary">
              {t("views.saveActiveFilters", { count: activeCount })}
            </Typography>
          )}

          {/* Visibility — only shown when user has bookmarks.share permission */}
          {canShareBookmarks && (
            <TextField
              select
              label={t("views.visibility")}
              value={dialogVisibility}
              onChange={(e) => setDialogVisibility(e.target.value as "private" | "public" | "shared")}
              fullWidth
              size="small"
              disabled={editingBookmark != null && !editingBookmark.is_owner}
            >
              <MenuItem value="private">
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol icon="lock" size={16} />
                  {t("views.visibilityPrivate")}
                </Box>
              </MenuItem>
              <MenuItem value="public">
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol icon="public" size={16} />
                  {t("views.visibilityPublic")}
                </Box>
              </MenuItem>
              <MenuItem value="shared">
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol icon="group" size={16} />
                  {t("views.visibilityShared")}
                </Box>
              </MenuItem>
            </TextField>
          )}

          {/* User picker when shared */}
          {canShareBookmarks && dialogVisibility === "shared" && (
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
                  <TextField {...params} label={t("views.shareWith")} size="small" placeholder={t("views.searchUsers")} />
                )}
                size="small"
                disabled={editingBookmark != null && !editingBookmark.is_owner}
              />

              {/* Can-edit toggles per shared user */}
              {dialogSharedWith.length > 0 && (
                <Box sx={{ pl: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                    {t("views.permissionsHint")}
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
                          {t("views.userCanEdit", { name: u.display_name })}
                        </Typography>
                      }
                      sx={{ ml: 0 }}
                    />
                  ))}
                </Box>
              )}
            </>
          )}

          {/* OData toggle — only shown when user has bookmarks.odata permission */}
          {canOdataBookmarks && (
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
                  <MaterialSymbol icon="cloud" size={16} />
                  <Typography variant="body2" fontSize={13}>{t("views.enableOdata")}</Typography>
                </Box>
              }
              sx={{ ml: 0 }}
            />
          )}
          {canOdataBookmarks && dialogOdata && editingBookmark?.odata_url && (
            <Box sx={{ bgcolor: "action.selected", borderRadius: 1, p: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {t("views.odataFeedUrl")}
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
                <Tooltip title={t("views.copyUrl")}>
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
          <Button onClick={() => setSaveDialogOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleSaveView}
            disabled={!viewName.trim()}
          >
            {editingBookmark ? t("views.update") : t("common:actions.save")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  "(empty)" chip helper — matches cards with no value for a facet     */
/* ------------------------------------------------------------------ */

function EmptyChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Chip
      label={label}
      size="small"
      onClick={onClick}
      variant={selected ? "filled" : "outlined"}
      sx={
        selected
          ? { bgcolor: "text.secondary", color: "background.paper", fontStyle: "italic" }
          : { borderColor: "divider", color: "text.secondary", fontStyle: "italic" }
      }
    />
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
      />
      <MaterialSymbol icon={icon} size={16} />
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
  active = false,
}: {
  bm: Bookmark;
  types: CardType[];
  onApply: (bm: Bookmark) => void;
  onEdit?: (bm: Bookmark) => void;
  onDelete?: (bm: Bookmark) => void;
  active?: boolean;
}) {
  const { t } = useTranslation(["inventory", "common"]);
  const typeLabel = useTypeLabel();
  const bmFilters = bm.filters as Record<string, unknown> | undefined;
  const bmTypes = (bmFilters?.types as string[]) || [];
  const matchedType = bmTypes.length === 1 ? types.find((t) => t.key === bmTypes[0]) : null;

  const visIcon = bm.visibility === "public" ? "public" : bm.visibility === "shared" ? "group" : null;

  return (
    <ListItemButton
      selected={active}
      sx={{ py: 0.5, px: 1, borderRadius: 1 }}
      onClick={() => onApply(bm)}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        {matchedType ? (
          <MaterialSymbol icon={matchedType.icon} size={18} color={matchedType.color} />
        ) : (
          <MaterialSymbol icon="bookmark" size={18} />
        )}
      </ListItemIcon>
      <ListItemText
        primary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" fontSize={14} noWrap sx={{ flex: 1 }}>
              {bm.name}
            </Typography>
            {visIcon && <MaterialSymbol icon={visIcon} size={13} />}
            {bm.odata_enabled && <MaterialSymbol icon="cloud" size={13} color="#1976d2" />}
          </Box>
        }
        secondary={
          !bm.is_owner
            ? t("inventory:views.byOwner", { name: bm.owner_name || t("inventory:views.unknown") })
            : matchedType
            ? typeLabel(matchedType)
            : bmTypes.length > 1
            ? t("inventory:views.nTypes", { count: bmTypes.length })
            : t("inventory:views.allTypes")
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
              <MaterialSymbol icon="edit" size={14} />
            </IconButton>
          )}
          {onDelete && (
            <IconButton size="small" onClick={() => onDelete(bm)} sx={{ p: 0.25 }}>
              <MaterialSymbol icon="delete" size={14} />
            </IconButton>
          )}
        </Box>
      )}
    </ListItemButton>
  );
}

/* ------------------------------------------------------------------ */
/*  Columns tab component                                              */
/* ------------------------------------------------------------------ */

const METADATA_COLUMNS = [
  { key: "meta_created_at", icon: "schedule", tKey: "columns.createdAt" as const },
  { key: "meta_updated_at", icon: "update", tKey: "columns.updatedAt" as const },
  { key: "meta_created_by", icon: "person_add", tKey: "columns.createdBy" as const },
  { key: "meta_updated_by", icon: "person", tKey: "columns.updatedBy" as const },
];

// Default-visible "core" columns that are always rendered by the grid unless
// explicitly hidden via the column selector. These keys live in
// `selectedColumns` alongside attribute/relation/meta keys; the InventoryPage
// `columnDefs` memo applies `hide: !selectedColumns.has(key)` for each.
// The labels below are i18n keys, namespace-prefixed where applicable.
export const CORE_COLUMNS = [
  { key: "core_type", icon: "category", tKey: "common:labels.type" as const },
  { key: "core_name", icon: "label", tKey: "common:labels.name" as const },
  { key: "core_path", icon: "account_tree", tKey: "columns.path" as const },
  { key: "core_description", icon: "description", tKey: "common:labels.description" as const },
  { key: "core_subtype", icon: "subdirectory_arrow_right", tKey: "common:labels.subtype" as const },
  { key: "core_lifecycle", icon: "timeline", tKey: "columns.lifecycle" as const },
  { key: "core_approval_status", icon: "verified", tKey: "columns.approvalStatus" as const },
  { key: "core_data_quality", icon: "donut_small", tKey: "columns.dataQuality" as const },
  { key: "core_tags", icon: "sell", tKey: "columns.tags" as const },
];

export const CORE_COLUMN_KEYS = CORE_COLUMNS.map((c) => c.key);

// Columns that must always be visible — deselecting them broke the inventory
// in subtle ways (no way to identify rows, broken keyboard navigation, etc.).
// These render as checked + disabled in the column picker.
export const LOCKED_COLUMN_KEYS: ReadonlySet<string> = new Set([
  "core_type",
  "core_name",
]);

function ColumnsTab({
  types,
  filters,
  selectedColumns,
  onSelectedColumnsChange,
  relevantRelTypes,
  onResetColumns,
  columnsChanged,
  t,
}: {
  types: CardType[];
  filters: Filters;
  selectedColumns: Set<string>;
  onSelectedColumnsChange: (cols: Set<string>) => void;
  relevantRelTypes: RelationType[];
  onResetColumns?: () => void;
  columnsChanged?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    defaults: true,
    metadata: true,
    attributes: true,
    relations: true,
  });

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleColumn = (key: string) => {
    if (LOCKED_COLUMN_KEYS.has(key)) return;
    const next = new Set(selectedColumns);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onSelectedColumnsChange(next);
  };

  const toggleAll = (keys: string[], checked: boolean) => {
    const next = new Set(selectedColumns);
    for (const k of keys) {
      if (checked) next.add(k);
      else if (!LOCKED_COLUMN_KEYS.has(k)) next.delete(k);
    }
    onSelectedColumnsChange(next);
  };

  // Compute available attribute fields based on selected types
  const attributeFields = useMemo(() => {
    const selectedTypes = filters.types.length > 0
      ? types.filter((ct) => filters.types.includes(ct.key))
      : [];

    if (selectedTypes.length === 0) return [];

    if (selectedTypes.length === 1) {
      // Single type: show all fields
      const fields: FieldDef[] = [];
      for (const section of selectedTypes[0].fields_schema) {
        for (const f of section.fields) {
          fields.push(f);
        }
      }
      return fields;
    }

    // Multiple types: show only common fields (by key)
    const fieldMaps = selectedTypes.map((ct) => {
      const map = new Map<string, FieldDef>();
      for (const section of ct.fields_schema) {
        for (const f of section.fields) {
          map.set(f.key, f);
        }
      }
      return map;
    });

    const firstMap = fieldMaps[0];
    const common: FieldDef[] = [];
    for (const [key, field] of firstMap) {
      if (fieldMaps.every((m) => m.has(key))) {
        common.push(field);
      }
    }
    return common;
  }, [types, filters.types]);

  // Filter items by search query
  const lowerSearch = searchQuery.toLowerCase();
  // Subtype is meaningful only when a single type with subtypes is selected;
  // hide it from the selector otherwise so users don't toggle a non-existent
  // column. All other core keys are universal.
  const singleTypeWithSubtypes =
    filters.types.length === 1
      ? types.find((ct) => ct.key === filters.types[0])?.subtypes?.length ?? 0
      : 0;
  const filteredCore = CORE_COLUMNS.filter((c) => {
    if (c.key === "core_subtype" && !singleTypeWithSubtypes) return false;
    if (searchQuery && !t(c.tKey).toLowerCase().includes(lowerSearch)) return false;
    return true;
  });
  const filteredMeta = METADATA_COLUMNS.filter(
    (m) => !searchQuery || t(m.tKey).toLowerCase().includes(lowerSearch),
  );
  const filteredAttrs = attributeFields.filter(
    (f) => !searchQuery || fieldLabel(f).toLowerCase().includes(lowerSearch),
  );
  const filteredRels = relevantRelTypes.filter((rt) => {
    if (!searchQuery) return true;
    const isSource = rt.source_type_key === (filters.types.length === 1 ? filters.types[0] : "");
    const otherKey = isSource ? rt.target_type_key : rt.source_type_key;
    const otherType = types.find((ct) => ct.key === otherKey);
    const label = otherType
      ? typeLabel(otherType)
      : otherKey;
    return label.toLowerCase().includes(lowerSearch);
  });

  const coreKeys = filteredCore.map((c) => c.key);
  const allCoreChecked = coreKeys.length > 0 && coreKeys.every((k) => selectedColumns.has(k));
  const someCoreChecked = coreKeys.some((k) => selectedColumns.has(k));
  const metaKeys = filteredMeta.map((m) => m.key);
  const attrKeys = filteredAttrs.map((f) => `attr_${f.key}`);
  const relKeys = filteredRels.map((rt) => {
    const selType = filters.types.length === 1 ? filters.types[0] : "";
    const isSource = rt.source_type_key === selType;
    return `rel_${isSource ? rt.target_type_key : rt.source_type_key}`;
  });

  const allMetaChecked = metaKeys.length > 0 && metaKeys.every((k) => selectedColumns.has(k));
  const someMetaChecked = metaKeys.some((k) => selectedColumns.has(k));
  const allAttrChecked = attrKeys.length > 0 && attrKeys.every((k) => selectedColumns.has(k));
  const someAttrChecked = attrKeys.some((k) => selectedColumns.has(k));
  const allRelChecked = relKeys.length > 0 && relKeys.every((k) => selectedColumns.has(k));
  const someRelChecked = relKeys.some((k) => selectedColumns.has(k));

  const totalSelected = selectedColumns.size;

  return (
    <>
      {/* Search */}
      <TextField
        size="small"
        fullWidth
        placeholder={t("columns.searchPlaceholder")}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        sx={{ mb: 1.5 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <MaterialSymbol icon="search" size={16} />
            </InputAdornment>
          ),
          ...(searchQuery
            ? {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery("")} sx={{ p: 0.25 }}>
                      <MaterialSymbol icon="close" size={14} />
                    </IconButton>
                  </InputAdornment>
                ),
              }
            : {}),
        }}
      />

      {filters.types.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2, fontSize: 13 }}>
          {t("columns.selectTypeHint")}
        </Typography>
      )}

      {/* Selected count + reset/clear */}
      {(totalSelected > 0 || columnsChanged) && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {t("columns.selectedCount", { count: totalSelected })}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {columnsChanged && onResetColumns && (
              <Button
                size="small"
                onClick={onResetColumns}
                startIcon={<MaterialSymbol icon="restart_alt" size={14} />}
                sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1 }}
              >
                {t("columns.reset")}
              </Button>
            )}
            <Button
              size="small"
              onClick={() => onSelectedColumnsChange(new Set(LOCKED_COLUMN_KEYS))}
              sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1 }}
            >
              {t("columns.clearAll")}
            </Button>
          </Box>
        </Box>
      )}

      {/* Default (always-visible) columns section */}
      {filteredCore.length > 0 && (
        <>
          <SectionHeader
            label={t("columns.defaults")}
            icon="grid_view"
            expanded={expandedSections.defaults}
            onToggle={() => toggleSection("defaults")}
            count={coreKeys.filter((k) => selectedColumns.has(k)).length}
          />
          <Collapse in={expandedSections.defaults}>
            <List dense disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                sx={{ py: 0.25, px: 0.5, borderRadius: 1 }}
                onClick={() => toggleAll(coreKeys, !allCoreChecked)}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Checkbox
                    size="small"
                    checked={allCoreChecked}
                    indeterminate={someCoreChecked && !allCoreChecked}
                    sx={{ p: 0 }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="body2" fontSize={13} fontWeight={500} fontStyle="italic">
                      {t("columns.selectAll")}
                    </Typography>
                  }
                />
              </ListItemButton>
              {filteredCore.map((c) => {
                const locked = LOCKED_COLUMN_KEYS.has(c.key);
                const row = (
                  <ListItemButton
                    key={c.key}
                    disabled={locked}
                    sx={{
                      py: 0.25,
                      px: 0.5,
                      borderRadius: 1,
                      // MUI greys out disabled buttons; bump opacity slightly so
                      // the locked rows remain readable while signalling they
                      // can't be toggled.
                      ...(locked ? { "&.Mui-disabled": { opacity: 0.7 } } : {}),
                    }}
                    onClick={() => toggleColumn(c.key)}
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <Checkbox
                        size="small"
                        checked={locked ? true : selectedColumns.has(c.key)}
                        disabled={locked}
                        sx={{ p: 0 }}
                      />
                    </ListItemIcon>
                    <ListItemIcon sx={{ minWidth: 24 }}>
                      <MaterialSymbol icon={c.icon} size={16} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontSize={13}>
                          {t(c.tKey)}
                        </Typography>
                      }
                    />
                  </ListItemButton>
                );
                return locked ? (
                  <Tooltip
                    key={c.key}
                    title={t("columns.alwaysVisible")}
                    placement="right"
                  >
                    <span>{row}</span>
                  </Tooltip>
                ) : (
                  row
                );
              })}
            </List>
          </Collapse>
        </>
      )}

      {/* Metadata section */}
      {filteredMeta.length > 0 && (
        <>
          <SectionHeader
            label={t("columns.metadata")}
            icon="info"
            expanded={expandedSections.metadata}
            onToggle={() => toggleSection("metadata")}
            count={metaKeys.filter((k) => selectedColumns.has(k)).length}
          />
          <Collapse in={expandedSections.metadata}>
            <List dense disablePadding sx={{ mb: 1 }}>
              {/* Select all metadata */}
              <ListItemButton
                sx={{ py: 0.25, px: 0.5, borderRadius: 1 }}
                onClick={() => toggleAll(metaKeys, !allMetaChecked)}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Checkbox
                    size="small"
                    checked={allMetaChecked}
                    indeterminate={someMetaChecked && !allMetaChecked}
                    sx={{ p: 0 }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="body2" fontSize={13} fontWeight={500} fontStyle="italic">
                      {t("columns.selectAll")}
                    </Typography>
                  }
                />
              </ListItemButton>
              {filteredMeta.map((m) => (
                <ListItemButton
                  key={m.key}
                  sx={{ py: 0.25, px: 0.5, borderRadius: 1 }}
                  onClick={() => toggleColumn(m.key)}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox size="small" checked={selectedColumns.has(m.key)} sx={{ p: 0 }} />
                  </ListItemIcon>
                  <ListItemIcon sx={{ minWidth: 24 }}>
                    <MaterialSymbol icon={m.icon} size={16} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body2" fontSize={13}>
                        {t(m.tKey)}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>
        </>
      )}

      {/* Attribute fields section */}
      {filteredAttrs.length > 0 && (
        <>
          <SectionHeader
            label={t("columns.attributes")}
            icon="tune"
            expanded={expandedSections.attributes}
            onToggle={() => toggleSection("attributes")}
            count={attrKeys.filter((k) => selectedColumns.has(k)).length}
          />
          <Collapse in={expandedSections.attributes}>
            <List dense disablePadding sx={{ mb: 1 }}>
              {/* Select all attributes */}
              <ListItemButton
                sx={{ py: 0.25, px: 0.5, borderRadius: 1 }}
                onClick={() => toggleAll(attrKeys, !allAttrChecked)}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Checkbox
                    size="small"
                    checked={allAttrChecked}
                    indeterminate={someAttrChecked && !allAttrChecked}
                    sx={{ p: 0 }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="body2" fontSize={13} fontWeight={500} fontStyle="italic">
                      {t("columns.selectAll")}
                    </Typography>
                  }
                />
              </ListItemButton>
              {filteredAttrs.map((f) => (
                <ListItemButton
                  key={f.key}
                  sx={{ py: 0.25, px: 0.5, borderRadius: 1 }}
                  onClick={() => toggleColumn(`attr_${f.key}`)}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox size="small" checked={selectedColumns.has(`attr_${f.key}`)} sx={{ p: 0 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body2" fontSize={13}>
                        {fieldLabel(f)}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>
        </>
      )}

      {/* Relation columns section */}
      {filteredRels.length > 0 && (
        <>
          <SectionHeader
            label={t("columns.relations")}
            icon="link"
            expanded={expandedSections.relations}
            onToggle={() => toggleSection("relations")}
            count={relKeys.filter((k) => selectedColumns.has(k)).length}
          />
          <Collapse in={expandedSections.relations}>
            <List dense disablePadding sx={{ mb: 1 }}>
              {/* Select all relations */}
              <ListItemButton
                sx={{ py: 0.25, px: 0.5, borderRadius: 1 }}
                onClick={() => toggleAll(relKeys, !allRelChecked)}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Checkbox
                    size="small"
                    checked={allRelChecked}
                    indeterminate={someRelChecked && !allRelChecked}
                    sx={{ p: 0 }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="body2" fontSize={13} fontWeight={500} fontStyle="italic">
                      {t("columns.selectAll")}
                    </Typography>
                  }
                />
              </ListItemButton>
              {filteredRels.map((rt) => {
                const selType = filters.types.length === 1 ? filters.types[0] : "";
                const isSource = rt.source_type_key === selType;
                const otherKey = isSource ? rt.target_type_key : rt.source_type_key;
                const otherType = types.find((ct) => ct.key === otherKey);
                const label = otherType
                  ? typeLabel(otherType)
                  : otherKey;
                const colKey = `rel_${otherKey}`;

                return (
                  <ListItemButton
                    key={colKey}
                    sx={{ py: 0.25, px: 0.5, borderRadius: 1 }}
                    onClick={() => toggleColumn(colKey)}
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <Checkbox size="small" checked={selectedColumns.has(colKey)} sx={{ p: 0 }} />
                    </ListItemIcon>
                    {otherType && (
                      <ListItemIcon sx={{ minWidth: 24 }}>
                        <MaterialSymbol icon={otherType.icon} size={16} color={otherType.color} />
                      </ListItemIcon>
                    )}
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontSize={13}>
                          {label}
                        </Typography>
                      }
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Collapse>
        </>
      )}
    </>
  );
}
