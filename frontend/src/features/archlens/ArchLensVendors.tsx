import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import type { ArchLensVendor } from "@/types";
import { formatCost } from "./utils";
import { useAnalysisPolling } from "./useAnalysisPolling";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByCategory(vendors: ArchLensVendor[]): Record<string, ArchLensVendor[]> {
  const groups: Record<string, ArchLensVendor[]> = {};
  for (const v of vendors) {
    const cat = v.category || "Uncategorized";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(v);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ArchLensVendors() {
  const { t } = useTranslation("admin");
  const [vendors, setVendors] = useState<ArchLensVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const { startPolling, polling: pollActive } = useAnalysisPolling(() => loadVendors(), (msg) => setError(msg));

  const loadVendors = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ArchLensVendor[]>("/archlens/vendors");
      setVendors(data);
    } catch {
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  const handleAnalyse = async () => {
    setAnalysing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<{ run_id: string }>("/archlens/vendors/analyse");
      setSuccess(t("archlens_vendor_analysis_started"));
      startPolling(res.run_id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAnalysing(false);
    }
  };

  // Derived data
  const allCategories = useMemo(() => {
    const cats = new Set(vendors.map(v => v.category || "Uncategorized"));
    return Array.from(cats).sort();
  }, [vendors]);

  const filtered = useMemo(() => {
    let result = vendors;
    if (categoryFilter !== "__all__") {
      result = result.filter(v => (v.category || "Uncategorized") === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(v =>
        v.vendor_name.toLowerCase().includes(q) ||
        (v.category || "").toLowerCase().includes(q) ||
        (v.sub_category || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [vendors, categoryFilter, search]);

  const categories = groupByCategory(filtered);
  const categoryEntries = Object.entries(categories).sort(
    (a, b) => b[1].length - a[1].length,
  );

  // KPI calculations
  const totalAppLinks = vendors.reduce((s, v) => s + v.app_count, 0);
  const totalCost = vendors.reduce((s, v) => s + v.total_cost, 0);
  const topCategory = categoryEntries[0];

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">
          {t("archlens_vendors_title")}
        </Typography>
        <Button
          variant="contained"
          startIcon={
            analysing ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              <MaterialSymbol icon="analytics" size={20} />
            )
          }
          onClick={handleAnalyse}
          disabled={analysing || pollActive}
        >
          {t("archlens_run_analysis")}
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
      ) : vendors.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <MaterialSymbol icon="storefront" size={48} color="#9e9e9e" />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("archlens_no_vendors")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("archlens_no_vendors_hint")}
          </Typography>
        </Paper>
      ) : (
        <>
          {/* KPI Strip */}
          <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 3 }}>
            <MetricCard
              icon="storefront"
              label={t("archlens_kpi_unique_vendors")}
              value={vendors.length}
              color="#0f7eb5"
            />
            <MetricCard
              icon="link"
              label={t("archlens_kpi_app_links")}
              value={totalAppLinks}
              color="#4caf50"
            />
            {totalCost > 0 && (
              <MetricCard
                icon="payments"
                label={t("archlens_kpi_annual_cost")}
                value={formatCost(totalCost)}
                color="#00897b"
              />
            )}
            {topCategory && (
              <MetricCard
                icon="category"
                label={t("archlens_kpi_top_category")}
                value={`${topCategory[0]} (${topCategory[1].length})`}
                color="#ffa31f"
              />
            )}
          </Stack>

          {/* Search & Filters */}
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
            <TextField
              size="small"
              placeholder={t("archlens_vendor_search_placeholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 280 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={20} />
                  </InputAdornment>
                ),
              }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
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
            <Box sx={{ flex: 1 }} />
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, v) => v && setViewMode(v)}
              size="small"
            >
              <ToggleButton value="grid">
                <MaterialSymbol icon="grid_view" size={20} />
              </ToggleButton>
              <ToggleButton value="table">
                <MaterialSymbol icon="view_list" size={20} />
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {viewMode === "grid" ? (
            <>
              {/* Category Cards */}
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                {t("archlens_vendor_categories")} ({categoryEntries.length})
              </Typography>
              <Grid container spacing={2} sx={{ mb: 3 }}>
                {categoryEntries.map(([category, catVendors]) => {
                  const catCost = catVendors.reduce((s, v) => s + v.total_cost, 0);
                  const catApps = catVendors.reduce((s, v) => s + v.app_count, 0);
                  return (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={category}>
                      <Card
                        variant="outlined"
                        sx={{ height: "100%", cursor: "pointer", "&:hover": { borderColor: "primary.main" } }}
                        onClick={() => { setCategoryFilter(category); setViewMode("table"); }}
                      >
                        <CardContent>
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                            <MaterialSymbol icon="category" size={20} color="#757575" />
                            <Typography variant="subtitle2" fontWeight="bold" noWrap>
                              {category}
                            </Typography>
                          </Stack>
                          <Typography variant="h4" fontWeight="bold" color="primary">
                            {catVendors.length}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {t("archlens_vendors_count")}
                          </Typography>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {catApps > 0 && <Chip label={`${catApps} apps`} size="small" variant="outlined" />}
                            {catCost > 0 && <Chip label={formatCost(catCost)} size="small" variant="outlined" />}
                          </Stack>
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                            {catVendors.slice(0, 4).map(v => (
                              <Chip key={v.id} label={v.vendor_name} size="small" sx={{ fontSize: 11 }} />
                            ))}
                            {catVendors.length > 4 && (
                              <Chip label={`+${catVendors.length - 4}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                            )}
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </>
          ) : (
            /* Vendor Table */
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                {t("archlens_all_vendors")} ({filtered.length})
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("archlens_col_vendor_name")}</TableCell>
                    <TableCell>{t("archlens_col_category")}</TableCell>
                    <TableCell>{t("archlens_col_sub_category")}</TableCell>
                    <TableCell align="right">{t("archlens_col_app_count")}</TableCell>
                    <TableCell align="right">{t("archlens_col_cost")}</TableCell>
                    <TableCell>{t("archlens_col_reasoning")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((v) => (
                    <TableRow key={v.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {v.vendor_name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={v.category} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        {v.sub_category && (
                          <Chip label={v.sub_category} size="small" variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell align="right">{v.app_count}</TableCell>
                      <TableCell align="right">
                        {v.total_cost > 0 ? formatCost(v.total_cost) : "-"}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 300 }}>
                        <Tooltip title={v.reasoning || ""} arrow>
                          <Typography variant="body2" noWrap>
                            {v.reasoning || "-"}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
