/**
 * ResourcesFilterSidebar — left-hand collapsible filter panel for the
 * repository-wide Resources admin grid. Structurally mirrors
 * `AuditLogFilterSidebar` / `RiskFilterSidebar`: tabbed Filters / Columns
 * header, collapsible sections, drag resize handle.
 *
 * Unlike the audit log, **every** filter here maps to a query param on
 * `GET /resources` — under server-side pagination a client-side filter
 * would only narrow the current page, not the result set.
 *
 * The component is fully controlled: option lists (card types, categories,
 * creators) come in as props so the sidebar never fetches anything itself.
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
import MenuItem from "@mui/material/MenuItem";
import InputAdornment from "@mui/material/InputAdornment";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { DateField } from "@/components/DateField";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColumnFreezeToggle from "@/components/grid/ColumnFreezeToggle";
import { LAYER_COLORS, STATUS_COLORS } from "@/theme";
import type { ResourceKind } from "@/types";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type ArchivedFilter = "any" | "active" | "archived";

export interface ResourceFilters {
  search: string;
  kinds: ResourceKind[];
  cardTypes: string[];
  categories: string[];
  mimeTypes: string[];
  createdBy: string;
  card: CardOption | null;
  archived: ArchivedFilter;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_RESOURCE_FILTERS: ResourceFilters = {
  search: "",
  kinds: [],
  cardTypes: [],
  categories: [],
  mimeTypes: [],
  createdBy: "",
  card: null,
  archived: "any",
  dateFrom: "",
  dateTo: "",
};

/** Kind icon + hue, shared with the grid's Kind chip so the two agree. */
export const RESOURCE_KIND_META: Record<ResourceKind, { icon: string; color: string }> = {
  file: { icon: "attach_file", color: LAYER_COLORS["Application & Data"] },
  link: { icon: "link", color: LAYER_COLORS["Technical Architecture"] },
};

const KINDS: { id: ResourceKind; labelKey: string }[] = [
  { id: "file", labelKey: "resources.kinds.file" },
  { id: "link", labelKey: "resources.kinds.link" },
];

/**
 * Mirrors `ALLOWED_MIME_TYPES` in `backend/app/api/v1/file_attachments.py`
 * — the only MIME types an attachment can ever carry. Icons match the ones
 * the per-card Resources tab uses for the same types.
 */
export const RESOURCE_MIME_TYPES: { id: string; labelKey: string; icon: string }[] = [
  { id: "application/pdf", labelKey: "resources.mime.pdf", icon: "picture_as_pdf" },
  {
    id: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    labelKey: "resources.mime.docx",
    icon: "description",
  },
  {
    id: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    labelKey: "resources.mime.xlsx",
    icon: "table_chart",
  },
  {
    id: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    labelKey: "resources.mime.pptx",
    icon: "slideshow",
  },
  { id: "image/png", labelKey: "resources.mime.png", icon: "image" },
  { id: "image/jpeg", labelKey: "resources.mime.jpeg", icon: "image" },
  { id: "image/svg+xml", labelKey: "resources.mime.svg", icon: "image" },
  { id: "text/plain", labelKey: "resources.mime.txt", icon: "description" },
];

/** Tri-state archived filter, rendered as coloured chips like approval status. */
const ARCHIVED_OPTIONS: { id: ArchivedFilter; labelKey: string; color: string }[] = [
  { id: "any", labelKey: "resources.filters.archivedAny", color: STATUS_COLORS.info },
  { id: "active", labelKey: "resources.filters.archivedActive", color: STATUS_COLORS.success },
  { id: "archived", labelKey: "resources.filters.archivedOnly", color: STATUS_COLORS.neutral },
];

export interface ResourceColumn {
  id: string;
  labelKey: string;
  /** Per-column glyph, mirroring the inventory column picker. */
  icon: string;
}

