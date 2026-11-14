import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Portal from "@mui/material/Portal";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardLogoAvatar from "@/components/CardLogoAvatar";
import ApprovalStatusBadge from "@/components/ApprovalStatusBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import AiSuggestPanel, { type AiApplyPayload } from "@/components/AiSuggestPanel";
import { hasTypePermission } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useAiStatus, aiSuggestEnabledFor } from "@/hooks/useAiStatus";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { api } from "@/api/client";
import { DataQualityPill } from "@/features/cards/sections";
import { GainFlight } from "@/features/cards/gamification/GainFlight";
import { useSaveOrigin, useScoreGain } from "@/features/cards/gamification/useScoreGain";
import { useGamificationEnabled } from "@/hooks/useGamificationEnabled";
import CardDetailContent from "@/features/cards/CardDetailContent";
import type {
  Card,
  CardEffectivePermissions,
  AiSuggestResponse,
} from "@/types";

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
  can_manage_adr_links: true,
  can_bpm_approve: true,
  can_manage_diagram_links: true,
  can_view_costs: true,
};

interface Props {
  cardId: string | null;
  open: boolean;
  onClose: () => void;
  /**
   * Leave the page beside the panel usable: no backdrop, no scroll lock, no
   * focus trap, nothing marked `aria-hidden`, and a click outside the panel
   * reaches the page instead of closing it. Escape inside the panel and the
   * close button still close it. The Inventory sets it so a user can keep
   * scrolling, filtering and clicking other rows while a card is previewed
   * (#1289). Off by default — every other caller (and the extension SDK)
   * keeps the modal drawer.
   */
  nonModal?: boolean;
  /** Load only the BO-scoped card and effective permissions. */
  boScoped?: boolean;
  onSaved?: () => void;
  refreshKey?: number;
  docked?: boolean;
  /**
   * Called when the parent asked for another card (or for the panel to close)
   * while a section held unsaved edits and the user chose to keep them: the
   * panel stays on `cardId` and hands it back so the parent can put its own
   * state back (#1397). The Inventory passes its preview setter; a modal
   * caller cannot switch cards behind the backdrop and needs nothing.
   */
  onKeepCard?: (cardId: string) => void;
}

