/**
 * SecurityLogFilterSidebar — left-hand filter panel for the **Security &
 * admin** sub-tab of the Audit log. Follows UI_GUIDELINES §3.11 (the Inventory
 * sidebar anatomy): collapsed 44px rail with an active-filter count, tabbed
 * Filters / Columns header with change dots, collapsible sections each with a
 * glyph and a count, drag resize handle.
 *
 * Every filter maps to a server query param on `GET /admin/audit-log` (the
 * grid pages server-side, so a client-side filter would narrow one page only).
 * Category, outcome and action are single-valued on the server, so their
 * options behave as a toggle: picking one replaces the previous pick, picking
 * it again clears it.
 *
 * Fully controlled and fetch-free: the page passes the action list it loaded.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { DateField } from "@/components/DateField";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  FilterCheckboxList,
  FilterSectionHeader,
} from "@/components/FilterSidebarSection";
import ColumnFreezeToggle from "@/components/grid/ColumnFreezeToggle";
import ColumnOrderSection, {
  type ColumnOrderItem,
} from "@/components/grid/ColumnOrderSection";
import {
  SECURITY_CATEGORIES,
  SECURITY_OUTCOMES,
  actionLabelKey,
  categoryColor,
  outcomeColor,
} from "./SecurityLogTypes";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface SecurityLogFilters {
  /** Free text over actor / subject email and target label (`q`). */
  q: string;
  /** "" = any. */
  category: string;
  /** "" = any. */
  outcome: string;
  /** Exact dotted action, "" = any. */
  action: string;
  /** A user id (→ `actor_user_id`) or an email (→ `actor_email`). */
  actor: string;
  ip: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_SECURITY_FILTERS: SecurityLogFilters = {
  q: "",
  category: "",
  outcome: "",
  action: "",
  actor: "",
  ip: "",
  dateFrom: "",
  dateTo: "",
};

export interface SecurityColumn {
  id: string;
  labelKey: string;
  icon: string;
}

export const SECURITY_GRID_COLUMNS: SecurityColumn[] = [
  { id: "created_at", labelKey: "securityLog.columns.when", icon: "schedule" },
  { id: "category", labelKey: "securityLog.columns.category", icon: "category" },
  { id: "action", labelKey: "securityLog.columns.action", icon: "bolt" },
  { id: "outcome", labelKey: "securityLog.columns.outcome", icon: "rule" },
  { id: "actor_email", labelKey: "securityLog.columns.actor", icon: "person" },
  { id: "subject_email", labelKey: "securityLog.columns.subject", icon: "account_circle" },
  { id: "target_label", labelKey: "securityLog.columns.target", icon: "ads_click" },
  { id: "ip", labelKey: "securityLog.columns.ip", icon: "lan" },
  { id: "origin", labelKey: "securityLog.columns.origin", icon: "hub" },
  {
    id: "impersonated_role",
    labelKey: "securityLog.columns.impersonatedRole",
    icon: "theater_comedy",
  },
];

/** Columns that always render — they anchor each row. */
export const LOCKED_SECURITY_COLUMNS: ReadonlySet<string> = new Set(["created_at", "action"]);

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

/** Number of active filters — drives the rail chip and the Filters tab dot. */
export function countActiveSecurityFilters(f: SecurityLogFilters): number {
  return (
    (f.q.trim() ? 1 : 0) +
    (f.category ? 1 : 0) +
    (f.outcome ? 1 : 0) +
    (f.action ? 1 : 0) +
    (f.actor.trim() ? 1 : 0) +
    (f.ip.trim() ? 1 : 0) +
    (f.dateFrom ? 1 : 0) +
    (f.dateTo ? 1 : 0)
  );
}

interface Props {
  filters: SecurityLogFilters;
  onFiltersChange: (f: SecurityLogFilters) => void;
  /** Distinct actions recorded so far (`GET /admin/audit-log/actions`). */
  actions: string[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  visibleColumns: Set<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  /** colIds frozen to the leading edge; the pin on each row toggles one. */
  frozenColumns: Set<string>;
  onToggleFrozen: (colId: string) => void;
  onResetColumns?: () => void;
  /** Visible, movable columns in grid order — feeds the reorder section. */
  columnOrderItems: ColumnOrderItem[];
  /** The full stored colId order (may include hidden columns). */
  columnOrder: string[];
  onColumnOrderChange: (next: string[]) => void;
  onResetColumnOrder?: () => void;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function ChangeDot() {
  return (
    <Box
      data-testid="change-dot"
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: "primary.main",
        flexShrink: 0,
      }}
    />
  );
}

