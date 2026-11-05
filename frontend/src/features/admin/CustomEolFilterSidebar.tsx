/**
 * Left-hand filter panel of the custom EOL products grid (Settings → EOL).
 * Same anatomy as `ResourcesFilterSidebar` / the Inventory sidebar
 * (`frontend/UI_GUIDELINES.md` § 3.11): a 44px rail when collapsed with an
 * active-filter count, tabbed Filters / Columns with a change dot,
 * collapsible sections each with an icon and a count, a resize handle.
 *
 * Every filter narrows rows the client already holds, so nothing here is
 * debounced. Fully controlled: the grid owns the state and its persistence.
 */
import { useMemo, useState } from "react";
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
import type { SxProps, Theme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColumnFreezeToggle from "@/components/grid/ColumnFreezeToggle";
import ColumnOrderSection, { type ColumnOrderItem } from "@/components/grid/ColumnOrderSection";
import { EOL_STATUS_COLORS, EOL_STATUS_LABEL_KEYS, EOL_STATUSES } from "@/lib/eol";
import { STATUS_COLORS } from "@/theme/tokens";

export type UsageFilter = "any" | "linked" | "unused";

export interface CustomEolFilters {
  search: string;
  /** Products whose worst cycle status (the row's chip) is one of these. */
  statuses: string[];
  usage: UsageFilter;
}

export const EMPTY_CUSTOM_EOL_FILTERS: CustomEolFilters = {
  search: "",
  statuses: [],
  usage: "any",
};

export interface CustomEolColumn {
  id: string;
  labelKey: string;
  icon: string;
}

/** Every column of the grid, in default order. Labels are in `admin`. */
export const CUSTOM_EOL_COLUMNS: CustomEolColumn[] = [
  { id: "product", labelKey: "eol.custom.columns.product", icon: "inventory_2" },
  { id: "cycles", labelKey: "eol.custom.columns.cycles", icon: "tag" },
  { id: "latestCycle", labelKey: "eol.custom.columns.latestCycle", icon: "new_releases" },
  { id: "latest", labelKey: "eol.custom.columns.latest", icon: "verified" },
  { id: "status", labelKey: "eol.custom.columns.status", icon: "traffic" },
  { id: "linked", labelKey: "eol.custom.columns.linked", icon: "link" },
  { id: "updated", labelKey: "eol.custom.columns.updated", icon: "schedule" },
  { id: "description", labelKey: "eol.custom.columns.description", icon: "notes" },
  { id: "link", labelKey: "eol.custom.columns.link", icon: "open_in_new" },
];

/** The column that names the row cannot be hidden. */
export const LOCKED_CUSTOM_EOL_COLUMNS = new Set(["product"]);

/** Long text, shown on request; the panel has it in full. */
const HIDDEN_BY_DEFAULT = new Set(["description", "link"]);

/** The columns a first visit shows, and what Reset brings back. */
export const DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS = CUSTOM_EOL_COLUMNS.map((c) => c.id).filter(
  (id) => !HIDDEN_BY_DEFAULT.has(id),
);

/** True when `visible` is anything but the default column set. */
export function columnsDifferFromDefault(visible: Set<string>): boolean {
  return (
    visible.size !== DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS.length ||
    DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS.some((id) => !visible.has(id))
  );
}

const USAGE_OPTIONS: { id: UsageFilter; labelKey: string; color: string }[] = [
  { id: "any", labelKey: "eol.custom.filters.usageAny", color: STATUS_COLORS.info },
  { id: "linked", labelKey: "eol.custom.filters.usageLinked", color: STATUS_COLORS.success },
  { id: "unused", labelKey: "eol.custom.filters.usageUnused", color: STATUS_COLORS.neutral },
];

/** The sidebar's resize bounds; stored prefs are clamped to them too. */
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

// Stryker disable all: layout, spacing and colour are presentation; jsdom lays nothing out
const SX = {
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 0.75,
    py: 0.5,
    px: 0.5,
    cursor: "pointer",
    borderRadius: 1,
    userSelect: "none",
    "&:hover": { bgcolor: "action.hover" },
  },
  sectionLabel: { flex: 1 },
  countChip: { height: 18, fontSize: 11 },
  changeDot: { width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main", flexShrink: 0 },
  rail: {
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
  },
  railChip: { mt: 1, fontSize: 11, height: 20, minWidth: 20 },
  root: { display: "flex", height: "100%" },
  panel: {
    border: 1,
    borderColor: "divider",
    borderRadius: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    bgcolor: "action.hover",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    px: 1.5,
    py: 0.5,
    borderBottom: 1,
    borderColor: "divider",
  },
  tabs: {
    minHeight: 36,
    "& .MuiTab-root": { minHeight: 36, py: 0, textTransform: "none", fontSize: 14, minWidth: 0 },
  },
  tabLabel: { display: "flex", alignItems: "center", gap: 0.5 },
  body: { flex: 1, overflowY: "auto", px: 1.5, py: 1 },
  clearButton: { mb: 1, textTransform: "none", fontSize: 12 },
  searchField: { my: 0.5 },
  divider: { my: 1 },
  row: { py: 0.25, px: 1, borderRadius: 1 },
  lockedRow: { py: 0.25, px: 1, borderRadius: 1, "&.Mui-disabled": { opacity: 0.7 } },
  checkboxCell: { minWidth: 28 },
  iconCell: { minWidth: 24 },
  checkbox: { p: 0 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 0.5, my: 0.5, px: 0.5 },
  columnsCaption: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    mb: 1,
    px: 0.5,
  },
  resetButton: { textTransform: "none", fontSize: 12, minWidth: 0, px: 1 },
  columnList: { mb: 1 },
  columnRow: { display: "flex", alignItems: "center" },
  columnRowMain: { flex: 1, minWidth: 0 },
  resizeHandle: {
    width: 4,
    cursor: "col-resize",
    "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
  },
} satisfies Record<string, SxProps<Theme>>;
const COLUMN_TEXT_PROPS = { fontSize: 13, noWrap: true };
// Stryker restore all

