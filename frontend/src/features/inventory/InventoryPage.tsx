import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellValueChangedEvent, SelectionChangedEvent, RowClickedEvent, SortChangedEvent, GridReadyEvent, ColumnState } from "ag-grid-community";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Menu from "@mui/material/Menu";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import Drawer from "@mui/material/Drawer";
import Tooltip from "@mui/material/Tooltip";
import ListSubheader from "@mui/material/ListSubheader";
import Autocomplete from "@mui/material/Autocomplete";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import LifecycleBadge from "@/components/LifecycleBadge";
import ArchiveDeleteDialog from "@/features/cards/ArchiveDeleteDialog";
import BulkRestoreDialog from "@/features/cards/BulkRestoreDialog";
import CreateCardDialog from "@/components/CreateCardDialog";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import InventoryFilterSidebar, {
  CORE_COLUMN_KEYS,
  LOCKED_COLUMN_KEYS,
  EMPTY_VALUE,
  valueIsEmpty,
  tagsToFilterText,
  type Filters,
} from "./InventoryFilterSidebar";
import ImportDialog from "./ImportDialog";
import { exportToExcel, exportCurrentViewToExcel } from "./excelExport";
import RelationCellPopover from "./RelationCellPopover";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { useAuth } from "@/hooks/useAuth";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useDateFormat } from "@/hooks/useDateFormat";
import { api, ApiError } from "@/api/client";
import { APPROVAL_STATUS_COLORS } from "@/theme/tokens";
import TagPicker from "@/components/TagPicker";
import TagsCellEditor from "@/features/inventory/TagsCellEditor";
import type { Card, CardListResponse, ColumnLayoutItem, FieldDef, Relation, RelationType, TagGroup, TagRef } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const DEFAULT_SIDEBAR_WIDTH = 300;

function getLifecyclePhase(card: Card): string {
  const lc = card.lifecycle || {};
  const now = new Date().toISOString().slice(0, 10);
  for (const phase of ["endOfLife", "phaseOut", "active", "phaseIn", "plan"]) {
    if (lc[phase] && lc[phase] <= now) return phase;
  }
  return "";
}

/**
 * Pre-compute the breadcrumb path *up to* each card's parent (i.e. excluding
 * the card's own name) from raw card data. Reads names and parent_ids once
 * into plain-string maps, then builds each path by walking the parent chain.
 * Returns a Map<id, parentPath> where root cards map to an empty string.
 */
function buildParentPaths(items: Card[]): Map<string, string> {
  const names = new Map<string, string>();
  const parents = new Map<string, string>();
  for (const card of items) {
    names.set(card.id, card.name);
    if (card.parent_id) parents.set(card.id, card.parent_id);
  }

  // `fullCache` holds "Ancestor / Parent / Self"; we derive the parent-only
  // breadcrumb by stripping the leaf segment when reading.
  const fullCache = new Map<string, string>();
  function resolveFull(id: string, seen: Set<string>): string {
    const cached = fullCache.get(id);
    if (cached !== undefined) return cached;
    const name = names.get(id) ?? "";
    const parentId = parents.get(id);
    if (!parentId || !names.has(parentId) || seen.has(parentId)) {
      fullCache.set(id, name);
      return name;
    }
    seen.add(id);
    const parentPath = resolveFull(parentId, seen);
    const path = parentPath ? parentPath + " / " + name : name;
    fullCache.set(id, path);
    return path;
  }

  const parentOnly = new Map<string, string>();
  for (const card of items) {
    const parentId = parents.get(card.id);
    if (!parentId) {
      parentOnly.set(card.id, "");
      continue;
    }
    parentOnly.set(card.id, resolveFull(parentId, new Set([card.id])));
  }
  return parentOnly;
}

/**
 * Build a lookup: for each relation type, map cardId → array of related names.
 * When the selected type is the source, we index by source_id and show target names.
 * When the selected type is the target, we index by target_id and show source names.
 */
function buildRelationIndex(
  relations: Relation[],
  relationType: RelationType,
  selectedType: string
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const isSource = relationType.source_type_key === selectedType;

  for (const rel of relations) {
    const myId = isSource ? rel.source_id : rel.target_id;
    const otherName = isSource ? rel.target?.name : rel.source?.name;
    if (!otherName) continue;
    const existing = index.get(myId);
    if (existing) {
      existing.push(otherName);
    } else {
      index.set(myId, [otherName]);
    }
  }
  return index;
}

/* ---- localStorage persistence helpers ---- */
const LS_KEY = "turboea_inventory";

interface InventoryPrefs {
  filters?: Filters;
  columns?: string[];
  // AG Grid column layout (order/width/pinning), captured via getColumnState().
  // Visibility still flows from `columns` → `selectedColumns` → colDef `hide`.
  columnState?: ColumnLayoutItem[];
  sortModel?: { colId: string; sort: string }[];
  // Set to true after the one-time migration that surfaces the previously
  // always-on Tags column in users' saved column selection. Without this
  // flag, existing users would suddenly stop seeing the Tags column once
  // it became togglable.
  coreTagsMerged?: boolean;
}

function loadPrefs(): InventoryPrefs | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as InventoryPrefs) : null;
  } catch {
    return null;
  }
}

function savePrefs(prefs: InventoryPrefs) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

