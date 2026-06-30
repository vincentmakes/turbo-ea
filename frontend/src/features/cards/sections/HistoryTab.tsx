import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { getPhaseLabels } from "@/features/cards/sections/cardDetailUtils";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel } from "@/hooks/useResolveLabel";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { EventEntry } from "@/types";

// ── Tab: History ────────────────────────────────────────────────
const EVENT_META_ICONS: Record<string, { icon: string; color: string }> = {
  "card.created": { icon: "add_circle", color: "#4caf50" },
  "card.updated": { icon: "edit", color: "#1976d2" },
  "card.archived": { icon: "archive", color: "#ff9800" },
  "card.restored": { icon: "restore", color: "#4caf50" },
  "card.deleted": { icon: "delete", color: "#f44336" },
  "card.approval_status.approve": { icon: "verified", color: "#4caf50" },
  "card.approval_status.reject": { icon: "cancel", color: "#f44336" },
  "card.approval_status.reset": { icon: "restart_alt", color: "#9e9e9e" },
  "stakeholder.added": { icon: "person_add", color: "#1976d2" },
  "stakeholder.role_changed": { icon: "manage_accounts", color: "#1976d2" },
  "stakeholder.removed": { icon: "person_remove", color: "#f44336" },
  "relation.created": { icon: "link", color: "#1976d2" },
  "relation.updated": { icon: "sync_alt", color: "#1976d2" },
  "relation.deleted": { icon: "link_off", color: "#f44336" },
  "risk.added": { icon: "report", color: "#ff9800" },
  "risk.updated": { icon: "edit_note", color: "#ff9800" },
  "risk.removed": { icon: "report_off", color: "#9e9e9e" },
  "document.added": { icon: "link", color: "#1976d2" },
  "document.removed": { icon: "link_off", color: "#f44336" },
  "file.uploaded": { icon: "upload_file", color: "#1976d2" },
  "file.deleted": { icon: "delete", color: "#f44336" },
  "comment.created": { icon: "chat", color: "#1976d2" },
};

function getEventMeta(t: (key: string) => string): Record<string, { label: string; icon: string; color: string }> {
  return {
    "card.created": { label: t("history.events.created"), ...EVENT_META_ICONS["card.created"] },
    "card.updated": { label: t("history.events.updated"), ...EVENT_META_ICONS["card.updated"] },
    "card.archived": { label: t("history.events.archived"), ...EVENT_META_ICONS["card.archived"] },
    "card.restored": { label: t("history.events.restored"), ...EVENT_META_ICONS["card.restored"] },
    "card.deleted": { label: t("history.events.deleted"), ...EVENT_META_ICONS["card.deleted"] },
    "card.approval_status.approve": { label: t("history.events.approved"), ...EVENT_META_ICONS["card.approval_status.approve"] },
    "card.approval_status.reject": { label: t("history.events.rejected"), ...EVENT_META_ICONS["card.approval_status.reject"] },
    "card.approval_status.reset": { label: t("history.events.resetToDraft"), ...EVENT_META_ICONS["card.approval_status.reset"] },
    "stakeholder.added": { label: t("history.events.stakeholderAdded"), ...EVENT_META_ICONS["stakeholder.added"] },
    "stakeholder.role_changed": { label: t("history.events.stakeholderRoleChanged"), ...EVENT_META_ICONS["stakeholder.role_changed"] },
    "stakeholder.removed": { label: t("history.events.stakeholderRemoved"), ...EVENT_META_ICONS["stakeholder.removed"] },
    "relation.created": { label: t("history.events.relationCreated"), ...EVENT_META_ICONS["relation.created"] },
    "relation.updated": { label: t("history.events.relationUpdated"), ...EVENT_META_ICONS["relation.updated"] },
    "relation.deleted": { label: t("history.events.relationDeleted"), ...EVENT_META_ICONS["relation.deleted"] },
    "risk.added": { label: t("history.events.riskAdded"), ...EVENT_META_ICONS["risk.added"] },
    "risk.updated": { label: t("history.events.riskUpdated"), ...EVENT_META_ICONS["risk.updated"] },
    "risk.removed": { label: t("history.events.riskRemoved"), ...EVENT_META_ICONS["risk.removed"] },
    "document.added": { label: t("history.events.documentAdded"), ...EVENT_META_ICONS["document.added"] },
    "document.removed": { label: t("history.events.documentRemoved"), ...EVENT_META_ICONS["document.removed"] },
    "file.uploaded": { label: t("history.events.fileUploaded"), ...EVENT_META_ICONS["file.uploaded"] },
    "file.deleted": { label: t("history.events.fileDeleted"), ...EVENT_META_ICONS["file.deleted"] },
    "comment.created": { label: t("history.events.commentCreated"), ...EVENT_META_ICONS["comment.created"] },
  };
}

