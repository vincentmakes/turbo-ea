import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellValueChangedEvent, SelectionChangedEvent, RowClickedEvent, SortChangedEvent } from "ag-grid-community";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
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
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import CreateCardDialog from "@/components/CreateCardDialog";
import InventoryFilterSidebar, { type Filters } from "./InventoryFilterSidebar";
import ImportDialog from "./ImportDialog";
import { exportToExcel } from "./excelExport";
import RelationCellPopover from "./RelationCellPopover";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { useAuth } from "@/hooks/useAuth";
import { useThemeMode } from "@/hooks/useThemeMode";
import { api } from "@/api/client";
import type { Card, CardListResponse, FieldDef, Relation, RelationType, TagGroup, TagRef } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#9e9e9e",
  APPROVED: "#4caf50",
  BROKEN: "#ff9800",
  REJECTED: "#f44336",
};

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
 * Pre-compute hierarchy display paths from raw card data.
 * Reads names and parent_ids once into plain-string maps, then builds
 * each path by walking the parent chain.  The result is a Map<id, path>
 * that is completely detached from the original data objects.
 */
function buildHierarchyPaths(items: Card[]): Map<string, string> {
  const names = new Map<string, string>();
  const parents = new Map<string, string>();
  for (const card of items) {
    names.set(card.id, card.name);
    if (card.parent_id) parents.set(card.id, card.parent_id);
  }

  const cache = new Map<string, string>();

  function resolve(id: string, seen: Set<string>): string {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const name = names.get(id) ?? "";
    const parentId = parents.get(id);
    if (!parentId || !names.has(parentId) || seen.has(parentId)) {
      cache.set(id, name);
      return name;
    }
    seen.add(id);
    const parentPath = resolve(parentId, seen);
    const path = parentPath ? parentPath + " / " + name : name;
    cache.set(id, path);
    return path;
  }

  for (const card of items) {
    resolve(card.id, new Set([card.id]));
  }
  return cache;
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
  sortModel?: { colId: string; sort: string }[];
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
  const { types, relationTypes } = useMetamodel();
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();
  const { user } = useAuth();
  const { mode } = useThemeMode();
  const canArchive = !!(user?.permissions?.["*"] || user?.permissions?.["inventory.archive"]);
  const canDelete = !!(user?.permissions?.["*"] || user?.permissions?.["inventory.delete"]);
  const canShareBookmarks = !!(user?.permissions?.["*"] || user?.permissions?.["bookmarks.share"]);
  const canOdataBookmarks = !!(user?.permissions?.["*"] || user?.permissions?.["bookmarks.odata"]);
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

  // Relations data: relTypeKey → Map<cardId, relatedNames[]>
  const [relationsMap, setRelationsMap] = useState<Map<string, Map<string, string[]>>>(new Map());

  // Tag groups (for filter + column rendering)
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  useEffect(() => {
    api.get<TagGroup[]>("/tag-groups").then(setTagGroups).catch(() => setTagGroups([]));
  }, []);

  // Dynamic column visibility: set of column keys the user has opted to show
  // Initialized from localStorage if available, otherwise defaults to all when type selected
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(() => {
    const saved = savedPrefsRef.current;
    if (saved?.columns && saved.columns.length > 0) {
      return new Set(saved.columns);
    }
    return new Set();
  });
  // Track whether the user has explicitly set columns (vs auto-populated defaults)
  const [columnsInitialized, setColumnsInitialized] = useState(
    () => !!(savedPrefsRef.current?.columns && savedPrefsRef.current.columns.length > 0),
  );

  // Mass edit state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [massEditOpen, setMassEditOpen] = useState(false);
  const [massEditField, setMassEditField] = useState("");
  const [massEditValue, setMassEditValue] = useState<unknown>("");
  const [massEditError, setMassEditError] = useState("");
  const [massEditLoading, setMassEditLoading] = useState(false);

  // Mass archive / delete state
  const [massArchiveOpen, setMassArchiveOpen] = useState(false);
  const [massArchiveLoading, setMassArchiveLoading] = useState(false);
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);
  const [massDeleteLoading, setMassDeleteLoading] = useState(false);

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

  // Compute the "default" set of columns: all attribute + all relation columns checked
  const defaultColumns = useMemo(() => {
    const cols = new Set<string>();
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
    // Tags column is visible by default whenever any tag groups exist
    if (tagGroups.length > 0) {
      cols.add("tags");
    }
    return cols;
  }, [typeConfig, commonFields, relevantRelTypes, selectedType, tagGroups]);

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
      sortModel,
    });
  }, [filters, selectedColumns, sortModel]);

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
      params.set("page_size", "10000");
      const res = await api.get<CardListResponse>(
        `/cards?${params}`
      );
      setData(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [filters.types, filters.search, filters.approvalStatuses, filters.showArchived]);

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
  const hierarchyPaths = useMemo(() => buildHierarchyPaths(data), [data]);

  // Client-side filtering
  const filteredData = useMemo(() => {
    let result = data;

    // When multiple types selected, filter client-side (API only supports single type)
    if (filters.types.length > 1) {
      result = result.filter((card) => filters.types.includes(card.type));
    }

    // Subtype filter
    if (filters.subtypes.length > 0) {
      result = result.filter((card) => card.subtype && filters.subtypes.includes(card.subtype));
    }

    // Lifecycle filter
    if (filters.lifecyclePhases.length > 0) {
      result = result.filter((card) => filters.lifecyclePhases.includes(getLifecyclePhase(card)));
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
          // multi-select: array of allowed values (OR match)
          if (Array.isArray(val)) {
            if (val.length === 0) return true;
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
          if (!index) return false;
          const names = index.get(card.id);
          if (!names) return false;
          return selectedNames.some((n) => names.includes(n));
        });
      });
    }

    // Tag filters — OR within a group, AND across groups
    const selectedTagIds = filters.tagIds || [];
    if (selectedTagIds.length > 0 && tagGroups.length > 0) {
      // Group selected ids by their tag_group_id
      const tagToGroup = new Map<string, string>();
      for (const g of tagGroups) {
        for (const tg of g.tags) tagToGroup.set(tg.id, g.id);
      }
      const byGroup = new Map<string, Set<string>>();
      for (const id of selectedTagIds) {
        const gid = tagToGroup.get(id);
        if (!gid) continue;
        if (!byGroup.has(gid)) byGroup.set(gid, new Set());
        byGroup.get(gid)!.add(id);
      }
      result = result.filter((card) => {
        const cardTagIds = new Set((card.tags || []).map((tg) => tg.id));
        for (const groupTagIds of byGroup.values()) {
          let anyMatch = false;
          for (const id of groupTagIds) {
            if (cardTagIds.has(id)) {
              anyMatch = true;
              break;
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
    const colState = event.api.getColumnState();
    const sorted = colState
      .filter((c) => c.sort)
      .map((c) => ({ colId: c.colId!, sort: c.sort! }));
    setSortModel(sorted);
  }, []);

  // Stable AG Grid config objects — prevents unnecessary grid re-renders
  const defaultColDef = useMemo(() => ({ sortable: true, filter: true, resizable: true }), []);
  const rowSelection = useMemo(() => ({ mode: "multiRow" as const, enableClickSelection: false, headerCheckbox: true, selectAll: "filtered" as const }), []);
  const getRowId = useCallback((p: { data: Card }) => p.data.id, []);
  const getRowStyle = useCallback((p: { data?: Card }) => p.data?.status === "ARCHIVED" ? { opacity: 0.6 } : undefined, []);
  const onRowClicked = useCallback((e: RowClickedEvent<Card>) => {
    if (!gridEditMode && e.data && !e.event?.defaultPrevented) {
      const api = gridRef.current?.api;
      const selected = api?.getSelectedRows() || [];
      if (selected.length > 0) return;
      navigate(`/cards/${e.data.id}`);
    }
  }, [gridEditMode, navigate]);

  // Mass-editable fields for current type
  const massEditableFields = useMemo(() => {
    const fields: { key: string; label: string; fieldDef?: FieldDef; isCore: boolean }[] = [
      { key: "approval_status", label: t("columns.approvalStatus"), isCore: true },
    ];
    if (typeConfig?.subtypes && typeConfig.subtypes.length > 0) {
      fields.push({ key: "subtype", label: t("common:labels.subtype"), isCore: true });
    }
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const field of section.fields) {
          if (field.readonly) continue;
          fields.push({ key: `attr_${field.key}`, label: rl(field.key, field.translations), fieldDef: field, isCore: false });
        }
      }
    }
    return fields;
  }, [typeConfig, t]);

  const currentMassField = massEditableFields.find((f) => f.key === massEditField);

  const handleMassEdit = async () => {
    if (selectedIds.length === 0 || !massEditField) return;
    setMassEditLoading(true);
    setMassEditError("");
    try {
      if (massEditField === "approval_status") {
        const action = massEditValue === "APPROVED" ? "approve" : massEditValue === "REJECTED" ? "reject" : "reset";
        await Promise.all(
          selectedIds.map((id) => api.post(`/cards/${id}/approval-status?action=${action}`))
        );
      } else if (massEditField === "subtype") {
        await api.patch("/cards/bulk", {
          ids: selectedIds,
          updates: { subtype: massEditValue || null },
        });
      } else if (massEditField.startsWith("attr_")) {
        const attrKey = massEditField.replace("attr_", "");
        await Promise.all(
          selectedIds.map((id) => {
            const existing = data.find((d) => d.id === id);
            const attrs = { ...(existing?.attributes || {}), [attrKey]: massEditValue || null };
            return api.patch(`/cards/${id}`, { attributes: attrs });
          })
        );
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

  const handleMassArchive = async () => {
    if (selectedIds.length === 0) return;
    setMassArchiveLoading(true);
    try {
      await Promise.all(selectedIds.map((id) => api.post(`/cards/${id}/archive`)));
      setMassArchiveOpen(false);
      setSelectedIds([]);
      gridRef.current?.api?.deselectAll();
      loadData();
    } finally {
      setMassArchiveLoading(false);
    }
  };

  const handleMassDelete = async () => {
    if (selectedIds.length === 0) return;
    setMassDeleteLoading(true);
    try {
      await Promise.all(selectedIds.map((id) => api.delete(`/cards/${id}`)));
      setMassDeleteOpen(false);
      setSelectedIds([]);
      gridRef.current?.api?.deselectAll();
      loadData();
    } finally {
      setMassDeleteLoading(false);
    }
  };

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      {
        field: "type",
        headerName: t("common:labels.type"),
        width: 140,
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
        field: "name",
        headerName: t("common:labels.name"),
        flex: 1,
        minWidth: 200,
        editable: gridEditMode,
        // valueFormatter only affects display — AG Grid still reads/writes the
        // raw name via `field: "name"`, so editing and data stay clean.
        valueFormatter: (p) => {
          if (!p.data || gridEditMode) return p.value;
          return hierarchyPaths.get(p.data.id) ?? p.value;
        },
        cellStyle: gridEditMode
          ? { fontWeight: 500 }
          : { cursor: "pointer", fontWeight: 500 },
      },
      {
        field: "description",
        headerName: t("common:labels.description"),
        flex: 1,
        minWidth: 200,
        editable: gridEditMode,
      },
    ];

    // Add subtype column when a type with subtypes is selected
    if (typeConfig?.subtypes && typeConfig.subtypes.length > 0) {
      cols.push({
        field: "subtype",
        headerName: t("common:labels.subtype"),
        width: 140,
        editable: gridEditMode,
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
              label={st ? rl(st.key, st.translations) : p.value}
              variant="outlined"
            />
          );
        },
      });
    }

    cols.push(
      {
        headerName: t("columns.lifecycle"),
        width: 120,
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
      },
      {
        field: "approval_status",
        headerName: t("columns.approvalStatus"),
        width: 110,
        cellRenderer: (p: { value: string }) => {
          const color = APPROVAL_STATUS_COLORS[p.value];
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
        field: "data_quality",
        headerName: t("columns.dataQuality"),
        width: 130,
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
        field: "tags",
        headerName: t("columns.tags"),
        width: 200,
        hide: !selectedColumns.has("tags"),
        sortable: false,
        cellRenderer: (p: { value: TagRef[] }) => {
          const tags = p.value || [];
          if (tags.length === 0) return "";
          const visible = tags.slice(0, 3);
          const overflow = tags.length - visible.length;
          return (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25, alignItems: "center" }}>
              {visible.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: 12,
                    ...(tag.color ? { bgcolor: tag.color, color: "#fff" } : {}),
                  }}
                />
              ))}
              {overflow > 0 && (
                <Chip
                  label={`+${overflow}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 12 }}
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
                        label={rl(opt.key, opt.translations)}
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
          });
        }
      }
    } else if (commonFields.length > 0) {
      // Multiple types selected: show common fields across all selected types
      for (const field of commonFields) {
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
                      label={rl(opt.key, opt.translations)}
                      sx={opt.color ? { bgcolor: opt.color, color: "#fff" } : {}}
                    />
                  ) : (
                    p.value || ""
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
        field: "created_at",
        headerName: t("columns.createdAt"),
        width: 160,
        hide: !selectedColumns.has("meta_created_at"),
        valueFormatter: (p) => p.value ? new Date(p.value).toLocaleString() : "",
      },
      {
        field: "updated_at",
        headerName: t("columns.updatedAt"),
        width: 160,
        hide: !selectedColumns.has("meta_updated_at"),
        valueFormatter: (p) => p.value ? new Date(p.value).toLocaleString() : "",
      },
      {
        field: "created_by",
        headerName: t("columns.createdBy"),
        width: 150,
        hide: !selectedColumns.has("meta_created_by"),
      },
      {
        field: "updated_by",
        headerName: t("columns.updatedBy"),
        width: 150,
        hide: !selectedColumns.has("meta_updated_by"),
      }
    );

    return cols;
  }, [types, typeConfig, commonFields, gridEditMode, relevantRelTypes, relTypeGroupMap, relationsMap, selectedType, hierarchyPaths, filters.showArchived, selectedColumns, t]);

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
              <MenuItem key={st.key} value={st.key}>{rl(st.key, st.translations)}</MenuItem>
            ))}
          </Select>
        </FormControl>
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
                  {rl(opt.key, opt.translations)}
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
            onFiltersChange={(f) => { setFilters(f); setFilterDrawerOpen(false); }}
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
          canArchive={canArchive}
          canShareBookmarks={canShareBookmarks}
          canOdataBookmarks={canOdataBookmarks}
          currentUserId={user?.id}
          selectedColumns={selectedColumns}
          onSelectedColumnsChange={setSelectedColumns}
          defaultColumns={defaultColumns}
          onResetColumns={handleResetColumns}
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
                    onClick={() => exportToExcel(filteredData, typeConfig, types)}
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
                onClick={() => exportToExcel(filteredData, typeConfig, types)}
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

        {/* Mass edit toolbar */}
        {selectedIds.length > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              mb: 1,
              px: 2,
              py: 1,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              borderRadius: 1,
              flexShrink: 0,
            }}
          >
            <MaterialSymbol icon="check_box" size={20} />
            <Typography variant="body2" fontWeight={600}>
              {t("selectedCount", { count: selectedIds.length })}
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="inherit"
              sx={{ color: "primary.main", bgcolor: "background.paper", textTransform: "none", "&:hover": { bgcolor: "action.selected" } }}
              startIcon={<MaterialSymbol icon="edit" size={16} />}
              onClick={() => { setMassEditOpen(true); setMassEditField(""); setMassEditValue(""); setMassEditError(""); }}
            >
              {t("massEdit.title")}
            </Button>
            {canArchive && !filters.showArchived && (
              <Button
                size="small"
                variant="contained"
                color="inherit"
                sx={{ color: "#e65100", bgcolor: "background.paper", textTransform: "none", "&:hover": { bgcolor: "action.selected" } }}
                startIcon={<MaterialSymbol icon="archive" size={16} />}
                onClick={() => setMassArchiveOpen(true)}
              >
                {t("common:actions.archive")}
              </Button>
            )}
            {canDelete && filters.showArchived && (
              <Button
                size="small"
                variant="contained"
                color="inherit"
                sx={{ color: "#c62828", bgcolor: "background.paper", textTransform: "none", "&:hover": { bgcolor: "action.selected" } }}
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
              sx={{ borderColor: "rgba(255,255,255,0.5)", textTransform: "none" }}
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
            ref={gridRef}
            rowData={filteredData}
            columnDefs={columnDefs}
            loading={loading}
            rowSelection={rowSelection}
            onSelectionChanged={handleSelectionChanged}
            onCellValueChanged={handleCellEdit}
            onRowClicked={onRowClicked}
            onSortChanged={handleSortChanged}
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
      <Dialog open={massEditOpen} onClose={() => setMassEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t("massEdit.dialogTitle", { count: selectedIds.length })}
        </DialogTitle>
        <DialogContent>
          {massEditError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setMassEditError("")}>{massEditError}</Alert>}
          <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
            <InputLabel>{t("massEdit.field")}</InputLabel>
            <Select
              value={massEditField}
              label={t("massEdit.field")}
              onChange={(e) => { setMassEditField(e.target.value); setMassEditValue(""); }}
            >
              {massEditableFields.map((f) => (
                <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>
              ))}
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

      {/* Mass Archive Confirmation */}
      <Dialog open={massArchiveOpen} onClose={() => setMassArchiveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("massArchive.dialogTitle", { count: selectedIds.length })}</DialogTitle>
        <DialogContent>
          <Typography>
            {t("massArchive.confirmMessage", { count: selectedIds.length })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMassArchiveOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="warning" onClick={handleMassArchive} disabled={massArchiveLoading}>
            {massArchiveLoading ? t("massArchive.archiving") : t("common:actions.archive")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Mass Delete Confirmation */}
      <Dialog open={massDeleteOpen} onClose={() => setMassDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("massDelete.dialogTitle", { count: selectedIds.length })}</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>{t("massDelete.cannotBeUndone")}</Alert>
          <Typography>
            {t("massDelete.confirmMessage", { count: selectedIds.length })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMassDeleteOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="error" onClick={handleMassDelete} disabled={massDeleteLoading}>
            {massDeleteLoading ? t("massDelete.deleting") : t("massEdit.deletePermanently")}
          </Button>
        </DialogActions>
      </Dialog>

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
        preSelectedType={selectedType || undefined}
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
