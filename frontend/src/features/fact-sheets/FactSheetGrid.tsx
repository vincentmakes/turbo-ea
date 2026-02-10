import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import {
  type ColDef,
  type CellValueChangedEvent,
  type GridReadyEvent,
  type IGetRowsParams,
  type GridApi,
  ModuleRegistry,
  AllCommunityModule,
} from "ag-grid-community";
import {
  Box,
  Button,
  Chip,
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
import {
  type FactSheet,
  type FactSheetListResponse,
  type FactSheetType,
  type FactSheetStatus,
  FACT_SHEET_TYPE_LABELS,
  FACT_SHEET_TYPE_ICONS,
  LIFECYCLE_PHASES,
  BUSINESS_CRITICALITY_OPTIONS,
  SUITABILITY_OPTIONS,
  QUALITY_SEAL_OPTIONS,
} from "../../types/fact-sheet";

ModuleRegistry.registerModules([AllCommunityModule]);

// --- Custom cell renderers ---

function TypeCellRenderer(params: { value: FactSheetType }) {
  if (!params.value) return null;
  const icon = FACT_SHEET_TYPE_ICONS[params.value];
  const label = FACT_SHEET_TYPE_LABELS[params.value];
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
      {label}
    </span>
  );
}

function StatusCellRenderer(params: { value: FactSheetStatus }) {
  if (!params.value) return null;
  const color = params.value === "active" ? "#2e7d32" : "#9e9e9e";
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
      {params.value}
    </span>
  );
}

function LifecycleCellRenderer(params: { value: Record<string, string> | null }) {
  if (!params.value) return null;
  const phases = params.value;
  // Show the current active phase
  const now = new Date().toISOString().slice(0, 10);
  let current = "plan";
  for (const phase of LIFECYCLE_PHASES) {
    if (phases[phase] && phases[phase] <= now) {
      current = phase;
    }
  }
  const colors: Record<string, string> = {
    plan: "#9e9e9e",
    phase_in: "#1565c0",
    active: "#2e7d32",
    phase_out: "#e65100",
    end_of_life: "#b71c1c",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: `${colors[current] || "#9e9e9e"}18`,
        color: colors[current] || "#9e9e9e",
        textTransform: "capitalize",
      }}
    >
      {current.replace("_", " ")}
    </span>
  );
}

function SuitabilityCellRenderer(params: { value: string | undefined }) {
  if (!params.value) return null;
  const colors: Record<string, string> = {
    unreasonable: "#b71c1c",
    insufficient: "#e65100",
    appropriate: "#1565c0",
    perfect: "#2e7d32",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: `${colors[params.value] || "#9e9e9e"}18`,
        color: colors[params.value] || "#9e9e9e",
        textTransform: "capitalize",
      }}
    >
      {params.value}
    </span>
  );
}

function CriticalityCellRenderer(params: { value: string | undefined }) {
  if (!params.value) return null;
  const colors: Record<string, string> = {
    administrative_service: "#9e9e9e",
    business_operational: "#1565c0",
    business_critical: "#e65100",
    mission_critical: "#b71c1c",
  };
  const labels: Record<string, string> = {
    administrative_service: "Administrative",
    business_operational: "Operational",
    business_critical: "Critical",
    mission_critical: "Mission Critical",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: `${colors[params.value] || "#9e9e9e"}18`,
        color: colors[params.value] || "#9e9e9e",
      }}
    >
      {labels[params.value] || params.value}
    </span>
  );
}

// --- Main component ---