export const RESOURCE_GRID_COLUMNS: ResourceColumn[] = [
  { id: "kind", labelKey: "resources.columns.kind", icon: "category" },
  { id: "name", labelKey: "resources.columns.name", icon: "label" },
  { id: "card_name", labelKey: "resources.columns.card", icon: "dashboard" },
  { id: "card_type", labelKey: "resources.columns.cardType", icon: "category" },
  { id: "category", labelKey: "resources.columns.category", icon: "sell" },
  { id: "mime_type", labelKey: "resources.columns.mimeType", icon: "description" },
  { id: "size", labelKey: "resources.columns.size", icon: "database" },
  { id: "url", labelKey: "resources.columns.url", icon: "link" },
  { id: "creator_name", labelKey: "resources.columns.creator", icon: "person" },
  { id: "created_at", labelKey: "resources.columns.created", icon: "schedule" },
  { id: "actions", labelKey: "resources.columns.actions", icon: "more_horiz" },
];

/** Columns that always render — they anchor each row. */
export const LOCKED_RESOURCE_COLUMNS = new Set(["kind", "name", "card_name", "actions"]);

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

/** A selectable option in the card-type / category / creator lists.
 *
 * `icon` / `color` follow the inventory sidebar's card-type rows: the entity's
 * own metamodel glyph in its own colour, so the sidebar reads the same as the
 * grid and the rest of the app. */
export interface FilterOption {
  id: string;
  label: string;
  icon?: string | null;
  color?: string | null;
}

interface Props {
  filters: ResourceFilters;
  onFiltersChange: (f: ResourceFilters) => void;
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
  cardTypeOptions: FilterOption[];
  categoryOptions: FilterOption[];
  creatorOptions: FilterOption[];
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Section header — chevron, section glyph, bold label, and a primary count
 * chip when the section has active selections. Same shape as the inventory
 * sidebar's `SectionHeader` (see `frontend/UI_GUIDELINES.md` § 3.11).
 */
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
        <Chip label={count} size="small" color="primary" sx={{ height: 18, fontSize: 11 }} />
      )}
    </Box>
  );
}

/** Checkbox row list with the option's own glyph, as the inventory card-type
 *  and column lists do. Options with no icon fall back to a coloured dot when
 *  they carry a colour, and to nothing at all when they carry neither. */
