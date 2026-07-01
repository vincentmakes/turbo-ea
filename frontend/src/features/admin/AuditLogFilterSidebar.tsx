/**
 * AuditLogFilterSidebar — left-hand collapsible filter panel for the
 * mutation-batch audit log. Structurally mirrors `RiskFilterSidebar`:
 * tabbed Filters / Columns header, collapsible sections, resize
 * handle, mobile-friendly. Filters drive the `?origin=`, `?tool_name=`,
 * `?since=`, `?until=` query params on `GET /api/v1/mutation-batches`
 * (the actor / status / search filters are applied client-side after
 * fetch since they're cheap to compute over the page-sized result).
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
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type AuditOrigin = "mcp" | "web" | "api";
export type AuditStatusKey = "committed" | "dry_run" | "open";

export interface AuditLogFilters {
  search: string;
  origins: AuditOrigin[];
  statuses: AuditStatusKey[];
  toolName: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_AUDIT_FILTERS: AuditLogFilters = {
  search: "",
  origins: [],
  statuses: [],
  toolName: "",
  dateFrom: "",
  dateTo: "",
};

const ORIGINS: { id: AuditOrigin; labelKey: string }[] = [
  { id: "mcp", labelKey: "auditLog.origins.mcp" },
  { id: "web", labelKey: "auditLog.origins.web" },
  { id: "api", labelKey: "auditLog.origins.api" },
];

const STATUSES: { id: AuditStatusKey; labelKey: string }[] = [
  { id: "committed", labelKey: "auditLog.statuses.committed" },
  { id: "dry_run", labelKey: "auditLog.statuses.dryRun" },
  { id: "open", labelKey: "auditLog.statuses.open" },
];

export interface AuditColumn {
  id: string;
  labelKey: string;
}

export const AUDIT_GRID_COLUMNS: AuditColumn[] = [
  { id: "created_at", labelKey: "auditLog.columns.when" },
  { id: "tool_name", labelKey: "auditLog.columns.tool" },
  { id: "origin", labelKey: "auditLog.columns.origin" },
  { id: "actor_display_name", labelKey: "auditLog.columns.actor" },
  { id: "status_derived", labelKey: "auditLog.columns.status" },
  { id: "event_count", labelKey: "auditLog.columns.events" },
  { id: "actions", labelKey: "auditLog.columns.actions" },
];

/** Columns that always render — they anchor each row. */
export const LOCKED_AUDIT_COLUMNS = new Set(["created_at", "tool_name", "actions"]);

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

