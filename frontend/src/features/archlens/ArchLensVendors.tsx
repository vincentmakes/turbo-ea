import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
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
  const { startPolling, polling: pollActive } = useAnalysisPolling(() => loadVendors());

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

  const categories = groupByCategory(vendors);
  const categoryEntries = Object.entries(categories).sort(
    (a, b) => b[1].length - a[1].length,
  );

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
          {/* Category Cards */}
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            {t("archlens_vendor_categories")}
          </Typography>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {categoryEntries.map(([category, catVendors]) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={category}>
                <Card variant="outlined" sx={{ height: "100%" }}>
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
                    <Typography variant="body2" color="text.secondary">
                      {t("archlens_vendors_count")}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Vendor Table */}
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              {t("archlens_all_vendors")}
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
                {vendors.map((v) => (
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
        </>
      )}
    </Box>
  );
}
