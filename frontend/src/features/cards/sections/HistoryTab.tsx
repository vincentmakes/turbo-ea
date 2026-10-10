import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import { alpha, useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { getPhaseLabels } from "@/features/cards/sections/cardDetailUtils";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel } from "@/hooks/useResolveLabel";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { EventEntry, FieldDef } from "@/types";
import {
  NO_VALUE,
  attributeLabels,
  eventDetailModel,
  eventMeta,
  fieldLabelsFor,
  parseChanges,
  type EventDetail,
} from "@/features/cards/sections/historyChanges";

// ── Tab: History ────────────────────────────────────────────────
function getFieldLabels(t: (key: string) => string): Record<string, string> {
  return {
    name: t("common:labels.name"),
    description: t("common:labels.description"),
    subtype: t("common:labels.subtype"),
    lifecycle: t("history.fields.lifecycle"),
    parent_id: t("common:labels.parent"),
    parent_label: t("history.fields.parentLabel"),
    alias: t("history.fields.alias"),
    external_id: t("history.fields.externalId"),
    approval_status: t("history.fields.approvalStatus"),
  };
}

// Approval status is stored as the raw enum, so a history row would otherwise
// read "APPROVED → BROKEN". These are the same four labels the approval badge
// and the Inventory render, so the tab agrees with the rest of the card.
function getApprovalStatusLabels(t: (key: string) => string): Record<string, string> {
  return {
    DRAFT: t("common:status.draft"),
    APPROVED: t("common:status.approved"),
    REJECTED: t("common:status.rejected"),
    BROKEN: t("common:status.broken"),
  };
}

interface EventDetailViewProps {
  detail: EventDetail;
  typeIconFor: (typeKey: string | null | undefined) => { icon: string; color: string } | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Renders the one-liner `eventDetailModel` decided on (relations, risks,
 *  documents, files, flow approvals, or the plain summary). */
function EventDetailView({ detail, typeIconFor, t }: EventDetailViewProps) {
  if (!detail) return null;
  if (detail.kind === "plain") return <PlainSummary text={detail.text} />;

  if (detail.kind === "relation") {
    const peerIcon = typeIconFor(detail.peerType);
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mt: 0.25 }}>
        <Typography variant="body2" color="text.secondary">{detail.label}</Typography>
        <MaterialSymbol icon={detail.outgoing ? "arrow_forward" : "arrow_back"} size={14} color="#9e9e9e" />
        {peerIcon && (
          <Box sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", bgcolor: peerIcon.color + "22" }}>
            <MaterialSymbol icon={peerIcon.icon} size={12} color={peerIcon.color} />
          </Box>
        )}
        {detail.peerId ? (
          <Link component={RouterLink} to={`/cards/${detail.peerId}`} variant="body2" underline="hover">
            {detail.peerName}
          </Link>
        ) : (
          <Typography variant="body2">{detail.peerName}</Typography>
        )}
        {detail.peerType && (
          <Typography variant="caption" color="text.disabled">{detail.peerType}</Typography>
        )}
      </Box>
    );
  }

  if (detail.kind === "risk") {
    const { reference, link, level, levelColor, title } = detail;
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mt: 0.25 }}>
        {reference && (
          link ? (
            <Link component={RouterLink} to={link} variant="body2" underline="hover" sx={{ fontFamily: "monospace" }}>
              {reference}
            </Link>
          ) : (
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{reference}</Typography>
          )
        )}
        {level && (
          <Chip
            size="small"
            label={level}
            sx={{
              height: 18,
              fontSize: "0.7rem",
              bgcolor: levelColor ? levelColor + "22" : undefined,
              color: levelColor,
              textTransform: "capitalize",
            }}
          />
        )}
        {title && <Typography variant="body2" color="text.secondary">{title}</Typography>}
      </Box>
    );
  }

  if (detail.kind === "link") {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
        <Link href={detail.url} target="_blank" rel="noopener noreferrer" underline="hover">
          {detail.text}
        </Link>
      </Typography>
    );
  }

  return (
    <Box sx={{ mt: 0.25 }}>
      {detail.revision != null && (
        <Typography variant="body2" color="text.secondary">
          {t("history.processFlowRevision", { revision: detail.revision })}
        </Typography>
      )}
      {detail.reason && (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
          {t("history.withdrawalReason")}: <LinkifiedText text={detail.reason} />
        </Typography>
      )}
    </Box>
  );
}

function PlainSummary({ text }: { text: string }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
      <LinkifiedText text={text} />
    </Typography>
  );
}

