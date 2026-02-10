import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import {
  type ColDef,
  type CellValueChangedEvent,
  type GridReadyEvent,
  type IGetRowsParams,
  type GridApi,
} from "ag-grid-community";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  Snackbar,
  Alert,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { useEventStream } from "../../hooks/useEventStream";
import type { FactSheet, FactSheetListResponse } from "../../types/fact-sheet";

// --- Interfaces for metamodel ---

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: string[];
  show_in_grid?: boolean;
}

interface TypeConfig {
  id: string;
  key: string;
  label: string;
  icon: string;
  color: string;
  fields: FieldDef[];
  built_in: boolean;
}

// --- Pill renderer ---

function PillRenderer(params: { value: string | undefined; colorMap?: Record<string, string> }) {
  if (!params.value) return null;
  const color = params.colorMap?.[params.value] || "#9e9e9e";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: `${color}18`,
        color,
        textTransform: "capitalize",
      }}
    >
      {String(params.value).replace(/_/g, " ")}
    </span>
  );
}

function StatusCellRenderer(params: { value: string }) {
  return PillRenderer({ value: params.value, colorMap: { active: "#2e7d32", archived: "#9e9e9e" } });
}

function LifecycleCellRenderer(params: { value: Record<string, string> | null }) {
  if (!params.value) return null;
  const phases = params.value;
  const now = new Date().toISOString().slice(0, 10);
  let current = "plan";
  for (const phase of ["plan", "phase_in", "active", "phase_out", "end_of_life"]) {
    if (phases[phase] && phases[phase] <= now) current = phase;
  }
  const colors: Record<string, string> = {
    plan: "#9e9e9e", phase_in: "#1565c0", active: "#2e7d32",
    phase_out: "#e65100", end_of_life: "#b71c1c",
  };
  return PillRenderer({ value: current, colorMap: colors });
}

// --- Main component ---

