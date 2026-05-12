import { useCallback, useEffect, useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import CreateSoAWDialog from "@/features/ea-delivery/CreateSoAWDialog";
import type { SoAW } from "@/types";

const STATUS_COLOR: Record<SoAW["status"], "default" | "warning" | "info" | "success"> = {
  draft: "default",
  in_review: "warning",
  approved: "info",
  signed: "success",
};

interface Props {
  initiativeId: string;
  /** Whether the current user can create / delete SoAWs on this card. */
  canManage: boolean;
}

export default function SoAWTab({ initiativeId, canManage }: Props) {
  const { t } = useTranslation(["grc", "common"]);
  const navigate = useNavigate();
  const [soaws, setSoaws] = useState<SoAW[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<SoAW[]>(`/soaw?initiative_id=${initiativeId}`);
      setSoaws(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (soaw: SoAW) => {
    if (!confirm(t("soaw.confirmDelete"))) return;
    try {
      await api.delete(`/soaw/${soaw.id}`);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <MaterialSymbol icon="article" size={22} color="#1976d2" />
            <Typography variant="h6" fontWeight={600}>
              {t("soaw.title")}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {t("soaw.subtitle")}
          </Typography>
        </Box>
        {canManage && (
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setCreateOpen(true)}
          >
            {t("soaw.create")}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : soaws.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 6, textAlign: "center" }}>
          <MaterialSymbol icon="article" size={40} color="#bbb" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, px: 2 }}>
            {t("soaw.empty")}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("soaw.columns.title")}</TableCell>
                <TableCell>{t("soaw.columns.status")}</TableCell>
                <TableCell align="right">{t("soaw.columns.revision")}</TableCell>
                <TableCell>{t("soaw.columns.updated")}</TableCell>
                <TableCell align="right">{t("common:labels.actions", "Actions")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {soaws.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell>
                    <RouterLink
                      to={`/ea-delivery/soaw/${s.id}`}
                      style={{ color: "inherit", textDecoration: "none", fontWeight: 500 }}
                    >
                      {s.name}
                    </RouterLink>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={s.status.replace("_", " ")}
                      color={STATUS_COLOR[s.status]}
                      variant={s.status === "signed" ? "filled" : "outlined"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="caption" color="text.secondary">
                      r{s.revision_number}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" justifyContent="flex-end" spacing={0.5}>
                      <Tooltip title={t("soaw.actions.preview")}>
                        <IconButton
                          size="small"
                          onClick={() => navigate(`/ea-delivery/soaw/${s.id}/preview`)}
                        >
                          <MaterialSymbol icon="visibility" size={18} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t("soaw.actions.open")}>
                        <IconButton
                          size="small"
                          onClick={() => navigate(`/ea-delivery/soaw/${s.id}`)}
                        >
                          <MaterialSymbol icon="open_in_new" size={18} />
                        </IconButton>
                      </Tooltip>
                      {canManage && (
                        <Tooltip title={t("soaw.actions.delete")}>
                          <IconButton size="small" color="error" onClick={() => handleDelete(s)}>
                            <MaterialSymbol icon="delete" size={18} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <CreateSoAWDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          navigate(`/ea-delivery/soaw/${created.id}`);
        }}
        fixedInitiativeId={initiativeId}
      />
    </Box>
  );
}