export default function FactSheetGrid() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get("type") as FactSheetType | null;

  const gridRef = useRef<AgGridReact>(null);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [selectedRows, setSelectedRows] = useState<FactSheet[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<FactSheetType>(typeFilter || "application");
  const [newDescription, setNewDescription] = useState("");
  const [bulkField, setBulkField] = useState("status");
  const [bulkValue, setBulkValue] = useState("");
  const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(
    null
  );

  // Listen for real-time changes
  useEventStream(
    useCallback(() => {
      // Refresh the grid datasource when any fact_sheet event arrives
      if (gridApi) {
        gridApi.refreshInfiniteCache();
      }
    }, [gridApi])
  );

  // Types that should show application-specific columns
  const appTypes = new Set<string>(["application"]);
  const hierarchyTypes = new Set<string>(["business_capability", "organization"]);
  const lifecycleTypes = new Set<string>(["application", "it_component", "interface", "platform"]);

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
      {
        headerName: "Type",
        field: "type",
        width: 180,
        cellRenderer: TypeCellRenderer,
        filter: true,
        hide: !!typeFilter,
      },
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
      },
      {
        headerName: "Business Criticality",
        field: "attributes.business_criticality",
        width: 180,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: BUSINESS_CRITICALITY_OPTIONS },
        cellRenderer: CriticalityCellRenderer,
        valueGetter: (params) => params.data?.attributes?.business_criticality,
        valueSetter: (params) => {
          if (!params.data.attributes) params.data.attributes = {};
          params.data.attributes.business_criticality = params.newValue;
          return true;
        },
        hide: !!typeFilter && !appTypes.has(typeFilter),
      },
      {
        headerName: "Technical Suitability",
        field: "attributes.technical_suitability",
        width: 170,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: SUITABILITY_OPTIONS },
        cellRenderer: SuitabilityCellRenderer,
        valueGetter: (params) => params.data?.attributes?.technical_suitability,
        valueSetter: (params) => {
          if (!params.data.attributes) params.data.attributes = {};
          params.data.attributes.technical_suitability = params.newValue;
          return true;
        },
        hide: !!typeFilter && !appTypes.has(typeFilter),
      },
      {
        headerName: "Functional Suitability",
        field: "attributes.functional_suitability",
        width: 170,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: SUITABILITY_OPTIONS },
        cellRenderer: SuitabilityCellRenderer,
        valueGetter: (params) => params.data?.attributes?.functional_suitability,
        valueSetter: (params) => {
          if (!params.data.attributes) params.data.attributes = {};
          params.data.attributes.functional_suitability = params.newValue;
          return true;
        },
        hide: !!typeFilter && !appTypes.has(typeFilter),
      },
      {
        headerName: "Lifecycle",
        field: "lifecycle",
        width: 140,
        cellRenderer: LifecycleCellRenderer,
        hide: !!typeFilter && !lifecycleTypes.has(typeFilter),
      },
      {
        headerName: "Parent",
        field: "parent_id",
        width: 140,
        valueFormatter: (params) => params.value ? "Has parent" : "Root",
        hide: !typeFilter || !hierarchyTypes.has(typeFilter),
      },
      {
        headerName: "Quality Seal",
        field: "quality_seal",
        width: 130,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: QUALITY_SEAL_OPTIONS },
      },
      {
        headerName: "Alias",
        field: "alias",
        width: 150,
        editable: true,
      },
      {
        headerName: "External ID",
        field: "external_id",
        width: 150,
        editable: true,
      },
      {
        headerName: "Completion",
        field: "completion",
        width: 120,
        valueFormatter: (params) => `${Math.round(params.value ?? 0)}%`,
      },
      {
        headerName: "Updated",
        field: "updated_at",
        width: 140,
        valueFormatter: (params) =>
          params.value ? new Date(params.value).toLocaleDateString() : "",
        sort: "desc",
      },
    ];
    return cols;
  }, [typeFilter]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
      filter: false,
    }),
    []
  );

  const onGridReady = useCallback(
    (params: GridReadyEvent) => {
      setGridApi(params.api);

      const dataSource = {
        getRows: async (rowParams: IGetRowsParams) => {
          const page = Math.floor(rowParams.startRow / 100) + 1;
          const reqParams: Record<string, string> = {
            page: String(page),
            page_size: "100",
          };
          if (typeFilter) reqParams.type = typeFilter;

          // Map AG Grid sort model to API params
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

      params.api.setGridOption("datasource", dataSource);
    },
    [typeFilter]
  );

  // Re-set datasource when type filter changes
  useEffect(() => {
    if (gridApi) {
      const dataSource = {
        getRows: async (rowParams: IGetRowsParams) => {
          const page = Math.floor(rowParams.startRow / 100) + 1;
          const reqParams: Record<string, string> = {
            page: String(page),
            page_size: "100",
          };
          if (typeFilter) reqParams.type = typeFilter;

          try {
            const data = await api.get<FactSheetListResponse>("/fact-sheets", reqParams);
            rowParams.successCallback(data.items, data.total);
          } catch {
            rowParams.failCallback();
          }
        },
      };

      gridApi.setGridOption("datasource", dataSource);
    }
  }, [typeFilter, gridApi]);

  const onCellValueChanged = useCallback(async (event: CellValueChangedEvent) => {
    const fs = event.data as FactSheet;
    const field = event.colDef.field;
    if (!field || !fs.id) return;

    try {
      // Determine what to PATCH based on the column
      let patchBody: Record<string, unknown>;

      if (field.startsWith("attributes.")) {
        // Merge into attributes JSON
        patchBody = { attributes: { ...fs.attributes } };
      } else {
        patchBody = { [field]: event.newValue };
      }

      await api.patch(`/fact-sheets/${fs.id}`, patchBody);
      setToast({ message: `Updated "${fs.name}"`, severity: "success" });
    } catch {
      setToast({ message: `Failed to update "${fs.name}"`, severity: "error" });
      // Revert the cell value on error
      event.node.setDataValue(field, event.oldValue);
    }
  }, []);

  const onRowDoubleClicked = useCallback(
    (event: { data: FactSheet }) => {
      if (event.data?.id) {
        navigate(`/fact-sheets/${event.data.id}`);
      }
    },
    [navigate]
  );

  const onSelectionChanged = useCallback(() => {
    if (gridApi) {
      setSelectedRows(gridApi.getSelectedRows());
    }
  }, [gridApi]);

  // --- Create ---
  async function handleCreate() {
    try {
      const fs = await api.post<FactSheet>("/fact-sheets", {
        name: newName,
        type: newType,
        description: newDescription || undefined,
      });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      navigate(`/fact-sheets/${fs.id}`);
    } catch {
      setToast({ message: "Failed to create fact sheet", severity: "error" });
    }
  }

  // --- Bulk update ---
  async function handleBulkUpdate() {
    if (selectedRows.length === 0) return;

    const ids = selectedRows.map((r) => r.id);
    let update: Record<string, unknown>;

    if (bulkField.startsWith("attributes.")) {
      const attrKey = bulkField.replace("attributes.", "");
      update = { attributes: { [attrKey]: bulkValue } };
    } else {
      update = { [bulkField]: bulkValue };
    }

    try {
      await api.patch("/fact-sheets/bulk", { ids, update });
      setToast({
        message: `Updated ${ids.length} fact sheet(s)`,
        severity: "success",
      });
      setBulkOpen(false);
      setBulkValue("");
      gridApi?.refreshInfiniteCache();
      gridApi?.deselectAll();
    } catch {
      setToast({ message: "Bulk update failed", severity: "error" });
    }
  }

  const title = typeFilter ? FACT_SHEET_TYPE_LABELS[typeFilter] : "All Fact Sheets";

  const bulkFieldOptions = [
    { value: "status", label: "Status", options: ["active", "archived"] },
    {
      value: "attributes.business_criticality",
      label: "Business Criticality",
      options: BUSINESS_CRITICALITY_OPTIONS,
    },
    {
      value: "attributes.technical_suitability",
      label: "Technical Suitability",
      options: SUITABILITY_OPTIONS,
    },
    { value: "quality_seal", label: "Quality Seal", options: QUALITY_SEAL_OPTIONS },
  ];

  const currentBulkOptions = bulkFieldOptions.find((f) => f.value === bulkField)?.options || [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 100px)" }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Typography variant="h4">{title}</Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          {selectedRows.length > 0 && (
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="edit_note" size={20} />}
              onClick={() => setBulkOpen(true)}
            >
              Bulk Edit ({selectedRows.length})
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="add" size={20} />}
            onClick={() => setCreateOpen(true)}
          >
            Create
          </Button>
        </Box>
      </Box>

      {/* AG Grid */}
      <Box sx={{ flex: 1, width: "100%" }}>
        <AgGridReact
          ref={gridRef}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowModelType="infinite"
          cacheBlockSize={100}
          maxBlocksInCache={10}
          rowSelection="multiple"
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          onRowDoubleClicked={onRowDoubleClicked}
          onSelectionChanged={onSelectionChanged}
          getRowId={(params) => params.data.id}
          animateRows={true}
          enableCellTextSelection={true}
          suppressRowClickSelection={true}
          rowHeight={42}
          headerHeight={44}
        />
      </Box>

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Fact Sheet</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          <TextField
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            autoFocus
            margin="dense"
          />
          <FormControl margin="dense">
            <InputLabel>Type</InputLabel>
            <Select
              value={newType}
              label="Type"
              onChange={(e) => setNewType(e.target.value as FactSheetType)}
            >
              {Object.entries(FACT_SHEET_TYPE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Description"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            multiline
            rows={3}
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk edit dialog */}
      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Bulk Edit — {selectedRows.length} fact sheet(s)
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          <FormControl margin="dense">
            <InputLabel>Field</InputLabel>
            <Select
              value={bulkField}
              label="Field"
              onChange={(e) => {
                setBulkField(e.target.value);
                setBulkValue("");
              }}
            >
              {bulkFieldOptions.map((f) => (
                <MenuItem key={f.value} value={f.value}>
                  {f.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl margin="dense">
            <InputLabel>New Value</InputLabel>
            <Select
              value={bulkValue}
              label="New Value"
              onChange={(e) => setBulkValue(e.target.value)}
            >
              {currentBulkOptions.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  <span style={{ textTransform: "capitalize" }}>
                    {opt.replace(/_/g, " ")}
                  </span>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleBulkUpdate} disabled={!bulkValue}>
            Apply to {selectedRows.length} rows
          </Button>
        </DialogActions>
      </Dialog>

      {/* Toast */}
      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
