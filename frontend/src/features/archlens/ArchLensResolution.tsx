import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
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
import type { ArchLensVendorHierarchy } from "@/types";
import { formatCost, vendorTypeColor } from "./utils";
import { useAnalysisPolling } from "./useAnalysisPolling";

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
  const { startPolling, polling: pollActive } = useAnalysisPolling(() => loadHierarchy());

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
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
            {t("archlens_vendor_hierarchy")}
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
              {hierarchy.map((v) => (
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
                        {v.aliases.map((alias) => (
                          <Chip
                            key={alias}
                            label={alias}
                            size="small"
                            variant="outlined"
                            sx={{ mb: 0.5 }}
                          />
                        ))}
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
      )}
    </Box>
  );
}
