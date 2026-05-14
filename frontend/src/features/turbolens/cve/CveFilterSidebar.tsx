/**
 * Left-side filter sidebar for the TurboLens > CVE grid.
 *
 * Follows the Compliance sidebar pattern:
 *  - 44 px collapsed rail (left, ``borderRight``, ``action.hover`` bg)
 *  - Expanded sidebar with SectionHeader + Collapse per filter family
 *  - Active-count chip visible even when collapsed
 *
 * Filter families: Severity / Status / Priority / Probability /
 * Card type / Other (patch available, promoted to risk) / Date range.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  CveDateField,
  CveFilters,
  CvePriority,
  CveProbability,
  CveSeverity,
  CveStatus,
  TriState,
} from "./types";
import { countActive, emptyCveFilters } from "./types";

const COLLAPSED_RAIL = 44;
const EXPANDED_WIDTH = 280;

const SEVERITIES: CveSeverity[] = ["critical", "high", "medium", "low", "info", "unknown"];
const STATUSES: CveStatus[] = ["open", "acknowledged", "in_progress", "mitigated", "accepted"];
const PRIORITIES: CvePriority[] = ["critical", "high", "medium", "low"];
const PROBABILITIES: CveProbability[] = ["very_high", "high", "medium", "low", "unknown"];

interface Props {
  filters: CveFilters;
  onFiltersChange: (f: CveFilters) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Distinct card_type values present in the loaded findings. */
  availableCardTypes: string[];
}

