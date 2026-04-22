/**
 * RisksTab — shows all Risks linked to a given Card via the M:N junction,
 * with quick actions to create a new risk for the card or jump to the
 * full risk register.
 *
 * Backed by ``GET /cards/{id}/risks``.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import type { Risk } from "@/types";
import CreateRiskDialog from "@/features/ea-delivery/risks/CreateRiskDialog";
import {
  emptySeed,
  RiskDialogSeed,
  riskLevelChipColor,
} from "@/features/ea-delivery/risks/riskDefaults";

interface Props {
  cardId: string;
}

export default function RisksTab({ cardId }: Props) {
  const { t } = useTranslation("delivery");
  const navigate = useNavigate();

  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogSeed, setDialogSeed] = useState<RiskDialogSeed | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Risk[]>(`/cards/${cardId}/risks`);
      setRisks(data);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Typography variant="subtitle1" fontWeight={700}>
          {t("risks.cardTab.title")}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate("/ea-delivery?tab=risks")}
          >
            {t("risks.title")}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<MaterialSymbol icon="add" size={16} />}
            onClick={() => setDialogSeed(emptySeed([cardId]))}
          >
            {t("risks.cardTab.createNew")}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {risks.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("risks.cardTab.empty")}
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("risks.col.reference")}</TableCell>
              <TableCell>{t("risks.col.title")}</TableCell>
              <TableCell>{t("risks.col.category")}</TableCell>
              <TableCell>{t("risks.col.initialLevel")}</TableCell>
              <TableCell>{t("risks.col.residualLevel")}</TableCell>
              <TableCell>{t("risks.col.status")}</TableCell>
              <TableCell>{t("risks.col.target")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {risks.map((r) => (
              <TableRow
                key={r.id}
                hover
                onClick={() => navigate(`/ea-delivery/risks/${r.id}`)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell>{r.reference}</TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t(`risks.category.${r.category}`)}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={riskLevelChipColor(r.initial_level)}
                    label={t(`risks.level.${r.initial_level}`)}
                  />
                </TableCell>
                <TableCell>
                  {r.residual_level ? (
                    <Chip
                      size="small"
                      color={riskLevelChipColor(r.residual_level)}
                      label={t(`risks.level.${r.residual_level}`)}
                    />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t(`risks.status.${r.status}`)}
                  />
                </TableCell>
                <TableCell>{r.target_resolution_date ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateRiskDialog
        open={Boolean(dialogSeed)}
        seed={dialogSeed}
        onClose={() => setDialogSeed(null)}
        onCreated={(risk) => {
          setDialogSeed(null);
          load();
          navigate(`/ea-delivery/risks/${risk.id}`);
        }}
      />
    </Paper>
  );
}