interface Props {
  filters: AuditLogFilters;
  onFiltersChange: (f: AuditLogFilters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  visibleColumns: Set<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  onResetColumns?: () => void;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export default function AuditLogFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  visibleColumns,
  onVisibleColumnsChange,
  onResetColumns,
}: Props) {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState<0 | 1>(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    search: true,
    origin: true,
    status: true,
    tool: false,
    date: false,
  });

  const hiddenColumnCount = AUDIT_GRID_COLUMNS.length - visibleColumns.size;
  const columnsChanged = hiddenColumnCount > 0;

  const toggleColumn = (id: string) => {
    if (LOCKED_AUDIT_COLUMNS.has(id)) return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onVisibleColumnsChange(next);
  };

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleInList = useCallback(
    <K extends "origins" | "statuses">(key: K, value: string) => {
      const current = filters[key] as unknown as string[];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      onFiltersChange({ ...filters, [key]: next } as AuditLogFilters);
    },
    [filters, onFiltersChange],
  );

  const setField = useCallback(
    <K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange],
  );

  const clearAll = () => onFiltersChange({ ...EMPTY_AUDIT_FILTERS });

  const activeCount = useMemo(
    () =>
      (filters.search.trim() ? 1 : 0) +
      filters.origins.length +
      filters.statuses.length +
      (filters.toolName.trim() ? 1 : 0) +
      (filters.dateFrom ? 1 : 0) +
      (filters.dateTo ? 1 : 0),
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

  // ── Collapsed rail ──────────────────────────────────────────────
  if (collapsed) {
    return (
      <Box
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
        <Tooltip title={t("auditLog.filters.expand")} placement="right">
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
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "action.hover",
        }}
      >
        {/* Tabbed header (Filters / Columns) — same shape as RiskFilterSidebar */}
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
                  {t("auditLog.filters.tabFilters")}
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
                  {t("auditLog.filters.tabColumns")}
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
          <IconButton size="small" onClick={onToggleCollapse}>
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
                  {t("auditLog.filters.clear")}
                </Button>
              )}

              {/* Search */}
              <SectionHeader
                label={t("auditLog.filters.sectionSearch")}
                expanded={expandedSections.search}
                onToggle={() => toggleSection("search")}
              />
              <Collapse in={expandedSections.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("auditLog.filters.searchPlaceholder")}
                  value={filters.search}
                  onChange={(e) => setField("search", e.target.value)}
                  sx={{ my: 0.5, "& input": { fontSize: 12, height: 16 } }}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Origin */}
              <SectionHeader
                label={t("auditLog.filters.sectionOrigin")}
                expanded={expandedSections.origin}
                onToggle={() => toggleSection("origin")}
              />
              <Collapse in={expandedSections.origin}>
                <List dense disablePadding>
                  {ORIGINS.map((o) => (
                    <ListItemButton
                      key={o.id}
                      dense
                      onClick={() => toggleInList("origins", o.id)}
                      sx={{ py: 0, px: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <Checkbox
                          edge="start"
                          size="small"
                          checked={filters.origins.includes(o.id)}
                          tabIndex={-1}
                          disableRipple
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={t(o.labelKey)}
                        primaryTypographyProps={{ fontSize: 12 }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Status */}
              <SectionHeader
                label={t("auditLog.filters.sectionStatus")}
                expanded={expandedSections.status}
                onToggle={() => toggleSection("status")}
              />
              <Collapse in={expandedSections.status}>
                <List dense disablePadding>
                  {STATUSES.map((s) => (
                    <ListItemButton
                      key={s.id}
                      dense
                      onClick={() => toggleInList("statuses", s.id)}
                      sx={{ py: 0, px: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <Checkbox
                          edge="start"
                          size="small"
                          checked={filters.statuses.includes(s.id)}
                          tabIndex={-1}
                          disableRipple
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={t(s.labelKey)}
                        primaryTypographyProps={{ fontSize: 12 }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Tool name */}
              <SectionHeader
                label={t("auditLog.filters.sectionTool")}
                expanded={expandedSections.tool}
                onToggle={() => toggleSection("tool")}
              />
              <Collapse in={expandedSections.tool}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("auditLog.filters.toolPlaceholder")}
                  value={filters.toolName}
                  onChange={(e) => setField("toolName", e.target.value)}
                  sx={{ my: 0.5, "& input": { fontSize: 12, height: 16 } }}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Date range */}
              <SectionHeader
                label={t("auditLog.filters.sectionDate")}
                expanded={expandedSections.date}
                onToggle={() => toggleSection("date")}
              />
              <Collapse in={expandedSections.date}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, my: 0.5 }}>
                  <TextField
                    size="small"
                    type="date"
                    label={t("auditLog.filters.dateFrom")}
                    value={filters.dateFrom}
                    onChange={(e) => setField("dateFrom", e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label={t("auditLog.filters.dateTo")}
                    value={filters.dateTo}
                    onChange={(e) => setField("dateTo", e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Box>
              </Collapse>
            </>
          ) : (
            /* ─────── Columns tab ─────── */
            <Box>
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
                  {t("auditLog.filters.columnsHint")}
                </Typography>
                {columnsChanged && onResetColumns && (
                  <Button
                    size="small"
                    onClick={onResetColumns}
                    sx={{ textTransform: "none", fontSize: 12 }}
                  >
                    {t("auditLog.filters.reset")}
                  </Button>
                )}
              </Box>
              <List dense disablePadding sx={{ mb: 1 }}>
                {AUDIT_GRID_COLUMNS.map((c) => {
                  const locked = LOCKED_AUDIT_COLUMNS.has(c.id);
                  return (
                    <ListItemButton
                      key={c.id}
                      dense
                      disabled={locked}
                      onClick={() => toggleColumn(c.id)}
                      sx={{ py: 0.25, px: 1, borderRadius: 1 }}
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
                      <ListItemText
                        primary={t(c.labelKey)}
                        primaryTypographyProps={{
                          fontSize: 13,
                          ml: 0.75,
                          noWrap: true,
                        }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          )}
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
