/**
 * Left-hand filter panel of an initiative's risk grid (Risk Management tab).
 * Same anatomy as the Inventory sidebar (`frontend/UI_GUIDELINES.md` § 3.11):
 * a 44px rail when collapsed with an active-filter count, tabbed Filters /
 * Columns with a change dot, collapsible sections each with an icon and a
 * count, a resize handle.
 *
 * Every filter narrows risks the tab already holds, so nothing here is
 * debounced. Fully controlled: the grid owns the state and its persistence,
 * and the owner options are handed in.
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
import {
  DEFAULT_VISIBLE_RISK_COLUMNS,
  EMPTY_RISK_FILTERS,
  LOCKED_RISK_COLUMNS,
  NO_OWNER,
  RISK_GRID_COLUMNS,
  RISK_GRID_COLUMN_IDS,
  RISK_SCORE_BANDS,
  RISK_STATUSES,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  activeRiskFilterCount,
  bandColor,
  riskColumnsDifferFromDefault,
  riskStatusLabel,
  riskStatusPaletteColor,
  scoreBandLabel,
  type PpmRiskFilters,
  type RiskOwnerOption,
} from "./ppmRiskModel";

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
    alignSelf: "stretch",
  },
  railChip: { mt: 1, fontSize: 11, height: 20, minWidth: 20 },
  root: { display: "flex", alignSelf: "stretch", flexGrow: 1 },
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
const ROW_TEXT_PROPS = { fontSize: 13, noWrap: true };
const EMPTY_TEXT_PROPS = { fontSize: 13, noWrap: true, fontStyle: "italic", color: "text.secondary" };
// Stryker restore all

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
  count: number;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={SX.sectionHeader}
      role="button"
      aria-expanded={expanded}
      data-section-icon={icon}
    >
      <MaterialSymbol icon={expanded ? "expand_more" : "chevron_right"} size={16} />
      <MaterialSymbol icon={icon} size={16} />
      <Typography variant="body2" fontWeight={600} fontSize={13} sx={SX.sectionLabel}>
        {label}
      </Typography>
      {count > 0 && (
        <Chip label={count} size="small" color="primary" sx={SX.countChip} data-testid="section-count" />
      )}
    </Box>
  );
}

function ChangeDot() {
  return <Box data-testid="change-dot" sx={SX.changeDot} />;
}

/** A selectable chip: filled in its colour when on, outlined in it when off. */
function StateChip({
  label,
  color,
  selected,
  onClick,
}: {
  label: string;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Chip
      size="small"
      label={label}
      variant={selected ? "filled" : "outlined"}
      aria-pressed={selected}
      onClick={onClick}
      sx={
        selected
          ? { bgcolor: color, color: "common.white", borderColor: color }
          : { borderColor: color, color }
      }
    />
  );
}