/** A wrapped row of single-select state chips (§3.11: filled when selected). */
function StateChips({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; label: string; color: string }[];
  selected: string;
  onToggle: (id: string) => void;
}) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, my: 0.5, px: 0.5 }}>
      {options.map((o) => {
        const on = selected === o.id;
        return (
          <Chip
            key={o.id}
            label={o.label}
            size="small"
            variant={on ? "filled" : "outlined"}
            aria-pressed={on}
            onClick={() => onToggle(o.id)}
            sx={{
              fontSize: 12,
              ...(on
                ? { bgcolor: o.color, color: "common.white", borderColor: o.color }
                : { borderColor: o.color, color: o.color }),
            }}
          />
        );
      })}
    </Box>
  );
}

function ClearableField({
  value,
  onChange,
  placeholder,
  icon,
  clearLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: string;
  clearLabel: string;
}) {
  return (
    <TextField
      size="small"
      fullWidth
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ my: 0.5 }}
      inputProps={{ "aria-label": placeholder }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <MaterialSymbol icon={icon} size={16} />
          </InputAdornment>
        ),
        ...(value
          ? {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label={clearLabel}
                    onClick={() => onChange("")}
                    sx={{ p: 0.25 }}
                  >
                    <MaterialSymbol icon="close" size={14} />
                  </IconButton>
                </InputAdornment>
              ),
            }
          : {}),
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export default function SecurityLogFilterSidebar({
  filters,
  onFiltersChange,
  actions,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  visibleColumns,
  onVisibleColumnsChange,
  frozenColumns,
  onToggleFrozen,
  onResetColumns,
  columnOrderItems,
  columnOrder,
  onColumnOrderChange,
  onResetColumnOrder,
}: Props) {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState<0 | 1>(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    search: true,
    category: true,
    outcome: true,
    action: true,
    actor: false,
    ip: false,
    date: false,
  });

  const allColumnIds = useMemo(() => SECURITY_GRID_COLUMNS.map((c) => c.id), []);
  const columnsChanged = visibleColumns.size < SECURITY_GRID_COLUMNS.length;

  const toggleColumn = (id: string) => {
    if (LOCKED_SECURITY_COLUMNS.has(id)) return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onVisibleColumnsChange(next);
  };

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const setField = useCallback(
    <K extends keyof SecurityLogFilters>(key: K, value: SecurityLogFilters[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange],
  );

  /** Single-valued facet: picking the current value clears it. */
  const toggleSingle = useCallback(
    (key: "category" | "outcome" | "action", value: string) => {
      onFiltersChange({ ...filters, [key]: filters[key] === value ? "" : value });
    },
    [filters, onFiltersChange],
  );

  const clearAll = () => onFiltersChange({ ...EMPTY_SECURITY_FILTERS });

  const activeCount = useMemo(() => countActiveSecurityFilters(filters), [filters]);

  // Translated labels, sorted so the list reads alphabetically in the user's
  // language; the selected action stays listed even when the server no longer
  // reports it (purged), so it can always be cleared.
  const actionItems = useMemo(() => {
    const keys = new Set(actions);
    if (filters.action) keys.add(filters.action);
    return Array.from(keys)
      .map((a) => ({ id: a, label: t(actionLabelKey(a), { defaultValue: a }) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [actions, filters.action, t]);

  // ── Resize drag ─────────────────────────────────────────────────
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (ev.clientX - startX)));
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ── Collapsed rail ──────────────────────────────────────────────
  if (collapsed) {
    return (
      <Box
        data-testid="security-sidebar-rail"
        sx={{
          width: 44,
          minWidth: 44,
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
        <Tooltip title={t("securityLog.filters.expand")} placement="right">
          <IconButton
            size="small"
            onClick={onToggleCollapse}
            aria-label={t("securityLog.filters.expand")}
          >
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
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "action.hover",
        }}
      >
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
                  {t("securityLog.filters.tabFilters")}
                  {activeCount > 0 && <ChangeDot />}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {t("securityLog.filters.tabColumns")}
                  {columnsChanged && <ChangeDot />}
                </Box>
              }
            />
          </Tabs>
          <IconButton
            size="small"
            onClick={onToggleCollapse}
            aria-label={t("securityLog.filters.collapse")}
          >
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, py: 1 }}>
          {tab === 0 ? (
            <>
              {activeCount > 0 && (
                <Button
                  size="small"
                  onClick={clearAll}
                  startIcon={<MaterialSymbol icon="filter_alt_off" size={16} />}
                  sx={{ mb: 1, textTransform: "none", fontSize: 12 }}
                >
                  {t("securityLog.filters.clear")}
                </Button>
              )}

              {/* Search */}
              <FilterSectionHeader
                label={t("securityLog.filters.sectionSearch")}
                icon="search"
                expanded={expandedSections.search}
                onToggle={() => toggleSection("search")}
                count={filters.q.trim() ? 1 : 0}
              />
              <Collapse in={expandedSections.search}>
                <ClearableField
                  value={filters.q}
                  onChange={(v) => setField("q", v)}
                  placeholder={t("securityLog.filters.searchPlaceholder")}
                  icon="search"
                  clearLabel={t("securityLog.filters.clear")}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Category */}
              <FilterSectionHeader
                label={t("securityLog.filters.sectionCategory")}
                icon="category"
                expanded={expandedSections.category}
                onToggle={() => toggleSection("category")}
                count={filters.category ? 1 : 0}
              />
              <Collapse in={expandedSections.category}>
                <StateChips
                  options={SECURITY_CATEGORIES.map((c) => ({
                    id: c,
                    label: t(`securityLog.categories.${c}`),
                    color: categoryColor(c),
                  }))}
                  selected={filters.category}
                  onToggle={(id) => toggleSingle("category", id)}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Outcome */}
              <FilterSectionHeader
                label={t("securityLog.filters.sectionOutcome")}
                icon="rule"
                expanded={expandedSections.outcome}
                onToggle={() => toggleSection("outcome")}
                count={filters.outcome ? 1 : 0}
              />
              <Collapse in={expandedSections.outcome}>
                <StateChips
                  options={SECURITY_OUTCOMES.map((o) => ({
                    id: o,
                    label: t(`securityLog.outcomes.${o}`),
                    color: outcomeColor(o),
                  }))}
                  selected={filters.outcome}
                  onToggle={(id) => toggleSingle("outcome", id)}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Action */}
              <FilterSectionHeader
                label={t("securityLog.filters.sectionAction")}
                icon="bolt"
                expanded={expandedSections.action}
                onToggle={() => toggleSection("action")}
                count={filters.action ? 1 : 0}
              />
              <Collapse in={expandedSections.action}>
                {actionItems.length === 0 ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", px: 1, py: 0.5, fontStyle: "italic" }}
                  >
                    {t("securityLog.filters.noActions")}
                  </Typography>
                ) : (
                  <FilterCheckboxList
                    items={actionItems.map((a) => ({
                      key: a.id,
                      label: a.label,
                      secondary: a.label === a.id ? undefined : a.id,
                      icon: "bolt",
                      color: categoryColor(a.id.split(".")[0]),
                      checked: filters.action === a.id,
                      onToggle: () => toggleSingle("action", a.id),
                    }))}
                  />
                )}
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Actor */}
              <FilterSectionHeader
                label={t("securityLog.filters.sectionActor")}
                icon="person"
                expanded={expandedSections.actor}
                onToggle={() => toggleSection("actor")}
                count={filters.actor.trim() ? 1 : 0}
              />
              <Collapse in={expandedSections.actor}>
                <ClearableField
                  value={filters.actor}
                  onChange={(v) => setField("actor", v)}
                  placeholder={t("securityLog.filters.actorPlaceholder")}
                  icon="person"
                  clearLabel={t("securityLog.filters.clear")}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* IP */}
              <FilterSectionHeader
                label={t("securityLog.filters.sectionIp")}
                icon="lan"
                expanded={expandedSections.ip}
                onToggle={() => toggleSection("ip")}
                count={filters.ip.trim() ? 1 : 0}
              />
              <Collapse in={expandedSections.ip}>
                <ClearableField
                  value={filters.ip}
                  onChange={(v) => setField("ip", v)}
                  placeholder={t("securityLog.filters.ipPlaceholder")}
                  icon="lan"
                  clearLabel={t("securityLog.filters.clear")}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Date range */}
              <FilterSectionHeader
                label={t("securityLog.filters.sectionDate")}
                icon="event"
                expanded={expandedSections.date}
                onToggle={() => toggleSection("date")}
                count={(filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0)}
              />
              <Collapse in={expandedSections.date}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, my: 0.5 }}>
                  <DateField
                    size="small"
                    label={t("securityLog.filters.dateFrom")}
                    value={filters.dateFrom}
                    onChange={(v) => setField("dateFrom", v)}
                  />
                  <DateField
                    size="small"
                    label={t("securityLog.filters.dateTo")}
                    value={filters.dateTo}
                    onChange={(v) => setField("dateTo", v)}
                  />
                </Box>
              </Collapse>
            </>
          ) : (
            /* ─────── Columns tab ─────── */
            <Box>
              <ColumnOrderSection
                items={columnOrderItems}
                order={columnOrder}
                frozen={frozenColumns}
                onToggleFrozen={onToggleFrozen}
                onReorder={onColumnOrderChange}
                onReset={onResetColumnOrder}
              />
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                  px: 0.5,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t("securityLog.filters.selectedCount", { count: visibleColumns.size })}
                </Typography>
                {columnsChanged && onResetColumns && (
                  <Button
                    size="small"
                    onClick={onResetColumns}
                    startIcon={<MaterialSymbol icon="restart_alt" size={14} />}
                    sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1 }}
                  >
                    {t("securityLog.filters.reset")}
                  </Button>
                )}
              </Box>
              <FilterSectionHeader
                label={t("securityLog.filters.columnsHint")}
                icon="grid_view"
                expanded
                onToggle={() => {}}
                count={visibleColumns.size}
              />
              <List dense disablePadding sx={{ mb: 1 }}>
                <ListItemButton
                  dense
                  onClick={() => onVisibleColumnsChange(new Set(allColumnIds))}
                  disabled={!columnsChanged}
                  sx={{ py: 0.25, px: 1, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox
                      size="small"
                      checked={!columnsChanged}
                      indeterminate={
                        visibleColumns.size > LOCKED_SECURITY_COLUMNS.size && columnsChanged
                      }
                      disableRipple
                      sx={{ p: 0 }}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body2" fontSize={13} fontWeight={500} fontStyle="italic">
                        {t("securityLog.filters.selectAll")}
                      </Typography>
                    }
                  />
                </ListItemButton>
                {SECURITY_GRID_COLUMNS.map((c) => {
                  const locked = LOCKED_SECURITY_COLUMNS.has(c.id);
                  const row = (
                    <ListItemButton
                      dense
                      disabled={locked}
                      onClick={() => toggleColumn(c.id)}
                      sx={{
                        py: 0.25,
                        px: 1,
                        borderRadius: 1,
                        ...(locked ? { "&.Mui-disabled": { opacity: 0.7 } } : {}),
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <Checkbox
                          size="small"
                          checked={visibleColumns.has(c.id)}
                          disabled={locked}
                          disableRipple
                          sx={{ p: 0 }}
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={{ minWidth: 24 }}>
                        <MaterialSymbol icon={c.icon} size={16} />
                      </ListItemIcon>
                      <ListItemText
                        primary={t(c.labelKey)}
                        primaryTypographyProps={{ fontSize: 13, noWrap: true }}
                      />
                    </ListItemButton>
                  );
                  // The pin is a sibling of the row button, never a child: a
                  // locked row disables its button (which would swallow the
                  // click), and a locked column is the one worth freezing.
                  return (
                    <Box key={c.id} sx={{ display: "flex", alignItems: "center" }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {locked ? (
                          <Tooltip title={t("securityLog.filters.alwaysVisible")} placement="right">
                            <span>{row}</span>
                          </Tooltip>
                        ) : (
                          row
                        )}
                      </Box>
                      <ColumnFreezeToggle
                        frozen={frozenColumns.has(c.id)}
                        onToggle={() => onToggleFrozen(c.id)}
                      />
                    </Box>
                  );
                })}
              </List>
            </Box>
          )}
        </Box>
      </Box>

      {/* Resize handle */}
      <Box
        data-testid="security-sidebar-resize"
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
