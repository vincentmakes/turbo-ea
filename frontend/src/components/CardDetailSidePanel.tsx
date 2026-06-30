import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import ApprovalStatusBadge from "@/components/ApprovalStatusBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import AiSuggestPanel, { type AiApplyPayload } from "@/components/AiSuggestPanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { useAiStatus } from "@/hooks/useAiStatus";
import { api } from "@/api/client";
import { DataQualityPill } from "@/features/cards/sections";
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
}

export default function CardDetailSidePanel({ cardId, open, onClose }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const { getType } = useMetamodel();
  const rml = useResolveMetaLabel();
  const rl = useResolveLabel();

  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [perms, setPerms] =
    useState<CardEffectivePermissions["effective"]>(DEFAULT_PERMISSIONS);

  const { aiStatus } = useAiStatus();
  const [aiResponse, setAiResponse] = useState<AiSuggestResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Reset state and fetch when cardId changes
  useEffect(() => {
    if (!cardId || !open) return;
    setCard(null);
    setError("");
    setPerms(DEFAULT_PERMISSIONS);
    setAiResponse(null);
    setAiError("");
    setAiLoading(false);
    api
      .get<Card>(`/cards/${cardId}`)
      .then(setCard)
      .catch((e) => setError(e.message));
    api
      .get<CardEffectivePermissions>(`/cards/${cardId}/my-permissions`)
      .then((res) => setPerms(res.effective))
      .catch(() => {});
  }, [cardId, open]);

  const typeConfig = card ? getType(card.type) : null;
  // Resolve the subtype key (e.g. "aiModel") to its translated metamodel label
  // (e.g. "AI Model"), mirroring CardDetail.tsx's header.
  const subtypeLabel =
    card?.subtype && typeof card.subtype === "string"
      ? (() => {
          const st = typeConfig?.subtypes?.find((s) => s.key === card.subtype);
          return st ? rl(st.label, st.translations) : card.subtype;
        })()
      : null;
  const isArchived = card?.status === "ARCHIVED";
  const aiEnabled =
    !!card &&
    aiStatus.enabled &&
    aiStatus.configured &&
    aiStatus.enabled_types.includes(card.type);

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

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: "100%", sm: 560, md: 640 },
          overflow: "auto",
        },
      }}
    >
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
          <IconButton size="small" onClick={onClose}>
            <MaterialSymbol icon="close" size={20} />
          </IconButton>
          {card && typeConfig && (
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.5,
                bgcolor: typeConfig.color + "18",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MaterialSymbol
                icon={typeConfig.icon}
                size={20}
                color={typeConfig.color}
              />
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {card ? (
              <>
                <Typography variant="subtitle1" fontWeight={700} noWrap>
                  {card.name}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {rml(typeConfig?.key ?? "", typeConfig?.translations, "label") || card.type}
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
                flexBasis: { xs: "100%", sm: "auto" },
                order: { xs: 1, sm: 0 },
              }}
            >
              <DataQualityPill value={card.data_quality} />
              <LifecycleBadge lifecycle={card.lifecycle} />
              <ApprovalStatusBadge status={card.approval_status} />
            </Box>
          )}
          <Tooltip title={t("cards:sidePanel.openFullPage")}>
            <IconButton
              size="small"
              onClick={() => {
                if (cardId) navigate(`/cards/${cardId}`);
              }}
            >
              <MaterialSymbol icon="open_in_new" size={20} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Content */}
      <Box sx={{ p: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!card && !error && <LinearProgress />}
        {card && (
          <CardDetailContent
            card={card}
            perms={perms}
            onCardUpdate={setCard}
            showBpmTabs={false}
            onAiSuggest={
              aiEnabled && perms.can_edit && !isArchived && !aiResponse
                ? handleAiSuggest
                : undefined
            }
            aiBusy={aiLoading}
            beforeTabs={
              (aiLoading || aiError || aiResponse) && (
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
    </Drawer>
  );
}
