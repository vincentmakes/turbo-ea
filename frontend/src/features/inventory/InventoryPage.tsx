import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellValueChangedEvent, SelectionChangedEvent, RowClickedEvent } from "ag-grid-community";
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
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/api/client";
import type { Card, CardListResponse, FieldDef, Relation, RelationType } from "@/types";
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

export default function InventoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { types, relationTypes } = useMetamodel();
  const { user } = useAuth();
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
  const [filters, setFilters] = useState<Filters>(() => {
    // Parse attr_* URL params into initial attribute filters
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
    };
  });

  const [data, setData] = useState<Card[]>([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [gridEditMode, setGridEditMode] = useState(false);

  // Relations data: relTypeKey → Map<cardId, relatedNames[]>
  const [relationsMap, setRelationsMap] = useState<Map<string, Map<string, string[]>>>(new Map());

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

  // Relevant relation types for the selected type (excluding relations to hidden types)
  // Since the API excludes hidden types, check that the other-end type exists in visible types
  const visibleTypeKeys = useMemo(() => new Set(types.map((t) => t.key)), [types]);
  const relevantRelTypes = useMemo(() => {
    if (!selectedType) return [];
    return relationTypes.filter(
      (rt) =>
        !rt.is_hidden &&
        (rt.source_type_key === selectedType || rt.target_type_key === selectedType) &&
        visibleTypeKeys.has(
          rt.source_type_key === selectedType ? rt.target_type_key : rt.source_type_key
        )
    );
  }, [selectedType, relationTypes, visibleTypeKeys]);

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

  // Fetch and index relations for each relevant relation type
  const fetchRelations = useCallback(async () => {
    if (!selectedType || relevantRelTypes.length === 0) {
      setRelationsMap(new Map());
      return;
    }

    const newMap = new Map<string, Map<string, string[]>>();
    const results = await Promise.all(
      relevantRelTypes.map((rt) =>
        api.get<Relation[]>(`/relations?type=${rt.key}`).catch(() => [] as Relation[])
      )
    );

    for (let i = 0; i < relevantRelTypes.length; i++) {
      const rt = relevantRelTypes[i];
      const rels = results[i];
      newMap.set(rt.key, buildRelationIndex(rels, rt, selectedType));
    }
    setRelationsMap(newMap);
  }, [selectedType, relevantRelTypes]);

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

    return result;
  }, [data, filters.types, filters.subtypes, filters.lifecyclePhases, filters.dataQualityMin, filters.attributes, filters.relations, relationsMap]);

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
      { key: "approval_status", label: "Approval Status", isCore: true },
    ];
    if (typeConfig?.subtypes && typeConfig.subtypes.length > 0) {
      fields.push({ key: "subtype", label: "Subtype", isCore: true });
    }
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const field of section.fields) {
          if (field.readonly) continue;
          fields.push({ key: `attr_${field.key}`, label: field.label, fieldDef: field, isCore: false });
        }
      }
    }
    return fields;
  }, [typeConfig]);

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
      setMassEditError(e instanceof Error ? e.message : "Mass edit failed");
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
        headerName: "Type",
        width: 140,
        cellRenderer: (p: { value: string }) => {
          const t = types.find((x) => x.key === p.value);
          return t ? (
            <Chip
              size="small"
              label={t.label}
              sx={{ bgcolor: t.color, color: "#fff", fontWeight: 500 }}
            />
          ) : (
            p.value
          );
        },
      },
      {
        field: "name",
        headerName: "Name",
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
        headerName: "Description",
        flex: 1,
        minWidth: 200,
        editable: gridEditMode,
      },
    ];

    // Add subtype column when a type with subtypes is selected
    if (typeConfig?.subtypes && typeConfig.subtypes.length > 0) {
      cols.push({
        field: "subtype",
        headerName: "Subtype",
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
              label={st?.label || p.value}
              variant="outlined"
            />
          );
        },
      });
    }

    cols.push(
      {
        headerName: "Lifecycle",
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
        headerName: "Approval Status",
        width: 110,
        cellRenderer: (p: { value: string }) => {
          const color = APPROVAL_STATUS_COLORS[p.value];
          if (!color) return "";
          const labels: Record<string, string> = {
            DRAFT: "Draft",
            APPROVED: "Approved",
            BROKEN: "Broken",
            REJECTED: "Rejected",
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
        headerName: "Data Quality",
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
                  bgcolor: "#e0e0e0",
                  "& .MuiLinearProgress-bar": { bgcolor: color, borderRadius: 3 },
                }}
              />
              <Typography variant="caption" sx={{ minWidth: 32, textAlign: "right" }}>
                {v}%
              </Typography>
            </Box>
          );
        },
      }
    );

    // Show status column when archived items are included
    if (filters.showArchived) {
      cols.push({
        field: "status",
        headerName: "Status",
        width: 110,
        cellRenderer: (p: { value: string }) => {
          if (p.value === "ARCHIVED") {
            return (
              <Chip size="small" label="Archived" sx={{ bgcolor: "#9e9e9e", color: "#fff", fontWeight: 500 }} />
            );
          }
          return <Chip size="small" label="Active" variant="outlined" sx={{ fontWeight: 500 }} />;
        },
      });
    }

    // Add type-specific attribute columns
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const field of section.fields) {
          cols.push({
            field: `attr_${field.key}`,
            headerName: field.label,
            width: 150,
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
                        label={opt.label}
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
    }

    // Add relation columns (one per relevant relation type)
    for (const rt of relevantRelTypes) {
      const isSource = rt.source_type_key === selectedType;
      const otherTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
      const otherType = types.find((t) => t.key === otherTypeKey);
      const headerName = otherType?.label || otherTypeKey;
      const index = relationsMap.get(rt.key);
      const relTypeRef = rt;

      cols.push({
        field: `rel_${rt.key}`,
        headerName,
        width: 180,
        valueGetter: (p: { data: Card }) => {
          if (!index) return "";
          const names = index.get(p.data?.id);
          return names ? names.join("; ") : "";
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
                  {p.value || <span style={{ color: "#999" }}>Click to edit</span>}
                </Typography>
                <MaterialSymbol icon="edit" size={14} color="#999" />
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

    return cols;
  }, [types, typeConfig, gridEditMode, relevantRelTypes, relationsMap, selectedType, hierarchyPaths, filters.showArchived]);

  // Render mass edit value input based on field type
  const renderMassEditInput = () => {
    if (!currentMassField) return null;

    if (massEditField === "approval_status") {
      return (
        <FormControl fullWidth size="small">
          <InputLabel>Value</InputLabel>
          <Select value={(massEditValue as string) || ""} label="Value" onChange={(e) => setMassEditValue(e.target.value)}>
            <MenuItem value="DRAFT">Draft</MenuItem>
            <MenuItem value="APPROVED">Approved</MenuItem>
            <MenuItem value="REJECTED">Rejected</MenuItem>
          </Select>
        </FormControl>
      );
    }

    if (massEditField === "subtype" && typeConfig?.subtypes) {
      return (
        <FormControl fullWidth size="small">
          <InputLabel>Value</InputLabel>
          <Select value={(massEditValue as string) || ""} label="Value" onChange={(e) => setMassEditValue(e.target.value)}>
            <MenuItem value=""><em>None</em></MenuItem>
            {typeConfig.subtypes.map((st) => (
              <MenuItem key={st.key} value={st.key}>{st.label}</MenuItem>
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
          <InputLabel>Value</InputLabel>
          <Select value={(massEditValue as string) || ""} label="Value" onChange={(e) => setMassEditValue(e.target.value)}>
            <MenuItem value=""><em>Clear</em></MenuItem>
            {fd.options.map((opt) => (
              <MenuItem key={opt.key} value={opt.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {opt.color && <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: opt.color }} />}
                  {opt.label}
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
          label="Value"
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
        label="Value"
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
            canArchive={canArchive}
            canShareBookmarks={canShareBookmarks}
            canOdataBookmarks={canOdataBookmarks}
            currentUserId={user?.id}
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
        />
      )}

      {/* Main content */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: { xs: 1, sm: 2 } }}>
        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1, sm: 2 }, mb: 1.5, flexShrink: 0, flexWrap: "wrap" }}>
          {isMobile && (
            <Tooltip title="Filters">
              <IconButton onClick={() => setFilterDrawerOpen(true)} size="small">
                <MaterialSymbol icon="filter_list" size={22} />
              </IconButton>
            </Tooltip>
          )}
          <Typography variant={isMobile ? "h6" : "h5"} fontWeight={600}>
            Inventory
          </Typography>
          <Chip label={`${filteredData.length} items`} size="small" />
          <Box sx={{ flex: 1 }} />
          {isMobile ? (
            <>
              <Tooltip title={gridEditMode ? "Editing" : "Grid Edit"}>
                <IconButton
                  color={gridEditMode ? "primary" : "default"}
                  onClick={() => setGridEditMode((v) => !v)}
                  size="small"
                >
                  <MaterialSymbol icon={gridEditMode ? "edit" : "edit_off"} size={20} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Export">
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
              <Tooltip title="Import">
                <IconButton onClick={() => setImportOpen(true)} size="small">
                  <MaterialSymbol icon="upload" size={20} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Create">
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
                {gridEditMode ? "Editing" : "Grid Edit"}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<MaterialSymbol icon="download" size={18} />}
                onClick={() => exportToExcel(filteredData, typeConfig, types)}
                disabled={filteredData.length === 0}
                sx={{ textTransform: "none" }}
              >
                Export
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<MaterialSymbol icon="upload" size={18} />}
                onClick={() => setImportOpen(true)}
                sx={{ textTransform: "none" }}
              >
                Import
              </Button>
              <Button
                variant="contained"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={() => setCreateOpen(true)}
                sx={{ textTransform: "none" }}
              >
                Create
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
              {selectedIds.length} selected
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="inherit"
              sx={{ color: "primary.main", bgcolor: "#fff", textTransform: "none", "&:hover": { bgcolor: "#e0e0e0" } }}
              startIcon={<MaterialSymbol icon="edit" size={16} />}
              onClick={() => { setMassEditOpen(true); setMassEditField(""); setMassEditValue(""); setMassEditError(""); }}
            >
              Mass Edit
            </Button>
            {canArchive && !filters.showArchived && (
              <Button
                size="small"
                variant="contained"
                color="inherit"
                sx={{ color: "#e65100", bgcolor: "#fff", textTransform: "none", "&:hover": { bgcolor: "#e0e0e0" } }}
                startIcon={<MaterialSymbol icon="archive" size={16} />}
                onClick={() => setMassArchiveOpen(true)}
              >
                Archive
              </Button>
            )}
            {canDelete && filters.showArchived && (
              <Button
                size="small"
                variant="contained"
                color="inherit"
                sx={{ color: "#c62828", bgcolor: "#fff", textTransform: "none", "&:hover": { bgcolor: "#e0e0e0" } }}
                startIcon={<MaterialSymbol icon="delete_forever" size={16} />}
                onClick={() => setMassDeleteOpen(true)}
              >
                Delete Permanently
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              sx={{ borderColor: "rgba(255,255,255,0.5)", textTransform: "none" }}
              onClick={() => gridRef.current?.api?.deselectAll()}
            >
              Clear Selection
            </Button>
          </Box>
        )}

        {/* AG Grid */}
        <Box
          className="ag-theme-quartz"
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
            getRowId={getRowId}
            getRowStyle={getRowStyle}
            animateRows
            defaultColDef={defaultColDef}
          />
        </Box>
      </Box>

      {/* Mass Edit Dialog */}
      <Dialog open={massEditOpen} onClose={() => setMassEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          Mass Edit ({selectedIds.length} items)
        </DialogTitle>
        <DialogContent>
          {massEditError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setMassEditError("")}>{massEditError}</Alert>}
          <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
            <InputLabel>Field</InputLabel>
            <Select
              value={massEditField}
              label="Field"
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
          <Button onClick={() => setMassEditOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleMassEdit}
            disabled={!massEditField || massEditLoading}
          >
            {massEditLoading ? "Applying..." : `Apply to ${selectedIds.length} items`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Mass Archive Confirmation */}
      <Dialog open={massArchiveOpen} onClose={() => setMassArchiveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Archive {selectedIds.length} Cards</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to archive {selectedIds.length} card{selectedIds.length !== 1 ? "s" : ""}? Archived cards can be restored within 30 days.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMassArchiveOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={handleMassArchive} disabled={massArchiveLoading}>
            {massArchiveLoading ? "Archiving..." : "Archive"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Mass Delete Confirmation */}
      <Dialog open={massDeleteOpen} onClose={() => setMassDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Permanently Delete {selectedIds.length} Cards</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>This action cannot be undone.</Alert>
          <Typography>
            Are you sure you want to permanently delete {selectedIds.length} card{selectedIds.length !== 1 ? "s" : ""}? All related data (relations, comments, documents, etc.) will also be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMassDeleteOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleMassDelete} disabled={massDeleteLoading}>
            {massDeleteLoading ? "Deleting..." : "Delete Permanently"}
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
