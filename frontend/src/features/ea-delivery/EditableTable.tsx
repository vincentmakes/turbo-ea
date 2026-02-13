import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import InputBase from "@mui/material/InputBase";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  columns: string[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
  readOnly?: boolean;
}

export default function EditableTable({ columns, rows, onChange, readOnly }: Props) {
  const updateCell = (ri: number, ci: number, value: string) => {
    const next = rows.map((r) => [...r]);
    next[ri][ci] = value;
    onChange(next);
  };

  const addRow = () => {
    onChange([...rows, new Array(columns.length).fill("")]);
  };

  const removeRow = (ri: number) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, i) => i !== ri));
  };

  return (
    <Box>
      <TableContainer
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "grey.50" }}>
              {columns.map((col) => (
                <TableCell
                  key={col}
                  sx={{ fontWeight: 600, fontSize: "0.8rem", py: 1 }}
                >
                  {col}
                </TableCell>
              ))}
              {!readOnly && <TableCell sx={{ width: 40, p: 0 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, ri) => (
              <TableRow
                key={ri}
                sx={{ "&:hover .row-action": { opacity: 1 } }}
              >
                {row.map((cell, ci) => (
                  <TableCell key={ci} sx={{ p: 0 }}>
                    <InputBase
                      fullWidth
                      multiline
                      readOnly={readOnly}
                      value={cell}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      sx={{
                        px: 1.5,
                        py: 0.75,
                        fontSize: "0.85rem",
                      }}
                    />
                  </TableCell>
                ))}
                {!readOnly && (
                  <TableCell sx={{ p: 0, width: 40 }}>
                    {rows.length > 1 && (
                      <Tooltip title="Remove row">
                        <IconButton
                          size="small"
                          className="row-action"
                          sx={{ opacity: 0, transition: "opacity 0.15s" }}
                          onClick={() => removeRow(ri)}
                        >
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!readOnly && (
        <Box sx={{ mt: 0.5 }}>
          <Tooltip title="Add row">
            <IconButton size="small" onClick={addRow}>
              <MaterialSymbol icon="add" size={18} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}
