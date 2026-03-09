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
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import { DataQualityRing } from "@/features/cards/sections";
import CardDetailContent from "@/features/cards/CardDetailContent";
import type { Card, CardEffectivePermissions } from "@/types";

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

  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [perms, setPerms] =
    useState<CardEffectivePermissions["effective"]>(DEFAULT_PERMISSIONS);

  // Reset state and fetch when cardId changes
  useEffect(() => {
    if (!cardId || !open) return;
    setCard(null);
    setError("");
    setPerms(DEFAULT_PERMISSIONS);
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
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
                  <Typography variant="caption" color="text.secondary">
                    {rml(typeConfig?.key ?? "", typeConfig?.translations, "label") || card.type}
                  </Typography>
                  {card.subtype && typeof card.subtype === "string" && (
                    <Chip
                      size="small"
                      label={card.subtype}
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
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <DataQualityRing value={card.data_quality} />
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
          />
        )}
      </Box>
    </Drawer>
  );
}
