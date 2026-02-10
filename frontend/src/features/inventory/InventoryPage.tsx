import { useState, useEffect, useCallback, useMemo } from "react";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import CreateFactSheetDialog from "@/components/CreateFactSheetDialog";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FactSheet, FactSheetListResponse } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

export default function InventoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { types } = useMetamodel();
  const [selectedType, setSelectedType] = useState(searchParams.get("type") || "");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [data, setData] = useState<FactSheet[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(searchParams.get("create") === "true");

  const typeConfig = types.find((t) => t.key === selectedType);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedType) params.set("type", selectedType);
      if (search) params.set("search", search);
      params.set("page_size", "500");
      const res = await api.get<FactSheetListResponse>(`/fact-sheets?${params}`);
      setData(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [selectedType, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
          ) : p.value;
        },
      },
      {
        field: "name",
        headerName: "Name",
        flex: 1,
        minWidth: 200,
        editable: true,
        cellStyle: { cursor: "pointer", fontWeight: 500 },
      },
      { field: "description", headerName: "Description", flex: 1, minWidth: 200, editable: true },
      {
        headerName: "Lifecycle",
        width: 120,
        valueGetter: (p: { data: FactSheet }) => {
          const lc = p.data?.lifecycle || {};
          const now = new Date().toISOString().slice(0, 10);
          for (const phase of ["endOfLife", "phaseOut", "active", "phaseIn", "plan"]) {
            if (lc[phase] && lc[phase] <= now) return phase;
          }
          return "";
        },
      },
      {
        field: "quality_seal",
        headerName: "Seal",
        width: 100,
        cellRenderer: (p: { value: string }) => {
          if (p.value === "APPROVED") return <Chip size="small" label="OK" color="success" />;
          if (p.value === "BROKEN") return <Chip size="small" label="!" color="warning" />;
          return "";
        },
      },
      {
        field: "completion",
        headerName: "Completion",
        width: 110,
        valueFormatter: (p: { value: number }) => `${Math.round(p.value || 0)}%`,
      },
    ];

    // Add type-specific attribute columns
    if (typeConfig) {
      for (const section of typeConfig.fields_schema) {
        for (const field of section.fields) {
          cols.push({
            field: `attr_${field.key}`,
            headerName: field.label,
            width: 150,
            editable: true,
            valueGetter: (p: { data: FactSheet }) =>
              (p.data?.attributes || {})[field.key] ?? "",
            valueSetter: (p) => {
              if (!p.data.attributes) p.data.attributes = {};
              (p.data.attributes as Record<string, unknown>)[field.key] = p.newValue;
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
    }

    return cols;
  }, [types, typeConfig]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Inventory
        </Typography>
        <Chip label={`${total} items`} size="small" />
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => setCreateOpen(true)}
          sx={{ textTransform: "none" }}
        >
          Create
        </Button>
      </Box>

      <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
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
      </Box>

      <Box className="ag-theme-quartz" sx={{ height: "calc(100vh - 240px)", width: "100%" }}>
        <AgGridReact
          rowData={data}
          columnDefs={columnDefs}
          loading={loading}
          rowSelection={{ mode: "multiRow", enableClickSelection: false }}
          onCellValueChanged={handleCellEdit}
          onRowClicked={(e) => {
            if (e.data) navigate(`/fact-sheets/${e.data.id}`);
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
        onCreate={() => loadData()}
        initialType={selectedType}
      />
    </Box>
  );
}
