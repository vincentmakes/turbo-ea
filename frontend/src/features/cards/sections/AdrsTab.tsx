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
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
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
  const [linkLoading, setLinkLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [allAdrs, setAllAdrs] = useState<ArchitectureDecision[]>([]);
  // Rows are click-to-link, so a stray click would otherwise attach a decision
  // outright. Hold the candidate here and confirm before writing.
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
    // Guard the fetch so the dialog shows a spinner rather than flashing
    // "nothing available to link" before the list has arrived.
    setLinkLoading(true);
    try {
      setAllAdrs(await api.get<ArchitectureDecision[]>("/adr"));
    } catch {
      /* the dialog falls back to its empty state */
    } finally {
      setLinkLoading(false);
    }
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

  const linkedIds = new Set(adrs.map((a) => a.id));
  const term = search.trim().toLowerCase();
  // `GET /adr` comes back most-recently-updated first; sort by reference so the
  // picker reads in the same order as the tab's own table.
  const linkable = allAdrs
    .filter((a) => !linkedIds.has(a.id))
    .filter(
      (a) =>
        a.title.toLowerCase().includes(term) ||
        a.reference_number.toLowerCase().includes(term),
    )
    .sort((a, b) => a.reference_number.localeCompare(b.reference_number));
  const nothingToLink = allAdrs.every((a) => linkedIds.has(a.id));

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
          <TextField
            autoFocus
            placeholder={t("cards:adrs.linkDialog.search")}
            fullWidth
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={20} />
                  </InputAdornment>
                ),
                endAdornment: search ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      aria-label={t("cards:adrs.linkDialog.clearSearch")}
                      onClick={() => setSearch("")}
                    >
                      <MaterialSymbol icon="close" size={18} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
            sx={{ mt: 1, mb: 2 }}
          />
          {/* The list is unpaginated, so cap it and scroll inside the dialog. */}
          <Box
            sx={{
              maxHeight: 360,
              overflow: "auto",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
            }}
          >
            {linkLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress size={28} />
              </Box>
            ) : linkable.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 4, textAlign: "center" }}
              >
                {nothingToLink
                  ? t("cards:adrs.linkDialog.empty")
                  : t("cards:adrs.linkDialog.noMatch")}
              </Typography>
            ) : (
              <List dense disablePadding>
                {linkable.map((adr) => (
                  // Whole-row click links the decision. Laying the row out as a
                  // flex container — rather than a ListItem `secondaryAction` —
                  // keeps every element in normal flow, so a long title can
                  // never slide underneath a trailing control.
                  <ListItemButton
                    key={adr.id}
                    onClick={() => setPendingLink(adr)}
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <Chip
                      label={adr.reference_number}
                      size="small"
                      variant="outlined"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.7rem",
                        height: 22,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {adr.title}
                    </Typography>
                    <Chip
                      label={t(
                        `delivery:${STATUS_LABEL_KEYS[adr.status] ?? "status.draft"}`,
                      )}
                      size="small"
                      color={STATUS_COLORS[adr.status] || "default"}
                      sx={{ height: 22, flexShrink: 0 }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
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
              reference: pendingLink?.reference_number ?? "",
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
