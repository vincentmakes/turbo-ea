/**
 * AdrsTab — shows all Architecture Decision Records linked to a given Card
 * via the M:N junction, with quick actions to link an existing ADR, create a
 * new one pre-linked to the card, or unlink.
 *
 * Backed by ``GET /adr/by-card/{id}?include_earlier=false``: a decision's
 * earlier revisions stay off the card, its current (and open) one is listed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
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
import DecisionPicker from "@/components/DecisionPicker";
import { api, ApiError } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { ArchitectureDecision } from "@/types";
import CreateAdrDialog from "@/features/ea-delivery/CreateAdrDialog";
import { DecisionStateChip } from "@/features/ea-delivery/DecisionStandingChip";
import { decisionRefLabel } from "@/features/ea-delivery/decisionStanding";
import MentionedInList from "@/features/ea-delivery/collab/MentionedInList";
import { STATUS_COLORS as STATUS_HUES } from "@/theme/tokens";

/** The decisions listed on a card: current and open revisions only. */
const adrsByCardPath = (cardId: string) =>
  `/adr/by-card/${cardId}?include_earlier=false`;

interface Props {
  cardId: string;
  cardName: string;
  cardType: string;
  canManageAdrLinks?: boolean;
}

export default function AdrsTab({
  cardId,
  cardName,
  cardType,
  canManageAdrLinks = false,
}: Props) {
  const { t } = useTranslation(["cards", "delivery", "common"]);
  const { t: td } = useTranslation("delivery");
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();
  const { formatDate } = useDateFormat();

  const [adrs, setAdrs] = useState<ArchitectureDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Link-existing dialog. A pick in the picker is held here and confirmed
  // before anything is written, so a stray click never attaches a decision.
  const [linkOpen, setLinkOpen] = useState(false);
  const [pendingLink, setPendingLink] = useState<ArchitectureDecision | null>(null);
  const [linking, setLinking] = useState(false);

  // Create-new dialog
  const [createOpen, setCreateOpen] = useState(false);

  const typeColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const mt of metamodelTypes) map[mt.key] = mt.color;
    return map;
  }, [metamodelTypes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ArchitectureDecision[]>(adrsByCardPath(cardId));
      setAdrs(data);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    load();
  }, [load]);

  const openLink = () => {
    setPendingLink(null);
    setLinkOpen(true);
  };

  const confirmLink = async () => {
    if (!pendingLink) return;
    setLinking(true);
    try {
      await api.post(`/adr/${pendingLink.id}/cards`, { card_id: cardId });
      load();
      setPendingLink(null);
      setLinkOpen(false);
    } catch {
      setError(t("cards:resources.error.linkFailed"));
      setPendingLink(null);
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (adrId: string) => {
    if (!confirm(t("cards:adrs.confirmUnlink"))) return;
    try {
      await api.delete(`/adr/${adrId}/cards/${cardId}`);
      load();
    } catch {
      setError(t("cards:resources.error.unlinkFailed"));
    }
  };

  // Decisions already on the card are not offered again.
  const linkedIds = useMemo(() => adrs.map((a) => a.id), [adrs]);

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
          {t("cards:adrs.title")}
        </Typography>
        {canManageAdrLinks && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MaterialSymbol icon="link" size={16} />}
              onClick={openLink}
            >
              {t("cards:adrs.linkAdr")}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={() => setCreateOpen(true)}
            >
              {t("cards:adrs.createAdr")}
            </Button>
          </Stack>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {adrs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("cards:adrs.empty")}
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("delivery:adr.grid.reference")}</TableCell>
              <TableCell>{t("delivery:adr.grid.title")}</TableCell>
              <TableCell>{t("delivery:adr.grid.status")}</TableCell>
              <TableCell>{t("delivery:adr.grid.linkedCards")}</TableCell>
              <TableCell>{t("delivery:adr.grid.lastModified")}</TableCell>
              {canManageAdrLinks && <TableCell padding="checkbox" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {adrs.map((adr) => (
              <TableRow
                key={adr.id}
                hover
                onClick={() => navigate(`/ea-delivery/adr/${adr.id}`)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell sx={{ whiteSpace: "nowrap" }}>{decisionRefLabel(adr, td)}</TableCell>
                <TableCell>{adr.title}</TableCell>
                <TableCell>
                  <DecisionStateChip adr={adr} />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {(adr.linked_cards ?? []).map((lc) => (
                      <Chip
                        key={lc.id}
                        label={lc.name}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: "0.7rem",
                          maxWidth: 140,
                          bgcolor: typeColorMap[lc.type] || STATUS_HUES.neutral,
                          color: "common.white",
                          "& .MuiChip-label": { px: 0.75 },
                        }}
                      />
                    ))}
                  </Box>
                </TableCell>
                <TableCell>
                  {adr.updated_at ? formatDate(adr.updated_at) : "—"}
                </TableCell>
                {canManageAdrLinks && (
                  <TableCell padding="checkbox">
                    <Tooltip title={t("cards:adrs.unlinkAdr")}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnlink(adr.id);
                        }}
                      >
                        <MaterialSymbol icon="link_off" size={18} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Decisions and SoAWs whose text or discussion mention this card. */}
      <Box sx={{ mt: 3, "&:empty": { display: "none" } }}>
        <MentionedInList target={{ kind: "card", id: cardId }} />
      </Box>

      {/* ── Link existing ADR ── */}
      {/* `md` rather than `sm`: decision titles are long sentences, and at
          `sm` most of them ellipsise away to nothing useful. */}
      <Dialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{t("cards:adrs.linkDialog.title")}</DialogTitle>
        <DialogContent>
          {/* The shared decision picker: browse on open, rank as you type,
              earlier revisions never offered. */}
          <DecisionPicker
            value={null}
            onChange={(adr) => {
              if (adr) setPendingLink(adr);
            }}
            excludeIds={linkedIds}
            enabled={linkOpen}
            autoFocus
            fullWidth
            placeholder={t("cards:adrs.linkDialog.search")}
            noOptionsText={t("cards:adrs.linkDialog.empty")}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Confirm the link (nested inside the picker) ── */}
      <Dialog
        open={Boolean(pendingLink)}
        onClose={() => setPendingLink(null)}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{t("cards:adrs.confirmLink.title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t("cards:adrs.confirmLink.body", {
              reference: pendingLink ? decisionRefLabel(pendingLink, td) : "",
              title: pendingLink?.title ?? "",
              card: cardName,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingLink(null)} disabled={linking}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" onClick={confirmLink} disabled={linking}>
            {t("cards:adrs.linkAdr")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Create ADR pre-linked to this card ── */}
      <CreateAdrDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => load()}
        preLinkedCards={[{ id: cardId, name: cardName, type: cardType }]}
      />
    </Paper>
  );
}
