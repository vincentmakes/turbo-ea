import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Pagination,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import {
  FactSheet,
  FactSheetListResponse,
  FactSheetType,
  FACT_SHEET_TYPE_LABELS,
  FACT_SHEET_TYPE_ICONS,
} from "../../types/fact-sheet";

export default function FactSheetList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const typeFilter = searchParams.get("type") as FactSheetType | null;

  const [factSheets, setFactSheets] = useState<FactSheet[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<FactSheetType>(typeFilter || "application");
  const [newDescription, setNewDescription] = useState("");

  const pageSize = 25;

  useEffect(() => {
    loadFactSheets();
  }, [typeFilter, page, search]);

  async function loadFactSheets() {
    const params: Record<string, string> = {
      page: String(page),
      page_size: String(pageSize),
    };
    if (typeFilter) params.type = typeFilter;
    if (search) params.search = search;

    try {
      const data = await api.get<FactSheetListResponse>("/fact-sheets", params);
      setFactSheets(data.items);
      setTotal(data.total);
    } catch {
      // handle error
    }
  }

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
      // handle error
    }
  }

  const title = typeFilter
    ? FACT_SHEET_TYPE_LABELS[typeFilter]
    : "All Fact Sheets";

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4">{title}</Typography>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={20} />}
          onClick={() => setCreateOpen(true)}
        >
          Create
        </Button>
      </Box>

      <Card sx={{ mb: 2, p: 2 }}>
        <TextField
          size="small"
          placeholder="Search fact sheets..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          sx={{ width: 300 }}
        />
      </Card>

      <TableContainer component={Card}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Completion</TableCell>
              <TableCell>Updated</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {factSheets.map((fs) => (
              <TableRow
                key={fs.id}
                hover
                sx={{ cursor: "pointer" }}
                onClick={() => navigate(`/fact-sheets/${fs.id}`)}
              >
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={FACT_SHEET_TYPE_ICONS[fs.type]} size={20} />
                    {fs.name}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip label={FACT_SHEET_TYPE_LABELS[fs.type]} size="small" />
                </TableCell>
                <TableCell>
                  <Chip
                    label={fs.status}
                    size="small"
                    color={fs.status === "active" ? "success" : "default"}
                  />
                </TableCell>
                <TableCell>{Math.round(fs.completion)}%</TableCell>
                <TableCell>{new Date(fs.updated_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
            {factSheets.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    No fact sheets found. Create one to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {total > pageSize && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Pagination
            count={Math.ceil(total / pageSize)}
            page={page}
            onChange={(_, p) => setPage(p)}
          />
        </Box>
      )}

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
    </Box>
  );
}