function CheckboxList({
  options,
  selected,
  onToggle,
}: {
  options: FilterOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <List dense disablePadding sx={{ mb: 1, maxHeight: 240, overflowY: "auto" }}>
      {options.map((o) => (
        <ListItemButton
          key={o.id}
          dense
          onClick={() => onToggle(o.id)}
          sx={{ py: 0.25, px: 1, borderRadius: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Checkbox
              size="small"
              checked={selected.includes(o.id)}
              tabIndex={-1}
              disableRipple
              sx={{ p: 0 }}
            />
          </ListItemIcon>
          {o.icon ? (
            <MaterialSymbol icon={o.icon} size={16} color={o.color ?? undefined} />
          ) : o.color ? (
            <Box
              sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: o.color, ml: 0.375 }}
            />
          ) : null}
          <ListItemText
            primary={o.label}
            primaryTypographyProps={{
              fontSize: 13,
              ml: o.icon || o.color ? 0.75 : 0,
              noWrap: true,
            }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export default function ResourcesFilterSidebar({
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
  onResetColumns,
  cardTypeOptions,
  categoryOptions,
  creatorOptions,
}: Props) {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState<0 | 1>(0);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    search: true,
    kind: true,
    cardType: true,
    category: false,
    mime: false,
    card: false,
    creator: false,
    archived: false,
    date: false,
  });

  const allColumnIds = useMemo(() => RESOURCE_GRID_COLUMNS.map((c) => c.id), []);
  const columnsChanged = visibleColumns.size < RESOURCE_GRID_COLUMNS.length;

  const toggleColumn = (id: string) => {
    if (LOCKED_RESOURCE_COLUMNS.has(id)) return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onVisibleColumnsChange(next);
  };

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleInList = useCallback(
    (key: "kinds" | "cardTypes" | "categories" | "mimeTypes", value: string) => {
      const current = filters[key] as string[];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      onFiltersChange({ ...filters, [key]: next } as ResourceFilters);
    },
    [filters, onFiltersChange],
  );

  const setField = useCallback(
    <K extends keyof ResourceFilters>(key: K, value: ResourceFilters[K]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange],
  );

  const clearAll = () => onFiltersChange({ ...EMPTY_RESOURCE_FILTERS });

  const activeCount = useMemo(
    () =>
      (filters.search.trim() ? 1 : 0) +
      filters.kinds.length +
      filters.cardTypes.length +
      filters.categories.length +
      filters.mimeTypes.length +
      (filters.createdBy ? 1 : 0) +
      (filters.card ? 1 : 0) +
      (filters.archived !== "any" ? 1 : 0) +
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
        <Tooltip title={t("resources.filters.expand")} placement="right">
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
        {/* Tabbed header (Filters / Columns) */}
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
                  {t("resources.filters.tabFilters")}
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
                  {t("resources.filters.tabColumns")}
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
                  {t("resources.filters.clear")}
                </Button>
              )}

              {/* Search */}
              <SectionHeader
                label={t("resources.filters.sectionSearch")}
                icon="search"
                expanded={expandedSections.search}
                onToggle={() => toggleSection("search")}
                count={filters.search.trim() ? 1 : 0}
              />
              <Collapse in={expandedSections.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("resources.filters.searchPlaceholder")}
                  value={filters.search}
                  onChange={(e) => setField("search", e.target.value)}
                  sx={{ my: 0.5 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <MaterialSymbol icon="search" size={16} />
                      </InputAdornment>
                    ),
                    ...(filters.search
                      ? {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                size="small"
                                onClick={() => setField("search", "")}
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
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Kind */}
              <SectionHeader
                label={t("resources.filters.sectionKind")}
                icon="folder_open"
                expanded={expandedSections.kind}
                onToggle={() => toggleSection("kind")}
                count={filters.kinds.length}
              />
              <Collapse in={expandedSections.kind}>
                <CheckboxList
                  options={KINDS.map((k) => ({
                    id: k.id,
                    label: t(k.labelKey),
                    icon: RESOURCE_KIND_META[k.id].icon,
                    color: RESOURCE_KIND_META[k.id].color,
                  }))}
                  selected={filters.kinds}
                  onToggle={(id) => toggleInList("kinds", id)}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Card type */}
              <SectionHeader
                label={t("resources.filters.sectionCardType")}
                icon="category"
                expanded={expandedSections.cardType}
                onToggle={() => toggleSection("cardType")}
                count={filters.cardTypes.length}
              />
              <Collapse in={expandedSections.cardType}>
                <CheckboxList
                  options={cardTypeOptions}
                  selected={filters.cardTypes}
                  onToggle={(id) => toggleInList("cardTypes", id)}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Category / link type */}
              <SectionHeader
                label={t("resources.filters.sectionCategory")}
                icon="sell"
                expanded={expandedSections.category}
                onToggle={() => toggleSection("category")}
                count={filters.categories.length}
              />
              <Collapse in={expandedSections.category}>
                <CheckboxList
                  options={categoryOptions}
                  selected={filters.categories}
                  onToggle={(id) => toggleInList("categories", id)}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* File type */}
              <SectionHeader
                label={t("resources.filters.sectionMime")}
                icon="description"
                expanded={expandedSections.mime}
                onToggle={() => toggleSection("mime")}
                count={filters.mimeTypes.length}
              />
              <Collapse in={expandedSections.mime}>
                <CheckboxList
                  options={RESOURCE_MIME_TYPES.map((m) => ({
                    id: m.id,
                    label: t(m.labelKey),
                    icon: m.icon,
                    color: RESOURCE_KIND_META.file.color,
                  }))}
                  selected={filters.mimeTypes}
                  onToggle={(id) => toggleInList("mimeTypes", id)}
                />
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Card */}
              <SectionHeader
                label={t("resources.filters.sectionCard")}
                icon="dashboard"
                expanded={expandedSections.card}
                onToggle={() => toggleSection("card")}
                count={filters.card ? 1 : 0}
              />
              <Collapse in={expandedSections.card} onEntered={() => setCardPickerOpen(true)}>
                <Box sx={{ my: 0.5 }}>
                  <CardPicker
                    value={filters.card}
                    onChange={(v) => setField("card", v)}
                    enabled={cardPickerOpen || expandedSections.card}
                    label={t("resources.filters.cardPlaceholder")}
                    size="small"
                    fullWidth
                  />
                </Box>
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Created by */}
              <SectionHeader
                label={t("resources.filters.sectionCreator")}
                icon="person"
                expanded={expandedSections.creator}
                onToggle={() => toggleSection("creator")}
                count={filters.createdBy ? 1 : 0}
              />
              <Collapse in={expandedSections.creator}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  value={filters.createdBy}
                  onChange={(e) => setField("createdBy", e.target.value)}
                  sx={{ my: 0.5 }}
                  SelectProps={{ displayEmpty: true }}
                >
                  <MenuItem value="">{t("resources.filters.anyCreator")}</MenuItem>
                  {creatorOptions.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Archived — coloured selectable chips, like the inventory's
                  approval-status and lifecycle sections. */}
              <SectionHeader
                label={t("resources.filters.sectionArchived")}
                icon="inventory_2"
                expanded={expandedSections.archived}
                onToggle={() => toggleSection("archived")}
                count={filters.archived !== "any" ? 1 : 0}
              />
              <Collapse in={expandedSections.archived}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, my: 0.5, px: 0.5 }}>
                  {ARCHIVED_OPTIONS.map((o) => {
                    const selected = filters.archived === o.id;
                    return (
                      <Chip
                        key={o.id}
                        size="small"
                        label={t(o.labelKey)}
                        variant={selected ? "filled" : "outlined"}
                        onClick={() => setField("archived", o.id)}
                        sx={
                          selected
                            ? { bgcolor: o.color, color: "#fff", borderColor: o.color }
                            : { borderColor: o.color, color: o.color }
                        }
                      />
                    );
                  })}
                </Box>
              </Collapse>

              <Divider sx={{ my: 1 }} />

              {/* Date range */}
              <SectionHeader
                label={t("resources.filters.sectionDate")}
                icon="schedule"
                expanded={expandedSections.date}
                onToggle={() => toggleSection("date")}
                count={(filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0)}
              />
              <Collapse in={expandedSections.date}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, my: 0.5 }}>
                  <DateField
                    size="small"
                    label={t("resources.filters.dateFrom")}
                    value={filters.dateFrom}
                    onChange={(v) => setField("dateFrom", v)}
                  />
                  <DateField
                    size="small"
                    label={t("resources.filters.dateTo")}
                    value={filters.dateTo}
                    onChange={(v) => setField("dateTo", v)}
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
                  {t("resources.filters.selectedCount", { count: visibleColumns.size })}
                </Typography>
                {columnsChanged && onResetColumns && (
                  <Button
                    size="small"
                    onClick={onResetColumns}
                    startIcon={<MaterialSymbol icon="restart_alt" size={14} />}
                    sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1 }}
                  >
                    {t("resources.filters.reset")}
                  </Button>
                )}
              </Box>
              <SectionHeader
                label={t("resources.filters.columnsHint")}
                icon="grid_view"
                expanded
                onToggle={() => {}}
                count={visibleColumns.size}
              />
              <List dense disablePadding sx={{ mb: 1 }}>
                <ListItemButton
                  dense
                  onClick={() => onVisibleColumnsChange(new Set(allColumnIds))}
                  disabled={visibleColumns.size === RESOURCE_GRID_COLUMNS.length}
                  sx={{ py: 0.25, px: 1, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox
                      size="small"
                      checked={visibleColumns.size === RESOURCE_GRID_COLUMNS.length}
                      indeterminate={
                        visibleColumns.size > LOCKED_RESOURCE_COLUMNS.size &&
                        visibleColumns.size < RESOURCE_GRID_COLUMNS.length
                      }
                      disableRipple
                      sx={{ p: 0 }}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body2" fontSize={13} fontWeight={500} fontStyle="italic">
                        {t("resources.filters.selectAll")}
                      </Typography>
                    }
                  />
                </ListItemButton>
                {RESOURCE_GRID_COLUMNS.map((c) => {
                  const locked = LOCKED_RESOURCE_COLUMNS.has(c.id);
                  const row = (
                    <ListItemButton
                      dense
                      disabled={locked}
                      onClick={() => toggleColumn(c.id)}
                      sx={{
                        py: 0.25,
                        px: 1,
                        borderRadius: 1,
                        // Keep locked rows readable while still signalling
                        // that they can't be toggled (same as the inventory).
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
                          <Tooltip
                            title={t("resources.filters.alwaysVisible")}
                            placement="right"
                          >
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
