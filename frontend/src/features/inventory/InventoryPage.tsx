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
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FactSheet, FactSheetListResponse, FieldDef } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const SEAL_COLORS: Record<string, string> = {
  DRAFT: "#9e9e9e",
  APPROVED: "#4caf50",
  BROKEN: "#ff9800",
  REJECTED: "#f44336",
};

const DEFAULT_SIDEBAR_WIDTH = 300;

export default function InventoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { types } = useMetamodel();
  const gridRef = useRef<AgGridReact>(null);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [filters, setFilters] = useState<Filters>({
    types: searchParams.get("type") ? [searchParams.get("type")!] : [],
    search: searchParams.get("search") || "",
    qualitySeals: [],
    attributes: {},
  });

  const [data, setData] = useState<FactSheet[]>([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(
    searchParams.get("create") === "true"
  );
  const [gridEditMode, setGridEditMode] = useState(false);

  // Mass edit state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [massEditOpen, setMassEditOpen] = useState(false);
  const [massEditField, setMassEditField] = useState("");
  const [massEditValue, setMassEditValue] = useState<unknown>("");
  const [massEditError, setMassEditError] = useState("");
  const [massEditLoading, setMassEditLoading] = useState(false);

  // Derive the single selected type for column rendering (only when exactly one type selected)
  const selectedType = filters.types.length === 1 ? filters.types[0] : "";
  const typeConfig = types.find((t) => t.key === selectedType);

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

    return result;
  }, [data, filters.types, filters.attributes]);

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

    return cols;
  }, [types, typeConfig, gridEditMode]);

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
    <Box sx={{ display: "flex", height: "calc(100vh - 64px)", mx: -3, mt: -3 }}>
      {/* Sidebar */}
      <InventoryFilterSidebar
        types={types}
        filters={filters}
        onFiltersChange={setFilters}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      />

      {/* Main content */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", p: 2 }}>
        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1.5 }}>
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
          sx={{ flex: 1, width: "100%" }}
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
    </Box>
  );
}
