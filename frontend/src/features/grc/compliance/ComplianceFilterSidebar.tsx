/**
 * Left-side filter sidebar for the GRC > Compliance grid.
 *
 * Follows the Inventory sidebar pattern exactly:
 *  - 44 px collapsed rail (left, ``borderRight``, ``action.hover`` bg)
 *  - Expanded sidebar with ``SectionHeader`` + ``Collapse`` per filter
 *    family
 *  - List + Checkbox rows (not Chips) — a tiny coloured dot before the
 *    label keeps the semantic colour visible without confusing the
 *    "selected vs unselected" affordance.
 *
 * Filter families: Compliance Status / Severity / Lifecycle / Card type /
 * Other (AI-only, Include resolved).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import {
  CARD_TYPE_COLORS,
  COMPLIANCE_LIFECYCLE_COLORS,
  SEVERITY_COLORS,
  STATUS_COLORS,
} from "@/theme";
import type {
  ComplianceDecision,
  ComplianceStatus,
  TurboLensComplianceFinding,
} from "@/types";

export interface ComplianceFilters {
  statuses: Set<ComplianceStatus>;
  severities: Set<TurboLensComplianceFinding["severity"]>;
  decisions: Set<ComplianceDecision>;
  cardTypes: Set<"Application" | "ITComponent">;
  aiOnly: boolean;
  /** Only show findings whose linked card has `hasAiFeatures = true`
   *  (i.e. the user confirmed it is AI via the verdict workflow). */
  aiConfirmedOnly: boolean;
  includeResolved: boolean;
}

/** Stable identifier for every compliance grid column. Keep in sync with
 *  the column field/key values in ``ComplianceGrid``. */
export const COMPLIANCE_GRID_COLUMNS: Array<{ id: string; labelKey: string }> = [
  { id: "card_name", labelKey: "compliance.grid.col.card" },
  { id: "severity", labelKey: "compliance.grid.col.severity" },
  { id: "status", labelKey: "compliance.grid.col.status" },
  { id: "regulation_article", labelKey: "compliance.grid.col.article" },
  { id: "requirement", labelKey: "compliance.grid.col.requirement" },
  { id: "decision", labelKey: "compliance.grid.col.lifecycle" },
  { id: "ai_detected", labelKey: "compliance.grid.col.ai" },
  { id: "created_at", labelKey: "compliance.grid.col.created" },
  { id: "updated_at", labelKey: "compliance.grid.col.modified" },
];

/** Columns that always render — the user can't hide these because they
 *  anchor the row (Card) or define the finding (Severity / Requirement). */
export const LOCKED_COMPLIANCE_COLUMNS = new Set(["card_name", "severity", "requirement"]);

interface Props {
  filters: ComplianceFilters;
  onFiltersChange: (next: ComplianceFilters) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Visible column ids; columns not in this set are hidden. */
  visibleColumns: Set<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  /** Reset visible columns to the default (all columns). */
  onResetColumns?: () => void;
  width?: number;
}

const STATUSES: ComplianceStatus[] = [
  "compliant",
  "partial",
  "non_compliant",
  "not_applicable",
  "review_needed",
];
const SEVERITIES: TurboLensComplianceFinding["severity"][] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const LIFECYCLE_STATES: ComplianceDecision[] = [
  "new",
  "in_review",
  "mitigated",
  "verified",
  "risk_tracked",
  "accepted",
  "not_applicable",
];
const CARD_TYPES: Array<"Application" | "ITComponent"> = [
  "Application",
  "ITComponent",
];

const DEFAULT_WIDTH = 280;
const COLLAPSED_RAIL = 44;

const STATUS_HEX: Record<ComplianceStatus, string> = {
  compliant: STATUS_COLORS.success,
  partial: STATUS_COLORS.warning,
  non_compliant: STATUS_COLORS.error,
  not_applicable: STATUS_COLORS.neutral,
  review_needed: STATUS_COLORS.info,
};

const SEVERITY_HEX: Record<TurboLensComplianceFinding["severity"], string> = {
  critical: SEVERITY_COLORS.critical,
  high: SEVERITY_COLORS.high,
  medium: SEVERITY_COLORS.medium,
  low: SEVERITY_COLORS.low,
  info: STATUS_COLORS.info,
};

const CARD_TYPE_ICONS: Record<"Application" | "ITComponent", string> = {
  Application: "apps",
  ITComponent: "memory",
};

