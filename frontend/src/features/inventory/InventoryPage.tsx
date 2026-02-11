import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellValueChangedEvent, SelectionChangedEvent } from "ag-grid-community";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import CreateFactSheetDialog from "@/components/CreateFactSheetDialog";
import InventoryFilterSidebar, { type Filters } from "./InventoryFilterSidebar";
import ImportDialog from "./ImportDialog";
import { exportToExcel } from "./excelExport";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FactSheet, FactSheetListResponse, FieldDef, Relation, RelationType } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const SEAL_COLORS: Record<string, string> = {
  DRAFT: "#9e9e9e",
  APPROVED: "#4caf50",
  BROKEN: "#ff9800",
  REJECTED: "#f44336",
};

const DEFAULT_SIDEBAR_WIDTH = 300;

/**
 * Walk the parent_id chain to build the full hierarchy path for a fact sheet.
 * Returns "Grandparent / Parent / Child" when ancestors are in the dataset,
 * or just the fact sheet name when it has no parent or the parent isn't loaded.
 */
function getHierarchyPath(fs: FactSheet, byId: Map<string, FactSheet>): string {
  const segments: string[] = [fs.name];
  const seen = new Set<string>([fs.id]);
  let current = fs;
  while (current.parent_id) {
    if (seen.has(current.parent_id)) break; // cycle guard
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    seen.add(parent.id);
    segments.unshift(parent.name);
    current = parent;
  }
  return segments.join(" / ");
}

