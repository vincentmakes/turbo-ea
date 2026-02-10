import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";

interface MatrixCell {
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  relation_type: string;
  count: number;
}

interface MatrixData {
  rows: string[];
  columns: string[];
  cells: MatrixCell[];
  row_type: string;
  col_type: string;
}

const TYPE_OPTIONS = [
  { value: "application", label: "Application" },
  { value: "business_capability", label: "Business Capability" },
  { value: "it_component", label: "IT Component" },
  { value: "organization", label: "Organization" },
  { value: "provider", label: "Provider" },
  { value: "interface", label: "Interface" },
  { value: "initiative", label: "Initiative" },
  { value: "data_object", label: "Data Object" },
];

export default function MatrixReport() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [rowType, setRowType] = useState("application");
  const [colType, setColType] = useState("business_capability");

  useEffect(() => {
    loadData();
  }, [rowType, colType]);

  async function loadData() {
    try {
      const result = await api.get<MatrixData>("/reports/matrix", {
        row_type: rowType,
        col_type: colType,
      });
      setData(result);
    } catch {
      // handle
    }
  }

  // Build lookup for quick cell access
  const cellMap = new Map<string, number>();
  if (data) {
    for (const cell of data.cells) {
      const key = `${cell.from_name}|${cell.to_name}`;
      cellMap.set(key, (cellMap.get(key) || 0) + cell.count);
    }
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Matrix Report</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Cross-reference matrix showing relations between fact sheet types.
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 2 }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Rows</InputLabel>
            <Select value={rowType} label="Rows" onChange={(e) => setRowType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Columns</InputLabel>
            <Select value={colType} label="Columns" onChange={(e) => setColType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {!data || (data.rows.length === 0 && data.columns.length === 0) ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="grid_on" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No data for this combination</Typography>
            <Typography color="text.secondary">
              Try selecting different row and column types.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent sx={{ overflow: "auto" }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {data.rows.length} rows × {data.columns.length} columns — {data.cells.length} relations
            </Typography>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: `200px repeat(${data.columns.length}, minmax(80px, 1fr))`,
                gap: 0,
                minWidth: 200 + data.columns.length * 80,
              }}
            >
              {/* Header row */}
              <Box
                sx={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  backgroundColor: "background.paper",
                  p: 1,
                  borderBottom: "2px solid",
                  borderColor: "divider",
                }}
              />
              {data.columns.map((col) => (
                <Box
                  key={col}
                  sx={{
                    p: 1,
                    borderBottom: "2px solid",
                    borderColor: "divider",
                    textAlign: "center",
                  }}
                >
                  <Tooltip title={col}>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 700,
                        writingMode: data.columns.length > 8 ? "vertical-rl" : "horizontal-tb",
                        textOrientation: "mixed",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: data.columns.length > 8 ? "none" : 80,
                        display: "block",
                      }}
                    >
                      {col}
                    </Typography>
                  </Tooltip>
                </Box>
              ))}

              {/* Data rows */}
              {data.rows.map((row) => (
                <>
                  <Box
                    key={`label-${row}`}
                    sx={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      backgroundColor: "background.paper",
                      p: 1,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 190,
                      }}
                    >
                      {row}
                    </Typography>
                  </Box>
                  {data.columns.map((col) => {
                    const count = cellMap.get(`${row}|${col}`) || 0;
                    return (
                      <Box
                        key={`${row}|${col}`}
                        sx={{
                          p: 0.5,
                          borderBottom: "1px solid",
                          borderColor: "divider",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: count > 0 ? "#1976d214" : "transparent",
                        }}
                      >
                        {count > 0 && (
                          <Tooltip title={`${row} → ${col}: ${count} relation(s)`}>
                            <Chip
                              label={count}
                              size="small"
                              color="primary"
                              sx={{ height: 22, minWidth: 28, fontSize: "0.7rem" }}
                            />
                          </Tooltip>
                        )}
                      </Box>
                    );
                  })}
                </>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