export default function FactSheetGrid() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const typeFilter = searchParams.get("type") || "";

  const gridRef = useRef<AgGridReact>(null);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [selectedRows, setSelectedRows] = useState<FactSheet[]>([]);
  const [typeConfigs, setTypeConfigs] = useState<TypeConfig[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(typeFilter || "application");
  const [newDescription, setNewDescription] = useState("");
  const [bulkField, setBulkField] = useState("status");
  const [bulkValue, setBulkValue] = useState("");
  const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(null);

  // Load type configs from API
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<{ items: TypeConfig[] }>("/metamodel/types");
        setTypeConfigs(data.items);
      } catch {
        // fallback
      }
    })();
  }, []);

  useEventStream(
    useCallback(() => {
      if (gridApi) gridApi.refreshInfiniteCache();
    }, [gridApi])
  );

  const currentConfig = useMemo(
    () => typeConfigs.find((c) => c.key === typeFilter),
    [typeConfigs, typeFilter]
  );

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      {
        headerName: "Name",
        field: "name",
        editable: true,
        pinned: "left",
        minWidth: 250,
        flex: 2,
        cellStyle: { cursor: "pointer", fontWeight: 500 },
      },
    ];

    if (!typeFilter) {
      cols.push({
        headerName: "Type",
        field: "type",
        width: 180,
        cellRenderer: (params: { value: string }) => {
          const cfg = typeConfigs.find((c) => c.key === params.value);
          if (!cfg) return params.value;
          return (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{cfg.icon}</span>
              {cfg.label}
            </span>
          );
        },
      });
    }

    cols.push(
      {
        headerName: "Status",
        field: "status",
        width: 120,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["active", "archived"] },
        cellRenderer: StatusCellRenderer,
      },
      {
        headerName: "Description",
        field: "description",
        width: 200,
        editable: true,
        cellStyle: { color: "#666" },
        valueFormatter: (params) => {
          const v = params.value as string | null;
          return v && v.length > 60 ? v.slice(0, 60) + "..." : v || "";
        },
      }
    );

    // Dynamic attribute columns from metamodel
    if (currentConfig) {
      for (const field of currentConfig.fields) {
        if (field.show_in_grid === false) continue;
        const col: ColDef = {
          headerName: field.label,
          field: `attributes.${field.key}`,
          width: 160,
          editable: true,
          valueGetter: (params) => params.data?.attributes?.[field.key],
          valueSetter: (params) => {
            if (!params.data.attributes) params.data.attributes = {};
            params.data.attributes[field.key] = params.newValue;
            return true;
          },
        };
        if (field.type === "enum" && field.options) {
          col.cellEditor = "agSelectCellEditor";
          col.cellEditorParams = { values: field.options };
          col.cellRenderer = (params: { value: string | undefined }) =>
            PillRenderer({ value: params.value });
        }
        cols.push(col);
      }
    }

    cols.push(
      { headerName: "Lifecycle", field: "lifecycle", width: 140, cellRenderer: LifecycleCellRenderer },
      {
        headerName: "Quality Seal", field: "quality_seal", width: 130, editable: true,
        cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["approved", "broken", "n_a"] },
      },
      {
        headerName: "Completion", field: "completion", width: 120,
        valueFormatter: (params) => `${Math.round(params.value ?? 0)}%`,
      },
      {
        headerName: "Updated", field: "updated_at", width: 140, sort: "desc",
        valueFormatter: (params) => params.value ? new Date(params.value).toLocaleDateString() : "",
      }
    );

    return cols;
  }, [typeFilter, typeConfigs, currentConfig]);

  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: false }), []);

  function buildDatasource(type: string) {
    return {
      getRows: async (rowParams: IGetRowsParams) => {
        const page = Math.floor(rowParams.startRow / 100) + 1;
        const reqParams: Record<string, string> = { page: String(page), page_size: "100" };
        if (type) reqParams.type = type;
        if (rowParams.sortModel.length > 0) {
          reqParams.sort_by = rowParams.sortModel[0].colId;
          reqParams.sort_dir = rowParams.sortModel[0].sort;
        }
        try {
          const data = await api.get<FactSheetListResponse>("/fact-sheets", reqParams);
          rowParams.successCallback(data.items, data.total);
        } catch {
          rowParams.failCallback();
        }
      },
    };
  }

  const onGridReady = useCallback(
    (params: GridReadyEvent) => {
      setGridApi(params.api);
      params.api.setGridOption("datasource", buildDatasource(typeFilter));
    },
    [typeFilter]
  );

  useEffect(() => {
    if (gridApi) gridApi.setGridOption("datasource", buildDatasource(typeFilter));
  }, [typeFilter, gridApi]);

  const onCellValueChanged = useCallback(async (event: CellValueChangedEvent) => {
    const fs = event.data as FactSheet;
    const field = event.colDef.field;
    if (!field || !fs.id) return;
    try {
      const patchBody: Record<string, unknown> = field.startsWith("attributes.")
        ? { attributes: { ...fs.attributes } }
        : { [field]: event.newValue };
      await api.patch(`/fact-sheets/${fs.id}`, patchBody);
      setToast({ message: `Updated "${fs.name}"`, severity: "success" });
    } catch {
      setToast({ message: `Failed to update "${fs.name}"`, severity: "error" });
      event.node.setDataValue(field, event.oldValue);
    }
  }, []);

  const onRowDoubleClicked = useCallback(
    (event: { data: FactSheet }) => { if (event.data?.id) navigate(`/fact-sheets/${event.data.id}`); },
    [navigate]
  );

  const onSelectionChanged = useCallback(() => {
    if (gridApi) setSelectedRows(gridApi.getSelectedRows());
  }, [gridApi]);

  async function handleCreate() {
    try {
      const fs = await api.post<FactSheet>("/fact-sheets", {
        name: newName, type: newType, description: newDescription || undefined,
      });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      navigate(`/fact-sheets/${fs.id}`);
    } catch {
      setToast({ message: "Failed to create fact sheet", severity: "error" });
    }
  }

  async function handleBulkUpdate() {
    if (selectedRows.length === 0) return;
    const ids = selectedRows.map((r) => r.id);
    const update: Record<string, unknown> = bulkField.startsWith("attributes.")
      ? { attributes: { [bulkField.replace("attributes.", "")]: bulkValue } }
      : { [bulkField]: bulkValue };
    try {
      await api.patch("/fact-sheets/bulk", { ids, update });
      setToast({ message: `Updated ${ids.length} fact sheet(s)`, severity: "success" });
      setBulkOpen(false);
      setBulkValue("");
      gridApi?.refreshInfiniteCache();
      gridApi?.deselectAll();
    } catch {
      setToast({ message: "Bulk update failed", severity: "error" });
    }
  }

  const title = currentConfig ? currentConfig.label : typeFilter ? typeFilter : "Inventory";

  const bulkFieldOptions: { value: string; label: string; options: string[] }[] = [
    { value: "status", label: "Status", options: ["active", "archived"] },
    { value: "quality_seal", label: "Quality Seal", options: ["approved", "broken", "n_a"] },
  ];
  if (currentConfig) {
    for (const field of currentConfig.fields) {
      if (field.type === "enum" && field.options) {
        bulkFieldOptions.push({ value: `attributes.${field.key}`, label: field.label, options: field.options });
      }
    }
  }
  const currentBulkOptions = bulkFieldOptions.find((f) => f.value === bulkField)?.options || [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 100px)" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography variant="h4">{title}</Typography>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Type Filter</InputLabel>
            <Select
              value={typeFilter}
              label="Type Filter"
              onChange={(e) => {
                if (e.target.value) setSearchParams({ type: e.target.value });
                else setSearchParams({});
              }}
            >
              <MenuItem value="">All Types</MenuItem>
              {typeConfigs.map((tc) => (
                <MenuItem key={tc.key} value={tc.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{tc.icon}</span>
                    {tc.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          {selectedRows.length > 0 && (
            <Button variant="outlined" startIcon={<MaterialSymbol icon="edit_note" size={20} />} onClick={() => setBulkOpen(true)}>
              Bulk Edit ({selectedRows.length})
            </Button>
          )}
          <Button variant="contained" startIcon={<MaterialSymbol icon="add" size={20} />}
            onClick={() => { if (typeFilter) setNewType(typeFilter); setCreateOpen(true); }}>
            Create
          </Button>
        </Box>
      </Box>

      <Box className="ag-theme-quartz" sx={{ flex: 1, width: "100%" }}>
        <AgGridReact
          ref={gridRef}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowModelType="infinite"
          cacheBlockSize={100}
          maxBlocksInCache={10}
          rowSelection={{ mode: "multiRow", enableClickSelection: false }}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          onRowDoubleClicked={onRowDoubleClicked}
          onSelectionChanged={onSelectionChanged}
          getRowId={(params) => params.data.id}
          animateRows={true}
          enableCellTextSelection={true}
          rowHeight={42}
          headerHeight={44}
        />
      </Box>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Fact Sheet</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          <TextField label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus margin="dense" />
          <FormControl margin="dense">
            <InputLabel>Type</InputLabel>
            <Select value={newType} label="Type" onChange={(e) => setNewType(e.target.value)}>
              {typeConfigs.map((tc) => (<MenuItem key={tc.key} value={tc.key}>{tc.label}</MenuItem>))}
            </Select>
          </FormControl>
          <TextField label="Description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} multiline rows={3} margin="dense" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim()}>Create</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Bulk Edit — {selectedRows.length} fact sheet(s)</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          <FormControl margin="dense">
            <InputLabel>Field</InputLabel>
            <Select value={bulkField} label="Field" onChange={(e) => { setBulkField(e.target.value); setBulkValue(""); }}>
              {bulkFieldOptions.map((f) => (<MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>))}
            </Select>
          </FormControl>
          <FormControl margin="dense">
            <InputLabel>New Value</InputLabel>
            <Select value={bulkValue} label="New Value" onChange={(e) => setBulkValue(e.target.value)}>
              {currentBulkOptions.map((opt) => (
                <MenuItem key={opt} value={opt}><span style={{ textTransform: "capitalize" }}>{opt.replace(/_/g, " ")}</span></MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleBulkUpdate} disabled={!bulkValue}>Apply to {selectedRows.length} rows</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {toast ? (<Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">{toast.message}</Alert>) : undefined}
      </Snackbar>
    </Box>
  );
}
