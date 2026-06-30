import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import Snackbar from "@mui/material/Snackbar";
import Fab from "@mui/material/Fab";
import Fade from "@mui/material/Fade";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import ApprovalStatusBadge from "@/components/ApprovalStatusBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import AiSuggestPanel, { type AiApplyPayload } from "@/components/AiSuggestPanel";
import ArchiveDeleteDialog from "@/features/cards/ArchiveDeleteDialog";
import RestoreDialog from "@/features/cards/RestoreDialog";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useArchiveRetentionDays } from "@/hooks/useArchiveRetentionDays";
import { api, ApiError } from "@/api/client";
import { DataQualityPill } from "@/features/cards/sections";
import CardDetailContent from "@/features/cards/CardDetailContent";
import type {
  Card,
  CardEffectivePermissions,
  AiSuggestResponse,
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
  can_manage_adr_links: true,
  can_manage_diagram_links: true,
  can_view_costs: true,
};

// ── Main Detail Page ────────────────────────────────────────────
export default function CardDetail() {
  const { t } = useTranslation(["cards", "common", "validation"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { getType } = useMetamodel();
  const { archiveRetentionDays } = useArchiveRetentionDays();
  const typeLabel = useTypeLabel();
  const stLabel = useSubtypeLabel();
  const [card, setCard] = useState<Card | null>(null);
  const [initialTab, setInitialTab] = useState(0);
  const [initialSubTab, setInitialSubTab] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");
  const [perms, setPerms] = useState<CardEffectivePermissions["effective"]>(DEFAULT_PERMISSIONS);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [actionsMenuAnchor, setActionsMenuAnchor] = useState<HTMLElement | null>(null);
  const [snack, setSnack] = useState("");

  // Favorite star
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);

  // Observer self-assignment (one-click "Observe this card")
  const [isObserver, setIsObserver] = useState(false);
  const [observerRoleAvailable, setObserverRoleAvailable] = useState(false);
  const [observeSaving, setObserveSaving] = useState(false);

  // Inline title editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Inline subtype editing
  const [subtypeAnchor, setSubtypeAnchor] = useState<HTMLElement | null>(null);
  const [subtypeSaving, setSubtypeSaving] = useState(false);

  // PPM auto-computed fields (for Initiative cards with PPM budget/cost lines)
  const [ppmHasBudget, setPpmHasBudget] = useState(false);
  const [ppmHasCosts, setPpmHasCosts] = useState(false);

  // AI suggestions state
  const { aiStatus } = useAiStatus();
  const [aiResponse, setAiResponse] = useState<AiSuggestResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [approvalBlock, setApprovalBlock] = useState<{
    missing_relations: { key: string; label: string; side: "source" | "target"; other_type_key: string }[];
    missing_tag_groups: { id: string; name: string }[];
  } | null>(null);

  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Fetch effective permissions for this card
  useEffect(() => {
    if (!id) return;
    setPerms(DEFAULT_PERMISSIONS);
    api
      .get<CardEffectivePermissions>(`/cards/${id}/my-permissions`)
      .then((res) => setPerms(res.effective))
      .catch(() => {}); // keep defaults on error
  }, [id]);

  // Fetch PPM cost existence for Initiative cards
  useEffect(() => {
    if (!card || card.type !== "Initiative") {
      setPpmHasBudget(false);
      setPpmHasCosts(false);
      return;
    }
    api
      .get<{ has_budget_lines: boolean; has_cost_lines: boolean }>(
        `/ppm/initiatives/${card.id}/has-costs`,
      )
      .then((res) => {
        setPpmHasBudget(res.has_budget_lines);
        setPpmHasCosts(res.has_cost_lines);
      })
      .catch(() => {}); // PPM not enabled or no permission — keep defaults
  }, [card?.id, card?.type]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Check whether the current user has favorited this card.
    api
      .get<{ id: string; card_id: string }[]>("/favorites")
      .then((favs) => setIsFavorite(favs.some((f) => f.card_id === id)))
      .catch(() => setIsFavorite(false));

    // Observe state + whether the Observer role exists on this card type.
    api
      .get<{ is_observer: boolean; observer_role_available: boolean }>(
        `/cards/${id}/me/observe`,
      )
      .then((r) => {
        setIsObserver(r.is_observer);
        setObserverRoleAvailable(r.observer_role_available);
      })
      .catch(() => {
        setIsObserver(false);
        setObserverRoleAvailable(false);
      });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFavorite = async () => {
    if (!id || favoriteSaving) return;
    setFavoriteSaving(true);
    try {
      if (isFavorite) {
        await api.delete(`/favorites/${id}`);
        setIsFavorite(false);
      } else {
        await api.post(`/favorites/${id}`, undefined);
        setIsFavorite(true);
      }
    } catch {
      // best effort
    } finally {
      setFavoriteSaving(false);
    }
  };

  const toggleObserve = async () => {
    if (!id || observeSaving) return;
    setObserveSaving(true);
    try {
      if (isObserver) {
        await api.delete(`/cards/${id}/me/observe`);
        setIsObserver(false);
        setSnack(t("cards:actions.observeRemoved"));
      } else {
        await api.post(`/cards/${id}/me/observe`, undefined);
        setIsObserver(true);
        setSnack(t("cards:actions.observeAdded"));
      }
    } catch {
      // best effort — most likely the Observer role was archived between
      // page load and click; the menu item will re-hide on next reload.
    } finally {
      setObserveSaving(false);
    }
  };

  const ppmAutoFieldKeys = useMemo(() => {
    const keys: string[] = [];
    if (ppmHasBudget) keys.push("costBudget");
    if (ppmHasCosts) keys.push("costActual");
    return keys;
  }, [ppmHasBudget, ppmHasCosts]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!card)
    return (
      <Box sx={{ p: 4 }}>
        <LinearProgress />
      </Box>
    );

  const typeConfig = getType(card.type);

  const subtypeLabel =
    card.subtype && typeof card.subtype === "string"
      ? (() => {
          const st = typeConfig?.subtypes?.find((s) => s.key === card.subtype);
          return st ? stLabel(st) : card.subtype;
        })()
      : null;
  const hasSubtypes = !!(typeConfig?.subtypes && typeConfig.subtypes.length > 0);
  const isArchived = card.status === "ARCHIVED";
  const canEditSubtype = hasSubtypes && perms.can_edit && !isArchived;

  const handleApprovalAction = async (action: "approve" | "reject" | "reset") => {
    try {
      await api.post(`/cards/${card.id}/approval-status?action=${action}`);
      const newStatus =
        action === "approve"
          ? "APPROVED"
          : action === "reject"
            ? "REJECTED"
            : "DRAFT";
      setCard({ ...card, approval_status: newStatus });
      setApprovalBlock(null);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        typeof err.detail === "object" &&
        err.detail !== null &&
        (err.detail as { code?: string }).code === "approval_blocked_mandatory_missing"
      ) {
        const detail = err.detail as {
          missing_relations: { key: string; label: string; side: "source" | "target"; other_type_key: string }[];
          missing_tag_groups: { id: string; name: string }[];
        };
        setApprovalBlock({
          missing_relations: detail.missing_relations,
          missing_tag_groups: detail.missing_tag_groups,
        });
        return;
      }
      throw err;
    }
  };

  // ── Inline title editing ─────────────────────────────────────
  const beginEditName = () => {
    setNameDraft(card.name);
    setNameError(null);
    setEditingName(true);
  };

  const cancelEditName = () => {
    setEditingName(false);
    setNameError(null);
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError(t("validation:required"));
      return;
    }
    if (trimmed === card.name) {
      setEditingName(false);
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      const updated = await api.patch<Card>(`/cards/${card.id}`, { name: trimmed });
      setCard(updated);
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setNameSaving(false);
    }
  };

  // ── Inline subtype editing ───────────────────────────────────
  const saveSubtype = async (next: string | null) => {
    const current = card.subtype || null;
    if (next === current) {
      setSubtypeAnchor(null);
      return;
    }
    setSubtypeSaving(true);
    try {
      const updated = await api.patch<Card>(`/cards/${card.id}`, {
        subtype: next,
      });
      setCard(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubtypeSaving(false);
      setSubtypeAnchor(null);
    }
  };

  // ── Archive / Restore / Delete ───────────────────────────────
  const handleArchiveConfirmed = async () => {
    // The dialog already issued the API call; just refresh the card.
    setArchiveDialogOpen(false);
    try {
      const refreshed = await api.get<Card>(`/cards/${card.id}`);
      setCard(refreshed);
    } catch {
      navigate("/inventory");
    }
  };

  const handleRestoreConfirmed = (primary: Card) => {
    setRestoreDialogOpen(false);
    setCard(primary);
  };

  const handleDeleteConfirmed = () => {
    setDeleteDialogOpen(false);
    navigate("/inventory");
  };

  // ── AI suggestions ──────────────────────────────────────────
  const aiEnabled =
    aiStatus.enabled &&
    aiStatus.configured &&
    aiStatus.enabled_types.includes(card.type);

  const handleAiSuggest = async () => {
    setAiError("");
    setAiResponse(null);
    setAiLoading(true);
    try {
      const res = await api.post<AiSuggestResponse>("/ai/suggest", {
        type_key: card.type,
        subtype: card.subtype || undefined,
        name: card.name,
      });
      setAiResponse(res);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiApply = async (payload: AiApplyPayload) => {
    const patch: Record<string, unknown> = {};
    if (payload.description) patch.description = payload.description;
    if (payload.fields) {
      patch.attributes = { ...(card.attributes ?? {}), ...payload.fields };
    }
    const updated = await api.patch<Card>(`/cards/${card.id}`, patch);
    setCard(updated);
    setAiResponse(null);
  };

  // archiveRetentionDays === 0 means "keep indefinitely" — no purge countdown.
  const daysUntilPurge =
    card.archived_at && archiveRetentionDays > 0
      ? Math.max(
          0,
          archiveRetentionDays -
            Math.floor((Date.now() - new Date(card.archived_at).getTime()) / 86400000),
        )
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
          {editingName ? (
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveName();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditName();
                  }
                }}
                disabled={nameSaving}
                error={!!nameError}
                helperText={nameError ?? undefined}
                InputProps={{
                  sx: {
                    fontSize: isMobile ? "1.25rem" : "1.5rem",
                    fontWeight: 700,
                  },
                }}
              />
              <IconButton
                size="small"
                onClick={saveName}
                disabled={nameSaving}
                aria-label={t("common:actions.save")}
              >
                <MaterialSymbol icon="check" size={20} />
              </IconButton>
              <IconButton
                size="small"
                onClick={cancelEditName}
                disabled={nameSaving}
                aria-label={t("common:actions.cancel")}
              >
                <MaterialSymbol icon="close" size={20} />
              </IconButton>
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                "&:hover .edit-name-btn": { opacity: 1 },
              }}
            >
              <Typography variant={isMobile ? "h6" : "h5"} fontWeight={700} noWrap>
                {card.name}
              </Typography>
              {perms.can_edit && !isArchived && (
                <Tooltip title={t("common:actions.edit")}>
                  <IconButton
                    size="small"
                    className="edit-name-btn"
                    onClick={beginEditName}
                    aria-label={t("common:actions.edit")}
                    sx={{
                      opacity: { xs: 1, sm: 0 },
                      transition: "opacity 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    <MaterialSymbol icon="edit" size={16} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography
              variant="body2"
              sx={{ color: typeConfig?.color || "text.secondary" }}
            >
              {typeLabel(typeConfig) || card.type}
            </Typography>
            {(hasSubtypes || subtypeLabel) && (
              <>
                <Typography
                  variant="body2"
                  aria-hidden
                  sx={{ color: typeConfig?.color || "text.secondary", opacity: 0.7 }}
                >
                  ·
                </Typography>
                {canEditSubtype ? (
                  <>
                    <Tooltip title={t("cards:subtype.editTooltip")}>
                      <Box
                        component="button"
                        type="button"
                        onClick={(e) => setSubtypeAnchor(e.currentTarget as HTMLElement)}
                        disabled={subtypeSaving}
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.25,
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          p: 0,
                          font: "inherit",
                          color: typeConfig?.color || "text.secondary",
                          "&:hover": { opacity: 0.8 },
                        }}
                      >
                        <Typography variant="body2" component="span" color="inherit">
                          {subtypeLabel || t("cards:subtype.empty")}
                        </Typography>
                        <MaterialSymbol icon="arrow_drop_down" size={16} />
                      </Box>
                    </Tooltip>
                    <Menu
                      anchorEl={subtypeAnchor}
                      open={Boolean(subtypeAnchor)}
                      onClose={() => setSubtypeAnchor(null)}
                    >
                      <MenuItem
                        selected={!card.subtype}
                        onClick={() => saveSubtype(null)}
                      >
                        <em>{t("common:labels.none")}</em>
                      </MenuItem>
                      {(typeConfig?.subtypes ?? []).map((st) => (
                        <MenuItem
                          key={st.key}
                          selected={card.subtype === st.key}
                          onClick={() => saveSubtype(st.key)}
                        >
                          {stLabel(st)}
                        </MenuItem>
                      ))}
                    </Menu>
                  </>
                ) : (
                  subtypeLabel && (
                    <Typography
                      variant="body2"
                      sx={{ color: typeConfig?.color || "text.secondary" }}
                    >
                      {subtypeLabel}
                    </Typography>
                  )
                )}
              </>
            )}
          </Box>
        </Box>
        {/* Badges + overflow menu — wrap to second row on mobile */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: { xs: "100%", sm: "auto" }, justifyContent: { xs: "flex-end", sm: "flex-start" } }}>
          <DataQualityPill value={card.data_quality} />
          <LifecycleBadge lifecycle={card.lifecycle} />
          <ApprovalStatusBadge
            status={card.approval_status}
            canChange={perms.can_approval_status}
            onAction={handleApprovalAction}
          />
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
            <MenuItem
              onClick={() => {
                setActionsMenuAnchor(null);
                window.open(`/cards/${card.id}`, "_blank", "noopener,noreferrer");
              }}
            >
              <ListItemIcon>
                <MaterialSymbol icon="open_in_new" size={20} />
              </ListItemIcon>
              <ListItemText>{t("common:actions.openInNewTab")}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={async () => {
                setActionsMenuAnchor(null);
                const url = `${window.location.origin}/cards/${card.id}`;
                try {
                  await navigator.clipboard.writeText(url);
                  setSnack(t("common:actions.linkCopied"));
                } catch {
                  // Clipboard API unavailable (older browsers, insecure
                  // contexts) — fall back to a manual-copy prompt.
                  window.prompt(t("common:actions.copyManually"), url);
                }
              }}
            >
              <ListItemIcon>
                <MaterialSymbol icon="link" size={20} />
              </ListItemIcon>
              <ListItemText>{t("common:actions.copyLink")}</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                setActionsMenuAnchor(null);
                toggleFavorite();
              }}
              disabled={favoriteSaving}
            >
              <ListItemIcon>
                <MaterialSymbol
                  icon="cards_star"
                  size={20}
                  color={isFavorite ? "#f5a623" : "#ccc"}
                />
              </ListItemIcon>
              <ListItemText>
                {isFavorite
                  ? t("cards:actions.removeFromFavorites")
                  : t("cards:actions.addToFavorites")}
              </ListItemText>
            </MenuItem>
            {(observerRoleAvailable || isObserver) && (
              <MenuItem
                onClick={() => {
                  setActionsMenuAnchor(null);
                  toggleObserve();
                }}
                disabled={observeSaving}
              >
                <ListItemIcon>
                  <MaterialSymbol
                    icon={isObserver ? "visibility" : "visibility_off"}
                    size={20}
                    color={isObserver ? "#1976d2" : "#ccc"}
                  />
                </ListItemIcon>
                <ListItemText>
                  {isObserver
                    ? t("cards:actions.stopObserving")
                    : t("cards:actions.observe")}
                </ListItemText>
              </MenuItem>
            )}
            {!isArchived && perms.can_archive && (
              <MenuItem onClick={() => { setActionsMenuAnchor(null); setArchiveDialogOpen(true); }}>
                <ListItemIcon>
                  <MaterialSymbol icon="archive" size={20} color="#ed6c02" />
                </ListItemIcon>
                <ListItemText>{t("common:actions.archive")}</ListItemText>
              </MenuItem>
            )}
            {!isArchived && perms.can_delete && (
              <MenuItem onClick={() => { setActionsMenuAnchor(null); setDeleteDialogOpen(true); }}>
                <ListItemIcon>
                  <MaterialSymbol icon="delete_forever" size={20} color="#d32f2f" />
                </ListItemIcon>
                <ListItemText>{t("common:actions.delete")}</ListItemText>
              </MenuItem>
            )}
          </Menu>
        </Box>
      </Box>

      {/* ── Archive dialog (with children + related strategies) ── */}
      <ArchiveDeleteDialog
        open={archiveDialogOpen}
        mode="archive"
        scope="single"
        cardId={card.id}
        cardName={card.name}
        onClose={() => setArchiveDialogOpen(false)}
        onConfirmed={handleArchiveConfirmed}
      />

      {/* ── Delete dialog (with children + related strategies) ── */}
      <ArchiveDeleteDialog
        open={deleteDialogOpen}
        mode="delete"
        scope="single"
        cardId={card.id}
        cardName={card.name}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirmed={handleDeleteConfirmed}
      />

      {/* ── Restore dialog with cascade-restore checkboxes ── */}
      <RestoreDialog
        open={restoreDialogOpen}
        cardId={card.id}
        cardName={card.name}
        onClose={() => setRestoreDialogOpen(false)}
        onConfirmed={handleRestoreConfirmed}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />

      <CardDetailContent
        card={card}
        perms={perms}
        onCardUpdate={setCard}
        initialTab={initialTab}
        initialSubTab={initialSubTab}
        autoFieldKeys={ppmAutoFieldKeys}
        onAiSuggest={
          aiEnabled && perms.can_edit && !isArchived && !aiResponse
            ? handleAiSuggest
            : undefined
        }
        aiBusy={aiLoading}
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
                      <Button size="small" color="inherit" onClick={() => setRestoreDialogOpen(true)} startIcon={<MaterialSymbol icon="restore" size={18} />}>
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
                {t("detail.archivedBanner")}
                {daysUntilPurge !== null && ` ${t("detail.purgeWarning", { count: daysUntilPurge })}`}
                {archiveRetentionDays === 0 && ` ${t("detail.archivedIndefinite")}`}
              </Alert>
            )}

            {/* Approval blocked: missing mandatory items */}
            {approvalBlock && (approvalBlock.missing_relations.length > 0 || approvalBlock.missing_tag_groups.length > 0) && (
              <Alert
                severity="warning"
                sx={{ mb: 2 }}
                onClose={() => setApprovalBlock(null)}
              >
                <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
                  {t("approval.blockedTitle")}
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {approvalBlock.missing_relations.map((r) => (
                    <li key={`rel-${r.key}-${r.side}`}>
                      {t("approval.missingRelation", { label: r.label, otherType: r.other_type_key })}
                    </li>
                  ))}
                  {approvalBlock.missing_tag_groups.map((g) => (
                    <li key={`tag-${g.id}`}>
                      {t("approval.missingTagGroup", { name: g.name })}
                    </li>
                  ))}
                </Box>
              </Alert>
            )}

            {/* AI Suggestion Panel */}
            {(aiLoading || aiError || aiResponse) && (
              <AiSuggestPanel
                response={aiResponse}
                loading={aiLoading}
                error={aiError}
                onApply={handleAiApply}
                onDismiss={() => {
                  setAiResponse(null);
                  setAiError("");
                }}
                fieldsSchema={typeConfig?.fields_schema}
              />
            )}
          </>
        }
      />
      <Fade in={showScrollTop}>
        <Fab
          size="small"
          aria-label={t("detail.backToTop")}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          sx={{ position: "fixed", bottom: 24, right: 24, zIndex: 200 }}
        >
          <MaterialSymbol icon="arrow_upward" size={20} />
        </Fab>
      </Fade>
    </Box>
  );
}
