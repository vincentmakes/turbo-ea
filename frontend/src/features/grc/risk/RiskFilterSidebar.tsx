/**
 * RiskFilterSidebar — left-hand collapsible filter panel for the Risk
 * Register. Shares its section header + checkbox-list primitives with the
 * Compliance sidebar (``components/FilterSidebarSection``), which itself
 * follows the Inventory sidebar pattern: iconed section headers with a
 * per-section count chip, and dense checkbox rows with a small coloured
 * dot where a value carries a semantic colour — deliberately not chips.
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
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CardOption } from "@/components/CardPicker";
import { DateField } from "@/components/DateField";
import {
  FilterCheckboxList,
  FilterSectionHeader,
} from "@/components/FilterSidebarSection";
import { SEVERITY_COLORS } from "@/theme/tokens";
import type {
  RiskCategory,
  RiskLevel,
  RiskSourceType,
  RiskStatus,
} from "@/types";
import {
  LOCKED_RISK_COLUMNS,
  RISK_GRID_COLUMNS,
} from "./RiskRegisterPage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskFilters {
  search: string;
  statuses: RiskStatus[];
  categories: RiskCategory[];
  levels: RiskLevel[];
  owners: string[]; // user ids
  /** Affected cards. Full options (not just ids) so the chips render
   *  their names without a second round-trip. Any-of semantics. */
  cards: CardOption[];
  /** Affected card types — "risks touching any Application". Any-of. */
  cardTypes: string[];
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
  cards: [],
  cardTypes: [],
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

/** A card offered by the Affected cards filter — pre-resolved by the parent
 *  from the loaded rows (name + type colour), like the ADR sidebar's
 *  `availableLinkedCards`. */
export interface CardFilterOption {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface Props {
  filters: RiskFilters;
  onFiltersChange: (f: RiskFilters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  availableOwners: OwnerOption[];
  /** Card types occurring on the loaded risks' linked cards. */
  availableCardTypes: { key: string; label: string; color: string }[];
  /** Cards linked to at least one loaded risk (narrowed by cardTypes). */
  availableCards: CardFilterOption[];
  visibleColumns: Set<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  /** colIds frozen to the leading edge; the pin on each row toggles one. */
  frozenColumns: Set<string>;
  onToggleFrozen: (colId: string) => void;
  onResetColumns?: () => void;
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
const SOURCES: RiskSourceType[] = ["manual", "compliance"];

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

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
  availableCardTypes,
  availableCards,
  visibleColumns,
  onVisibleColumnsChange,
  frozenColumns,
  onToggleFrozen,
  onResetColumns,
}: Props) {
  const { t } = useTranslation(["grc", "common"]);

  const [tab, setTab] = useState<0 | 1>(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    search: true,
    status: true,
    category: true,
    level: true,
    owner: false,
    cardTypes: false,
    cards: false,
    source: false,
    target: false,
  });
  const [ownerSearch, setOwnerSearch] = useState("");
  const [cardSearch, setCardSearch] = useState("");

  const hiddenColumnCount = RISK_GRID_COLUMNS.length - visibleColumns.size;
  const columnsChanged = hiddenColumnCount > 0;
  const toggleColumn = (id: string) => {
    if (LOCKED_RISK_COLUMNS.has(id)) return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onVisibleColumnsChange(next);
  };

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
      filters.cards.length +
      filters.cardTypes.length +
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