/**
 * Build a lookup: for each relation type, map factSheetId → array of related names.
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
  const gridRef = useRef<AgGridReact>(null);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [filters, setFilters] = useState<Filters>({
    types: searchParams.get("type") ? [searchParams.get("type")!] : [],
    search: searchParams.get("search") || "",
    qualitySeals: [],
    attributes: {},
    relations: {},
  });

  const [data, setData] = useState<FactSheet[]>([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [gridEditMode, setGridEditMode] = useState(false);

  // Relations data: relTypeKey → Map<factSheetId, relatedNames[]>
  const [relationsMap, setRelationsMap] = useState<Map<string, Map<string, string[]>>>(new Map());

  // Mass edit state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [massEditOpen, setMassEditOpen] = useState(false);
  const [massEditField, setMassEditField] = useState("");
  const [massEditValue, setMassEditValue] = useState<unknown>("");
  const [massEditError, setMassEditError] = useState("");
  const [massEditLoading, setMassEditLoading] = useState(false);

  // React to ?create=true search param
  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setCreateOpen(true);
    }
  }, [searchParams]);

  // Derive the single selected type for column rendering (only when exactly one type selected)
  const selectedType = filters.types.length === 1 ? filters.types[0] : "";
  const typeConfig = types.find((t) => t.key === selectedType);

  // Relevant relation types for the selected type
  const relevantRelTypes = useMemo(() => {
    if (!selectedType) return [];
    return relationTypes.filter(
      (rt) => !rt.is_hidden && (rt.source_type_key === selectedType || rt.target_type_key === selectedType)
    );
  }, [selectedType, relationTypes]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.types.length === 1) params.set("type", filters.types[0]);
      if (filters.search) params.set("search", filters.search);
      if (filters.qualitySeals.length > 0) {
        params.set("quality_seal", filters.qualitySeals.join(","));
      }
      params.set("page_size", "500");
      const res = await api.get<FactSheetListResponse>(
        `/fact-sheets?${params}`
      );
      setData(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [filters.types, filters.search, filters.qualitySeals]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetch relations for each relevant relation type when data changes
  useEffect(() => {
    if (!selectedType || relevantRelTypes.length === 0 || data.length === 0) {
      setRelationsMap(new Map());
      return;
    }

    let cancelled = false;

    (async () => {
      const newMap = new Map<string, Map<string, string[]>>();
      const results = await Promise.all(
        relevantRelTypes.map((rt) =>
          api.get<Relation[]>(`/relations?type=${rt.key}`).catch(() => [] as Relation[])
        )
      );

      if (cancelled) return;

      for (let i = 0; i < relevantRelTypes.length; i++) {
        const rt = relevantRelTypes[i];
        const rels = results[i];
        newMap.set(rt.key, buildRelationIndex(rels, rt, selectedType));
      }
      setRelationsMap(newMap);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedType, relevantRelTypes, data]);

  // Index all loaded fact sheets by id for hierarchy lookups
  const dataById = useMemo(() => {
    const m = new Map<string, FactSheet>();
    for (const fs of data) m.set(fs.id, fs);
    return m;
  }, [data]);

  // Client-side filtering: type multi-select (>1 type) and attribute filters
  const filteredData = useMemo(() => {
    let result = data;

    // When multiple types selected, filter client-side (API only supports single type)
    if (filters.types.length > 1) {
      result = result.filter((fs) => filters.types.includes(fs.type));
    }

    // Attribute filters (client-side)
    const attrEntries = Object.entries(filters.attributes);
    if (attrEntries.length > 0) {
      result = result.filter((fs) => {
        const attrs = fs.attributes || {};
        return attrEntries.every(([key, val]) => attrs[key] === val);
      });
    }

    // Relation filters (client-side)
    const relEntries = Object.entries(filters.relations || {});
    if (relEntries.length > 0) {
      result = result.filter((fs) => {
        return relEntries.every(([relTypeKey, relatedName]) => {
          const index = relationsMap.get(relTypeKey);
          if (!index) return false;
          const names = index.get(fs.id);
          return names?.includes(relatedName) ?? false;
        });
      });
    }

    return result;
  }, [data, filters.types, filters.attributes, filters.relations, relationsMap]);

  const handleCellEdit = async (event: CellValueChangedEvent) => {
    const fs = event.data as FactSheet;
    const field = event.colDef.field!;
    if (field === "name" || field === "description") {
      await api.patch(`/fact-sheets/${fs.id}`, { [field]: event.newValue });
    } else if (field.startsWith("attr_")) {
      const key = field.replace("attr_", "");
      const fieldDef = typeConfig?.fields_schema
        .flatMap((s) => s.fields)
        .find((f) => f.key === key);
      if (fieldDef?.readonly) return;
      const attrs = { ...fs.attributes, [key]: event.newValue };
      await api.patch(`/fact-sheets/${fs.id}`, { attributes: attrs });
    }
  };

  const handleCreate = async (createData: {
    type: string;
    subtype?: string;
    name: string;
    description?: string;
    parent_id?: string;
    attributes?: Record<string, unknown>;
  }) => {
    await api.post("/fact-sheets", createData);
    loadData();
  };

  const handleSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    const rows = event.api.getSelectedRows() as FactSheet[];
    setSelectedIds(rows.map((r) => r.id));
  }, []);

  // Mass-editable fields for current type
  const massEditableFields = useMemo(() => {
    const fields: { key: string; label: string; fieldDef?: FieldDef; isCore: boolean }[] = [
      { key: "quality_seal", label: "Quality Seal", isCore: true },
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
      if (massEditField === "quality_seal") {
        const action = massEditValue === "APPROVED" ? "approve" : massEditValue === "REJECTED" ? "reject" : "reset";
        await Promise.all(
          selectedIds.map((id) => api.post(`/fact-sheets/${id}/quality-seal?action=${action}`))
        );
      } else if (massEditField === "subtype") {
        await api.patch("/fact-sheets/bulk", {
          ids: selectedIds,
          updates: { subtype: massEditValue || null },
        });
      } else if (massEditField.startsWith("attr_")) {
        const attrKey = massEditField.replace("attr_", "");
        await Promise.all(
          selectedIds.map((id) => {
            const existing = data.find((d) => d.id === id);
            const attrs = { ...(existing?.attributes || {}), [attrKey]: massEditValue || null };
            return api.patch(`/fact-sheets/${id}`, { attributes: attrs });
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
        valueGetter: (p: { data: FactSheet }) => {
          if (!p.data) return "";
          if (gridEditMode) return p.data.name; // edit the leaf name only
          return getHierarchyPath(p.data, dataById);
        },
        valueSetter: (p) => {
          p.data.name = p.newValue;
          return true;
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
        valueGetter: (p: { data: FactSheet }) => {
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
        field: "quality_seal",
        headerName: "Seal",
        width: 110,
        cellRenderer: (p: { value: string }) => {
          const color = SEAL_COLORS[p.value];
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
        field: "completion",
        headerName: "Completion",
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

    // Add type-specific attribute columns
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const field of section.fields) {
          cols.push({
            field: `attr_${field.key}`,
            headerName: field.label,
            width: 150,
            editable: gridEditMode && !field.readonly,
            valueGetter: (p: { data: FactSheet }) =>
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

      cols.push({
        field: `rel_${rt.key}`,
        headerName,
        width: 180,
        valueGetter: (p: { data: FactSheet }) => {
          if (!index) return "";
          const names = index.get(p.data?.id);
          return names ? names.join("; ") : "";
        },
        cellRenderer: (p: { value: string }) => {
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
  }, [types, typeConfig, gridEditMode, relevantRelTypes, relationsMap, selectedType, dataById]);

  // Render mass edit value input based on field type
  const renderMassEditInput = () => {
    if (!currentMassField) return null;

    if (massEditField === "quality_seal") {
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

    if (fd.type === "number") {
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
      {/* Sidebar */}
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
      />

      {/* Main content */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 2 }}>
        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1.5, flexShrink: 0 }}>
          <Typography variant="h5" fontWeight={600}>
            Inventory
          </Typography>
          <Chip label={`${filteredData.length} items`} size="small" />
          <Box sx={{ flex: 1 }} />
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
            rowSelection={{ mode: "multiRow", enableClickSelection: false, headerCheckbox: false }}
            onSelectionChanged={handleSelectionChanged}
            onCellValueChanged={handleCellEdit}
            onRowClicked={(e) => {
              if (!gridEditMode && e.data && !e.event?.defaultPrevented) {
                navigate(`/fact-sheets/${e.data.id}`);
              }
            }}
            getRowId={(p) => p.data.id}
            animateRows
            pagination
            paginationPageSize={100}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true,
            }}
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

      <CreateFactSheetDialog
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
        existingFactSheets={data}
        allTypes={types}
        preSelectedType={selectedType || undefined}
      />
    </Box>
  );
}