export default function InventoryPage() {
  const { t } = useTranslation(["inventory", "common"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { formatDate, formatDateTime } = useDateFormat();
  const { types, relationTypes } = useMetamodel();
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();
  const { user } = useAuth();
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const canArchive = !!(user?.permissions?.["*"] || user?.permissions?.["inventory.archive"]);
  const canDelete = !!(user?.permissions?.["*"] || user?.permissions?.["inventory.delete"]);
  const canShareBookmarks = !!(user?.permissions?.["*"] || user?.permissions?.["bookmarks.share"]);
  const canOdataBookmarks = !!(user?.permissions?.["*"] || user?.permissions?.["bookmarks.odata"]);
  const canViewCostsGlobally = !!(user?.permissions?.["*"] || user?.permissions?.["costs.view"]);
  const gridRef = useRef<AgGridReact>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);

  // Load persisted prefs once on mount
  const savedPrefsRef = useRef(loadPrefs());

  const [filters, setFilters] = useState<Filters>(() => {
    // URL params take precedence over localStorage
    const hasUrlParams = searchParams.has("type") || searchParams.has("search") ||
      searchParams.has("approval_status") || searchParams.has("show_archived") ||
      searchParams.has("mine") ||
      Array.from(searchParams.keys()).some((k) => k.startsWith("attr_"));

    if (hasUrlParams) {
      const attributes: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        if (key.startsWith("attr_")) {
          attributes[key.slice(5)] = value;
        }
      });
      return {
        types: searchParams.get("type") ? [searchParams.get("type")!] : [],
        search: searchParams.get("search") || "",
        subtypes: [],
        lifecyclePhases: [],
        dataQualityMin: null,
        approvalStatuses: searchParams.get("approval_status") ? [searchParams.get("approval_status")!] : [],
        showArchived: searchParams.get("show_archived") === "true",
        attributes,
        relations: {},
        tagIds: [],
        mineScope: searchParams.get("mine") === "stakeholder" ? "stakeholder" : null,
      };
    }

    // Fall back to localStorage
    const saved = savedPrefsRef.current;
    if (saved?.filters) {
      return {
        types: saved.filters.types || [],
        search: saved.filters.search || "",
        subtypes: saved.filters.subtypes || [],
        lifecyclePhases: saved.filters.lifecyclePhases || [],
        dataQualityMin: saved.filters.dataQualityMin ?? null,
        approvalStatuses: saved.filters.approvalStatuses || [],
        showArchived: saved.filters.showArchived || false,
        attributes: saved.filters.attributes || {},
        relations: saved.filters.relations || {},
        tagIds: saved.filters.tagIds || [],
        mineScope: saved.filters.mineScope ?? null,
      };
    }

    return {
      types: [],
      search: "",
      subtypes: [],
      lifecyclePhases: [],
      dataQualityMin: null,
      approvalStatuses: [],
      showArchived: false,
      attributes: {},
      relations: {},
      tagIds: [],
      mineScope: null,
    };
  });

  // Sort model for AG Grid persistence
  const [sortModel, setSortModel] = useState<{ colId: string; sort: string }[]>(
    () => savedPrefsRef.current?.sortModel || [],
  );

  const [data, setData] = useState<Card[]>([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [gridEditMode, setGridEditMode] = useState(false);
  // Card-detail side panel: opened from the eye icon in the Name column.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);

  // Relations data: relTypeKey → Map<cardId, relatedNames[]>
  const [relationsMap, setRelationsMap] = useState<Map<string, Map<string, string[]>>>(new Map());

  // Tag groups (for filter + column rendering)
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  useEffect(() => {
    api.get<TagGroup[]>("/tag-groups").then(setTagGroups).catch(() => setTagGroups([]));
  }, []);

  // User id → display name map for Created By / Modified By columns
  const [userNameMap, setUserNameMap] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .get<{ id: string; display_name: string }[]>("/users")
      .then((users) => {
        const map: Record<string, string> = {};
        for (const u of users) map[u.id] = u.display_name;
        setUserNameMap(map);
      })
      .catch(() => setUserNameMap({}));
  }, []);

  // Dynamic column visibility: set of column keys the user has opted to show
  // Initialized from localStorage if available, otherwise defaults to all when type selected
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(() => {
    const saved = savedPrefsRef.current;
    if (saved?.columns && saved.columns.length > 0) {
      const restored = new Set(saved.columns);
      // Backwards compat: prefs saved before "Default columns" were togglable
      // contain only attribute/relation/meta keys. Detect that and merge in
      // the full core set so users keep seeing the columns that used to be
      // unconditionally rendered.
      const hasAnyCore = saved.columns.some((k) => k.startsWith("core_"));
      if (!hasAnyCore) {
        for (const k of CORE_COLUMN_KEYS) restored.add(k);
      }
      // One-time migration: surface the previously-always-on Tags column in
      // existing users' saved column sets. Cleared on the next save (the
      // persist effect writes coreTagsMerged: true).
      if (!saved.coreTagsMerged) {
        restored.add("core_tags");
      }
      // Type and name are required and can't be deselected — re-add them in
      // case an older pref omitted them.
      for (const k of LOCKED_COLUMN_KEYS) restored.add(k);
      return restored;
    }
    return new Set(LOCKED_COLUMN_KEYS);
  });
  // Track whether the user has explicitly set columns (vs auto-populated defaults)
  const [columnsInitialized, setColumnsInitialized] = useState(
    () => !!(savedPrefsRef.current?.columns && savedPrefsRef.current.columns.length > 0),
  );

  // --- Column layout (order / width / pinning) -------------------------------
  // Visibility flows from `selectedColumns` (the sidebar picker) into colDef
  // `hide`; this state carries the *positional* layout captured from AG Grid via
  // getColumnState(). It is persisted to localStorage and to saved views
  // (bookmark.column_state) so reopening a view restores how the grid looked.
  const [columnState, setColumnState] = useState<ColumnLayoutItem[] | undefined>(
    () => savedPrefsRef.current?.columnState,
  );
  // Mirror of the latest columnState for the apply effect (which keys on
  // columnDefs, not columnState, to avoid re-applying on every capture).
  const columnStateRef = useRef(columnState);
  columnStateRef.current = columnState;
  // While true, the saved layout is (re)applied to the grid as columns arrive.
  // Attribute/relation columns appear only after the metamodel loads — *after*
  // the grid is ready — so a one-shot restore would miss them. We keep
  // re-applying on every columnDefs change until the user manually rearranges.
  const restorePendingRef = useRef(true);
  // Guards against the apply firing column events that we'd otherwise capture
  // back (feedback) or mistake for a user rearrange.
  const applyingLayoutRef = useRef(false);
  // Bumped to force a re-apply (e.g. when a saved view is applied and the
  // column *set* doesn't change, so columnDefs alone wouldn't retrigger).
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [gridReady, setGridReady] = useState(false);

  // Set the saved layout to restore (initial load handled by restorePendingRef
  // default; this is the entry point for applying a bookmark's layout).
  const applyColumnLayout = useCallback((layout: ColumnLayoutItem[] | null) => {
    restorePendingRef.current = true;
    setColumnState(layout ?? undefined);
    setLayoutNonce((n) => n + 1);
  }, []);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<null | HTMLElement>(null);

  // Mass edit state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [massEditOpen, setMassEditOpen] = useState(false);
  const [massEditField, setMassEditField] = useState("");
  const [massEditValue, setMassEditValue] = useState<unknown>("");
  const [massEditError, setMassEditError] = useState("");
  const [massEditLoading, setMassEditLoading] = useState(false);
  // Per-card blockers from a partial mass-update — populated when at least
  // one card couldn't be processed (e.g. approval gate triggered).
  const [massEditBlockers, setMassEditBlockers] = useState<
    {
      id: string;
      name: string;
      missingRelations: string[];
      missingTagGroups: string[];
      message: string | null;
    }[]
  >([]);
  const [massEditSucceeded, setMassEditSucceeded] = useState(0);
  // Relation mass-edit state
  const [massEditRelMode, setMassEditRelMode] = useState<"add" | "remove">("add");
  const [massEditRelTargets, setMassEditRelTargets] = useState<{ id: string; name: string; type: string }[]>([]);
  const [massEditRelSearch, setMassEditRelSearch] = useState("");
  const [massEditRelOptions, setMassEditRelOptions] = useState<{ id: string; name: string; type: string }[]>([]);

  // Mass archive / delete state
  const [massArchiveOpen, setMassArchiveOpen] = useState(false);
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);
  const [massRestoreOpen, setMassRestoreOpen] = useState(false);

  // Relation cell dialog state
  const [relEditOpen, setRelEditOpen] = useState(false);
  const [relEditFsId, setRelEditFsId] = useState("");
  const [relEditFsName, setRelEditFsName] = useState("");
  const [relEditRelType, setRelEditRelType] = useState<RelationType | null>(null);

  // React to ?create=true search param
  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setCreateOpen(true);
    }
  }, [searchParams]);

  // Sync ?search= URL param into filters when navigating to inventory from elsewhere (e.g. toolbar)
  useEffect(() => {
    const urlSearch = searchParams.get("search") || "";
    if (urlSearch !== filters.search) {
      setFilters((prev) => ({ ...prev, search: urlSearch }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Derive the single selected type for column rendering (only when exactly one type selected)
  const selectedType = filters.types.length === 1 ? filters.types[0] : "";
  const typeConfig = types.find((t) => t.key === selectedType);

  // Common fields across multiple selected types (for dynamic columns)
  const commonFields = useMemo<FieldDef[]>(() => {
    if (filters.types.length <= 1) return [];
    const selectedTypes = types.filter((t) => filters.types.includes(t.key));
    if (selectedTypes.length < 2) return [];

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

  // Relevant relation types for the selected type (excluding relations to hidden types)
  // Since the API excludes hidden types, check that the other-end type exists in visible types
  // Deduplicated by other-end type key to avoid showing duplicate columns (e.g. two relation
  // types both connecting Platform ↔ ITComponent)
  const visibleTypeKeys = useMemo(() => new Set(types.map((t) => t.key)), [types]);
  const relevantRelTypes = useMemo(() => {
    if (!selectedType) return [];
    const filtered = relationTypes.filter(
      (rt) =>
        !rt.is_hidden &&
        (rt.source_type_key === selectedType || rt.target_type_key === selectedType) &&
        visibleTypeKeys.has(
          rt.source_type_key === selectedType ? rt.target_type_key : rt.source_type_key
        )
    );
    // Deduplicate by other-end type key — keep first occurrence
    const seenOtherKeys = new Set<string>();
    return filtered.filter((rt) => {
      const otherKey =
        rt.source_type_key === selectedType ? rt.target_type_key : rt.source_type_key;
      if (seenOtherKeys.has(otherKey)) return false;
      seenOtherKeys.add(otherKey);
      return true;
    });
  }, [selectedType, relationTypes, visibleTypeKeys]);

  // Map from other-end type key to all matching relation type keys (for merging data)
  const relTypeGroupMap = useMemo(() => {
    if (!selectedType) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const rt of relationTypes) {
      if (rt.is_hidden) continue;
      if (rt.source_type_key !== selectedType && rt.target_type_key !== selectedType) continue;
      const otherKey =
        rt.source_type_key === selectedType ? rt.target_type_key : rt.source_type_key;
      if (!visibleTypeKeys.has(otherKey)) continue;
      const existing = map.get(otherKey);
      if (existing) existing.push(rt.key);
      else map.set(otherKey, [rt.key]);
    }
    return map;
  }, [selectedType, relationTypes, visibleTypeKeys]);

  // Compute the "default" set of columns: all core columns + all attribute +
  // all relation columns checked. The core keys (type, name, path, etc.) used
  // to be unconditionally rendered; they're now togglable, so include them in
  // the defaults so a fresh / reset state matches the legacy "everything on"
  // behavior.
  const defaultColumns = useMemo(() => {
    const cols = new Set<string>(CORE_COLUMN_KEYS);
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const f of section.fields) {
          cols.add(`attr_${f.key}`);
        }
      }
    } else if (commonFields.length > 0) {
      for (const f of commonFields) {
        cols.add(`attr_${f.key}`);
      }
    }
    for (const rt of relevantRelTypes) {
      const otherKey =
        rt.source_type_key === selectedType ? rt.target_type_key : rt.source_type_key;
      cols.add(`rel_${otherKey}`);
    }
    return cols;
  }, [typeConfig, commonFields, relevantRelTypes, selectedType]);

  // Auto-populate columns with all-checked defaults when type changes (and not yet initialized)
  useEffect(() => {
    if (filters.types.length === 0) return;
    if (columnsInitialized) return;
    if (defaultColumns.size > 0) {
      setSelectedColumns(defaultColumns);
      setColumnsInitialized(true);
    }
  }, [filters.types, defaultColumns, columnsInitialized]);

  // Persist filters, columns, and sort to localStorage on change
  useEffect(() => {
    savePrefs({
      filters,
      columns: Array.from(selectedColumns),
      columnState,
      sortModel,
      coreTagsMerged: true,
    });
  }, [filters, selectedColumns, sortModel, columnState]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.types.length === 1) params.set("type", filters.types[0]);
      if (filters.search) params.set("search", filters.search);
      if (filters.approvalStatuses.length > 0) {
        params.set("approval_status", filters.approvalStatuses.join(","));
      }
      if (filters.showArchived) {
        params.set("status", "ARCHIVED");
      }
      if (filters.mineScope) {
        params.set("mine", filters.mineScope);
      }
      params.set("page_size", "10000");
      const res = await api.get<CardListResponse>(
        `/cards?${params}`
      );
      setData(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [filters.types, filters.search, filters.approvalStatuses, filters.showArchived, filters.mineScope]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // All relation type keys we need to fetch (including grouped duplicates)
  const allRelTypeKeys = useMemo(() => {
    const keys: string[] = [];
    for (const group of relTypeGroupMap.values()) {
      for (const k of group) keys.push(k);
    }
    return keys;
  }, [relTypeGroupMap]);

  // Fetch and index relations for each relevant relation type
  const fetchRelations = useCallback(async () => {
    if (!selectedType || allRelTypeKeys.length === 0) {
      setRelationsMap(new Map());
      return;
    }

    // Fetch all relation types (including grouped duplicates)
    const allRts = allRelTypeKeys.map((key) => relationTypes.find((rt) => rt.key === key)!).filter(Boolean);
    const newMap = new Map<string, Map<string, string[]>>();
    const results = await Promise.all(
      allRts.map((rt) =>
        api.get<Relation[]>(`/relations?type=${rt.key}`).catch(() => [] as Relation[])
      )
    );

    for (let i = 0; i < allRts.length; i++) {
      const rt = allRts[i];
      const rels = results[i];
      newMap.set(rt.key, buildRelationIndex(rels, rt, selectedType));
    }
    setRelationsMap(newMap);
  }, [selectedType, allRelTypeKeys, relationTypes]);

  // Fetch relations when data or relevant types change
  useEffect(() => {
    if (data.length === 0) {
      setRelationsMap(new Map());
      return;
    }

    let cancelled = false;
    fetchRelations().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [fetchRelations, data]);

  // Pre-computed hierarchy display paths (id → "Parent / Child").
  // Built once from raw API data; completely detached from the mutable row objects
  // that AG Grid holds, so grid-internal writes to data[field] cannot corrupt paths.
  const parentPaths = useMemo(() => buildParentPaths(data), [data]);

  // Client-side filtering
  const filteredData = useMemo(() => {
    let result = data;

    // When multiple types selected, filter client-side (API only supports single type)
    if (filters.types.length > 1) {
      result = result.filter((card) => filters.types.includes(card.type));
    }

    // Subtype filter ("(empty)" matches cards with no subtype set)
    if (filters.subtypes.length > 0) {
      result = result.filter((card) => filters.subtypes.includes(card.subtype || EMPTY_VALUE));
    }

    // Lifecycle filter ("(empty)" matches cards with no/unstarted lifecycle)
    if (filters.lifecyclePhases.length > 0) {
      result = result.filter((card) => filters.lifecyclePhases.includes(getLifecyclePhase(card) || EMPTY_VALUE));
    }

    // Data quality filter
    if (filters.dataQualityMin !== null) {
      const min = filters.dataQualityMin;
      if (min === 0) {
        // "Poor" = below 50
        result = result.filter((card) => (card.data_quality ?? 0) < 50);
      } else {
        result = result.filter((card) => (card.data_quality ?? 0) >= min);
      }
    }

    // Attribute filters (client-side) — supports different field types
    const attrEntries = Object.entries(filters.attributes);
    if (attrEntries.length > 0) {
      result = result.filter((card) => {
        const attrs = card.attributes || {};
        return attrEntries.every(([key, val]) => {
          const actual = attrs[key];
          // single/multi-select: array of allowed values (OR match).
          // "(empty)" matches cards with no value for this attribute.
          if (Array.isArray(val)) {
            if (val.length === 0) return true;
            if (valueIsEmpty(actual)) return val.includes(EMPTY_VALUE);
            if (Array.isArray(actual)) return actual.some((a) => val.includes(a as string));
            return val.includes(actual as string);
          }
          // number/cost: filter as minimum value
          if (!isNaN(Number(val)) && val !== "" && typeof actual === "number") {
            return actual >= Number(val);
          }
          // boolean: string comparison
          if (val === "true" || val === "false") {
            return String(actual) === val;
          }
          // text: case-insensitive contains
          if (typeof actual === "string" && typeof val === "string") {
            return actual.toLowerCase().includes(val.toLowerCase());
          }
          // exact match fallback
          return actual === val;
        });
      });
    }

    // Relation filters (client-side) — multi-select (OR within a relation type)
    const relEntries = Object.entries(filters.relations || {});
    if (relEntries.length > 0) {
      result = result.filter((card) => {
        return relEntries.every(([relTypeKey, selectedNames]) => {
          if (!Array.isArray(selectedNames) || selectedNames.length === 0) return true;
          const index = relationsMap.get(relTypeKey);
          const names = index?.get(card.id);
          const wantEmpty = selectedNames.includes(EMPTY_VALUE);
          // No related cards of this type → only matches when "(empty)" is selected.
          if (!names || names.length === 0) return wantEmpty;
          return selectedNames.some((n) => n !== EMPTY_VALUE && names.includes(n));
        });
      });
    }

    // Tag filters — OR within a group, AND across groups.
    // A group's "(empty)" token matches cards bearing no tag from that group.
    const selectedTagIds = filters.tagIds || [];
    if (selectedTagIds.length > 0 && tagGroups.length > 0) {
      const tagToGroup = new Map<string, string>();
      const groupTagIdSets = new Map<string, Set<string>>();
      for (const g of tagGroups) {
        groupTagIdSets.set(g.id, new Set(g.tags.map((tg) => tg.id)));
        for (const tg of g.tags) tagToGroup.set(tg.id, g.id);
      }
      // groupId → { ids: real tag ids selected, wantEmpty: "(empty)" selected }
      const byGroup = new Map<string, { ids: Set<string>; wantEmpty: boolean }>();
      const ensure = (gid: string) => {
        let e = byGroup.get(gid);
        if (!e) {
          e = { ids: new Set<string>(), wantEmpty: false };
          byGroup.set(gid, e);
        }
        return e;
      };
      const emptyPrefix = `${EMPTY_VALUE}:`;
      for (const id of selectedTagIds) {
        if (id.startsWith(emptyPrefix)) {
          ensure(id.slice(emptyPrefix.length)).wantEmpty = true;
        } else {
          const gid = tagToGroup.get(id);
          if (gid) ensure(gid).ids.add(id);
        }
      }
      result = result.filter((card) => {
        const cardTagIds = new Set((card.tags || []).map((tg) => tg.id));
        for (const [gid, sel] of byGroup) {
          let anyMatch = false;
          if (sel.wantEmpty) {
            const groupSet = groupTagIdSets.get(gid);
            const hasNoneInGroup = !groupSet || ![...groupSet].some((id) => cardTagIds.has(id));
            if (hasNoneInGroup) anyMatch = true;
          }
          if (!anyMatch) {
            for (const id of sel.ids) {
              if (cardTagIds.has(id)) {
                anyMatch = true;
                break;
              }
            }
          }
          if (!anyMatch) return false;
        }
        return true;
      });
    }

    return result;
  }, [data, filters.types, filters.subtypes, filters.lifecyclePhases, filters.dataQualityMin, filters.attributes, filters.relations, filters.tagIds, relationsMap, tagGroups]);

  const handleCellEdit = async (event: CellValueChangedEvent) => {
    const card = event.data as Card;
    const field = event.colDef.field!;
    if (field === "name" || field === "description") {
      await api.patch(`/cards/${card.id}`, { [field]: event.newValue });
    } else if (field.startsWith("attr_")) {
      const key = field.replace("attr_", "");
      const fieldDef = typeConfig?.fields_schema
        .flatMap((s) => s.fields)
        .find((f) => f.key === key);
      if (fieldDef?.readonly) return;
      const attrs = { ...card.attributes, [key]: event.newValue };
      await api.patch(`/cards/${card.id}`, { attributes: attrs });
    } else if (field === "tags") {
      const oldIds = new Set<string>((event.oldValue as TagRef[] | undefined ?? []).map((t) => t.id));
      const newIds = new Set<string>((event.newValue as TagRef[] | undefined ?? []).map((t) => t.id));
      const toAdd = [...newIds].filter((id) => !oldIds.has(id));
      const toRemove = [...oldIds].filter((id) => !newIds.has(id));
      if (toAdd.length > 0) {
        await api.post(`/cards/${card.id}/tags`, toAdd);
      }
      for (const id of toRemove) {
        await api.delete(`/cards/${card.id}/tags/${id}`);
      }
    }
  };

  const handleCreate = async (createData: {
    type: string;
    subtype?: string;
    name: string;
    description?: string;
    parent_id?: string;
    attributes?: Record<string, unknown>;
    lifecycle?: Record<string, string>;
  }): Promise<string> => {
    const card = await api.post<Card>("/cards", createData);
    loadData();
    return card.id;
  };

  const handleSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    const rows = event.api.getSelectedRows() as Card[];
    setSelectedIds(rows.map((r) => r.id));
  }, []);

  const handleResetColumns = useCallback(() => {
    setSelectedColumns(defaultColumns);
  }, [defaultColumns]);

  const handleSortChanged = useCallback((event: SortChangedEvent) => {
    // Ignore sort events fired by our own applyColumnState() restore.
    if (applyingLayoutRef.current) return;
    const colState = event.api.getColumnState();
    const sorted = colState
      .filter((c) => c.sort)
      .map((c) => ({ colId: c.colId!, sort: c.sort! }));
    setSortModel(sorted);
    // getColumnState() carries each column's sort/sortIndex, and column_state is
    // what saved views persist + restore — so fold the new sort into it here.
    // Without this, a sort-only change (no drag/pin) never reaches the saved
    // view and sorting wouldn't survive reopening it.
    setColumnState(colState as unknown as ColumnLayoutItem[]);
  }, []);

  // Capture order/width/pinning whenever the user drags or pins a column.
  // onDragStopped covers both column moves and resizes (one event at drag end).
  // A genuine user rearrange also ends the initial-restore window.
  const captureColumnState = useCallback(() => {
    if (applyingLayoutRef.current) return;
    const api = gridRef.current?.api;
    if (!api) return;
    restorePendingRef.current = false;
    setColumnState(api.getColumnState() as unknown as ColumnLayoutItem[]);
  }, []);

  const handleGridReady = useCallback((_event: GridReadyEvent) => {
    setGridReady(true);
  }, []);

  // Export only what's on screen: the displayed columns, in their current
  // left-to-right order, with their displayed headers, and only the rows left
  // after filtering — in sort order. WYSIWYG, not importable. Values are read
  // straight from the grid (via valueGetters/valueFormatters) so relation,
  // lifecycle, path and date columns come out exactly as displayed.
  const handleExportCurrentView = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    // Exclude AG Grid's auto-generated columns (the row-selection / controls
    // column, colId `ag-Grid-ControlsColumn` / `ag-Grid-SelectionColumn`) — they
    // carry no data and would otherwise surface as an empty leading column.
    const displayed = api
      .getAllDisplayedColumns()
      .filter((c) => !c.getColId().startsWith("ag-Grid-"));
    const columns = displayed.map((c) => ({
      colId: c.getColId(),
      headerName: api.getDisplayNameForColumn(c, null) || c.getColId(),
    }));
    const rows: Record<string, unknown>[] = [];
    // forEachNodeAfterFilterAndSort walks EVERY row that passes the active
    // filters, in display (sort) order — it ignores pagination and row
    // virtualization. So the export always covers the full filtered result,
    // not just the rows currently scrolled/paged into view. (Do not switch to
    // getRenderedNodes(), which is viewport-bound.)
    api.forEachNodeAfterFilterAndSort((node) => {
      if (!node.data) return;
      const row: Record<string, unknown> = {};
      for (const col of displayed) {
        row[col.getColId()] = api.getCellValue({
          rowNode: node,
          colKey: col,
          useFormatter: true,
        });
      }
      rows.push(row);
    });
    const sheetLabel = typeConfig
      ? rml(typeConfig.key, typeConfig.translations, "label")
      : t("export.viewSheetName", { defaultValue: "View" });
    exportCurrentViewToExcel(rows, columns, { sheetLabel });
  }, [typeConfig, rml, t]);

  // Stable AG Grid config objects — prevents unnecessary grid re-renders
  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true }), []);
  const rowSelection = useMemo(() => ({ mode: "multiRow" as const, enableClickSelection: false, headerCheckbox: true, selectAll: "filtered" as const }), []);
  const getRowId = useCallback((p: { data: Card }) => p.data.id, []);
  const getRowStyle = useCallback((p: { data?: Card }) => p.data?.status === "ARCHIVED" ? { opacity: 0.6 } : undefined, []);
  const onRowClicked = useCallback((e: RowClickedEvent<Card>) => {
    if (gridEditMode || !e.data || e.event?.defaultPrevented) return;
    // Let the browser handle Ctrl/Cmd/Shift+Click and middle-click — they're
    // intended for "open in new tab/window" via the real anchor in the Name
    // cell. Re-firing programmatic navigation here would also navigate the
    // current tab, so skip.
    const evt = e.event as MouseEvent | undefined;
    if (evt?.ctrlKey || evt?.metaKey || evt?.shiftKey || evt?.button === 1) return;
    const api = gridRef.current?.api;
    const selected = api?.getSelectedRows() || [];
    if (selected.length > 0) return;
    navigate(`/cards/${e.data.id}`);
  }, [gridEditMode, navigate]);

  // Mass-editable fields for current type
  type MassEditField = {
    key: string;
    label: string;
    fieldDef?: FieldDef;
    relInfo?: { relType: RelationType; otherTypeKey: string; isSource: boolean };
    group: "core" | "attribute" | "relation";
  };
  const massEditableFields = useMemo<MassEditField[]>(() => {
    const fields: MassEditField[] = [
      { key: "approval_status", label: t("columns.approvalStatus"), group: "core" },
    ];
    if (typeConfig?.subtypes && typeConfig.subtypes.length > 0) {
      fields.push({ key: "subtype", label: t("common:labels.subtype"), group: "core" });
    }
    fields.push({ key: "tags", label: t("columns.tags"), group: "core" });
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const field of section.fields) {
          if (field.readonly) continue;
          fields.push({
            key: `attr_${field.key}`,
            label: rl(field.key, field.translations),
            fieldDef: field,
            group: "attribute",
          });
        }
      }
    }
    // Relation fields — only when a single type is selected. Each (relation type × direction)
    // becomes a distinct mass-edit option, so self-referential relation types appear twice
    // (once in each direction). Hidden relation types and relations to hidden types are skipped.
    if (selectedType) {
      for (const rt of relationTypes) {
        if (rt.is_hidden) continue;
        const sourceMatches = rt.source_type_key === selectedType;
        const targetMatches = rt.target_type_key === selectedType;
        if (!sourceMatches && !targetMatches) continue;
        // "out" direction: selected card is source
        if (sourceMatches && visibleTypeKeys.has(rt.target_type_key)) {
          const verb = rml(rt.key, rt.translations, "label");
          const otherLabel = (() => {
            const ot = types.find((tp) => tp.key === rt.target_type_key);
            return ot ? rml(ot.key, ot.translations, "label") : rt.target_type_key;
          })();
          fields.push({
            key: `rel_${rt.key}__out`,
            label: `${verb} → ${otherLabel}`,
            relInfo: { relType: rt, otherTypeKey: rt.target_type_key, isSource: true },
            group: "relation",
          });
        }
        // "in" direction: selected card is target. Only render if it's not the same as out
        // (i.e. self-referential, where we already added the "out" side and want both verbs).
        if (targetMatches && visibleTypeKeys.has(rt.source_type_key)) {
          const isSelf = sourceMatches && targetMatches;
          if (!isSelf && sourceMatches) continue; // already covered by out
          const reverse = rml(rt.key, rt.translations, "reverse_label");
          const verb = reverse || rml(rt.key, rt.translations, "label");
          const otherLabel = (() => {
            const ot = types.find((tp) => tp.key === rt.source_type_key);
            return ot ? rml(ot.key, ot.translations, "label") : rt.source_type_key;
          })();
          fields.push({
            key: `rel_${rt.key}__in`,
            label: `${verb} → ${otherLabel}`,
            relInfo: { relType: rt, otherTypeKey: rt.source_type_key, isSource: false },
            group: "relation",
          });
        }
      }
    }
    return fields;
  }, [typeConfig, selectedType, relationTypes, visibleTypeKeys, types, t, rl, rml]);

  const currentMassField = massEditableFields.find((f) => f.key === massEditField);

  // Search for relation targets when the user is in relation mass-edit mode.
  // Excludes the cards being mass-edited so users can't accidentally link a card to itself.
  useEffect(() => {
    if (!massEditOpen || !currentMassField?.relInfo) return;
    if (massEditRelSearch.length < 1) {
      setMassEditRelOptions([]);
      return;
    }
    const otherTypeKey = currentMassField.relInfo.otherTypeKey;
    const selectedSet = new Set(selectedIds);
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string; type: string }[] }>(
          `/cards?type=${otherTypeKey}&search=${encodeURIComponent(massEditRelSearch)}&page_size=20`,
        )
        .then((res) => {
          setMassEditRelOptions(res.items.filter((item) => !selectedSet.has(item.id)));
        })
        .catch(() => setMassEditRelOptions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [massEditRelSearch, massEditOpen, currentMassField, selectedIds]);

  const handleMassEdit = async () => {
    if (selectedIds.length === 0 || !massEditField) return;
    setMassEditLoading(true);
    setMassEditError("");
    setMassEditBlockers([]);
    setMassEditSucceeded(0);
    try {
      if (massEditField === "approval_status") {
        const action =
          massEditValue === "APPROVED"
            ? "approve"
            : massEditValue === "REJECTED"
              ? "reject"
              : "reset";
        const results = await Promise.allSettled(
          selectedIds.map((id) =>
            api.post(`/cards/${id}/approval-status?action=${action}`),
          ),
        );

        const blockers: typeof massEditBlockers = [];
        let succeeded = 0;
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            succeeded += 1;
            return;
          }
          const id = selectedIds[i];
          const card = data.find((d) => d.id === id);
          const name = card?.name ?? id;
          const reason = r.reason;
          if (reason instanceof ApiError && reason.status === 400) {
            const detail = reason.detail as
              | {
                  code?: string;
                  missing_relations?: { label: string }[];
                  missing_tag_groups?: { name: string }[];
                }
              | string
              | undefined;
            if (detail && typeof detail === "object" && detail.code === "approval_blocked_mandatory_missing") {
              blockers.push({
                id,
                name,
                missingRelations: (detail.missing_relations ?? []).map((x) => x.label),
                missingTagGroups: (detail.missing_tag_groups ?? []).map((x) => x.name),
                message: null,
              });
              return;
            }
          }
          blockers.push({
            id,
            name,
            missingRelations: [],
            missingTagGroups: [],
            message: reason instanceof Error ? reason.message : t("massEdit.failed"),
          });
        });

        // Always reload — successful approves committed server-side.
        await loadData();

        if (blockers.length === 0) {
          setMassEditOpen(false);
          setMassEditField("");
          setMassEditValue("");
          return;
        }
        setMassEditSucceeded(succeeded);
        setMassEditBlockers(blockers);
        return;
      }

      if (currentMassField?.relInfo) {
        if (massEditRelTargets.length === 0) {
          setMassEditError(t("massEdit.rel.noTargetsSelected"));
          return;
        }
        const { relType, isSource } = currentMassField.relInfo;
        // Pre-fetch all relations of this type to determine what already exists,
        // so "add" is idempotent and "remove" can locate the relation IDs to delete.
        const allRels = await api
          .get<Relation[]>(`/relations?type=${relType.key}`)
          .catch(() => [] as Relation[]);
        const targetIdSet = new Set(massEditRelTargets.map((tg) => tg.id));

        const ops: Promise<unknown>[] = [];
        const opSourceIds: string[] = [];

        if (massEditRelMode === "add") {
          // For each selected card × each target, create a relation if not already present.
          // We treat already-existing relations as a no-op success (idempotent).
          for (const sourceId of selectedIds) {
            const existingPairs = new Set<string>();
            for (const r of allRels) {
              const a = isSource ? r.source_id : r.target_id;
              const b = isSource ? r.target_id : r.source_id;
              if (a === sourceId) existingPairs.add(b);
            }
            for (const tg of massEditRelTargets) {
              if (existingPairs.has(tg.id)) continue;
              if (tg.id === sourceId) continue; // can't link to self
              ops.push(
                api.post("/relations", {
                  type: relType.key,
                  source_id: isSource ? sourceId : tg.id,
                  target_id: isSource ? tg.id : sourceId,
                }),
              );
              opSourceIds.push(sourceId);
            }
          }
        } else {
          // remove: find relations of this type whose other-end is in the chosen targets
          for (const sourceId of selectedIds) {
            for (const r of allRels) {
              const a = isSource ? r.source_id : r.target_id;
              const b = isSource ? r.target_id : r.source_id;
              if (a !== sourceId) continue;
              if (!targetIdSet.has(b)) continue;
              ops.push(api.delete(`/relations/${r.id}`));
              opSourceIds.push(sourceId);
            }
          }
        }

        if (ops.length === 0) {
          // nothing to do — surface as a soft message, not an error
          setMassEditError(
            massEditRelMode === "add"
              ? t("massEdit.rel.nothingToAdd")
              : t("massEdit.rel.nothingToRemove"),
          );
          return;
        }

        const results = await Promise.allSettled(ops);
        // Aggregate per-source-card status: a card "succeeded" if every op for it resolved.
        const cardStatus = new Map<string, { ok: number; fail: number; firstError?: string }>();
        results.forEach((r, i) => {
          const sid = opSourceIds[i];
          const cur = cardStatus.get(sid) ?? { ok: 0, fail: 0 };
          if (r.status === "fulfilled") cur.ok += 1;
          else {
            cur.fail += 1;
            if (!cur.firstError) {
              cur.firstError =
                r.reason instanceof Error ? r.reason.message : t("massEdit.failed");
            }
          }
          cardStatus.set(sid, cur);
        });

        const blockers: typeof massEditBlockers = [];
        let succeeded = 0;
        for (const sid of selectedIds) {
          const status = cardStatus.get(sid);
          if (!status || status.fail === 0) {
            succeeded += 1;
            continue;
          }
          const card = data.find((d) => d.id === sid);
          blockers.push({
            id: sid,
            name: card?.name ?? sid,
            missingRelations: [],
            missingTagGroups: [],
            message: status.firstError ?? t("massEdit.failed"),
          });
        }
        await loadData();
        await fetchRelations();
        if (blockers.length === 0) {
          setMassEditOpen(false);
          setMassEditField("");
          setMassEditValue("");
          setMassEditRelTargets([]);
          setMassEditRelSearch("");
          return;
        }
        setMassEditSucceeded(succeeded);
        setMassEditBlockers(blockers);
        return;
      }

      if (massEditField === "subtype") {
        await api.patch("/cards/bulk", {
          ids: selectedIds,
          updates: { subtype: massEditValue || null },
        });
      } else if (massEditField === "tags") {
        const tagIds = Array.isArray(massEditValue) ? (massEditValue as string[]) : [];
        if (tagIds.length === 0) {
          setMassEditError(t("massEdit.tags.pickAtLeastOne"));
          return;
        }
        const results = await Promise.allSettled(
          selectedIds.map((id) => {
            if (massEditRelMode === "add") {
              return api.post(`/cards/${id}/tags`, tagIds);
            }
            return Promise.all(
              tagIds.map((tagId) => api.delete(`/cards/${id}/tags/${tagId}`)),
            );
          }),
        );
        const blockers: typeof massEditBlockers = [];
        let succeeded = 0;
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            succeeded += 1;
            return;
          }
          const id = selectedIds[i];
          const card = data.find((d) => d.id === id);
          blockers.push({
            id,
            name: card?.name ?? id,
            missingRelations: [],
            missingTagGroups: [],
            message:
              r.reason instanceof Error ? r.reason.message : t("massEdit.failed"),
          });
        });
        await loadData();
        if (blockers.length === 0) {
          setMassEditOpen(false);
          setMassEditField("");
          setMassEditValue("");
          return;
        }
        setMassEditSucceeded(succeeded);
        setMassEditBlockers(blockers);
        return;
      } else if (massEditField.startsWith("attr_")) {
        const attrKey = massEditField.replace("attr_", "");
        const results = await Promise.allSettled(
          selectedIds.map((id) => {
            const existing = data.find((d) => d.id === id);
            const attrs = {
              ...(existing?.attributes || {}),
              [attrKey]: massEditValue || null,
            };
            return api.patch(`/cards/${id}`, { attributes: attrs });
          }),
        );
        const blockers: typeof massEditBlockers = [];
        let succeeded = 0;
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            succeeded += 1;
            return;
          }
          const id = selectedIds[i];
          const card = data.find((d) => d.id === id);
          blockers.push({
            id,
            name: card?.name ?? id,
            missingRelations: [],
            missingTagGroups: [],
            message:
              r.reason instanceof Error ? r.reason.message : t("massEdit.failed"),
          });
        });
        await loadData();
        if (blockers.length === 0) {
          setMassEditOpen(false);
          setMassEditField("");
          setMassEditValue("");
          return;
        }
        setMassEditSucceeded(succeeded);
        setMassEditBlockers(blockers);
        return;
      }

      setMassEditOpen(false);
      setMassEditField("");
      setMassEditValue("");
      loadData();
    } catch (e) {
      setMassEditError(e instanceof Error ? e.message : t("massEdit.failed"));
    } finally {
      setMassEditLoading(false);
    }
  };

  const handleMassArchiveConfirmed = () => {
    setMassArchiveOpen(false);
    setSelectedIds([]);
    gridRef.current?.api?.deselectAll();
    loadData();
  };

  const handleMassDeleteConfirmed = () => {
    setMassDeleteOpen(false);
    setSelectedIds([]);
    gridRef.current?.api?.deselectAll();
    loadData();
  };

  const handleMassRestoreConfirmed = () => {
    setMassRestoreOpen(false);
    setSelectedIds([]);
    gridRef.current?.api?.deselectAll();
    loadData();
  };

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      {
        colId: "core_type",
        field: "type",
        headerName: t("common:labels.type"),
        width: 140,
        hide: !selectedColumns.has("core_type"),
        cellRenderer: (p: { value: string }) => {
          const tp = types.find((x) => x.key === p.value);
          return tp ? (
            <Chip
              size="small"
              label={rml(tp.key, tp.translations, "label")}
              sx={{ bgcolor: tp.color, color: "#fff", fontWeight: 500 }}
            />
          ) : (
            p.value
          );
        },
      },
      {
        colId: "core_name",
        field: "name",
        headerName: t("common:labels.name"),
        flex: 1,
        minWidth: 220,
        editable: gridEditMode,
        hide: !selectedColumns.has("core_name"),
        cellStyle: gridEditMode
          ? { fontWeight: 500 }
          : { cursor: "pointer", fontWeight: 500 },
        cellRenderer: gridEditMode
          ? undefined
          : (p: { data?: Card; value: string }) => {
              if (!p.data) return p.value ?? "";
              const id = p.data.id;
              return (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    width: "100%",
                  }}
                >
                  <Tooltip title={t("actions.previewCard")}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        // Don't bubble up to onRowClicked (which would
                        // navigate to the full page), and don't follow the
                        // sibling link.
                        e.stopPropagation();
                        e.preventDefault();
                        setPreviewCardId(id);
                      }}
                      sx={{ p: 0.25 }}
                      aria-label={t("actions.previewCard")}
                    >
                      <MaterialSymbol icon="visibility" size={16} />
                    </IconButton>
                  </Tooltip>
                  <Box
                    component={RouterLink}
                    to={`/cards/${id}`}
                    sx={{
                      color: "inherit",
                      textDecoration: "none",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      "&:hover": { textDecoration: "underline" },
                    }}
                    onClick={(e) => {
                      // Modifier-clicks: let the browser handle natively
                      // (open in new tab/window). Suppress the row-click so
                      // the current tab doesn't also navigate.
                      if (
                        e.ctrlKey ||
                        e.metaKey ||
                        e.shiftKey ||
                        (e as React.MouseEvent).button === 1
                      ) {
                        e.stopPropagation();
                      }
                    }}
                  >
                    {p.value}
                  </Box>
                </Box>
              );
            },
      },
      {
        colId: "core_path",
        headerName: t("columns.path"),
        flex: 1,
        minWidth: 180,
        sortable: true,
        hide: !selectedColumns.has("core_path"),
        valueGetter: (p: { data?: Card }) =>
          p.data ? parentPaths.get(p.data.id) ?? "" : "",
        cellStyle: { color: "var(--mui-palette-text-secondary)" },
      },
      {
        colId: "core_description",
        field: "description",
        headerName: t("common:labels.description"),
        flex: 1,
        minWidth: 200,
        editable: gridEditMode,
        hide: !selectedColumns.has("core_description"),
      },
    ];

    // Add subtype column when a type with subtypes is selected
    if (typeConfig?.subtypes && typeConfig.subtypes.length > 0) {
      cols.push({
        colId: "core_subtype",
        field: "subtype",
        headerName: t("common:labels.subtype"),
        width: 140,
        editable: gridEditMode,
        hide: !selectedColumns.has("core_subtype"),
        ...(gridEditMode
          ? {
              cellEditor: "agSelectCellEditor",
              cellEditorParams: {
                values: ["", ...typeConfig.subtypes.map((s) => s.key)],
              },
            }
          : {}),
        cellRenderer: (p: { value: string }) => {
          if (!p.value) return "";
          const st = typeConfig.subtypes?.find((s) => s.key === p.value);
          return (
            <Chip
              size="small"
              label={st ? rl(st.label, st.translations) : p.value}
              variant="outlined"
            />
          );
        },
      });
    }

    cols.push(
      {
        colId: "core_lifecycle",
        headerName: t("columns.lifecycle"),
        width: 150,
        hide: !selectedColumns.has("core_lifecycle"),
        valueGetter: (p: { data: Card }) => {
          const lc = p.data?.lifecycle || {};
          const now = new Date().toISOString().slice(0, 10);
          for (const phase of [
            "endOfLife",
            "phaseOut",
            "active",
            "phaseIn",
            "plan",
          ]) {
            if (lc[phase] && lc[phase] <= now) return phase;
          }
          return "";
        },
        cellRenderer: (p: { data: Card }) => {
          const lifecycle = p.data?.lifecycle as
            | Record<string, string>
            | undefined;
          if (!lifecycle) return "";
          return <LifecycleBadge lifecycle={lifecycle} />;
        },
      },
      {
        colId: "core_approval_status",
        field: "approval_status",
        headerName: t("columns.approvalStatus"),
        width: 110,
        hide: !selectedColumns.has("core_approval_status"),
        cellRenderer: (p: { value: string }) => {
          const color =
            APPROVAL_STATUS_COLORS[p.value as keyof typeof APPROVAL_STATUS_COLORS];
          if (!color) return "";
          const labels: Record<string, string> = {
            DRAFT: t("common:status.draft"),
            APPROVED: t("common:status.approved"),
            BROKEN: t("common:status.broken"),
            REJECTED: t("common:status.rejected"),
          };
          return (
            <Chip
              size="small"
              label={labels[p.value] || p.value}
              sx={{ bgcolor: color, color: "#fff", fontWeight: 500 }}
            />
          );
        },
      },
      {
        colId: "core_data_quality",
        field: "data_quality",
        headerName: t("columns.dataQuality"),
        width: 130,
        hide: !selectedColumns.has("core_data_quality"),
        cellRenderer: (p: { value: number }) => {
          const v = Math.round(p.value || 0);
          const color =
            v >= 80 ? "#4caf50" : v >= 50 ? "#ff9800" : "#f44336";
          return (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
                pr: 1,
              }}
            >
              <LinearProgress
                variant="determinate"
                value={v}
                sx={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  bgcolor: "action.selected",
                  "& .MuiLinearProgress-bar": { bgcolor: color, borderRadius: 3 },
                }}
              />
              <Typography variant="caption" sx={{ minWidth: 32, textAlign: "right" }}>
                {v}%
              </Typography>
            </Box>
          );
        },
      },
      {
        colId: "core_tags",
        field: "tags",
        headerName: t("columns.tags"),
        width: 200,
        sortable: false,
        hide: !selectedColumns.has("core_tags"),
        editable: gridEditMode,
        cellEditor: TagsCellEditor,
        cellEditorPopup: true,
        cellEditorParams: { groups: tagGroups, typeKey: selectedType || undefined },
        valueSetter: (p: { data: Card; newValue: TagRef[] }) => {
          p.data.tags = p.newValue || [];
          return true;
        },
        // The cell value is a TagRef[]; without this, AG Grid's column-header
        // text filter stringifies it to "[object Object]" and never matches a
        // typed tag name (issue #728). Filter on the joined tag names instead.
        filterValueGetter: (p: { data?: Card }) => tagsToFilterText(p.data?.tags),
        cellRenderer: (p: { value: TagRef[] }) => {
          const tags = p.value || [];
          if (tags.length === 0) return "";
          const visible = tags.slice(0, 3);
          const overflow = tags.length - visible.length;
          return (
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 0.25,
                rowGap: "2px",
                alignItems: "center",
                lineHeight: 1,
              }}
            >
              {visible.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  size="small"
                  sx={{
                    height: 16,
                    fontSize: 11,
                    "& .MuiChip-label": { px: 0.75 },
                    ...(tag.color ? { bgcolor: tag.color, color: "#fff" } : {}),
                  }}
                />
              ))}
              {overflow > 0 && (
                <Chip
                  label={`+${overflow}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 16, fontSize: 11, "& .MuiChip-label": { px: 0.75 } }}
                />
              )}
            </Box>
          );
        },
      }
    );

    // Show status column when archived items are included
    if (filters.showArchived) {
      cols.push({
        colId: "core_status",
        field: "status",
        headerName: t("common:labels.status"),
        width: 110,
        cellRenderer: (p: { value: string }) => {
          if (p.value === "ARCHIVED") {
            return (
              <Chip size="small" label={t("common:status.archived")} sx={{ bgcolor: "#9e9e9e", color: "#fff", fontWeight: 500 }} />
            );
          }
          return <Chip size="small" label={t("common:status.active")} variant="outlined" sx={{ fontWeight: 500 }} />;
        },
      });
    }

    // Add type-specific attribute columns
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const field of section.fields) {
          // Hide cost columns when the user lacks the global costs.view perm.
          // Stakeholder-aware visibility per row would create a confusing
          // grid (some cells empty, others populated) — the inventory grid is
          // gated on the global permission.
          if (field.type === "cost" && !canViewCostsGlobally) continue;
          const colKey = `attr_${field.key}`;
          cols.push({
            field: colKey,
            headerName: rl(field.key, field.translations),
            width: 150,
            hide: !selectedColumns.has(colKey),
            editable: gridEditMode && !field.readonly,
            valueGetter: (p: { data: Card }) =>
              (p.data?.attributes || {})[field.key] ?? "",
            valueSetter: (p) => {
              if (!p.data.attributes) p.data.attributes = {};
              (p.data.attributes as Record<string, unknown>)[field.key] =
                p.newValue;
              return true;
            },
            ...(field.type === "single_select" && field.options
              ? {
                  cellEditor: "agSelectCellEditor",
                  cellEditorParams: {
                    values: ["", ...field.options.map((o) => o.key)],
                  },
                  cellRenderer: (p: { value: string }) => {
                    const opt = field.options?.find((o) => o.key === p.value);
                    return opt ? (
                      <Chip
                        size="small"
                        label={rl(opt.label || opt.key, opt.translations)}
                        sx={
                          opt.color
                            ? { bgcolor: opt.color, color: "#fff" }
                            : {}
                        }
                      />
                    ) : (
                      p.value || ""
                    );
                  },
                }
              : {}),
            ...(field.type === "multiple_select" && field.options
              ? {
                  cellRenderer: (p: { value: unknown }) => {
                    const arr = Array.isArray(p.value) ? p.value : [];
                    return (
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                        {arr.map((v) => {
                          const opt = field.options?.find((o) => o.key === v);
                          return (
                            <Chip
                              key={String(v)}
                              size="small"
                              label={opt ? rl(opt.label || opt.key, opt.translations) : String(v)}
                              sx={opt?.color ? { bgcolor: opt.color, color: "#fff" } : {}}
                            />
                          );
                        })}
                      </Box>
                    );
                  },
                }
              : {}),
            ...(field.type === "multiline_text"
              ? {
                  cellEditor: "agLargeTextCellEditor",
                  cellEditorPopup: true,
                  cellEditorParams: { rows: 8, cols: 60, maxLength: 100000 },
                }
              : {}),
          });
        }
      }
    } else if (commonFields.length > 0) {
      // Multiple types selected: show common fields across all selected types
      for (const field of commonFields) {
        if (field.type === "cost" && !canViewCostsGlobally) continue;
        const colKey = `attr_${field.key}`;
        cols.push({
          field: colKey,
          headerName: rl(field.key, field.translations),
          width: 150,
          hide: !selectedColumns.has(colKey),
          valueGetter: (p: { data: Card }) =>
            (p.data?.attributes || {})[field.key] ?? "",
          ...(field.type === "single_select" && field.options
            ? {
                cellRenderer: (p: { value: string }) => {
                  const opt = field.options?.find((o) => o.key === p.value);
                  return opt ? (
                    <Chip
                      size="small"
                      label={rl(opt.label || opt.key, opt.translations)}
                      sx={opt.color ? { bgcolor: opt.color, color: "#fff" } : {}}
                    />
                  ) : (
                    p.value || ""
                  );
                },
              }
            : {}),
          ...(field.type === "multiple_select" && field.options
            ? {
                cellRenderer: (p: { value: unknown }) => {
                  const arr = Array.isArray(p.value) ? p.value : [];
                  return (
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {arr.map((v) => {
                        const opt = field.options?.find((o) => o.key === v);
                        return (
                          <Chip
                            key={String(v)}
                            size="small"
                            label={opt ? rl(opt.label || opt.key, opt.translations) : String(v)}
                            sx={opt?.color ? { bgcolor: opt.color, color: "#fff" } : {}}
                          />
                        );
                      })}
                    </Box>
                  );
                },
              }
            : {}),
        });
      }
    }

    // Add relation columns (one per other-end type, merging grouped relation types)
    for (const rt of relevantRelTypes) {
      const isSource = rt.source_type_key === selectedType;
      const otherTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
      const otherType = types.find((t) => t.key === otherTypeKey);
      const headerName = otherType ? rml(otherType.key, otherType.translations, "label") : otherTypeKey;
      const relTypeRef = rt;
      const colKey = `rel_${otherTypeKey}`;
      // All relation type keys that connect selectedType ↔ otherTypeKey
      const groupKeys = relTypeGroupMap.get(otherTypeKey) || [rt.key];

      cols.push({
        field: colKey,
        headerName,
        width: 180,
        hide: !selectedColumns.has(colKey),
        valueGetter: (p: { data: Card }) => {
          // Merge names from all relation types in the group
          const allNames: string[] = [];
          for (const rk of groupKeys) {
            const index = relationsMap.get(rk);
            if (index) {
              const names = index.get(p.data?.id);
              if (names) allNames.push(...names);
            }
          }
          // Deduplicate
          return [...new Set(allNames)].join("; ");
        },
        cellRenderer: (p: { value: string; data: Card }) => {
          if (gridEditMode) {
            return (
              <Box
                onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setRelEditOpen(true);
                  setRelEditFsId(p.data.id);
                  setRelEditFsName(p.data.name);
                  setRelEditRelType(relTypeRef);
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  overflow: "hidden",
                  cursor: "pointer",
                  width: "100%",
                  height: "100%",
                  "&:hover": { bgcolor: "action.hover" },
                  borderRadius: 0.5,
                  px: 0.5,
                }}
              >
                {otherType && (
                  <MaterialSymbol icon={otherType.icon} size={14} color={otherType.color} />
                )}
                <Typography
                  variant="body2"
                  sx={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
                  title={p.value}
                >
                  {p.value || <span style={{ opacity: 0.5 }}>{t("columns.clickToEdit")}</span>}
                </Typography>
                <MaterialSymbol icon="edit" size={14} />
              </Box>
            );
          }
          if (!p.value) return "";
          return (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                overflow: "hidden",
              }}
            >
              {otherType && (
                <MaterialSymbol icon={otherType.icon} size={14} color={otherType.color} />
              )}
              <Typography
                variant="body2"
                sx={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={p.value}
              >
                {p.value}
              </Typography>
            </Box>
          );
        },
      });
    }

    // Metadata columns (always defined, shown/hidden via selectedColumns)
    cols.push(
      {
        colId: "meta_created_at",
        field: "created_at",
        headerName: t("columns.createdAt"),
        width: 160,
        hide: !selectedColumns.has("meta_created_at"),
        valueFormatter: (p) => (p.value ? formatDateTime(p.value) : ""),
      },
      {
        colId: "meta_updated_at",
        field: "updated_at",
        headerName: t("columns.updatedAt"),
        width: 160,
        hide: !selectedColumns.has("meta_updated_at"),
        valueFormatter: (p) => (p.value ? formatDateTime(p.value) : ""),
      },
      {
        colId: "meta_created_by",
        field: "created_by",
        headerName: t("columns.createdBy"),
        width: 150,
        hide: !selectedColumns.has("meta_created_by"),
        valueFormatter: (p: { value?: string }) =>
          p.value ? userNameMap[p.value] ?? p.value : "",
      },
      {
        colId: "meta_updated_by",
        field: "updated_by",
        headerName: t("columns.updatedBy"),
        width: 150,
        hide: !selectedColumns.has("meta_updated_by"),
        valueFormatter: (p: { value?: string }) =>
          p.value ? userNameMap[p.value] ?? p.value : "",
      }
    );

    return cols;
  }, [types, typeConfig, commonFields, gridEditMode, relevantRelTypes, relTypeGroupMap, relationsMap, selectedType, parentPaths, filters.showArchived, selectedColumns, userNameMap, t, formatDate, formatDateTime, canViewCostsGlobally, tagGroups]);

  // Restore the saved column layout (order/width/pinning/sort) onto the grid.
  // Keyed on `columnDefs` so it re-applies each time the column *set* changes —
  // crucially when attribute/relation columns arrive after the metamodel loads,
  // which happens *after* the grid is ready. We strip `hide` so visibility keeps
  // flowing from `selectedColumns`. `restorePendingRef` stops the restore once
  // the user manually rearranges; `applyingLayoutRef` guards against capturing
  // the events this apply fires. Without re-applying on columnDefs changes, a
  // one-shot restore at grid-ready loses the late-arriving columns' positions.
  useEffect(() => {
    if (!gridReady || !restorePendingRef.current) return;
    const layout = columnStateRef.current;
    if (!layout || layout.length === 0) return;
    const api = gridRef.current?.api;
    if (!api) return;
    const state: ColumnState[] = layout.map(({ hide: _hide, ...rest }) => rest);
    applyingLayoutRef.current = true;
    api.applyColumnState({ state, applyOrder: true });
    applyingLayoutRef.current = false;
  }, [gridReady, columnDefs, layoutNonce]);

  // Render mass edit value input based on field type
  const renderMassEditInput = () => {
    if (!currentMassField) return null;

    if (massEditField === "approval_status") {
      return (
        <FormControl fullWidth size="small">
          <InputLabel>{t("massEdit.value")}</InputLabel>
          <Select value={(massEditValue as string) || ""} label={t("massEdit.value")} onChange={(e) => setMassEditValue(e.target.value)}>
            <MenuItem value="DRAFT">{t("common:status.draft")}</MenuItem>
            <MenuItem value="APPROVED">{t("common:status.approved")}</MenuItem>
            <MenuItem value="REJECTED">{t("common:status.rejected")}</MenuItem>
          </Select>
        </FormControl>
      );
    }

    if (massEditField === "subtype" && typeConfig?.subtypes) {
      return (
        <FormControl fullWidth size="small">
          <InputLabel>{t("massEdit.value")}</InputLabel>
          <Select value={(massEditValue as string) || ""} label={t("massEdit.value")} onChange={(e) => setMassEditValue(e.target.value)}>
            <MenuItem value=""><em>{t("common:labels.none")}</em></MenuItem>
            {typeConfig.subtypes.map((st) => (
              <MenuItem key={st.key} value={st.key}>{rl(st.label, st.translations)}</MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (massEditField === "tags") {
      const ids = Array.isArray(massEditValue) ? (massEditValue as string[]) : [];
      return (
        <Box>
          <ToggleButtonGroup
            value={massEditRelMode}
            exclusive
            size="small"
            onChange={(_, val) => { if (val) setMassEditRelMode(val); }}
            sx={{ mb: 2 }}
          >
            <ToggleButton value="add" sx={{ textTransform: "none", px: 2 }}>
              <MaterialSymbol icon="add" size={16} style={{ marginRight: 6 }} />
              {t("massEdit.tags.add")}
            </ToggleButton>
            <ToggleButton value="remove" sx={{ textTransform: "none", px: 2 }}>
              <MaterialSymbol icon="remove" size={16} style={{ marginRight: 6 }} />
              {t("massEdit.tags.remove")}
            </ToggleButton>
          </ToggleButtonGroup>
          <TagPicker
            groups={tagGroups}
            value={ids}
            onChange={(next) => setMassEditValue(next)}
            typeKey={selectedType || undefined}
            size="small"
            label={t("columns.tags")}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
            {massEditRelMode === "add"
              ? t("massEdit.tags.addHint", { count: selectedIds.length })
              : t("massEdit.tags.removeHint", { count: selectedIds.length })}
          </Typography>
        </Box>
      );
    }

    if (currentMassField.relInfo) {
      const otherType = types.find((tp) => tp.key === currentMassField.relInfo!.otherTypeKey);
      const otherLabel = otherType
        ? rml(otherType.key, otherType.translations, "label")
        : currentMassField.relInfo.otherTypeKey;
      return (
        <Box>
          <ToggleButtonGroup
            value={massEditRelMode}
            exclusive
            size="small"
            onChange={(_, val) => { if (val) setMassEditRelMode(val); }}
            sx={{ mb: 2 }}
          >
            <ToggleButton value="add" sx={{ textTransform: "none", px: 2 }}>
              <MaterialSymbol icon="add_link" size={16} style={{ marginRight: 6 }} />
              {t("massEdit.rel.add")}
            </ToggleButton>
            <ToggleButton value="remove" sx={{ textTransform: "none", px: 2 }}>
              <MaterialSymbol icon="link_off" size={16} style={{ marginRight: 6 }} />
              {t("massEdit.rel.remove")}
            </ToggleButton>
          </ToggleButtonGroup>
          <Autocomplete
            multiple
            size="small"
            fullWidth
            options={massEditRelOptions}
            value={massEditRelTargets}
            getOptionLabel={(opt) => opt.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_, val) => setMassEditRelTargets(val)}
            inputValue={massEditRelSearch}
            onInputChange={(_, val) => setMassEditRelSearch(val)}
            filterOptions={(x) => x}
            renderOption={(props, opt) => {
              const tConf = types.find((tp) => tp.key === opt.type);
              return (
                <li {...props} key={opt.id}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {tConf && <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: tConf.color }} />}
                    <Typography variant="body2">{opt.name}</Typography>
                  </Box>
                </li>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((opt, i) => (
                <Chip
                  size="small"
                  label={opt.name}
                  {...getTagProps({ index: i })}
                  key={opt.id}
                  sx={otherType ? { bgcolor: `${otherType.color}22` } : undefined}
                />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("massEdit.rel.targets", { type: otherLabel })}
                placeholder={t("massEdit.rel.searchPlaceholder", { type: otherLabel })}
              />
            )}
            noOptionsText={
              massEditRelSearch
                ? t("common:labels.noResults")
                : t("massEdit.rel.typeToSearch", { type: otherLabel })
            }
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
            {massEditRelMode === "add"
              ? t("massEdit.rel.addHint", { count: selectedIds.length, type: otherLabel })
              : t("massEdit.rel.removeHint", { count: selectedIds.length, type: otherLabel })}
          </Typography>
        </Box>
      );
    }

    const fd = currentMassField.fieldDef;
    if (!fd) return null;

    if (fd.type === "single_select" && fd.options) {
      return (
        <FormControl fullWidth size="small">
          <InputLabel>{t("massEdit.value")}</InputLabel>
          <Select value={(massEditValue as string) || ""} label={t("massEdit.value")} onChange={(e) => setMassEditValue(e.target.value)}>
            <MenuItem value=""><em>{t("massEdit.clear")}</em></MenuItem>
            {fd.options.map((opt) => (
              <MenuItem key={opt.key} value={opt.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {opt.color && <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: opt.color }} />}
                  {rl(opt.label || opt.key, opt.translations)}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (fd.type === "number" || fd.type === "cost") {
      return (
        <TextField
          fullWidth
          size="small"
          label={t("massEdit.value")}
          type="number"
          value={massEditValue ?? ""}
          onChange={(e) => setMassEditValue(e.target.value ? Number(e.target.value) : "")}
        />
      );
    }

    return (
      <TextField
        fullWidth
        size="small"
        label={t("massEdit.value")}
        value={(massEditValue as string) ?? ""}
        onChange={(e) => setMassEditValue(e.target.value)}
      />
    );
  };

  return (
    <Box sx={{ display: "flex", height: "calc(100vh - 64px)", m: -3 }}>
      {/* Sidebar — Drawer on mobile, inline on desktop */}
      {isMobile ? (
        <Drawer
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          PaperProps={{ sx: { width: 300 } }}
        >
          <InventoryFilterSidebar
            types={types}
            filters={filters}
            onFiltersChange={setFilters}
            collapsed={false}
            onToggleCollapse={() => setFilterDrawerOpen(false)}
            width={300}
            onWidthChange={() => {}}
            relevantRelTypes={relevantRelTypes}
            relationsMap={relationsMap}
            tagGroups={tagGroups}
            canArchive={canArchive}
            canShareBookmarks={canShareBookmarks}
            canOdataBookmarks={canOdataBookmarks}
            currentUserId={user?.id}
            selectedColumns={selectedColumns}
            onSelectedColumnsChange={setSelectedColumns}
            defaultColumns={defaultColumns}
            onResetColumns={handleResetColumns}
            columnState={columnState}
            onApplyColumnState={applyColumnLayout}
          />
        </Drawer>
      ) : (
        <InventoryFilterSidebar
          types={types}
          filters={filters}
          onFiltersChange={setFilters}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          relevantRelTypes={relevantRelTypes}
          relationsMap={relationsMap}
          tagGroups={tagGroups}
          canArchive={canArchive}
          canShareBookmarks={canShareBookmarks}
          canOdataBookmarks={canOdataBookmarks}
          currentUserId={user?.id}
          selectedColumns={selectedColumns}
          onSelectedColumnsChange={setSelectedColumns}
          defaultColumns={defaultColumns}
          onResetColumns={handleResetColumns}
          columnState={columnState}
          onApplyColumnState={applyColumnLayout}
        />
      )}

      {/* Main content */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: { xs: 1, sm: 2 } }}>
        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1, sm: 2 }, mb: 1.5, flexShrink: 0, flexWrap: "wrap" }}>
          {isMobile && (
            <Tooltip title={t("toolbar.filters")}>
              <IconButton onClick={() => setFilterDrawerOpen(true)} size="small">
                <MaterialSymbol icon="filter_list" size={22} />
              </IconButton>
            </Tooltip>
          )}
          <Typography variant={isMobile ? "h6" : "h5"} fontWeight={600}>
            {t("page.title")}
          </Typography>
          <Chip label={t("common:items", { count: filteredData.length })} size="small" />
          <Box sx={{ flex: 1 }} />
          {isMobile ? (
            <>
              <Tooltip title={gridEditMode ? t("toolbar.editing") : t("toolbar.gridEdit")}>
                <IconButton
                  color={gridEditMode ? "primary" : "default"}
                  onClick={() => setGridEditMode((v) => !v)}
                  size="small"
                >
                  <MaterialSymbol icon={gridEditMode ? "edit" : "edit_off"} size={20} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("common:actions.export")}>
                <span>
                  <IconButton
                    onClick={(e) => setExportMenuAnchor(e.currentTarget)}
                    disabled={filteredData.length === 0}
                    size="small"
                  >
                    <MaterialSymbol icon="download" size={20} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t("common:actions.import")}>
                <IconButton onClick={() => setImportOpen(true)} size="small">
                  <MaterialSymbol icon="upload" size={20} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("common:actions.create")}>
                <IconButton color="primary" onClick={() => setCreateOpen(true)} size="small">
                  <MaterialSymbol icon="add" size={20} />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <Button
                variant={gridEditMode ? "contained" : "outlined"}
                color={gridEditMode ? "primary" : "inherit"}
                startIcon={<MaterialSymbol icon={gridEditMode ? "edit" : "edit_off"} size={18} />}
                onClick={() => setGridEditMode((v) => !v)}
                sx={{ textTransform: "none" }}
              >
                {gridEditMode ? t("toolbar.editing") : t("toolbar.gridEdit")}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<MaterialSymbol icon="download" size={18} />}
                endIcon={<MaterialSymbol icon="arrow_drop_down" size={18} />}
                onClick={(e) => setExportMenuAnchor(e.currentTarget)}
                disabled={filteredData.length === 0}
                sx={{ textTransform: "none" }}
              >
                {t("common:actions.export")}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<MaterialSymbol icon="upload" size={18} />}
                onClick={() => setImportOpen(true)}
                sx={{ textTransform: "none" }}
              >
                {t("common:actions.import")}
              </Button>
              <Button
                variant="contained"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={() => setCreateOpen(true)}
                sx={{ textTransform: "none" }}
              >
                {t("common:actions.create")}
              </Button>
            </>
          )}
        </Box>

        {/* Export menu — full importable workbook vs. WYSIWYG current view */}
        <Menu
          anchorEl={exportMenuAnchor}
          open={Boolean(exportMenuAnchor)}
          onClose={() => setExportMenuAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              exportToExcel(filteredData, typeConfig, types, relationTypes, {
                canViewCosts: canViewCostsGlobally,
              });
              setExportMenuAnchor(null);
            }}
          >
            <ListItemText
              primary={t("export.allFields")}
              secondary={t("export.allFieldsHint")}
            />
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              handleExportCurrentView();
              setExportMenuAnchor(null);
            }}
          >
            <ListItemText
              primary={t("export.currentView")}
              secondary={t("export.currentViewHint")}
            />
          </MenuItem>
        </Menu>

        {/* Mass edit toolbar */}
        {selectedIds.length > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              columnGap: { xs: 1, sm: 2 },
              rowGap: 1,
              mb: 1,
              px: { xs: 1, sm: 2 },
              py: 1,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              borderRadius: 1,
              flexShrink: 0,
            }}
          >
            <MaterialSymbol icon="check_box" size={20} />
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ whiteSpace: "nowrap", mr: { xs: "auto", sm: 0 } }}
            >
              {t("selectedCount", { count: selectedIds.length })}
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="inherit"
              sx={{
                color: "primary.main",
                bgcolor: "background.paper",
                textTransform: "none",
                whiteSpace: "nowrap",
                "&:hover": { bgcolor: "action.selected" },
              }}
              startIcon={<MaterialSymbol icon="edit" size={16} />}
              onClick={() => {
                setMassEditOpen(true);
                setMassEditField("");
                setMassEditValue("");
                setMassEditError("");
                setMassEditBlockers([]);
                setMassEditSucceeded(0);
                setMassEditRelTargets([]);
                setMassEditRelSearch("");
                setMassEditRelMode("add");
              }}
            >
              {t("massEdit.title")}
            </Button>
            {canArchive && !filters.showArchived && (
              <Button
                size="small"
                variant="contained"
                color="inherit"
                sx={{
                  color: "#e65100",
                  bgcolor: "background.paper",
                  textTransform: "none",
                  whiteSpace: "nowrap",
                  "&:hover": { bgcolor: "action.selected" },
                }}
                startIcon={<MaterialSymbol icon="archive" size={16} />}
                onClick={() => setMassArchiveOpen(true)}
              >
                {t("common:actions.archive")}
              </Button>
            )}
            {canArchive && filters.showArchived && (
              <Button
                size="small"
                variant="contained"
                color="inherit"
                sx={{
                  color: "#2e7d32",
                  bgcolor: "background.paper",
                  textTransform: "none",
                  whiteSpace: "nowrap",
                  "&:hover": { bgcolor: "action.selected" },
                }}
                startIcon={<MaterialSymbol icon="restore" size={16} />}
                onClick={() => setMassRestoreOpen(true)}
              >
                {t("common:actions.restore")}
              </Button>
            )}
            {canDelete && filters.showArchived && (
              <Button
                size="small"
                variant="contained"
                color="inherit"
                sx={{
                  color: "#c62828",
                  bgcolor: "background.paper",
                  textTransform: "none",
                  whiteSpace: "nowrap",
                  "&:hover": { bgcolor: "action.selected" },
                }}
                startIcon={<MaterialSymbol icon="delete_forever" size={16} />}
                onClick={() => setMassDeleteOpen(true)}
              >
                {t("massEdit.deletePermanently")}
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              sx={{
                borderColor: "rgba(255,255,255,0.5)",
                textTransform: "none",
                whiteSpace: "nowrap",
              }}
              onClick={() => gridRef.current?.api?.deselectAll()}
            >
              {t("massEdit.clearSelection")}
            </Button>
          </Box>
        )}

        {/* AG Grid */}
        <Box
          className={mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
          sx={{ flex: 1, width: "100%", minHeight: 0 }}
        >
          <AgGridReact
            key={isRtl ? "rtl" : "ltr"}
            enableRtl={isRtl}
            ref={gridRef}
            rowData={filteredData}
            columnDefs={columnDefs}
            loading={loading}
            rowSelection={rowSelection}
            onSelectionChanged={handleSelectionChanged}
            onCellValueChanged={handleCellEdit}
            onRowClicked={onRowClicked}
            onSortChanged={handleSortChanged}
            onGridReady={handleGridReady}
            onDragStopped={captureColumnState}
            onColumnPinned={captureColumnState}
            maintainColumnOrder
            getRowId={getRowId}
            getRowStyle={getRowStyle}
            animateRows
            defaultColDef={defaultColDef}
            initialState={
              sortModel.length > 0
                ? {
                    sort: {
                      sortModel: sortModel.map((s) => ({
                        colId: s.colId,
                        sort: s.sort as "asc" | "desc",
                      })),
                    },
                  }
                : undefined
            }
          />
        </Box>
      </Box>

      {/* Mass Edit Dialog */}
      <Dialog open={massEditOpen} onClose={() => setMassEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {t("massEdit.dialogTitle", { count: selectedIds.length })}
        </DialogTitle>
        <DialogContent>
          {massEditError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setMassEditError("")}>{massEditError}</Alert>}
          {massEditBlockers.length > 0 && (
            <Alert
              severity={massEditSucceeded > 0 ? "warning" : "error"}
              sx={{ mb: 2 }}
              onClose={() => {
                setMassEditBlockers([]);
                setMassEditSucceeded(0);
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {t("massEdit.partialSummary", {
                  succeeded: massEditSucceeded,
                  blocked: massEditBlockers.length,
                })}
              </Typography>
              <Box
                component="ul"
                sx={{ m: 0, pl: 2, maxHeight: 220, overflowY: "auto" }}
              >
                {massEditBlockers.slice(0, 50).map((b) => {
                  const reasons: string[] = [];
                  if (b.missingRelations.length)
                    reasons.push(
                      t("massEdit.missingRelations", {
                        items: b.missingRelations.join(", "),
                      }),
                    );
                  if (b.missingTagGroups.length)
                    reasons.push(
                      t("massEdit.missingTagGroups", {
                        items: b.missingTagGroups.join(", "),
                      }),
                    );
                  if (b.message) reasons.push(b.message);
                  return (
                    <li key={b.id}>
                      <Box
                        component="a"
                        href={`/cards/${b.id}`}
                        target="_blank"
                        rel="noopener"
                        sx={{ fontWeight: 500, color: "inherit" }}
                      >
                        {b.name}
                      </Box>
                      {reasons.length > 0 && (
                        <span> — {reasons.join("; ")}</span>
                      )}
                    </li>
                  );
                })}
                {massEditBlockers.length > 50 && (
                  <li>
                    <em>
                      {t("massEdit.andMore", {
                        count: massEditBlockers.length - 50,
                      })}
                    </em>
                  </li>
                )}
              </Box>
            </Alert>
          )}
          <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
            <InputLabel>{t("massEdit.field")}</InputLabel>
            <Select
              value={massEditField}
              label={t("massEdit.field")}
              onChange={(e) => {
                setMassEditField(e.target.value);
                setMassEditValue("");
                setMassEditRelTargets([]);
                setMassEditRelSearch("");
                setMassEditRelMode("add");
                setMassEditError("");
              }}
            >
              {(() => {
                const items: ReactNode[] = [];
                const coreFields = massEditableFields.filter((f) => f.group === "core");
                const attrFields = massEditableFields.filter((f) => f.group === "attribute");
                const relFields = massEditableFields.filter((f) => f.group === "relation");
                if (coreFields.length > 0) {
                  items.push(
                    <ListSubheader key="hdr-core">{t("massEdit.groupCore")}</ListSubheader>,
                  );
                  for (const f of coreFields) items.push(<MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>);
                }
                if (attrFields.length > 0) {
                  items.push(
                    <ListSubheader key="hdr-attr">{t("massEdit.groupAttributes")}</ListSubheader>,
                  );
                  for (const f of attrFields) items.push(<MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>);
                }
                if (relFields.length > 0) {
                  items.push(
                    <ListSubheader key="hdr-rel">{t("massEdit.groupRelations")}</ListSubheader>,
                  );
                  for (const f of relFields) {
                    const otherType = f.relInfo
                      ? types.find((tp) => tp.key === f.relInfo!.otherTypeKey)
                      : undefined;
                    items.push(
                      <MenuItem key={f.key} value={f.key}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          {otherType && (
                            <Box
                              sx={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                bgcolor: otherType.color,
                              }}
                            />
                          )}
                          <span>{f.label}</span>
                        </Box>
                      </MenuItem>,
                    );
                  }
                }
                return items;
              })()}
            </Select>
          </FormControl>
          {massEditField && renderMassEditInput()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMassEditOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleMassEdit}
            disabled={!massEditField || massEditLoading}
          >
            {massEditLoading ? t("massEdit.applying") : t("massEdit.applyToCount", { count: selectedIds.length })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Archive — single dialog when one card selected, bulk dialog otherwise */}
      {massArchiveOpen &&
        (selectedIds.length === 1 ? (
          <ArchiveDeleteDialog
            open
            mode="archive"
            scope="single"
            cardId={selectedIds[0]}
            cardName={data.find((c) => c.id === selectedIds[0])?.name ?? ""}
            onClose={() => setMassArchiveOpen(false)}
            onConfirmed={handleMassArchiveConfirmed}
          />
        ) : (
          <ArchiveDeleteDialog
            open
            mode="archive"
            scope="bulk"
            cardIds={selectedIds}
            onClose={() => setMassArchiveOpen(false)}
            onConfirmed={handleMassArchiveConfirmed}
          />
        ))}

      {/* Restore (bulk only — single-card restore opens from CardDetail). */}
      {massRestoreOpen && (
        <BulkRestoreDialog
          open
          cardIds={selectedIds}
          onClose={() => setMassRestoreOpen(false)}
          onConfirmed={handleMassRestoreConfirmed}
        />
      )}

      {/* Delete — single dialog when one card selected, bulk dialog otherwise */}
      {massDeleteOpen &&
        (selectedIds.length === 1 ? (
          <ArchiveDeleteDialog
            open
            mode="delete"
            scope="single"
            cardId={selectedIds[0]}
            cardName={data.find((c) => c.id === selectedIds[0])?.name ?? ""}
            onClose={() => setMassDeleteOpen(false)}
            onConfirmed={handleMassDeleteConfirmed}
          />
        ) : (
          <ArchiveDeleteDialog
            open
            mode="delete"
            scope="bulk"
            cardIds={selectedIds}
            onClose={() => setMassDeleteOpen(false)}
            onConfirmed={handleMassDeleteConfirmed}
          />
        ))}

      <CreateCardDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setSearchParams({});
        }}
        onCreate={handleCreate}
        initialType={selectedType}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={loadData}
        existingCards={data}
        allTypes={types}
        relationTypes={relationTypes}
        preSelectedType={selectedType || undefined}
        tagGroups={tagGroups}
      />

      <CardDetailSidePanel
        cardId={previewCardId}
        open={!!previewCardId}
        onClose={() => setPreviewCardId(null)}
      />

      {relEditRelType && (
        <RelationCellPopover
          open={relEditOpen}
          onClose={() => { setRelEditOpen(false); setRelEditFsId(""); setRelEditFsName(""); setRelEditRelType(null); }}
          cardId={relEditFsId}
          cardName={relEditFsName}
          relationType={relEditRelType}
          selectedType={selectedType}
          onRelationsChanged={fetchRelations}
        />
      )}
    </Box>
  );
}
