import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";

interface CrudRow {
  data_object_id: string;
  data_object_name: string;
  apps: Record<string, string>; // app_id -> CRUD flags
}

interface CrudMatrixData {
  rows: CrudRow[];
  columns: { id: string; name: string }[];
}

function CrudFlags({ flags }: { flags: string }) {
  const flagColors: Record<string, string> = {
    C: "#2e7d32",
    R: "#1565c0",
    U: "#ed6c02",
    D: "#d32f2f",
  };

  return (
    <Box sx={{ display: "flex", gap: 0.25, justifyContent: "center" }}>
      {["C", "R", "U", "D"].map((f) => {
        const active = flags.includes(f);
        return (
          <Tooltip key={f} title={f === "C" ? "Create" : f === "R" ? "Read" : f === "U" ? "Update" : "Delete"}>
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.7rem",
                fontWeight: 700,
                backgroundColor: active ? `${flagColors[f]}18` : "transparent",
                color: active ? flagColors[f] : "#ddd",
                border: "1px solid",
                borderColor: active ? flagColors[f] : "#eee",
              }}
            >
              {f}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

export default function CrudMatrix() {
  const navigate = useNavigate();
  const [data, setData] = useState<CrudMatrixData>({ rows: [], columns: [] });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const result = await api.get<CrudMatrixData>("/integration/crud-matrix");
      setData(result);
    } catch {
      // handle
    }
  }

  const totalDataObjects = data.rows.length;
  const totalApps = data.columns.length;
  const totalRelations = data.rows.reduce(
    (sum, row) => sum + Object.keys(row.apps).length, 0
  );

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">CRUD Matrix</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Data Objects (rows) vs Applications (columns) — showing Create, Read, Update, Delete operations.
        </Typography>
      </Box>

      {/* Summary */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Card sx={{ flex: "1 1 150px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{totalDataObjects}</Typography>
            <Typography variant="body2" color="text.secondary">Data Objects</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: "1 1 150px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{totalApps}</Typography>
            <Typography variant="body2" color="text.secondary">Applications</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: "1 1 150px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{totalRelations}</Typography>
            <Typography variant="body2" color="text.secondary">Mappings</Typography>
          </CardContent>
        </Card>
      </Box>

      {data.rows.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="database" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No data object mappings</Typography>
            <Typography color="text.secondary">
              Create Data Object fact sheets and link them to Applications with CRUD usage.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card} sx={{ maxHeight: "calc(100vh - 320px)" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    position: "sticky",
                    left: 0,
                    zIndex: 3,
                    backgroundColor: "background.paper",
                    fontWeight: 700,
                    minWidth: 180,
                  }}
                >
                  Data Object
                </TableCell>
                {data.columns.map((col) => (
                  <TableCell
                    key={col.id}
                    align="center"
                    sx={{
                      fontWeight: 600,
                      fontSize: "0.75rem",
                      minWidth: 100,
                      maxWidth: 120,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      cursor: "pointer",
                      "&:hover": { color: "primary.main" },
                    }}
                    onClick={() => navigate(`/fact-sheets/${col.id}`)}
                  >
                    <Tooltip title={col.name}>
                      <span>{col.name}</span>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.data_object_id} hover>
                  <TableCell
                    sx={{
                      position: "sticky",
                      left: 0,
                      backgroundColor: "background.paper",
                      zIndex: 1,
                    }}
                  >
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer" }}
                      onClick={() => navigate(`/fact-sheets/${row.data_object_id}`)}
                    >
                      <MaterialSymbol icon="database" size={16} />
                      <Typography variant="body2" sx={{ fontWeight: 500, "&:hover": { textDecoration: "underline" } }}>
                        {row.data_object_name}
                      </Typography>
                    </Box>
                  </TableCell>
                  {data.columns.map((col) => (
                    <TableCell key={col.id} align="center" sx={{ p: 0.5 }}>
                      {row.apps[col.id] ? (
                        <CrudFlags flags={row.apps[col.id]} />
                      ) : (
                        <Typography variant="caption" color="text.disabled">-</Typography>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Legend */}
      <Box sx={{ display: "flex", gap: 2, mt: 2, justifyContent: "center" }}>
        {[
          { flag: "C", label: "Create", color: "#2e7d32" },
          { flag: "R", label: "Read", color: "#1565c0" },
          { flag: "U", label: "Update", color: "#ed6c02" },
          { flag: "D", label: "Delete", color: "#d32f2f" },
        ].map((item) => (
          <Chip
            key={item.flag}
            label={`${item.flag} = ${item.label}`}
            size="small"
            sx={{ color: item.color, borderColor: item.color }}
            variant="outlined"
          />
        ))}
      </Box>
    </Box>
  );
}