function getFieldLabels(t: (key: string) => string): Record<string, string> {
  return {
    name: t("common:labels.name"),
    description: t("common:labels.description"),
    subtype: t("common:labels.subtype"),
    lifecycle: t("history.fields.lifecycle"),
    parent_id: t("common:labels.parent"),
    alias: t("history.fields.alias"),
    external_id: t("history.fields.externalId"),
    approval_status: t("history.fields.approvalStatus"),
  };
}

function fmtVal(val: unknown, phaseLabels: Record<string, string>): string {
  if (val == null || val === "") return "\u2014";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map((v) => fmtVal(v, phaseLabels)).join(", ");
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>).filter(([, v]) => v != null && v !== "");
    if (entries.length === 0) return "\u2014";
    return entries.map(([k, v]) => `${phaseLabels[k] || k}: ${v}`).join(", ");
  }
  return String(val);
}

interface ChangeRow { field: string; oldVal: string; newVal: string }

const RISK_LEVEL_COLOR: Record<string, string> = {
  critical: "#d32f2f",
  high: "#f57c00",
  medium: "#fbc02d",
  low: "#388e3c",
};

interface EventDetailProps {
  data: Record<string, unknown> | undefined;
  eventType: string;
  fallbackSummary: string | null;
  typeIconFor: (typeKey: string | null | undefined) => { icon: string; color: string } | null;
}

/** Renders a richer one-liner for events that ship structured context
 *  (relations, risks, documents, files). Falls back to the plain summary
 *  for everything else. */
function EventDetail({ data, eventType, fallbackSummary, typeIconFor }: EventDetailProps) {
  if (!data) return fallbackSummary ? <PlainSummary text={fallbackSummary} /> : null;

  if (eventType.startsWith("relation.")) {
    const directional = (data.directional_label as string) || (data.relation_label as string) || (data.type as string);
    const peerId = data.peer_id as string | undefined;
    const peerName = (data.peer_name as string) || peerId || "";
    const peerType = data.peer_type as string | null | undefined;
    const direction = (data.direction as string) || "outgoing";
    const peerIcon = typeIconFor(peerType);
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mt: 0.25 }}>
        <Typography variant="body2" color="text.secondary">{directional}</Typography>
        <MaterialSymbol icon={direction === "outgoing" ? "arrow_forward" : "arrow_back"} size={14} color="#9e9e9e" />
        {peerIcon && (
          <Box sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", bgcolor: peerIcon.color + "22" }}>
            <MaterialSymbol icon={peerIcon.icon} size={12} color={peerIcon.color} />
          </Box>
        )}
        {peerId ? (
          <Link component={RouterLink} to={`/cards/${peerId}`} variant="body2" underline="hover">
            {peerName}
          </Link>
        ) : (
          <Typography variant="body2">{peerName}</Typography>
        )}
        {peerType && (
          <Typography variant="caption" color="text.disabled">{peerType}</Typography>
        )}
      </Box>
    );
  }

  if (eventType.startsWith("risk.")) {
    const reference = data.reference as string | undefined;
    const title = data.title as string | undefined;
    const level = (data.level as string | undefined)?.toLowerCase();
    const link = data.link as string | undefined;
    const levelColor = level ? RISK_LEVEL_COLOR[level] : undefined;
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

  if (eventType === "document.added" || eventType === "document.removed") {
    const name = (data.name as string) || (data.url as string) || fallbackSummary || "";
    const url = data.url as string | undefined;
    if (eventType === "document.added" && url) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          <Link href={url} target="_blank" rel="noopener noreferrer" underline="hover">
            {name}
          </Link>
        </Typography>
      );
    }
    return <PlainSummary text={name} />;
  }

  if (eventType === "file.uploaded" || eventType === "file.deleted") {
    const name = (data.name as string) || fallbackSummary || "";
    const size = data.size as number | undefined;
    const sizeText = size != null ? ` · ${(size / 1024).toFixed(1)} KB` : "";
    return <PlainSummary text={`${name}${sizeText}`} />;
  }

  if (eventType.startsWith("stakeholder.")) {
    // Stakeholder events ship a clean summary already (user · role[ · old → new]).
    return fallbackSummary ? <PlainSummary text={fallbackSummary} /> : null;
  }

  return fallbackSummary ? <PlainSummary text={fallbackSummary} /> : null;
}