export default function ComplianceFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapsed,
  visibleColumns,
  onVisibleColumnsChange,
  onResetColumns,
  width = DEFAULT_WIDTH,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const { getType } = useMetamodel();
  // Metamodel color (admin-editable) first, static token as fallback.
  const cardTypeColor = (ct: "Application" | "ITComponent") =>
    getType(ct)?.color || CARD_TYPE_COLORS[ct];

  const [tab, setTab] = useState<0 | 1>(0);
  const [expanded, setExpanded] = useState({
    status: true,
    severity: true,
    lifecycle: true,
    cardType: true,
    other: true,
  });
  const toggleSection = (key: keyof typeof expanded) =>
    setExpanded((p) => ({ ...p, [key]: !p[key] }));

  const totalColumns = COMPLIANCE_GRID_COLUMNS.length;
  const hiddenColumns = totalColumns - visibleColumns.size;
  const columnsChanged = hiddenColumns > 0;
  const toggleColumn = (id: string) => {
    if (LOCKED_COMPLIANCE_COLUMNS.has(id)) return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onVisibleColumnsChange(next);
  };

  function toggleSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const activeCount =
    (STATUSES.length - filters.statuses.size) +
    (SEVERITIES.length - filters.severities.size) +
    (LIFECYCLE_STATES.length - filters.decisions.size) +
    (CARD_TYPES.length - filters.cardTypes.size) +
    (filters.aiOnly ? 1 : 0) +
    (filters.includeResolved ? 1 : 0);

  if (collapsed) {
    return (
      <Box
        sx={{
          width: COLLAPSED_RAIL,
          minWidth: COLLAPSED_RAIL,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={tCards("compliance.filters.expand")} placement="right">
          <IconButton size="small" onClick={onToggleCollapsed}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 12 }}
          />
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width,
        minWidth: width,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        display: "flex",
        flexDirection: "column",
        bgcolor: "action.hover",
        overflow: "hidden",
      }}
    >
      {/* Tabbed header (Filters / Columns) — mirrors Inventory pattern. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v as 0 | 1)}
          sx={{
            minHeight: 36,
            "& .MuiTab-root": {
              minHeight: 36,
              py: 0,
              textTransform: "none",
              fontSize: 14,
              minWidth: 0,
            },
          }}
        >
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                {tCards("compliance.filters.title")}
                {activeCount > 0 && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: "primary.main",
                      flexShrink: 0,
                    }}
                  />
                )}
              </Box>
            }
          />
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                {tCards("compliance.columns.title")}
                {columnsChanged && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: "primary.main",
                      flexShrink: 0,
                    }}
                  />
                )}
              </Box>
            }
          />
        </Tabs>
        <IconButton size="small" onClick={onToggleCollapsed} aria-label="collapse">
          <MaterialSymbol icon="chevron_left" size={20} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", p: 1 }}>
      {tab === 0 ? (
        <>
        <SectionHeader
          label={t("compliance_filter_status")}
          icon="verified"
          expanded={expanded.status}
          onToggle={() => toggleSection("status")}
          count={STATUSES.length - filters.statuses.size}
        />
        <Collapse in={expanded.status}>
          <CheckboxList
            items={STATUSES.map((s) => ({
              key: s,
              label: t(`compliance_status_${s}`),
              color: STATUS_HEX[s],
              checked: filters.statuses.has(s),
              onToggle: () =>
                onFiltersChange({ ...filters, statuses: toggleSet(filters.statuses, s) }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={t("compliance_filter_severity")}
          icon="flag"
          expanded={expanded.severity}
          onToggle={() => toggleSection("severity")}
          count={SEVERITIES.length - filters.severities.size}
        />
        <Collapse in={expanded.severity}>
          <CheckboxList
            items={SEVERITIES.map((s) => ({
              key: s,
              label: t(`compliance_severity_${s}`),
              color: SEVERITY_HEX[s],
              checked: filters.severities.has(s),
              onToggle: () =>
                onFiltersChange({
                  ...filters,
                  severities: toggleSet(filters.severities, s),
                }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.lifecycle")}
          icon="route"
          expanded={expanded.lifecycle}
          onToggle={() => toggleSection("lifecycle")}
          count={LIFECYCLE_STATES.length - filters.decisions.size}
        />
        <Collapse in={expanded.lifecycle}>
          <CheckboxList
            items={LIFECYCLE_STATES.map((d) => ({
              key: d,
              label: t(`compliance_decision_${d}`),
              color: COMPLIANCE_LIFECYCLE_COLORS[d],
              checked: filters.decisions.has(d),
              onToggle: () =>
                onFiltersChange({
                  ...filters,
                  decisions: toggleSet(filters.decisions, d),
                }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.cardType")}
          icon="category"
          expanded={expanded.cardType}
          onToggle={() => toggleSection("cardType")}
          count={CARD_TYPES.length - filters.cardTypes.size}
        />
        <Collapse in={expanded.cardType}>
          <CheckboxList
            items={CARD_TYPES.map((ct) => ({
              key: ct,
              label: ct,
              color: cardTypeColor(ct),
              icon: CARD_TYPE_ICONS[ct],
              checked: filters.cardTypes.has(ct),
              onToggle: () =>
                onFiltersChange({
                  ...filters,
                  cardTypes: toggleSet(filters.cardTypes, ct),
                }),
            }))}
          />
        </Collapse>

        <SectionHeader
          label={tCards("compliance.filters.other")}
          icon="tune"
          expanded={expanded.other}
          onToggle={() => toggleSection("other")}
          count={
            (filters.aiOnly ? 1 : 0) +
            (filters.aiConfirmedOnly ? 1 : 0) +
            (filters.includeResolved ? 1 : 0)
          }
        />
        <Collapse in={expanded.other}>
          <CheckboxList
            items={[
              {
                key: "ai_only",
                label: t("compliance_filter_ai_only"),
                checked: filters.aiOnly,
                onToggle: () =>
                  onFiltersChange({ ...filters, aiOnly: !filters.aiOnly }),
              },
              {
                key: "ai_confirmed_only",
                label: t("compliance_filter_ai_confirmed_only"),
                checked: filters.aiConfirmedOnly,
                onToggle: () =>
                  onFiltersChange({
                    ...filters,
                    aiConfirmedOnly: !filters.aiConfirmedOnly,
                  }),
              },
              {
                key: "include_resolved",
                label: t("compliance_filter_include_resolved"),
                checked: filters.includeResolved,
                onToggle: () =>
                  onFiltersChange({
                    ...filters,
                    includeResolved: !filters.includeResolved,
                  }),
              },
            ]}
          />
        </Collapse>
        </>
      ) : (
        /* ─────── Columns tab ─────── */
        <Box>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1, px: 0.5 }}
          >
            <Typography variant="caption" color="text.secondary">
              {tCards("compliance.columns.help")}
            </Typography>
            {columnsChanged && onResetColumns && (
              <Button
                size="small"
                onClick={onResetColumns}
                sx={{ textTransform: "none", fontSize: 12 }}
              >
                {tCards("compliance.columns.reset")}
              </Button>
            )}
          </Stack>
          <CheckboxList
            items={COMPLIANCE_GRID_COLUMNS.map((c) => ({
              key: c.id,
              label: tCards(c.labelKey),
              checked: visibleColumns.has(c.id),
              onToggle: () => toggleColumn(c.id),
              disabled: LOCKED_COMPLIANCE_COLUMNS.has(c.id),
            }))}
          />
        </Box>
      )}
      </Box>
    </Box>
  );
}

