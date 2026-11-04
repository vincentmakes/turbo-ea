import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card, CardRestoreResponse, RestoreImpact, RestoreImpactPassenger } from "@/types";

interface Props {
  open: boolean;
  cardId: string;
  cardName: string;
  onClose: () => void;
  onConfirmed: (primary: Card) => void;
}

export default function RestoreDialog({ open, cardId, cardName, onClose, onConfirmed }: Props) {
  const { t } = useTranslation(["cards", "common"]);
  const [impact, setImpact] = useState<RestoreImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setImpact(null);
      setTicked(new Set());
      setError("");
      return;
    }
    setLoading(true);
    api
      .get<RestoreImpact>(`/cards/${cardId}/restore-impact`)
      .then((data) => {
        setImpact(data);
        // Default-tick every passenger so the natural "yes" is one click.
        setTicked(new Set(data.passengers.map((p) => p.id)));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [open, cardId]);

  const grouped = useMemo(() => {
    if (!impact) return { children: [] as RestoreImpactPassenger[], related: [] as RestoreImpactPassenger[] };
    return {
      children: impact.passengers.filter((p) => p.role === "child"),
      related: impact.passengers.filter((p) => p.role === "related"),
    };
  }, [impact]);

  const togglePassenger = (id: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setAll = (passengers: RestoreImpactPassenger[], on: boolean) => {
    setTicked((prev) => {
      const next = new Set(prev);
      for (const p of passengers) {
        if (on) next.add(p.id); else next.delete(p.id);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError("");
    try {
      const body =
        ticked.size > 0 ? { also_restore_card_ids: Array.from(ticked) } : {};
      const res = await api.post<CardRestoreResponse>(`/cards/${cardId}/restore`, body);
      onConfirmed(res.primary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const passengerCount = impact?.passengers.length ?? 0;

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("cards:detail.dialogs.restore.title")}</DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {!loading && (
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography>
              <span
                dangerouslySetInnerHTML={{
                  __html: t("cards:detail.dialogs.restore.confirm", {
                    name: cardName,
                    interpolation: { escapeValue: true },
                  }),
                }}
              />
            </Typography>

            {passengerCount > 0 && (
              <Box>
                <Divider sx={{ mb: 2 }} />
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
                    {t("cards:detail.dialogs.restore.passengersTitle")}
                  </Typography>
                  <Chip
                    label={t("cards:detail.dialogs.restore.passengerChip", { count: passengerCount })}
                    size="small"
                    color="info"
                    variant="outlined"
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t("cards:detail.dialogs.restore.passengersIntro")}
                </Typography>

                {grouped.children.length > 0 && (
                  <Box sx={{ mb: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {t("cards:detail.dialogs.restore.childrenGroup")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ({grouped.children.length})
                      </Typography>
                      <Link
                        component="button"
                        type="button"
                        variant="caption"
                        onClick={() =>
                          setAll(
                            grouped.children,
                            !grouped.children.every((c) => ticked.has(c.id)),
                          )
                        }
                      >
                        {grouped.children.every((c) => ticked.has(c.id))
                          ? t("cards:detail.dialogs.related.selectNone")
                          : t("cards:detail.dialogs.related.selectAll")}
                      </Link>
                    </Stack>
                    {grouped.children.map((p) => (
                      <FormControlLabel
                        key={p.id}
                        sx={{ display: "flex", ml: 1 }}
                        control={
                          <Checkbox
                            checked={ticked.has(p.id)}
                            onChange={() => togglePassenger(p.id)}
                            size="small"
                          />
                        }
                        label={
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="body2">{p.name}</Typography>
                            <Chip label={p.type} size="small" variant="outlined" />
                          </Stack>
                        }
                      />
                    ))}
                  </Box>
                )}

                {grouped.related.length > 0 && (
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {t("cards:detail.dialogs.restore.relatedGroup")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ({grouped.related.length})
                      </Typography>
                      <Link
                        component="button"
                        type="button"
                        variant="caption"
                        onClick={() =>
                          setAll(
                            grouped.related,
                            !grouped.related.every((c) => ticked.has(c.id)),
                          )
                        }
                      >
                        {grouped.related.every((c) => ticked.has(c.id))
                          ? t("cards:detail.dialogs.related.selectNone")
                          : t("cards:detail.dialogs.related.selectAll")}
                      </Link>
                    </Stack>
                    {grouped.related.map((p) => (
                      <FormControlLabel
                        key={p.id}
                        sx={{ display: "flex", ml: 1 }}
                        control={
                          <Checkbox
                            checked={ticked.has(p.id)}
                            onChange={() => togglePassenger(p.id)}
                            size="small"
                          />
                        }
                        label={
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="body2">{p.name}</Typography>
                            <Chip label={p.type} size="small" variant="outlined" />
                          </Stack>
                        }
                      />
                    ))}
                  </Box>
                )}
              </Box>
            )}

            <Alert severity="info">{t("cards:detail.restoreCascadeWarning")}</Alert>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleConfirm}
          disabled={submitting}
          startIcon={<MaterialSymbol icon="restore" size={18} />}
        >
          {submitting ? t("cards:detail.dialogs.restore.restoring") : t("common:actions.restore")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