export function activeFilterCount(f: CustomEolFilters): number {
  return (f.search.trim() ? 1 : 0) + f.statuses.length + (f.usage !== "any" ? 1 : 0);
}

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
    <Box onClick={onToggle} sx={SX.sectionHeader}>
      <MaterialSymbol icon={expanded ? "expand_more" : "chevron_right"} size={16} />
      <MaterialSymbol icon={icon} size={16} />
      <Typography variant="body2" fontWeight={600} fontSize={13} sx={SX.sectionLabel}>
        {label}
      </Typography>
      {count != null && count > 0 && (
        <Chip label={count} size="small" color="primary" sx={SX.countChip} />
      )}
    </Box>
  );
}

function ChangeDot() {
  return <Box data-testid="change-dot" sx={SX.changeDot} />;
}

interface Props {
  filters: CustomEolFilters;
  onFiltersChange: (f: CustomEolFilters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  visibleColumns: Set<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  frozenColumns: Set<string>;
  onToggleFrozen: (colId: string) => void;
  columnOrderItems: ColumnOrderItem[];
  columnOrder: string[];
  onColumnOrderChange: (next: string[]) => void;
  onResetColumnOrder?: () => void;
}

export default function CustomEolFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  visibleColumns,
  onVisibleColumnsChange,
  frozenColumns,
  onToggleFrozen,
  columnOrderItems,
  columnOrder,
  onColumnOrderChange,
  onResetColumnOrder,
}: Props) {
  const { t } = useTranslation(["admin", "reports"]);
  const [tab, setTab] = useState<0 | 1>(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    search: true,
    status: true,
    usage: false,
  });
  const toggleSection = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));
  const activeCount = useMemo(() => activeFilterCount(filters), [filters]);
  const allColumnIds = useMemo(() => CUSTOM_EOL_COLUMNS.map((c) => c.id), []);
  const columnsChanged = columnsDifferFromDefault(visibleColumns);

  const toggleIn = (key: "statuses", value: string) => {
    const current = filters[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [key]: next });
  };

  const toggleColumn = (id: string) => {
    if (LOCKED_CUSTOM_EOL_COLUMNS.has(id)) return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onVisibleColumnsChange(next);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) =>
      onWidthChange(
        Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX))),
      );
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (collapsed) {
    return (
      <Box sx={SX.rail}>
        <Tooltip title={t("eol.custom.filters.expand")} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={SX.railChip}
          />
        )}
      </Box>
    );
  }

  return (
    <Box sx={SX.root}>
      <Box sx={[SX.panel, { width }]}>
        <Box sx={SX.header}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v as 0 | 1)}
            sx={SX.tabs}
          >
            <Tab
              label={
                <Box sx={SX.tabLabel}>
                  {t("eol.custom.filters.tabFilters")}
                  {activeCount > 0 && <ChangeDot />}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={SX.tabLabel}>
                  {t("eol.custom.filters.tabColumns")}
                  {columnsChanged && <ChangeDot />}
                </Box>
              }
            />
          </Tabs>
          <IconButton
            size="small"
            onClick={onToggleCollapse}
            aria-label={t("eol.custom.filters.collapse")}
          >
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        <Box sx={SX.body}>
          {tab === 0 ? (
            <>
              {activeCount > 0 && (
                <Button
                  size="small"
                  onClick={() => onFiltersChange({ ...EMPTY_CUSTOM_EOL_FILTERS })}
                  startIcon={<MaterialSymbol icon="filter_alt_off" size={16} />}
                  sx={SX.clearButton}
                >
                  {t("eol.custom.filters.clear")}
                </Button>
              )}

              <SectionHeader
                label={t("eol.custom.filters.sectionSearch")}
                icon="search"
                expanded={expanded.search}
                onToggle={() => toggleSection("search")}
                count={filters.search.trim() ? 1 : 0}
              />
              <Collapse in={expanded.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("eol.custom.filters.searchPlaceholder")}
                  value={filters.search}
                  onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                  sx={SX.searchField}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <MaterialSymbol icon="search" size={16} />
                      </InputAdornment>
                    ),
                    endAdornment: filters.search ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label={t("eol.custom.filters.clearSearch")}
                          onClick={() => onFiltersChange({ ...filters, search: "" })}
                        >
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  }}
                />
              </Collapse>

              <Divider sx={SX.divider} />

              <SectionHeader
                label={t("eol.custom.filters.sectionStatus")}
                icon="traffic"
                expanded={expanded.status}
                onToggle={() => toggleSection("status")}
                count={filters.statuses.length}
              />
              <Collapse in={expanded.status}>
                <Box sx={SX.chipRow}>
                  {EOL_STATUSES.map((s) => {
                    const selected = filters.statuses.includes(s);
                    const color = EOL_STATUS_COLORS[s];
                    return (
                      <Chip
                        key={s}
                        size="small"
                        label={t(`reports:${EOL_STATUS_LABEL_KEYS[s]}`)}
                        variant={selected ? "filled" : "outlined"}
                        onClick={() => toggleIn("statuses", s)}
                        sx={
                          selected
                            ? { bgcolor: color, color: "common.white", borderColor: color }
                            : { borderColor: color, color }
                        }
                      />
                    );
                  })}
                </Box>
              </Collapse>

              <Divider sx={SX.divider} />

              <SectionHeader
                label={t("eol.custom.filters.sectionUsage")}
                icon="link"
                expanded={expanded.usage}
                onToggle={() => toggleSection("usage")}
                count={filters.usage !== "any" ? 1 : 0}
              />
              <Collapse in={expanded.usage}>
                <Box sx={SX.chipRow}>
                  {USAGE_OPTIONS.map((o) => {
                    const selected = filters.usage === o.id;
                    return (
                      <Chip
                        key={o.id}
                        size="small"
                        label={t(o.labelKey)}
                        variant={selected ? "filled" : "outlined"}
                        onClick={() => onFiltersChange({ ...filters, usage: o.id })}
                        sx={
                          selected
                            ? { bgcolor: o.color, color: "common.white", borderColor: o.color }
                            : { borderColor: o.color, color: o.color }
                        }
                      />
                    );
                  })}
                </Box>
              </Collapse>
            </>
          ) : (
            <Box>
              <ColumnOrderSection
                items={columnOrderItems}
                order={columnOrder}
                frozen={frozenColumns}
                onToggleFrozen={onToggleFrozen}
                onReorder={onColumnOrderChange}
                onReset={onResetColumnOrder}
              />
              <Box sx={SX.columnsCaption}>
                <Typography variant="caption" color="text.secondary">
                  {t("eol.custom.filters.selectedCount", { count: visibleColumns.size })}
                </Typography>
                {columnsChanged && (
                  <Button
                    size="small"
                    onClick={() => onVisibleColumnsChange(new Set(DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS))}
                    startIcon={<MaterialSymbol icon="restart_alt" size={14} />}
                    sx={SX.resetButton}
                  >
                    {t("eol.custom.filters.reset")}
                  </Button>
                )}
              </Box>
              <SectionHeader
                label={t("eol.custom.filters.columnsHint")}
                icon="grid_view"
                expanded
                onToggle={() => {}}
                count={visibleColumns.size}
              />
              <List dense disablePadding sx={SX.columnList}>
                <ListItemButton
                  dense
                  onClick={() => onVisibleColumnsChange(new Set(allColumnIds))}
                  disabled={visibleColumns.size === CUSTOM_EOL_COLUMNS.length}
                  sx={SX.row}
                >
                  <ListItemIcon sx={SX.checkboxCell}>
                    <Checkbox
                      size="small"
                      checked={visibleColumns.size === CUSTOM_EOL_COLUMNS.length}
                      indeterminate={
                        visibleColumns.size > LOCKED_CUSTOM_EOL_COLUMNS.size &&
                        visibleColumns.size < CUSTOM_EOL_COLUMNS.length
                      }
                      disableRipple
                      sx={SX.checkbox}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        fontSize={13}
                        fontWeight={500}
                        fontStyle="italic"
                      >
                        {t("eol.custom.filters.selectAll")}
                      </Typography>
                    }
                  />
                </ListItemButton>
                {CUSTOM_EOL_COLUMNS.map((c) => {
                  const locked = LOCKED_CUSTOM_EOL_COLUMNS.has(c.id);
                  const row = (
                    <ListItemButton
                      dense
                      disabled={locked}
                      onClick={() => toggleColumn(c.id)}
                      sx={locked ? SX.lockedRow : SX.row}
                    >
                      <ListItemIcon sx={SX.checkboxCell}>
                        <Checkbox
                          size="small"
                          checked={visibleColumns.has(c.id)}
                          disabled={locked}
                          disableRipple
                          sx={SX.checkbox}
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={SX.iconCell}>
                        <MaterialSymbol icon={c.icon} size={16} />
                      </ListItemIcon>
                      <ListItemText
                        primary={t(c.labelKey)}
                        primaryTypographyProps={COLUMN_TEXT_PROPS}
                      />
                    </ListItemButton>
                  );
                  // The pin is a sibling of the row button: a locked row's
                  // disabled button would swallow its click.
                  return (
                    <Box key={c.id} sx={SX.columnRow}>
                      <Box sx={SX.columnRowMain}>
                        {locked ? (
                          <Tooltip title={t("eol.custom.filters.alwaysVisible")} placement="right">
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
      <Box data-testid="resize-handle" onMouseDown={handleResizeMouseDown} sx={SX.resizeHandle} />
    </Box>
  );
}
