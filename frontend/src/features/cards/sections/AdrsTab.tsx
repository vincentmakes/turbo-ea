/**
 * AdrsTab — shows all Architecture Decision Records linked to a given Card
 * via the M:N junction, with quick actions to link an existing ADR, create a
 * new one pre-linked to the card, or unlink.
 *
 * Backed by ``GET /adr/by-card/{id}``.
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
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
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
import { api, ApiError } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { ArchitectureDecision } from "@/types";
import CreateAdrDialog from "@/features/ea-delivery/CreateAdrDialog";

/** Status chip colour per ADR workflow state. */
const STATUS_COLORS: Record<string, "default" | "warning" | "success"> = {
  draft: "default",
  in_review: "warning",
  signed: "success",
};

/** Status label keys in the `delivery` namespace (already translated). */
const STATUS_LABEL_KEYS: Record<string, string> = {
  draft: "status.draft",
  in_review: "status.inReview",
  signed: "status.signed",
};

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
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();
  const { formatDate } = useDateFormat();

  const [adrs, setAdrs] = useState<ArchitectureDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Link-existing dialog
  const [linkOpen, setLinkOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [allAdrs, setAllAdrs] = useState<ArchitectureDecision[]>([]);

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
      const data = await api.get<ArchitectureDecision[]>(`/adr/by-card/${cardId}`);
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

  const openLink = async () => {
    setLinkOpen(true);
    setSearch("");
    try {
      setAllAdrs(await api.get<ArchitectureDecision[]>("/adr"));
    } catch {
      /* the dialog simply shows its empty state */
    }
  };

  const handleLink = async (adrId: string) => {
    try {
      await api.post(`/adr/${adrId}/cards`, { card_id: cardId });
      load();
      setLinkOpen(false);
    } catch {
      setError(t("cards:resources.error.linkFailed"));
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

  const linkedIds = new Set(adrs.map((a) => a.id));
  const term = search.toLowerCase();
  const linkable = allAdrs.filter(
    (a) =>
      !linkedIds.has(a.id) &&
      (a.title.toLowerCase().includes(term) ||
        a.reference_number.toLowerCase().includes(term)),
  );

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
                <TableCell>{adr.reference_number}</TableCell>
                <TableCell>{adr.title}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={STATUS_COLORS[adr.status] || "default"}
                    label={t(
                      `delivery:${STATUS_LABEL_KEYS[adr.status] ?? "status.draft"}`,
                    )}
                  />
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
                          bgcolor: typeColorMap[lc.type] || "#9e9e9e",
                          color: "#fff",
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

      {/* ── Link existing ADR ── */}
      <Dialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("cards:adrs.linkDialog.title")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            placeholder={t("cards:adrs.linkDialog.search")}
            fullWidth
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <List dense>
            {linkable.map((adr) => (
              <ListItem
                key={adr.id}
                secondaryAction={
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleLink(adr.id)}
                    sx={{ textTransform: "none" }}
                  >
                    {t("cards:adrs.linkAdr")}
                  </Button>
                }
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      <Typography variant="body2" fontWeight={600}>
                        {adr.reference_number}
                      </Typography>
                      <Typography variant="body2">{adr.title}</Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {linkable.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("cards:adrs.linkDialog.empty")}
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>
            {t("common:actions.cancel")}
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