export default function CardDetailSidePanel({
  cardId,
  open,
  onClose,
  nonModal = false,
  boScoped = false,
  onSaved,
  refreshKey,
  docked = false,
  onKeepCard,
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const { t: reportT } = useTranslation("reports");
  const user = useOptionalAuthUser();
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const resolveSubtypeLabel = useCardSubtypeLabel();

  // Unsaved edits (#1397). The sections report "any section dirty" through
  // CardDetailContent, exactly as on the full card page (#843), and report
  // clean again when they unmount.
  const [dirty, setDirty] = useState(false);
  const leaveMessage = t("cards:detail.unsavedLeaveConfirm");
  // Reload, tab close, the "open full page" button and any other route
  // change. `pathOnly`: the page beside a non-modal panel keeps working, and
  // a same-path query-string write of its own is no reason to ask.
  useUnsavedChangesGuard(dirty, leaveMessage, { pathOnly: true });

  // The card the panel shows. It follows the parent's request (`open ?
  // cardId : null`) unless that would throw away unsaved edits and the user
  // says no — then the panel keeps its card, whatever the props say.
  const [shownId, setShownId] = useState<string | null>(open && cardId ? cardId : null);
  const shownIdRef = useRef(shownId);
  const dirtyRef = useRef(dirty);
  const leaveMessageRef = useRef(leaveMessage);
  const onKeepCardRef = useRef(onKeepCard);
  shownIdRef.current = shownId;
  dirtyRef.current = dirty;
  leaveMessageRef.current = leaveMessage;
  onKeepCardRef.current = onKeepCard;
  // A target the user already answered for, so one request is asked once:
  // `approved` — the panel's own close was confirmed, so the parent's
  // resulting `open=false` must not ask again; `declined` — the effect can
  // run again for the same request (StrictMode, a parent that re-renders
  // before restoring its state) and must not ask twice.
  // `undefined` = no answer recorded; `null` is a real target (closed).
  const approvedRef = useRef<string | null | undefined>(undefined);
  const declinedRef = useRef<string | null | undefined>(undefined);

  const [loadedCard, setCard] = useState<Card | null>(null);
  const card = loadedCard?.id === shownId ? loadedCard : null;
  const [saveVersion, setSaveVersion] = useState(0);
  const [error, setError] = useState("");
  const [perms, setPerms] =
    useState<CardEffectivePermissions["effective"]>(DEFAULT_PERMISSIONS);
  // Gamified data quality: the panel's header is already sticky, so the pill
  // plays the gain (the orb flies to it from the saved section) and no
  // separate score bar is needed.
  const gamification = useGamificationEnabled();
  const [saveOrigin, reportSaveOrigin] = useSaveOrigin();
  const scoreGain = useScoreGain(card?.id, card?.data_quality, gamification, saveOrigin);
  const [pillEl, setPillEl] = useState<HTMLElement | null>(null);
  const [impactNonce, setImpactNonce] = useState<number | null>(null);

  const { aiStatus } = useAiStatus();
  const [aiResponse, setAiResponse] = useState<AiSuggestResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    const target = open && cardId ? cardId : null;
    const current = shownIdRef.current;
    if (target === current) {
      // The parent caught up with the panel (or restored its state after a
      // decline): nothing to ask, and a later request is a fresh question.
      approvedRef.current = undefined;
      declinedRef.current = undefined;
      return;
    }
    if (dirtyRef.current && approvedRef.current !== target) {
      if (declinedRef.current === target) return;
      if (!window.confirm(leaveMessageRef.current)) {
        declinedRef.current = target;
        if (current) onKeepCardRef.current?.(current);
        return;
      }
    }
    approvedRef.current = undefined;
    declinedRef.current = undefined;
    setShownId(target);
  }, [cardId, open]);

  // The panel's own ways out — close button, Escape, the modal backdrop.
  const requestClose = () => {
    if (dirtyRef.current && !window.confirm(leaveMessageRef.current)) return;
    approvedRef.current = null;
    onClose();
    // A parent already at `open=false` (it closed while the user kept the
    // edits) re-renders nothing on onClose, so close from here.
    if (!(open && cardId)) {
      approvedRef.current = undefined;
      setShownId(null);
    }
  };

  // A refresh of the same card (refreshKey, saveVersion) keeps its expanded
  // sections and scroll state: only a change of the shown card resets.
  useEffect(() => {
    // Whatever was unsaved belonged to the card the user just agreed to leave.
    dirtyRef.current = false;
    setDirty(false);
    if (!shownId) return;
    setCard(null);
    setError("");
    setPerms(DEFAULT_PERMISSIONS);
    setAiResponse(null);
    setAiError("");
    setAiLoading(false);
  }, [shownId, boScoped]);

  // isCurrent(): a switch can land before the previous card's responses do;
  // those must not paint the old card over the new one.
  useAbortableEffect(async ({ signal, isCurrent }) => {
    if (!shownId) return;
    if (boScoped) {
      try {
        const detail = await api.get<{ card: Card; permissions: CardEffectivePermissions["effective"] }>(
          `/bo-relationship/objects/${shownId}/detail`, { signal },
        );
        if (!isCurrent()) return;
        setCard(detail.card);
        setPerms(detail.permissions);
        setError("");
      } catch (e) {
        if (!isCurrent()) return;
        setCard(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } else {
      await Promise.all([
        api.get<Card>(`/cards/${shownId}`)
          .then((value) => { if (isCurrent()) setCard(value); })
          .catch((e) => { if (isCurrent()) setError(e.message); }),
        api.get<CardEffectivePermissions>(`/cards/${shownId}/my-permissions`)
          .then((res) => { if (isCurrent()) setPerms(res.effective); })
          .catch(() => {}),
      ]);
    }
  }, [shownId, boScoped, refreshKey, saveVersion]);

  const typeConfig = card ? getType(card.type) : null;
  // Resolve the subtype key (e.g. "aiModel") to its translated metamodel label
  // (e.g. "AI Model"), mirroring CardDetail.tsx's header.
  const subtypeLabel = card ? resolveSubtypeLabel(card.type, card.subtype) : "";
  const isArchived = card?.status === "ARCHIVED";
  const aiEnabled = !boScoped && aiSuggestEnabledFor(aiStatus, card?.type);
  const canOpenFullCard = !boScoped || (
    card && hasTypePermission(user, "inventory.view", card.type)
  );

  const handleAiSuggest = async () => {
    if (!card) return;
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
    if (!card) return;
    const patch: Record<string, unknown> = {};
    if (payload.description) patch.description = payload.description;
    if (payload.fields) {
      patch.attributes = { ...(card.attributes ?? {}), ...payload.fields };
    }
    const updated = await api.patch<Card>(`/cards/${card.id}`, patch);
    setCard(updated);
    setAiResponse(null);
  };

  const content = (
    <>
      {/* Header */}
      <Box
        sx={{
          p: 2,
          pb: 1,
          borderBottom: 1,
          borderColor: "divider",
          position: "sticky",
          top: 0,
          bgcolor: "background.paper",
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            rowGap: 1,
            columnGap: 1,
            mb: 1,
          }}
        >
          <IconButton size="small" onClick={requestClose} aria-label={t("actions.close")}>
            <MaterialSymbol icon="close" size={20} />
          </IconButton>
          {card && typeConfig && (
            <CardLogoAvatar
              cardId={card.id}
              logoUpdatedAt={card.logo_updated_at}
              typeIcon={typeConfig.icon}
              typeColor={typeConfig.color}
              size={32}
              radius={1.5}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {card ? (
              <>
                <Typography variant="subtitle1" fontWeight={700} noWrap={!docked}
                  sx={docked ? { overflowWrap: "anywhere" } : undefined}>
                  {card.name}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {typeLabel(typeConfig) || card.type}
                  </Typography>
                  {subtypeLabel && (
                    <Chip
                      size="small"
                      label={subtypeLabel}
                      variant="outlined"
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  )}
                </Box>
              </>
            ) : (
              <Typography variant="subtitle1" color="text.secondary">
                {t("labels.loading")}
              </Typography>
            )}
          </Box>
          {card && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 0.5,
                flexBasis: docked ? "100%" : { xs: "100%", sm: "auto" },
                order: docked ? 1 : { xs: 1, sm: 0 },
              }}
            >
              <DataQualityPill
                value={card.data_quality}
                cardId={boScoped ? undefined : card.id}
                cardType={card.type}
                animate={gamification}
                gain={scoreGain}
                impactNonce={impactNonce}
                onRootRef={setPillEl}
              />
              <LifecycleBadge lifecycle={card.lifecycle} />
              <ApprovalStatusBadge status={card.approval_status} />
            </Box>
          )}
          {canOpenFullCard && <Tooltip title={t("cards:sidePanel.openFullPage")}>
            <IconButton
              size="small"
              onClick={() => {
                if (shownId) navigate(`/cards/${shownId}`);
              }}
            >
              <MaterialSymbol icon="open_in_new" size={20} />
            </IconButton>
          </Tooltip>}
        </Box>
      </Box>

      {/* Content */}
      {/*
        Isolated so the header above keeps its sticky guarantee. The Paper is the
        scroll container and the header only holds zIndex 1, so any section that
        uses a zIndex of its own would otherwise paint over it while scrolling --
        the lifecycle timeline did exactly that. Containing the whole content
        subtree settles it for every section, present and future, rather than
        trading zIndex numbers with each one.
      */}
      <Box sx={{ p: 2, isolation: "isolate" }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!card && !error && <LinearProgress />}
        {card && (
          <CardDetailContent
            key={card.id}
            card={card}
            perms={perms}
            onCardUpdate={(updated) => {
              if (updated.id === shownIdRef.current) {
                if (boScoped) setSaveVersion((version) => version + 1);
                else setCard(updated);
              }
              onSaved?.();
            }}
            onDirtyChange={setDirty}
            boScoped={boScoped}
            onSaveOrigin={reportSaveOrigin}
            showBpmTabs={false}
            onAiSuggest={
              aiEnabled && perms.can_edit && !isArchived && !aiResponse
                ? handleAiSuggest
                : undefined
            }
            aiBusy={aiLoading}
            beforeTabs={boScoped ? (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2">{reportT("boRelationship.indicators")}</Typography>
                {card.attributes?.isPersonalData === true && <Chip size="small" label={reportT("boRelationship.personalData")} />}
                {card.attributes?.isPaymentData === true && <Chip size="small" label={reportT("boRelationship.paymentData")} />}
              </Box>
            ) : (aiLoading || aiError || aiResponse) && (
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
              )
            }
          />
        )}
      </Box>
      {gamification && scoreGain?.originAnchor && (
        <GainFlight
          key={scoreGain.nonce}
          gain={scoreGain}
          targetEl={pillEl}
          onImpact={setImpactNonce}
        />
      )}
    </>
  );

  const paperSx = {
    width: { xs: "100%", sm: 560, md: 640 },
    overflow: "auto",
  };

  if (docked) {
    return shownId !== null ? (
      <Box
        role="region"
        aria-label={reportT("boRelationship.cardDetails")}
        onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) requestClose(); }}
        sx={{
          width: "100%", minWidth: 0, overflow: "auto",
          maxHeight: { xs: 560, lg: "calc(var(--bo-canvas-height, 650px) + 40px)" },
        }}
      >
        {content}
      </Box>
    ) : null;
  }

  if (nonModal) {
    // MUI's own non-modal drawer, not a temporary one with its backdrop hidden:
    // a temporary drawer is a Modal, and a Modal marks every sibling of its
    // portal `aria-hidden` whatever its props say — the page a user is meant
    // to keep working in would be invisible to a screen reader.
    // The Portal keeps the panel out of the caller's layout, as the modal
    // drawer is; the content unmounts on close, as the modal drawer's does.
    return (
      <Portal>
        <Drawer
          anchor="right"
          variant="persistent"
          open={shownId !== null}
          slotProps={{ transition: { unmountOnExit: true } }}
          PaperProps={{
            // No Modal ⇒ no built-in Escape handling. Only a keydown that
            // started inside the panel reaches here, and a nested dialog, menu
            // or autocomplete that consumed its own Escape stops it first.
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Escape" && !e.defaultPrevented) requestClose();
            },
            // The persistent variant is flat; give it the modal drawer's lift.
            sx: { ...paperSx, boxShadow: 16 },
          }}
        >
          {content}
        </Drawer>
      </Portal>
    );
  }

  return (
    <Drawer
      anchor="right"
      open={shownId !== null}
      onClose={requestClose}
      PaperProps={{ sx: paperSx }}
    >
      {content}
    </Drawer>
  );
}
