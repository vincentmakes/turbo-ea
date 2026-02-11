import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellValueChangedEvent } from "ag-grid-community";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import MaterialSymbol from "@/components/MaterialSymbol";
import CreateFactSheetDialog from "@/components/CreateFactSheetDialog";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FactSheet, FactSheetListResponse } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const SEAL_COLORS: Record<string, string> = {
  DRAFT: "#9e9e9e",
  APPROVED: "#4caf50",
  BROKEN: "#ff9800",
  REJECTED: "#f44336",
};

export default function InventoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { types } = useMetamodel();
  const gridRef = useRef<AgGridReact>(null);
  const [selectedType, setSelectedType] = useState(
    searchParams.get("type") || ""
  );
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [sealFilter, setSealFilter] = useState<string[]>([]);
  const [data, setData] = useState<FactSheet[]>([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(
    searchParams.get("create") === "true"
  );
  const [gridEditMode, setGridEditMode] = useState(false);

  const typeConfig = types.find((t) => t.key === selectedType);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedType) params.set("type", selectedType);
      if (search) params.set("search", search);
      params.set("page_size", "500");
      const res = await api.get<FactSheetListResponse>(
        `/fact-sheets?${params}`
      );
      setData(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [selectedType, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Client-side seal filter
  const filteredData = useMemo(() => {
    if (sealFilter.length === 0) return data;
    return data.filter((fs) => sealFilter.includes(fs.quality_seal));
  }, [data, sealFilter]);

  const handleCellEdit = async (event: CellValueChangedEvent) => {
    const fs = event.data as FactSheet;
    const field = event.colDef.field!;
    if (field === "name" || field === "description") {
      await api.patch(`/fact-sheets/${fs.id}`, { [field]: event.newValue });
    } else if (field.startsWith("attr_")) {
      const key = field.replace("attr_", "");
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
            editable: gridEditMode,
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

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
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

      <Box
        sx={{
          display: "flex",
          gap: 2,
          mb: 2,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Type</InputLabel>
          <Select
            value={selectedType}
            label="Type"
            onChange={(e) => setSelectedType(e.target.value)}
          >
            <MenuItem value="">All Types</MenuItem>
            {types.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol icon={t.icon} size={16} color={t.color} />
                  {t.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <MaterialSymbol icon="search" size={18} />
              </InputAdornment>
            ),
          }}
          sx={{ minWidth: 250 }}
        />
        <ToggleButtonGroup
          size="small"
          value={sealFilter}
          onChange={(_, v) => setSealFilter(v)}
        >
          {(["DRAFT", "APPROVED", "BROKEN", "REJECTED"] as const).map(
            (seal) => (
              <ToggleButton
                key={seal}
                value={seal}
                sx={{
                  textTransform: "none",
                  px: 1.5,
                  fontSize: "0.75rem",
                  "&.Mui-selected": {
                    bgcolor: SEAL_COLORS[seal] + "22",
                    borderColor: SEAL_COLORS[seal],
                    color: SEAL_COLORS[seal],
                  },
                }}
              >
                {seal.charAt(0) + seal.slice(1).toLowerCase()}
              </ToggleButton>
            )
          )}
        </ToggleButtonGroup>
      </Box>

      <Box
        className="ag-theme-quartz"
        sx={{ height: "calc(100vh - 240px)", width: "100%" }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={filteredData}
          columnDefs={columnDefs}
          loading={loading}
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