function toggleSet<T>(s: Set<T>, v: T): Set<T> {
  const next = new Set(s);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export default function CveFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapsed,
  availableCardTypes,
}: Props) {
  const { t } = useTranslation("cards");
  const { t: tAdmin } = useTranslation("admin");
  const active = countActive(filters);

  const [expanded, setExpanded] = useState({
    severity: true,
    status: true,
    priority: true,
    probability: false,
    cardType: false,
    other: true,
    date: false,
  });
  const toggle = (k: keyof typeof expanded) =>
    setExpanded((p) => ({ ...p, [k]: !p[k] }));

  // ── Collapsed rail ──────────────────────────────────────────────────
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
        <Tooltip title={t("cve.filters.expand")} placement="right">
          <IconButton size="small" onClick={onToggleCollapsed}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {active > 0 && (
          <Chip
            label={active}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 12 }}
          />
        )}
      </Box>
    );
  }

  // ── Expanded panel ──────────────────────────────────────────────────
  return (
    <Paper
      variant="outlined"
      sx={{
        width: EXPANDED_WIDTH,
        minWidth: EXPANDED_WIDTH,
        display: "flex",
        flexDirection: "column",
        bgcolor: "action.hover",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 0.75,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <MaterialSymbol icon="filter_list" size={18} />
          <Typography variant="subtitle2" fontWeight={600}>
            {t("cve.filters.title")}
          </Typography>
          {active > 0 && (
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
        </Stack>
        <IconButton size="small" onClick={onToggleCollapsed} aria-label="collapse">
          <MaterialSymbol icon="chevron_left" size={20} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", p: 1 }}>
        {/* Active count + reset */}
        {active > 0 && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Chip
              label={t("cve.filters.activeCount", { count: active })}
              size="small"
              color="primary"
              sx={{ height: 20, fontSize: 12 }}
            />
            <Button
              size="small"
              onClick={() => onFiltersChange(emptyCveFilters())}
              sx={{ textTransform: "none", fontSize: 12 }}
            >
              {t("cve.filters.reset")}
            </Button>
          </Stack>
        )}

        {/* Search */}
        <TextField
          size="small"
          fullWidth
          label={t("cve.filters.search")}
          placeholder={t("cve.filters.searchPlaceholder")}
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          sx={{ mb: 1 }}
        />

        {/* Severity */}
        <SectionHeader
          label={t("cve.filters.severity")}
          icon="warning"
          expanded={expanded.severity}
          onToggle={() => toggle("severity")}
        />
        <Collapse in={expanded.severity}>
          <CheckboxList
            items={SEVERITIES.map((s) => ({
              key: s,
              label: tAdmin(`turbolens_security_severity_${s}`),
              checked: filters.severities.has(s),
              onToggle: () =>
                onFiltersChange({ ...filters, severities: toggleSet(filters.severities, s) }),
            }))}
          />
        </Collapse>

        {/* Status */}
        <SectionHeader
          label={t("cve.filters.status")}
          icon="task_alt"
          expanded={expanded.status}
          onToggle={() => toggle("status")}
        />
        <Collapse in={expanded.status}>
          <CheckboxList
            items={STATUSES.map((s) => ({
              key: s,
              label: tAdmin(`turbolens_security_status_${s}`),
              checked: filters.statuses.has(s),
              onToggle: () =>
                onFiltersChange({ ...filters, statuses: toggleSet(filters.statuses, s) }),
            }))}
          />
        </Collapse>

        {/* Priority */}
        <SectionHeader
          label={t("cve.filters.priority")}
          icon="trending_up"
          expanded={expanded.priority}
          onToggle={() => toggle("priority")}
        />
        <Collapse in={expanded.priority}>
          <CheckboxList
            items={PRIORITIES.map((p) => ({
              key: p,
              label: tAdmin(`turbolens_security_priority_${p}`),
              checked: filters.priorities.has(p),
              onToggle: () =>
                onFiltersChange({ ...filters, priorities: toggleSet(filters.priorities, p) }),
            }))}
          />
        </Collapse>

        {/* Probability */}
        <SectionHeader
          label={t("cve.filters.probability")}
          icon="percent"
          expanded={expanded.probability}
          onToggle={() => toggle("probability")}
        />
        <Collapse in={expanded.probability}>
          <CheckboxList
            items={PROBABILITIES.map((p) => ({
              key: p,
              label: tAdmin(`turbolens_security_probability_${p}`),
              checked: filters.probabilities.has(p),
              onToggle: () =>
                onFiltersChange({
                  ...filters,
                  probabilities: toggleSet(filters.probabilities, p),
                }),
            }))}
          />
        </Collapse>

        {/* Card type */}
        <SectionHeader
          label={t("cve.filters.cardType")}
          icon="category"
          expanded={expanded.cardType}
          onToggle={() => toggle("cardType")}
        />
        <Collapse in={expanded.cardType}>
          <CheckboxList
            items={availableCardTypes.map((ct) => ({
              key: ct,
              label: ct,
              checked: filters.cardTypes.has(ct),
              onToggle: () =>
                onFiltersChange({ ...filters, cardTypes: toggleSet(filters.cardTypes, ct) }),
            }))}
          />
        </Collapse>

        {/* Other (tri-state toggles) */}
        <SectionHeader
          label={t("cve.filters.other")}
          icon="tune"
          expanded={expanded.other}
          onToggle={() => toggle("other")}
        />
        <Collapse in={expanded.other}>
          <Stack spacing={1} sx={{ mb: 1, px: 0.5 }}>
            <TriStateRow
              label={t("cve.filters.patchAvailable")}
              value={filters.patchAvailable}
              onChange={(v) => onFiltersChange({ ...filters, patchAvailable: v })}
              t={t}
            />
            <TriStateRow
              label={t("cve.filters.promotedToRisk")}
              value={filters.promotedToRisk}
              onChange={(v) => onFiltersChange({ ...filters, promotedToRisk: v })}
              t={t}
            />
          </Stack>
        </Collapse>

        {/* Date range */}
        <SectionHeader
          label={t("cve.filters.dateField")}
          icon="event"
          expanded={expanded.date}
          onToggle={() => toggle("date")}
        />
        <Collapse in={expanded.date}>
          <Stack spacing={1} sx={{ mb: 1, px: 0.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>{t("cve.filters.dateField")}</InputLabel>
              <Select
                value={filters.dateField}
                label={t("cve.filters.dateField")}
                onChange={(e) =>
                  onFiltersChange({ ...filters, dateField: e.target.value as CveDateField })
                }
              >
                <MenuItem value="created">{t("cve.filters.dateCreated")}</MenuItem>
                <MenuItem value="modified">{t("cve.filters.dateModified")}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="date"
              label={t("cve.filters.dateFrom")}
              InputLabelProps={{ shrink: true }}
              value={filters.dateFrom ?? ""}
              onChange={(e) =>
                onFiltersChange({ ...filters, dateFrom: e.target.value || null })
              }
            />
            <TextField
              size="small"
              type="date"
              label={t("cve.filters.dateTo")}
              InputLabelProps={{ shrink: true }}
              value={filters.dateTo ?? ""}
              onChange={(e) =>
                onFiltersChange({ ...filters, dateTo: e.target.value || null })
              }
            />
          </Stack>
        </Collapse>
      </Box>
    </Paper>
  );
}

/* ─── helpers ───────────────────────────────────────────────────────── */

function SectionHeader({
  label,
  icon,
  expanded,
  onToggle,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
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
    </Box>
  );
}

interface CheckboxItem {
  key: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function CheckboxList({ items }: { items: CheckboxItem[] }) {
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, mb: 1 }}>
      {items.map((item) => (
        <Box
          component="li"
          key={item.key}
          onClick={item.disabled ? undefined : item.onToggle}
          sx={{
            display: "flex",
            alignItems: "center",
            py: 0.25,
            px: 1,
            borderRadius: 1,
            cursor: item.disabled ? "default" : "pointer",
            opacity: item.disabled ? 0.5 : 1,
            "&:hover": { bgcolor: item.disabled ? undefined : "action.selected" },
          }}
        >
          <Checkbox
            size="small"
            checked={item.checked}
            disabled={item.disabled}
            disableRipple
            sx={{ p: 0, mr: 0.75 }}
          />
          <Typography variant="body2" fontSize={13} noWrap>
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function TriStateRow({
  label,
  value,
  onChange,
  t,
}: {
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
  t: (key: string) => string;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" mb={0.25}>
        {label}
      </Typography>
      <RadioGroup row value={value} onChange={(_, v) => onChange(v as TriState)}>
        <FormControlLabel
          value="any"
          control={<Radio size="small" />}
          label={<Typography variant="body2" fontSize={12}>{t("cve.filters.triAny")}</Typography>}
        />
        <FormControlLabel
          value="yes"
          control={<Radio size="small" />}
          label={<Typography variant="body2" fontSize={12}>{t("cve.filters.triYes")}</Typography>}
        />
        <FormControlLabel
          value="no"
          control={<Radio size="small" />}
          label={<Typography variant="body2" fontSize={12}>{t("cve.filters.triNo")}</Typography>}
        />
      </RadioGroup>
    </Box>
  );
}
