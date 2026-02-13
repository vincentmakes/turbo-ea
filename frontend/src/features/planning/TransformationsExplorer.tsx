import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TablePagination from "@mui/material/TablePagination";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type {
  Transformation,
  TransformationListResponse,
  TransformationStatus,
} from "@/types";

const STATUS_COLORS: Record<TransformationStatus, string> = {
  draft: "#9e9e9e",
  planned: "#1976d2",
  executed: "#4caf50",
};

const STATUS_LABELS: Record<TransformationStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  executed: "Executed",
};

export default function TransformationsExplorer() {
  const navigate = useNavigate();
  const { getType } = useMetamodel();

  // Data state
  const [items, setItems] = useState<Transformation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [initiativeSearch, setInitiativeSearch] = useState("");
  const [debouncedInitiativeSearch, setDebouncedInitiativeSearch] = useState("");

  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Dialog state
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<Transformation | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  // Debounce search input
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [search]);

  // Debounce initiative search input
  const initiativeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(initiativeTimerRef.current);
    initiativeTimerRef.current = setTimeout(() => {
      setDebouncedInitiativeSearch(initiativeSearch);
      setPage(0);
    }, 300);
    return () => clearTimeout(initiativeTimerRef.current);
  }, [initiativeSearch]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status", statusFilter);
      if (debouncedInitiativeSearch) params.set("initiative_search", debouncedInitiativeSearch);
      params.set("page", String(page + 1));
      params.set("page_size", String(pageSize));
      const res = await api.get<TransformationListResponse>(
        `/transformations?${params}`
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transformations");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, debouncedInitiativeSearch, page, pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExecute = async () => {
    if (!actionTarget) return;
    setActionLoading(true);
    setActionError("");
    try {
      await api.post(`/transformations/${actionTarget.id}/execute`);
      setExecuteDialogOpen(false);
      setActionTarget(null);
      loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to execute transformation");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!actionTarget) return;
    setActionLoading(true);
    setActionError("");
    try {
      await api.delete(`/transformations/${actionTarget.id}`);
      setDeleteDialogOpen(false);
      setActionTarget(null);
      loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete transformation");
    } finally {
      setActionLoading(false);
    }
  };

  const openExecuteDialog = (t: Transformation) => {
    setActionTarget(t);
    setActionError("");
    setExecuteDialogOpen(true);
  };

  const openDeleteDialog = (t: Transformation) => {
    setActionTarget(t);
    setActionError("");
    setDeleteDialogOpen(true);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString();
  };

  const getTemplateLabel = (t: Transformation) => {
    if (t.template?.name) return t.template.name;
    if (t.template?.target_fact_sheet_type) {
      const typeInfo = getType(t.template.target_fact_sheet_type);
      return typeInfo?.label || t.template.target_fact_sheet_type;
    }
    return "-";
  };

  return (
    <Box>
      {/* Page Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={600} sx={{ mb: 0.5 }}>
          Transformations Explorer
        </Typography>
        <Typography variant="body2" color="text.secondary">
          View and manage all transformations across initiatives. Track planned changes to
          your IT landscape and execute them when ready.
        </Typography>
      </Box>

      {/* Filters Bar */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              gap: 2,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <TextField
              size="small"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 220 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={20} color="#999" />
                  </InputAdornment>
                ),
              }}
            />

            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(0);
                }}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="planned">Planned</MenuItem>
                <MenuItem value="executed">Executed</MenuItem>
              </Select>
            </FormControl>

            <TextField
              size="small"
              placeholder="Filter by initiative..."
              value={initiativeSearch}
              onChange={(e) => setInitiativeSearch(e.target.value)}
              sx={{ minWidth: 220 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="rocket_launch" size={20} color="#999" />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Loading Bar */}
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      {/* Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Initiative</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Template</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Completion Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Impacts
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((t) => (
              <TableRow
                key={t.id}
                hover
                sx={{ cursor: "pointer" }}
                onClick={() => {
                  if (t.initiative_id) {
                    navigate(`/fact-sheets/${t.initiative_id}`);
                  }
                }}
              >
                <TableCell>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    sx={{
                      color: "primary.main",
                      "&:hover": { textDecoration: "underline" },
                    }}
                  >
                    {t.name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {t.initiative?.name || "-"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{getTemplateLabel(t)}</Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={STATUS_LABELS[t.status] || t.status}
                    sx={{
                      bgcolor: STATUS_COLORS[t.status] || "#9e9e9e",
                      color: "#fff",
                      fontWeight: 500,
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {formatDate(t.completion_date)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2">{t.impact_count}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {t.creator?.display_name || "-"}
                  </Typography>
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 0.5,
                    }}
                  >
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (t.initiative_id) {
                            navigate(`/fact-sheets/${t.initiative_id}`);
                          }
                        }}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </Tooltip>

                    {t.status === "planned" && (
                      <Tooltip title="Execute transformation">
                        <IconButton
                          size="small"
                          color="success"
                          onClick={() => openExecuteDialog(t)}
                        >
                          <MaterialSymbol
                            icon="play_arrow"
                            size={18}
                            color="#4caf50"
                          />
                        </IconButton>
                      </Tooltip>
                    )}

                    {t.status !== "executed" && (
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => openDeleteDialog(t)}
                        >
                          <MaterialSymbol
                            icon="delete"
                            size={18}
                            color="#f44336"
                          />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}

            {/* Empty State */}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    <MaterialSymbol
                      icon="transform"
                      size={48}
                      color="#bdbdbd"
                    />
                    <Typography variant="h6" color="text.secondary">
                      No transformations found
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ maxWidth: 400, textAlign: "center" }}
                    >
                      Transformations define planned changes to your IT landscape.
                      Create them from an initiative's detail page.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => {
            setPageSize(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </TableContainer>

      {/* Execute Confirmation Dialog */}
      <Dialog
        open={executeDialogOpen}
        onClose={() => setExecuteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Execute Transformation</DialogTitle>
        <DialogContent>
          {actionError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              onClose={() => setActionError("")}
            >
              {actionError}
            </Alert>
          )}
          <Typography>
            Are you sure you want to execute the transformation{" "}
            <strong>{actionTarget?.name}</strong>? This will apply all{" "}
            {actionTarget?.impact_count || 0} planned impacts to the architecture.
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExecuteDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleExecute}
            disabled={actionLoading}
            startIcon={
              <MaterialSymbol icon="play_arrow" size={18} />
            }
          >
            {actionLoading ? "Executing..." : "Execute"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Delete Transformation</DialogTitle>
        <DialogContent>
          {actionError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              onClose={() => setActionError("")}
            >
              {actionError}
            </Alert>
          )}
          <Typography>
            Are you sure you want to delete the transformation{" "}
            <strong>{actionTarget?.name}</strong>? This will remove all associated
            impacts. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={actionLoading}
            startIcon={<MaterialSymbol icon="delete" size={18} />}
          >
            {actionLoading ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
