/**
 * RiskFilterSidebar — left-hand collapsible filter panel for the Risk
 * Register, mirroring the ADR filter sidebar pattern exactly (same
 * resize handle behaviour, collapsed rail, "Filters / N" header,
 * **Clear filters** button, and expandable sections).
 *
 * The filter state is a single :type:`RiskFilters` object that the
 * parent (``RiskRegisterPage``) owns and passes down — one callback
 * for every mutation, one ``Clear filters`` shortcut at the top of the
 * panel.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  RiskCategory,
  RiskLevel,
  RiskSourceType,
  RiskStatus,
} from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskFilters {
  search: string;
  statuses: RiskStatus[];
  categories: RiskCategory[];
  levels: RiskLevel[];
  owners: string[]; // user ids
  sources: RiskSourceType[];
  dateTargetFrom: string;
  dateTargetTo: string;
  overdueOnly: boolean;
}

export const EMPTY_RISK_FILTERS: RiskFilters = {
  search: "",
  statuses: [],
  categories: [],
  levels: [],
  owners: [],
  sources: [],
  dateTargetFrom: "",
  dateTargetTo: "",
  overdueOnly: false,
};

export interface OwnerOption {
  id: string;
  display_name: string;
  email: string;
}

interface Props {
  filters: RiskFilters;
  onFiltersChange: (f: RiskFilters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  availableOwners: OwnerOption[];
}

const STATUSES: RiskStatus[] = [
  "identified",
  "analysed",
  "mitigation_planned",
  "in_progress",
  "mitigated",
  "monitoring",
  "accepted",
  "closed",
];
const CATEGORIES: RiskCategory[] = [
  "security",
  "compliance",
  "operational",
  "technology",
  "financial",
  "reputational",
  "strategic",
];
const LEVELS: RiskLevel[] = ["critical", "high", "medium", "low"];
const SOURCES: RiskSourceType[] = [
  "manual",
  "security_cve",
  "security_compliance",
  "architect",
];

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        py: 0.5,
        userSelect: "none",
        "&:hover": { bgcolor: "action.hover", borderRadius: 1 },
      }}
    >
      <MaterialSymbol
        icon={expanded ? "expand_more" : "chevron_right"}
        size={18}
        style={{ marginRight: 4 }}
      />
      <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RiskFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  availableOwners,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    search: true,
    status: true,
    category: true,
    level: true,
    owner: false,
    source: false,
    target: false,
  });
  const [ownerSearch, setOwnerSearch] = useState("");

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Toggle helpers — one per list filter ────────────────────────
  const toggleInList = useCallback(
    <K extends keyof RiskFilters>(key: K, value: string) => {
      const current = filters[key] as unknown as string[];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      onFiltersChange({ ...filters, [key]: next } as RiskFilters);
    },
    [filters, onFiltersChange],
  );

  const setField = useCallback(
    <K extends keyof RiskFilters>(key: K, value: RiskFilters[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange],
  );

  const clearAll = () => onFiltersChange({ ...EMPTY_RISK_FILTERS });

  const activeCount = useMemo(
    () =>
      (filters.search.trim() ? 1 : 0) +
      filters.statuses.length +
      filters.categories.length +
      filters.levels.length +
      filters.owners.length +
      filters.sources.length +
      (filters.dateTargetFrom ? 1 : 0) +
      (filters.dateTargetTo ? 1 : 0) +
      (filters.overdueOnly ? 1 : 0),
    [filters],
  );

  // ── Resize drag ─────────────────────────────────────────────────
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startW + (ev.clientX - startX)),
      );
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ── Owner list, optionally filtered by local search. Must live
  //    above any early return so the hooks order stays stable. ───
  const filteredOwners = useMemo(() => {
    if (!ownerSearch.trim()) return availableOwners;
    const q = ownerSearch.toLowerCase();
    return availableOwners.filter(
      (o) =>
        o.display_name.toLowerCase().includes(q)
        || o.email.toLowerCase().includes(q),
    );
  }, [availableOwners, ownerSearch]);

  // ── Collapsed rail ──────────────────────────────────────────────
  if (collapsed) {
    return (
      <Box
        sx={{
          width: 44,
          minWidth: 44,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={t("risks.filter.clearAll")} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, fontSize: 11, height: 20, minWidth: 20 }}
          />
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "action.hover",
        }}
      >
        {/* Header */}
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontSize: 14, fontWeight: 600 }}>
              {t("risks.filter.panelTitle")}
            </Typography>
            {activeCount > 0 && (
              <Chip
                label={t("risks.filter.activeCount", { count: activeCount })}
                size="small"
                color="primary"
                sx={{ height: 20, fontSize: 11 }}
              />
            )}
          </Box>
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, py: 1 }}>
          {activeCount > 0 && (
            <Button
              size="small"
              onClick={clearAll}
              startIcon={<MaterialSymbol icon="filter_alt_off" size={16} />}
              sx={{ mb: 1, textTransform: "none", fontSize: 12 }}
            >
              {t("risks.filter.clearAll")}
            </Button>
          )}

          {/* Search */}
          <SectionHeader
            label={t("risks.filter.search")}
            expanded={expandedSections.search}
            onToggle={() => toggleSection("search")}
          />
          <Collapse in={expandedSections.search}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("risks.filter.searchPlaceholder")}
              value={filters.search}
              onChange={(e) => setField("search", e.target.value)}
              sx={{ my: 0.5, "& input": { fontSize: 12, height: 16 } }}
            />
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* Status */}
          <SectionHeader
            label={t("risks.filter.status")}
            expanded={expandedSections.status}
            onToggle={() => toggleSection("status")}
          />
          <Collapse in={expandedSections.status}>
            <List dense disablePadding>
              {STATUSES.map((s) => (
                <ListItemButton
                  key={s}
                  dense
                  onClick={() => toggleInList("statuses", s)}
                  sx={{ py: 0, px: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.statuses.includes(s)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`risks.status.${s}`)}
                    primaryTypographyProps={{ fontSize: 12 }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* Category */}
          <SectionHeader
            label={t("risks.filter.category")}
            expanded={expandedSections.category}
            onToggle={() => toggleSection("category")}
          />
          <Collapse in={expandedSections.category}>
            <List dense disablePadding>
              {CATEGORIES.map((c) => (
                <ListItemButton
                  key={c}
                  dense
                  onClick={() => toggleInList("categories", c)}
                  sx={{ py: 0, px: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.categories.includes(c)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`risks.category.${c}`)}
                    primaryTypographyProps={{ fontSize: 12 }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* Level */}
          <SectionHeader
            label={t("risks.filter.level")}
            expanded={expandedSections.level}
            onToggle={() => toggleSection("level")}
          />
          <Collapse in={expandedSections.level}>
            <List dense disablePadding>
              {LEVELS.map((l) => (
                <ListItemButton
                  key={l}
                  dense
                  onClick={() => toggleInList("levels", l)}
                  sx={{ py: 0, px: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.levels.includes(l)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`risks.level.${l}`)}
                    primaryTypographyProps={{ fontSize: 12 }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* Owner */}
          <SectionHeader
            label={t("risks.filter.owner")}
            expanded={expandedSections.owner}
            onToggle={() => toggleSection("owner")}
          />
          <Collapse in={expandedSections.owner}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("risks.filter.ownerSearchPlaceholder")}
              value={ownerSearch}
              onChange={(e) => setOwnerSearch(e.target.value)}
              sx={{ my: 0.5, "& input": { fontSize: 12, height: 16 } }}
            />
            {filteredOwners.length === 0 ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", px: 0.5, py: 1 }}
              >
                {t("risks.filter.noOwners")}
              </Typography>
            ) : (
              <List dense disablePadding sx={{ maxHeight: 240, overflowY: "auto" }}>
                {filteredOwners.map((o) => (
                  <ListItemButton
                    key={o.id}
                    dense
                    onClick={() => toggleInList("owners", o.id)}
                    sx={{ py: 0, px: 0.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <Checkbox
                        edge="start"
                        size="small"
                        checked={filters.owners.includes(o.id)}
                        tabIndex={-1}
                        disableRipple
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={o.display_name}
                      secondary={o.email}
                      primaryTypographyProps={{ fontSize: 12 }}
                      secondaryTypographyProps={{ fontSize: 10 }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* Source */}
          <SectionHeader
            label={t("risks.filter.source")}
            expanded={expandedSections.source}
            onToggle={() => toggleSection("source")}
          />
          <Collapse in={expandedSections.source}>
            <List dense disablePadding>
              {SOURCES.map((s) => (
                <ListItemButton
                  key={s}
                  dense
                  onClick={() => toggleInList("sources", s)}
                  sx={{ py: 0, px: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.sources.includes(s)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`risks.source.${s}`)}
                    primaryTypographyProps={{ fontSize: 12 }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* Target date + overdue */}
          <SectionHeader
            label={t("risks.filter.target")}
            expanded={expandedSections.target}
            onToggle={() => toggleSection("target")}
          />
          <Collapse in={expandedSections.target}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, my: 0.5 }}>
              <TextField
                size="small"
                type="date"
                label={t("risks.filter.from")}
                value={filters.dateTargetFrom}
                onChange={(e) => setField("dateTargetFrom", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                size="small"
                type="date"
                label={t("risks.filter.to")}
                value={filters.dateTargetTo}
                onChange={(e) => setField("dateTargetTo", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={filters.overdueOnly}
                    onChange={(e) => setField("overdueOnly", e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontSize: 12 }}>
                    {t("risks.filter.overdueOnly")}
                  </Typography>
                }
              />
            </Box>
          </Collapse>
        </Box>
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 4,
          cursor: "col-resize",
          "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
        }}
      />
    </Box>
  );
}