  // ── Affected-cards toggle — stores the full option (id + name + type)
  //    so the active filter chips/labels never need a refetch. ──────
  const toggleCard = useCallback(
    (card: CardFilterOption) => {
      const next = filters.cards.some((c) => c.id === card.id)
        ? filters.cards.filter((c) => c.id !== card.id)
        : [...filters.cards, { id: card.id, name: card.name, type: card.type }];
      onFiltersChange({ ...filters, cards: next });
    },
    [filters, onFiltersChange],
  );

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
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "action.hover",
        }}
      >
        {/* Tabbed header (Filters / Columns) — mirrors Inventory + Compliance. */}
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
                  {t("risks.filter.panelTitle")}
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
                  {t("risks.columns.title")}
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

        {/* Scrollable content */}
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
              {t("risks.filter.clearAll")}
            </Button>
          )}

          {/* Search */}
          <FilterSectionHeader
            label={t("risks.filter.search")}
            icon="search"
            expanded={expandedSections.search}
            onToggle={() => toggleSection("search")}
            count={filters.search.trim() ? 1 : 0}
          />
          <Collapse in={expandedSections.search}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("risks.filter.searchPlaceholder")}
              value={filters.search}
              onChange={(e) => setField("search", e.target.value)}
              sx={{ mb: 1, "& .MuiInputBase-root": { fontSize: 13 } }}
            />
          </Collapse>

          {/* Status */}
          <FilterSectionHeader
            label={t("risks.filter.status")}
            icon="route"
            expanded={expandedSections.status}
            onToggle={() => toggleSection("status")}
            count={filters.statuses.length}
          />
          <Collapse in={expandedSections.status}>
            <FilterCheckboxList
              items={STATUSES.map((s) => ({
                key: s,
                label: t(`risks.status.${s}`),
                checked: filters.statuses.includes(s),
                onToggle: () => toggleInList("statuses", s),
              }))}
            />
          </Collapse>

          {/* Category */}
          <FilterSectionHeader
            label={t("risks.filter.category")}
            icon="label"
            expanded={expandedSections.category}
            onToggle={() => toggleSection("category")}
            count={filters.categories.length}
          />
          <Collapse in={expandedSections.category}>
            <FilterCheckboxList
              items={CATEGORIES.map((c) => ({
                key: c,
                label: t(`risks.category.${c}`),
                checked: filters.categories.includes(c),
                onToggle: () => toggleInList("categories", c),
              }))}
            />
          </Collapse>

          {/* Level — severity colours as dots, same as the Compliance
              sidebar's Severity section. */}
          <FilterSectionHeader
            label={t("risks.filter.level")}
            icon="flag"
            expanded={expandedSections.level}
            onToggle={() => toggleSection("level")}
            count={filters.levels.length}
          />
          <Collapse in={expandedSections.level}>
            <FilterCheckboxList
              items={LEVELS.map((l) => ({
                key: l,
                label: t(`risks.level.${l}`),
                color: SEVERITY_COLORS[l],
                checked: filters.levels.includes(l),
                onToggle: () => toggleInList("levels", l),
              }))}
            />
          </Collapse>

          {/* Owner */}
          <FilterSectionHeader
            label={t("risks.filter.owner")}
            icon="person"
            expanded={expandedSections.owner}
            onToggle={() => toggleSection("owner")}
            count={filters.owners.length}
          />
          <Collapse in={expandedSections.owner}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("risks.filter.ownerSearchPlaceholder")}
              value={ownerSearch}
              onChange={(e) => setOwnerSearch(e.target.value)}
              sx={{ mb: 0.5, "& .MuiInputBase-root": { fontSize: 13 } }}
            />
            {filteredOwners.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 1, py: 0.5, fontSize: 12 }}
              >
                {t("risks.filter.noOwners")}
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
                <FilterCheckboxList
                  items={filteredOwners.map((o) => ({
                    key: o.id,
                    label: o.display_name,
                    secondary: o.email,
                    checked: filters.owners.includes(o.id),
                    onToggle: () => toggleInList("owners", o.id),
                  }))}
                />
              </Box>
            )}
          </Collapse>

          {/* Card type — narrows both the risk list and the Affected cards
              options below. */}
          <FilterSectionHeader
            label={t("risks.filter.cardType")}
            icon="category"
            expanded={expandedSections.cardTypes}
            onToggle={() => toggleSection("cardTypes")}
            count={filters.cardTypes.length}
          />
          <Collapse in={expandedSections.cardTypes}>
            {availableCardTypes.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 1, py: 0.5, fontSize: 12 }}
              >
                {t("risks.filter.noCardTypes")}
              </Typography>
            ) : (
              <FilterCheckboxList
                items={availableCardTypes.map((ct) => ({
                  key: ct.key,
                  label: ct.label,
                  color: ct.color,
                  checked: filters.cardTypes.includes(ct.key),
                  onToggle: () => toggleInList("cardTypes", ct.key),
                }))}
              />
            )}
          </Collapse>

          {/* Affected cards — the cards linked to at least one loaded risk,
              searchable by name. */}
          <FilterSectionHeader
            label={t("risks.filter.cards")}
            icon="style"
            expanded={expandedSections.cards}
            onToggle={() => toggleSection("cards")}
            count={filters.cards.length}
          />
          <Collapse in={expandedSections.cards}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("risks.filter.cardsPlaceholder")}
              value={cardSearch}
              onChange={(e) => setCardSearch(e.target.value)}
              sx={{ mb: 0.5, "& .MuiInputBase-root": { fontSize: 13 } }}
            />
            {availableCards.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 1, py: 0.5, fontSize: 12 }}
              >
                {t("risks.filter.noCards")}
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
                <FilterCheckboxList
                  items={availableCards
                    .filter(
                      (card) =>
                        !cardSearch ||
                        card.name.toLowerCase().includes(cardSearch.toLowerCase()),
                    )
                    .map((card) => ({
                      key: card.id,
                      label: card.name,
                      color: card.color,
                      checked: filters.cards.some((c) => c.id === card.id),
                      onToggle: () => toggleCard(card),
                    }))}
                />
              </Box>
            )}
          </Collapse>

          {/* Source */}
          <FilterSectionHeader
            label={t("risks.filter.source")}
            icon="input"
            expanded={expandedSections.source}
            onToggle={() => toggleSection("source")}
            count={filters.sources.length}
          />
          <Collapse in={expandedSections.source}>
            <FilterCheckboxList
              items={SOURCES.map((s) => ({
                key: s,
                label: t(`risks.source.${s}`),
                checked: filters.sources.includes(s),
                onToggle: () => toggleInList("sources", s),
              }))}
            />
          </Collapse>

          {/* Target date + overdue */}
          <FilterSectionHeader
            label={t("risks.filter.target")}
            icon="event"
            expanded={expandedSections.target}
            onToggle={() => toggleSection("target")}
            count={
              (filters.dateTargetFrom ? 1 : 0) +
              (filters.dateTargetTo ? 1 : 0) +
              (filters.overdueOnly ? 1 : 0)
            }
          />
          <Collapse in={expandedSections.target}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, my: 0.5 }}>
              <DateField
                size="small"
                label={t("risks.filter.from")}
                value={filters.dateTargetFrom}
                onChange={(v) => setField("dateTargetFrom", v)}
              />
              <DateField
                size="small"
                label={t("risks.filter.to")}
                value={filters.dateTargetTo}
                onChange={(v) => setField("dateTargetTo", v)}
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
                {t("risks.columns.help")}
              </Typography>
              {columnsChanged && onResetColumns && (
                <Button
                  size="small"
                  onClick={onResetColumns}
                  sx={{ textTransform: "none", fontSize: 12 }}
                >
                  {t("risks.columns.reset")}
                </Button>
              )}
            </Box>
            <FilterCheckboxList
              items={RISK_GRID_COLUMNS.map((c) => ({
                key: c.id,
                label: t(c.labelKey),
                checked: visibleColumns.has(c.id),
                onToggle: () => toggleColumn(c.id),
                disabled: LOCKED_RISK_COLUMNS.has(c.id),
                frozen: frozenColumns.has(c.id),
                onToggleFrozen: () => onToggleFrozen(c.id),
              }))}
            />
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