/* ─── helpers ───────────────────────────────────────────────────────── */

function SectionHeader({
  label,
  icon,
  expanded,
  onToggle,
  count,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        py: 0.5,
        px: 0.5,
        cursor: "pointer",
        borderRadius: 1,
        userSelect: "none",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <MaterialSymbol icon={expanded ? "expand_more" : "chevron_right"} size={16} />
      <MaterialSymbol icon={icon} size={16} />
      <Typography variant="body2" fontWeight={600} fontSize={13} sx={{ flex: 1 }}>
        {label}
      </Typography>
      {count != null && count > 0 && (
        <Chip
          label={count}
          size="small"
          color="primary"
          sx={{ height: 18, fontSize: 11 }}
        />
      )}
    </Box>
  );
}

interface CheckboxItem {
  key: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  color?: string;
  icon?: string;
  disabled?: boolean;
}

function CheckboxList({ items }: { items: CheckboxItem[] }) {
  return (
    <List dense disablePadding sx={{ mb: 1 }}>
      {items.map((item) => (
        <ListItemButton
          key={item.key}
          dense
          disabled={item.disabled}
          onClick={item.onToggle}
          sx={{ py: 0.25, px: 1, borderRadius: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Checkbox
              size="small"
              checked={item.checked}
              disabled={item.disabled}
              disableRipple
              sx={{ p: 0 }}
            />
          </ListItemIcon>
          {item.icon ? (
            <MaterialSymbol icon={item.icon} size={14} color={item.color} />
          ) : item.color ? (
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: item.color,
                flexShrink: 0,
              }}
            />
          ) : null}
          <ListItemText
            primary={item.label}
            primaryTypographyProps={{
              fontSize: 13,
              ml: 0.75,
              noWrap: true,
            }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

export function defaultComplianceFilters(): ComplianceFilters {
  return {
    statuses: new Set(STATUSES),
    severities: new Set(SEVERITIES),
    decisions: new Set<ComplianceDecision>([
      "new",
      "in_review",
      "mitigated",
      "verified",
      "risk_tracked",
      "accepted",
    ]),
    cardTypes: new Set<"Application" | "ITComponent">(["Application", "ITComponent"]),
    aiOnly: false,
    aiConfirmedOnly: false,
    includeResolved: false,
  };
}