function PlainSummary({ text }: { text: string }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
      {text}
    </Typography>
  );
}

/**
 * Resolve a raw change-payload key (e.g. `attr_costTotalAnnual` from the
 * survey-apply path, or a bare attribute key from the regular PATCH path)
 * to a human-friendly label using whichever source matches first:
 *   1. Static i18n labels for built-in fields (`name`, `description`, etc.)
 *   2. Lifecycle phase keys (`plan`, `phaseIn`, `active`, …)
 *   3. Metamodel attribute label resolved via the card type's fields_schema
 *   4. The raw key as a last-resort fallback
 */
function resolveFieldLabel(
  rawKey: string,
  fieldLabels: Record<string, string>,
  phaseLabels: Record<string, string>,
  attrLabels: Record<string, string>,
): string {
  if (fieldLabels[rawKey]) return fieldLabels[rawKey];
  if (phaseLabels[rawKey]) return phaseLabels[rawKey];
  // The survey-apply path emits attribute changes keyed as `attr_<fieldKey>`
  // so the audit event distinguishes attribute updates from core-field
  // updates. Strip the prefix before looking up the metamodel label.
  const attrKey = rawKey.startsWith("attr_") ? rawKey.slice(5) : rawKey;
  if (attrLabels[attrKey]) return attrLabels[attrKey];
  return rawKey;
}

function parseChanges(
  changes: Record<string, unknown>,
  fieldLabels: Record<string, string>,
  phaseLabels: Record<string, string>,
  attrLabels: Record<string, string>,
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const [field, change] of Object.entries(changes)) {
    if (!change || typeof change !== "object" || !("old" in change) || !("new" in change)) {
      // Legacy stringified format -- skip non-parsable
      continue;
    }
    const c = change as { old: unknown; new: unknown };
    if (field === "attributes" && typeof c.old === "object" && typeof c.new === "object") {
      const oldA = (c.old || {}) as Record<string, unknown>;
      const newA = (c.new || {}) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(oldA), ...Object.keys(newA)])) {
        if (JSON.stringify(oldA[key]) !== JSON.stringify(newA[key])) {
          rows.push({
            field: resolveFieldLabel(key, fieldLabels, phaseLabels, attrLabels),
            oldVal: fmtVal(oldA[key], phaseLabels),
            newVal: fmtVal(newA[key], phaseLabels),
          });
        }
      }
    } else if (field === "lifecycle" && typeof c.old === "object" && typeof c.new === "object") {
      const oldL = (c.old || {}) as Record<string, unknown>;
      const newL = (c.new || {}) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(oldL), ...Object.keys(newL)])) {
        if (oldL[key] !== newL[key]) {
          rows.push({ field: phaseLabels[key] || key, oldVal: fmtVal(oldL[key], phaseLabels), newVal: fmtVal(newL[key], phaseLabels) });
        }
      }
    } else {
      rows.push({
        field: resolveFieldLabel(field, fieldLabels, phaseLabels, attrLabels),
        oldVal: fmtVal(c.old, phaseLabels),
        newVal: fmtVal(c.new, phaseLabels),
      });
    }
  }
  return rows;
}

function HistoryTab({ fsId, cardType }: { fsId: string; cardType?: string }) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const { formatDateTime } = useDateFormat();
  const eventMeta = getEventMeta(t);
  const fieldLabels = getFieldLabels(t);
  const phaseLabels = getPhaseLabels(t);
  const { getType } = useMetamodel();
  const fieldLabel = useFieldLabel();
  // Build a `{attributeKey: localizedLabel}` map for the card's type so
  // change rows can show "Total Annual Cost" instead of `costTotalAnnual`.
  const attrLabels: Record<string, string> = {};
  if (cardType) {
    const ct = getType(cardType);
    if (ct) {
      for (const section of ct.fields_schema || []) {
        for (const f of section.fields || []) {
          attrLabels[f.key] = fieldLabel(f);
        }
      }
    }
  }
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
        const meta = eventMeta[e.event_type] || { label: e.event_type, icon: "info", color: "#9e9e9e" };
        const changes = e.data?.changes as Record<string, unknown> | undefined;
        const rows = changes ? parseChanges(changes, fieldLabels, phaseLabels, attrLabels) : [];
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
                <EventDetail
                  data={e.data}
                  eventType={e.event_type}
                  fallbackSummary={summary}
                  typeIconFor={typeIconFor}
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
                        {row.oldVal !== "\u2014" && (
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