function HistoryTab({ fsId, cardType }: { fsId: string; cardType?: string }) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const { formatDateTime } = useDateFormat();
  const fieldLabels = getFieldLabels(t);
  const phaseLabels = getPhaseLabels(t);
  const statusLabels = getApprovalStatusLabels(t);
  const resourceLabels = {
    url: t("resources.addLinkDialog.url"),
    type: t("resources.addLinkDialog.type"),
    category: t("resources.uploadFileDialog.category"),
  };
  const { getType } = useMetamodel();
  const fieldLabel = useFieldLabel();
  // `{attributeKey: localizedLabel}` for the card's type, so change rows show
  // "Total Annual Cost" instead of `costTotalAnnual`.
  const attrLabels = attributeLabels(
    cardType ? getType(cardType)?.fields_schema : undefined,
    (f) => fieldLabel(f as FieldDef),
  );
  const typeIconFor = (typeKey: string | null | undefined) => {
    if (!typeKey) return null;
    const ct = getType(typeKey);
    if (!ct) return null;
    return { icon: ct.icon || "category", color: ct.color || "#9e9e9e" };
  };
  const [events, setEvents] = useState<EventEntry[]>([]);
  useEffect(() => {
    api.get<EventEntry[]>(`/cards/${fsId}/history`).then(setEvents).catch(() => {});
  }, [fsId]);

  if (events.length === 0) {
    return <Typography color="text.secondary" variant="body2">{t("history.empty")}</Typography>;
  }

  return (
    <Box>
      {events.map((e) => {
        const meta = eventMeta(e.event_type, t);
        const changes = e.data?.changes as Record<string, unknown> | undefined;
        const rows = changes
          ? parseChanges(changes, {
              fields: fieldLabelsFor(e.event_type, fieldLabels, resourceLabels),
              phases: phaseLabels,
              attributes: attrLabels,
              statuses: statusLabels,
            })
          : [];
        const summary = typeof e.data?.summary === "string" ? (e.data.summary as string) : null;

        return (
          <Box key={e.id} sx={{ display: "flex", gap: 1.5, mb: 2 }}>
            {/* Timeline dot */}
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 0.25 }}>
              <Box sx={{ width: 28, height: 28, borderRadius: "50%", bgcolor: meta.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <MaterialSymbol icon={meta.icon} size={16} color={meta.color} />
              </Box>
              <Box sx={{ width: 2, flex: 1, bgcolor: "divider", mt: 0.5 }} />
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, pb: 1, minWidth: 0 }}>
              {/* Header row */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="body2" fontWeight={600}>{meta.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("history.by", { user: e.user_display_name || t("common:labels.system") })}
                </Typography>
                <Typography variant="caption" color="text.disabled" sx={{ ml: "auto", whiteSpace: "nowrap" }}>
                  {e.created_at ? formatDateTime(e.created_at) : ""}
                </Typography>
              </Box>

              {/* Detail line — for events that don't carry a field-level diff
                  (relations, stakeholders, risks, documents, files). Renders
                  clickable peer cards for relations, links to the risk page
                  for risk events, etc. Falls back to plain summary text. */}
              {rows.length === 0 && (
                <EventDetailView
                  detail={eventDetailModel(e.event_type, e.data, summary)}
                  typeIconFor={typeIconFor}
                  t={t}
                />
              )}

              {/* Change rows */}
              {rows.length > 0 && (
                <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.25 }}>
                  {rows.map((row, i) => (
                    <Box
                      key={i}
                      sx={{
                        display: "flex", alignItems: "center", gap: 1,
                        bgcolor: "action.hover", borderRadius: 1, px: 1, py: 0.5,
                      }}
                    >
                      <Typography variant="caption" fontWeight={600} sx={{ minWidth: 90, color: "text.secondary", flexShrink: 0 }}>
                        {row.field}
                      </Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, flexWrap: "wrap" }}>
                        {row.oldVal !== NO_VALUE && (
                          <Typography
                            variant="caption"
                            sx={{
                              color: theme.palette.error.main, bgcolor: alpha(theme.palette.error.main, 0.1), borderRadius: 0.5, px: 0.75, py: 0.125,
                              textDecoration: "line-through", maxWidth: 250, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                          >
                            {row.oldVal}
                          </Typography>
                        )}
                        <MaterialSymbol icon="arrow_right_alt" size={16} color="#9e9e9e" />
                        <Typography
                          variant="caption"
                          sx={{
                            color: theme.palette.success.main, bgcolor: alpha(theme.palette.success.main, 0.1), borderRadius: 0.5, px: 0.75, py: 0.125,
                            fontWeight: 500, maxWidth: 250, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {row.newVal}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default HistoryTab;
