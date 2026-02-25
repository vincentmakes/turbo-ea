import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import ApprovalStatusBadge from "@/components/ApprovalStatusBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import { DataQualityRing } from "@/features/cards/sections";
import CardDetailContent from "@/features/cards/CardDetailContent";
import type {
  Card,
  CardEffectivePermissions,
} from "@/types";

// ── Default permissions (allow everything until loaded) ─────────
const DEFAULT_PERMISSIONS: CardEffectivePermissions["effective"] = {
  can_view: true,
  can_edit: true,
  can_archive: true,
  can_delete: true,
  can_approval_status: true,
  can_manage_stakeholders: true,
  can_manage_relations: true,
  can_manage_documents: true,
  can_manage_comments: true,
  can_create_comments: true,
  can_bpm_edit: true,
  can_bpm_manage_drafts: true,
  can_bpm_approve: true,
};

// ── Main Detail Page ────────────────────────────────────────────
export default function CardDetail() {
  const { t } = useTranslation(["cards", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { getType } = useMetamodel();
  const rml = useResolveMetaLabel();
  const [card, setCard] = useState<Card | null>(null);
  const [initialTab, setInitialTab] = useState(0);
  const [initialSubTab, setInitialSubTab] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");
  const [perms, setPerms] = useState<CardEffectivePermissions["effective"]>(DEFAULT_PERMISSIONS);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [actionsMenuAnchor, setActionsMenuAnchor] = useState<HTMLElement | null>(null);

  // Fetch effective permissions for this card
  useEffect(() => {
    if (!id) return;
    setPerms(DEFAULT_PERMISSIONS);
    api
      .get<CardEffectivePermissions>(`/cards/${id}/my-permissions`)
      .then((res) => setPerms(res.effective))
      .catch(() => {}); // keep defaults on error
  }, [id]);

  useEffect(() => {
    if (!id) return;
    // Read tab from URL search params (e.g. ?tab=1&subtab=1)
    const urlTab = searchParams.get("tab");
    const urlSubTab = searchParams.get("subtab");
    if (urlTab) {
      setInitialTab(parseInt(urlTab, 10) || 0);
      // Clear the query params so they don't persist on navigation
      setSearchParams({}, { replace: true });
    } else {
      setInitialTab(0);
    }
    if (urlSubTab) {
      setInitialSubTab(parseInt(urlSubTab, 10) || 0);
    } else {
      setInitialSubTab(undefined);
    }
    api
      .get<Card>(`/cards/${id}`)
      .then(setCard)
      .catch((e) => setError(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!card)
    return (
      <Box sx={{ p: 4 }}>
        <LinearProgress />
      </Box>
    );

  const typeConfig = getType(card.type);

  const handleApprovalAction = async (action: "approve" | "reject" | "reset") => {
    await api.post(`/cards/${card.id}/approval-status?action=${action}`);
    const newStatus =
      action === "approve"
        ? "APPROVED"
        : action === "reject"
          ? "REJECTED"
          : "DRAFT";
    setCard({ ...card, approval_status: newStatus });
  };

  // ── Archive / Restore / Delete ───────────────────────────────
  const handleArchive = async () => {
    setArchiveDialogOpen(false);
    const updated = await api.post<Card>(`/cards/${card.id}/archive`);
    setCard(updated);
  };

  const handleRestore = async () => {
    const updated = await api.post<Card>(`/cards/${card.id}/restore`);
    setCard(updated);
  };

  const handleDelete = async () => {
    setDeleteDialogOpen(false);
    await api.delete(`/cards/${card.id}`);
    navigate("/inventory");
  };

  const isArchived = card.status === "ARCHIVED";
  const daysUntilPurge = card.archived_at
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date(card.archived_at).getTime()) / 86400000))
    : null;

  return (
    <Box sx={{ maxWidth: 960, mx: "auto" }}>
      {/* ── Header ── */}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: { xs: 1, sm: 2 }, mb: 3 }}>
        <IconButton onClick={() => navigate(-1)} sx={{ mr: { xs: -0.5, sm: 0 } }}>
          <MaterialSymbol icon="arrow_back" size={24} />
        </IconButton>
        {typeConfig && (
          <Box
            sx={{
              width: { xs: 32, sm: 40 },
              height: { xs: 32, sm: 40 },
              borderRadius: 2,
              bgcolor: typeConfig.color + "18",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialSymbol
              icon={typeConfig.icon}
              size={isMobile ? 20 : 24}
              color={typeConfig.color}
            />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant={isMobile ? "h6" : "h5"} fontWeight={700} noWrap>
            {card.name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {rml(typeConfig?.key ?? "", typeConfig?.translations, "label") || card.type}
            </Typography>
            {card.subtype && typeof card.subtype === "string" && (
              <Chip size="small" label={card.subtype} variant="outlined" sx={{ height: 20 }} />
            )}
          </Box>
        </Box>
        {/* Badges + overflow menu — wrap to second row on mobile */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: { xs: "100%", sm: "auto" }, justifyContent: { xs: "flex-end", sm: "flex-start" } }}>
          <DataQualityRing value={card.data_quality} />
          <LifecycleBadge lifecycle={card.lifecycle} />
          <ApprovalStatusBadge
            status={card.approval_status}
            canChange={perms.can_approval_status}
            onAction={handleApprovalAction}
          />
          {!isArchived && (perms.can_archive || perms.can_delete) && (
            <>
              <Tooltip title={t("detail.actions.moreActions")}>
                <IconButton
                  size="small"
                  onClick={(e) => setActionsMenuAnchor(e.currentTarget)}
                  aria-label={t("detail.actions.moreActions")}
                >
                  <MaterialSymbol icon="more_vert" size={20} />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={actionsMenuAnchor}
                open={!!actionsMenuAnchor}
                onClose={() => setActionsMenuAnchor(null)}
              >
                {perms.can_archive && (
                  <MenuItem onClick={() => { setActionsMenuAnchor(null); setArchiveDialogOpen(true); }}>
                    <ListItemIcon>
                      <MaterialSymbol icon="archive" size={20} color="#ed6c02" />
                    </ListItemIcon>
                    <ListItemText>{t("common:actions.archive")}</ListItemText>
                  </MenuItem>
                )}
                {perms.can_delete && (
                  <MenuItem onClick={() => { setActionsMenuAnchor(null); setDeleteDialogOpen(true); }}>
                    <ListItemIcon>
                      <MaterialSymbol icon="delete_forever" size={20} color="#d32f2f" />
                    </ListItemIcon>
                    <ListItemText>{t("common:actions.delete")}</ListItemText>
                  </MenuItem>
                )}
              </Menu>
            </>
          )}
        </Box>
      </Box>

      {/* ── Archive confirmation dialog ── */}
      <Dialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)}>
        <DialogTitle>{t("detail.dialogs.archive.title")}</DialogTitle>
        <DialogContent>
          <Typography>
            {t("detail.dialogs.archive.confirm", { name: card.name })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("detail.dialogs.archive.description")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveDialogOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="warning" onClick={handleArchive}>{t("common:actions.archive")}</Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t("detail.dialogs.delete.title")}</DialogTitle>
        <DialogContent>
          <Typography>
            {t("detail.dialogs.delete.confirm", { name: card.name })}
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {t("detail.dialogs.delete.description")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>{t("detail.dialogs.delete.submit")}</Button>
        </DialogActions>
      </Dialog>

      <CardDetailContent
        card={card}
        perms={perms}
        onCardUpdate={setCard}
        initialTab={initialTab}
        initialSubTab={initialSubTab}
        beforeTabs={
          <>
            {/* Archived banner */}
            {isArchived && (
              <Alert
                severity="warning"
                sx={{ mb: 2 }}
                action={
                  <Box sx={{ display: "flex", gap: 1 }}>
                    {perms.can_archive && (
                      <Button size="small" color="inherit" onClick={handleRestore} startIcon={<MaterialSymbol icon="restore" size={18} />}>
                        {t("common:actions.restore")}
                      </Button>
                    )}
                    {perms.can_delete && (
                      <Button size="small" color="error" onClick={() => setDeleteDialogOpen(true)} startIcon={<MaterialSymbol icon="delete_forever" size={18} />}>
                        {t("common:actions.delete")}
                      </Button>
                    )}
                  </Box>
                }
              >
                {t("detail.archivedBanner")}{daysUntilPurge !== null && ` ${t("detail.purgeWarning", { count: daysUntilPurge })}`}
              </Alert>
            )}

          </>
        }
      />
    </Box>
  );
}
