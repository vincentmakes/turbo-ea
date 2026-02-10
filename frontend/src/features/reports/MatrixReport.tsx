import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";

interface MatrixData {
  rows: { id: string; name: string }[];
  columns: { id: string; name: string }[];
  intersections: { row_id: string; col_id: string }[];
}

export default function MatrixReport() {
  const { types } = useMetamodel();
  const [rowType, setRowType] = useState("Application");
  const [colType, setColType] = useState("BusinessCapability");
  const [data, setData] = useState<MatrixData | null>(null);

  useEffect(() => {
    api.get<MatrixData>(`/reports/matrix?row_type=${rowType}&col_type=${colType}`).then(setData);
  }, [rowType, colType]);

  const intersectionSet = new Set(
    (data?.intersections || []).map((i) => `${i.row_id}:${i.col_id}`)
  );

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Matrix Report</Typography>
      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Rows</InputLabel>
          <Select value={rowType} label="Rows" onChange={(e) => setRowType(e.target.value)}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Columns</InputLabel>
          <Select value={colType} label="Columns" onChange={(e) => setColType(e.target.value)}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      {data && (
        <Box sx={{ overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ padding: 8, border: "1px solid #e0e0e0", position: "sticky", left: 0, background: "#f5f5f5" }}></th>
                {data.columns.map((c) => (
                  <th key={c.id} style={{ padding: 8, border: "1px solid #e0e0e0", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: "#f5f5f5" }}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 8, border: "1px solid #e0e0e0", fontWeight: 500, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff" }}>
                    {r.name}
                  </td>
                  {data.columns.map((c) => {
                    const has = intersectionSet.has(`${r.id}:${c.id}`) || intersectionSet.has(`${c.id}:${r.id}`);
                    return (
                      <td
                        key={c.id}
                        style={{
                          padding: 8,
                          border: "1px solid #e0e0e0",
                          textAlign: "center",
                          backgroundColor: has ? "#e3f2fd" : "#fff",
                        }}
                      >
                        {has ? "●" : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Box>
  );
}
