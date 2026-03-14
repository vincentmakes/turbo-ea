import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import InputAdornment from "@mui/material/InputAdornment";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import type { ArchLensVendorHierarchy } from "@/types";
import { formatCost, vendorTypeColor } from "./utils";
import { useAnalysisPolling } from "./useAnalysisPolling";

// ---------------------------------------------------------------------------
// Sort options
// ---------------------------------------------------------------------------

type SortKey = "linked" | "cost" | "name" | "confidence";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ArchLensResolution() {
  const { t } = useTranslation("admin");
  const [hierarchy, setHierarchy] = useState<ArchLensVendorHierarchy[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("__all__");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [sortBy, setSortBy] = useState<SortKey>("linked");
  const { startPolling, polling: pollActive } = useAnalysisPolling(() => loadHierarchy(), (msg) => setError(msg));

  const loadHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ArchLensVendorHierarchy[]>("/archlens/vendors/hierarchy");
      setHierarchy(data);
    } catch {
      setHierarchy([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHierarchy();
  }, [loadHierarchy]);

  const handleResolve = async () => {
    setResolving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<{ run_id: string }>("/archlens/vendors/resolve");
      setSuccess(t("archlens_resolve_started"));
      startPolling(res.run_id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  // Derived data
  const allTypes = useMemo(() => {
    const types = new Set(hierarchy.map(v => v.vendor_type || "unknown"));
    return Array.from(types).sort();
  }, [hierarchy]);

  const allCategories = useMemo(() => {
    const cats = new Set(hierarchy.map(v => v.category).filter(Boolean) as string[]);
    return Array.from(cats).sort();
  }, [hierarchy]);

  const filtered = useMemo(() => {
    let result = hierarchy;
    if (typeFilter !== "__all__") {
      result = result.filter(v => v.vendor_type === typeFilter);
    }
    if (categoryFilter !== "__all__") {
      result = result.filter(v => v.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(v =>
        v.canonical_name.toLowerCase().includes(q) ||
        (v.aliases || []).some(a => a.toLowerCase().includes(q))
      );
    }
    // Sort
    const sorted = [...result];
    switch (sortBy) {
      case "linked": sorted.sort((a, b) => (b.app_count + b.itc_count) - (a.app_count + a.itc_count)); break;
      case "cost": sorted.sort((a, b) => b.total_cost - a.total_cost); break;
      case "name": sorted.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)); break;
      case "confidence": sorted.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)); break;
    }
    return sorted;
  }, [hierarchy, typeFilter, categoryFilter, search, sortBy]);

  // KPI calculations
  const canonicalVendors = hierarchy.filter(v => v.vendor_type === "vendor").length;
  const productsModules = hierarchy.filter(v => v.vendor_type !== "vendor").length;
  const totalLinked = hierarchy.reduce((s, v) => s + v.app_count + v.itc_count, 0);
  const withConfidence = hierarchy.filter(v => v.confidence != null);
  const avgConfidence = withConfidence.length > 0
    ? withConfidence.reduce((s, v) => s + (v.confidence ?? 0), 0) / withConfidence.length
    : 0;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">
          {t("archlens_resolution_title")}
        </Typography>
        <Button
          variant="contained"
          startIcon={
            resolving ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              <MaterialSymbol icon="account_tree" size={20} />
            )
          }
          onClick={handleResolve}
          disabled={resolving || pollActive}
        >
          {t("archlens_resolve_vendors")}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : hierarchy.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <MaterialSymbol icon="account_tree" size={48} color="#9e9e9e" />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("archlens_no_hierarchy")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("archlens_no_hierarchy_hint")}
          </Typography>
        </Paper>
      ) : (
        <>
          {/* KPI Strip */}
          <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 3 }}>
            <MetricCard
              icon="storefront"
              label={t("archlens_kpi_canonical_vendors")}
              value={canonicalVendors}
              color="#0f7eb5"
            />
            <MetricCard
              icon="inventory_2"
              label={t("archlens_kpi_products_modules")}
              value={productsModules}
              color="#8e24aa"
            />
            <MetricCard
              icon="link"
              label={t("archlens_kpi_linked_cards")}
              value={totalLinked}
              color="#4caf50"
            />
            <MetricCard
              icon="speed"
              label={t("archlens_kpi_avg_confidence")}
              value={`${Math.round(avgConfidence)}%`}
              color={avgConfidence >= 80 ? "#4caf50" : avgConfidence >= 50 ? "#ffa31f" : "#f44336"}
            />
          </Stack>

          {/* Search & Filters */}
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              placeholder={t("archlens_resolution_search_placeholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 250 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={20} />
                  </InputAdornment>
                ),
              }}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t("archlens_col_vendor_type")}</InputLabel>
              <Select
                value={typeFilter}
                label={t("archlens_col_vendor_type")}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <MenuItem value="__all__">{t("archlens_filter_all")}</MenuItem>
                {allTypes.map(tp => (
                  <MenuItem key={tp} value={tp}>{tp}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t("archlens_col_category")}</InputLabel>
              <Select
                value={categoryFilter}
                label={t("archlens_col_category")}
                onChange={e => setCategoryFilter(e.target.value)}
              >
                <MenuItem value="__all__">{t("archlens_filter_all")}</MenuItem>
                {allCategories.map(cat => (
                  <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t("archlens_sort_by")}</InputLabel>
              <Select
                value={sortBy}
                label={t("archlens_sort_by")}
                onChange={e => setSortBy(e.target.value as SortKey)}
              >
                <MenuItem value="linked">{t("archlens_sort_most_linked")}</MenuItem>
                <MenuItem value="cost">{t("archlens_sort_highest_cost")}</MenuItem>
                <MenuItem value="name">{t("archlens_sort_name_az")}</MenuItem>
                <MenuItem value="confidence">{t("archlens_sort_confidence")}</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              {t("archlens_vendor_hierarchy")} ({filtered.length})
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("archlens_col_canonical_name")}</TableCell>
                  <TableCell>{t("archlens_col_vendor_type")}</TableCell>
                  <TableCell>{t("archlens_col_aliases")}</TableCell>
                  <TableCell>{t("archlens_col_category")}</TableCell>
                  <TableCell align="right">{t("archlens_col_app_count")}</TableCell>
                  <TableCell align="right">{t("archlens_col_itc_count")}</TableCell>
                  <TableCell align="right">{t("archlens_col_cost")}</TableCell>
                  <TableCell align="right">{t("archlens_col_confidence")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((v) => (
                  <TableRow key={v.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {v.canonical_name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={v.vendor_type}
                        size="small"
                        color={vendorTypeColor(v.vendor_type)}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 250 }}>
                      {v.aliases && v.aliases.length > 0 ? (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {v.aliases.slice(0, 5).map((alias) => (
                            <Chip
                              key={alias}
                              label={alias}
                              size="small"
                              variant="outlined"
                              sx={{ mb: 0.5 }}
                            />
                          ))}
                          {v.aliases.length > 5 && (
                            <Chip label={`+${v.aliases.length - 5}`} size="small" variant="outlined" sx={{ mb: 0.5 }} />
                          )}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.category ? (
                        <Tooltip title={v.sub_category || ""} arrow>
                          <Chip label={v.category} size="small" variant="outlined" />
                        </Tooltip>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell align="right">{v.app_count}</TableCell>
                    <TableCell align="right">{v.itc_count}</TableCell>
                    <TableCell align="right">
                      {v.total_cost > 0 ? formatCost(v.total_cost) : "-"}
                    </TableCell>
                    <TableCell align="right">
                      {v.confidence != null ? (
                        <Chip
                          label={`${Math.round(v.confidence)}%`}
                          size="small"
                          color={
                            v.confidence >= 80
                              ? "success"
                              : v.confidence >= 50
                                ? "warning"
                                : "error"
                          }
                          variant="outlined"
                        />
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </Box>
  );
}