interface Props {
  filters: PpmRiskFilters;
  onFiltersChange: (f: PpmRiskFilters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  /** The owners present in the risks (`riskOwnerOptions`). */
  owners: RiskOwnerOption[];
  visibleColumns: ReadonlySet<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  frozenColumns: ReadonlySet<string>;
  onToggleFrozen: (colId: string) => void;
  columnOrderItems: ColumnOrderItem[];
  columnOrder: string[];
  onColumnOrderChange: (next: string[]) => void;
  onResetColumnOrder?: () => void;
}

export default function PpmRiskFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  owners,
  visibleColumns,
  onVisibleColumnsChange,
  frozenColumns,
  onToggleFrozen,
  columnOrderItems,
  columnOrder,
  onColumnOrderChange,
  onResetColumnOrder,
}: Props) {
  const { t } = useTranslation("ppm");
  const [tab, setTab] = useState<0 | 1>(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    search: true,
    status: true,
    score: true,
    owner: true,
  });
  const toggleSection = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));
  const activeCount = useMemo(() => activeRiskFilterCount(filters), [filters]);
  const columnsChanged = riskColumnsDifferFromDefault(visibleColumns);
  const allColumns = RISK_GRID_COLUMN_IDS.length;

  const toggleIn = <K extends "statuses" | "bands" | "owners">(key: K, value: string) => {
    const current = filters[key] as string[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [key]: next });
  };

  const toggleColumn = (id: string) => {
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
      <Box sx={SX.rail} data-testid="risk-filter-rail">
        <Tooltip title={t("riskGridShowFilters")} placement="right">
          <IconButton size="small" onClick={onToggleCollapse} aria-label={t("riskGridShowFilters")}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip label={activeCount} size="small" color="primary" sx={SX.railChip} />
        )}
      </Box>
    );
  }

  const ownerRow = (id: string, label: string, empty: boolean) => (
    <ListItemButton key={id} dense onClick={() => toggleIn("owners", id)} sx={SX.row}>
      <ListItemIcon sx={SX.checkboxCell}>
        <Checkbox
          size="small"
          checked={filters.owners.includes(id)}
          disableRipple
          sx={SX.checkbox}
          inputProps={{ "aria-label": label }}
        />
      </ListItemIcon>
      <ListItemIcon sx={SX.iconCell}>
        <MaterialSymbol icon={empty ? "person_off" : "person"} size={16} />
      </ListItemIcon>
      <ListItemText primary={label} primaryTypographyProps={empty ? EMPTY_TEXT_PROPS : ROW_TEXT_PROPS} />
    </ListItemButton>
  );

  return (
    <Box sx={SX.root} data-testid="risk-filter-sidebar">
      <Box sx={[SX.panel, { width }]}>
        <Box sx={SX.header}>
          <Tabs value={tab} onChange={(_, v) => setTab(v as 0 | 1)} sx={SX.tabs}>
            <Tab
              label={
                <Box sx={SX.tabLabel}>
                  {t("riskFilterTabFilters")}
                  {activeCount > 0 && <ChangeDot />}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={SX.tabLabel}>
                  {t("riskFilterTabColumns")}
                  {columnsChanged && <ChangeDot />}
                </Box>
              }
            />
          </Tabs>
          <IconButton size="small" onClick={onToggleCollapse} aria-label={t("riskGridHideFilters")}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        <Box sx={SX.body}>
          {tab === 0 ? (
            <>
              {activeCount > 0 && (
                <Button
                  size="small"
                  onClick={() => onFiltersChange({ ...EMPTY_RISK_FILTERS })}
                  startIcon={<MaterialSymbol icon="filter_alt_off" size={16} />}
                  sx={SX.clearButton}
                >
                  {t("riskFilterClearAll")}
                </Button>
              )}

              <SectionHeader
                label={t("riskFilterSectionSearch")}
                icon="search"
                expanded={expanded.search}
                onToggle={() => toggleSection("search")}
                count={filters.search.trim() ? 1 : 0}
              />
              <Collapse in={expanded.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("riskFilterSearchPlaceholder")}
                  value={filters.search}
                  onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                  sx={SX.searchField}
                  slotProps={{
                    htmlInput: { "aria-label": t("riskFilterSectionSearch") },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <MaterialSymbol icon="search" size={16} />
                        </InputAdornment>
                      ),
                      endAdornment: filters.search ? (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            aria-label={t("riskFilterClearSearch")}
                            onClick={() => onFiltersChange({ ...filters, search: "" })}
                          >
                            <MaterialSymbol icon="close" size={16} />
                          </IconButton>
                        </InputAdornment>
                      ) : undefined,
                    },
                  }}
                />
              </Collapse>

              <Divider sx={SX.divider} />

              <SectionHeader
                label={t("riskStatus")}
                icon="traffic"
                expanded={expanded.status}
                onToggle={() => toggleSection("status")}
                count={filters.statuses.length}
              />
              <Collapse in={expanded.status}>
                <Box sx={SX.chipRow}>
                  {RISK_STATUSES.map((s) => (
                    <StateChip
                      key={s}
                      label={riskStatusLabel(s, t)}
                      color={riskStatusPaletteColor(s)}
                      selected={filters.statuses.includes(s)}
                      onClick={() => toggleIn("statuses", s)}
                    />
                  ))}
                </Box>
              </Collapse>

              <Divider sx={SX.divider} />

              <SectionHeader
                label={t("riskScore")}
                icon="speed"
                expanded={expanded.score}
                onToggle={() => toggleSection("score")}
                count={filters.bands.length}
              />
              <Collapse in={expanded.score}>
                <Box sx={SX.chipRow}>
                  {RISK_SCORE_BANDS.map((b) => (
                    <StateChip
                      key={b}
                      label={scoreBandLabel(b, t)}
                      color={bandColor(b)}
                      selected={filters.bands.includes(b)}
                      onClick={() => toggleIn("bands", b)}
                    />
                  ))}
                </Box>
              </Collapse>

              <Divider sx={SX.divider} />

              <SectionHeader
                label={t("riskOwner")}
                icon="person"
                expanded={expanded.owner}
                onToggle={() => toggleSection("owner")}
                count={filters.owners.length}
              />
              <Collapse in={expanded.owner}>
                <List dense disablePadding>
                  {owners.map((o) => ownerRow(o.id, o.name, false))}
                  {ownerRow(NO_OWNER, t("riskFilterNoOwner"), true)}
                </List>
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
                  {t("riskGridColumnsSelected", { count: visibleColumns.size })}
                </Typography>
                {columnsChanged && (
                  <Button
                    size="small"
                    onClick={() => onVisibleColumnsChange(new Set(DEFAULT_VISIBLE_RISK_COLUMNS))}
                    startIcon={<MaterialSymbol icon="restart_alt" size={14} />}
                    sx={SX.resetButton}
                  >
                    {t("common:actions.reset")}
                  </Button>
                )}
              </Box>
              <SectionHeader
                label={t("riskGridColumnsSection")}
                icon="view_column"
                expanded
                onToggle={() => {}}
                count={visibleColumns.size}
              />
              <List dense disablePadding sx={SX.columnList}>
                <ListItemButton
                  dense
                  onClick={() => onVisibleColumnsChange(new Set(RISK_GRID_COLUMN_IDS))}
                  disabled={visibleColumns.size === allColumns}
                  sx={SX.row}
                >
                  <ListItemIcon sx={SX.checkboxCell}>
                    <Checkbox
                      size="small"
                      checked={visibleColumns.size === allColumns}
                      indeterminate={
                        visibleColumns.size > LOCKED_RISK_COLUMNS.size &&
                        visibleColumns.size < allColumns
                      }
                      disableRipple
                      sx={SX.checkbox}
                      inputProps={{ "aria-label": t("riskGridColumnsSelectAll") }}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body2" fontSize={13} fontWeight={500} fontStyle="italic">
                        {t("riskGridColumnsSelectAll")}
                      </Typography>
                    }
                  />
                </ListItemButton>
                {RISK_GRID_COLUMNS.map((c) => {
                  const locked = LOCKED_RISK_COLUMNS.has(c.id);
                  const label = t(c.labelKey);
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
                          inputProps={{ "aria-label": label }}
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={SX.iconCell}>
                        <MaterialSymbol icon={c.icon} size={16} />
                      </ListItemIcon>
                      <ListItemText primary={label} primaryTypographyProps={ROW_TEXT_PROPS} />
                    </ListItemButton>
                  );
                  // The pin is a sibling of the row button: a locked row's
                  // disabled button would swallow its click. The action
                  // column is never frozen, so it carries no pin.
                  return (
                    <Box key={c.id} sx={SX.columnRow} data-column-row={c.id}>
                      <Box sx={SX.columnRowMain}>
                        {locked ? (
                          <Tooltip title={t("riskGridColumnLocked")} placement="right">
                            <span>{row}</span>
                          </Tooltip>
                        ) : (
                          row
                        )}
                      </Box>
                      {c.id !== "actions" && (
                        <ColumnFreezeToggle
                          frozen={frozenColumns.has(c.id)}
                          onToggle={() => onToggleFrozen(c.id)}
                        />
                      )}
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
