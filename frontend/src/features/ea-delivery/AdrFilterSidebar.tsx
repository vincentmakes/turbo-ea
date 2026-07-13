import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import MaterialSymbol from "@/components/MaterialSymbol";
import { ADR_COLUMN_DEFS, ADR_LOCKED_COLUMN_KEYS } from "./adrGridPrefs";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AdrFilters {
  cardTypes: string[];
  linkedCards: string[];
  statuses: string[];
  signedBy: string[];
  dateCreatedFrom: string;
  dateCreatedTo: string;
  dateModifiedFrom: string;
  dateModifiedTo: string;
  dateSignedFrom: string;
  dateSignedTo: string;
}

export const EMPTY_ADR_FILTERS: AdrFilters = {
  cardTypes: [],
  linkedCards: [],
  statuses: [],
  signedBy: [],
  dateCreatedFrom: "",
  dateCreatedTo: "",
  dateModifiedFrom: "",
  dateModifiedTo: "",
  dateSignedFrom: "",
  dateSignedTo: "",
};

interface Props {
  filters: AdrFilters;
  onFiltersChange: (f: AdrFilters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  availableCardTypes: { key: string; label: string; color: string }[];
  availableLinkedCards: { id: string; name: string; type: string; color: string }[];
  availableSignatories: { userId: string; displayName: string }[];
  /** colIds hidden in the grid (column chooser state, owned by the panel). */
  hiddenColumns: Set<string>;
  onHiddenColumnsChange: (next: Set<string>) => void;
  /** Extension-contributed grid columns, choosable like built-in ones. */
  extensionColumns: { colId: string; label: string }[];
}

const STATUS_OPTIONS = [
  { key: "draft", tKey: "status.draft" as const, color: "#9e9e9e" },
  { key: "in_review", tKey: "status.inReview" as const, color: "#ff9800" },
  { key: "signed", tKey: "status.signed" as const, color: "#4caf50" },
];

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

/* ------------------------------------------------------------------ */
/*  Section header                                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Columns tab (grid column chooser)                                  */
/* ------------------------------------------------------------------ */

function ColumnsTab({
  hiddenColumns,
  onHiddenColumnsChange,
  extensionColumns,
}: {
  hiddenColumns: Set<string>;
  onHiddenColumnsChange: (next: Set<string>) => void;
  extensionColumns: { colId: string; label: string }[];
}) {
  const { t } = useTranslation("delivery");
  const [search, setSearch] = useState("");

  const builtInColumns = useMemo(
    () => ADR_COLUMN_DEFS.map((d) => ({ key: d.key, label: t(d.tKey) })),
    [t],
  );
  const extColumns = useMemo(
    () => extensionColumns.map((c) => ({ key: c.colId, label: c.label })),
    [extensionColumns],
  );

  // Count only hidden keys that map to a real column, so stale prefs (e.g.
  // an uninstalled extension's column) don't skew the shown count.
  const allKeys = useMemo(
    () => new Set([...builtInColumns, ...extColumns].map((c) => c.key)),
    [builtInColumns, extColumns],
  );
  const hiddenCount = useMemo(
    () => [...hiddenColumns].filter((k) => allKeys.has(k)).length,
    [hiddenColumns, allKeys],
  );
  const shownCount = allKeys.size - hiddenCount;

  const matchesSearch = (label: string) =>
    !search || label.toLowerCase().includes(search.toLowerCase());

  const toggleColumn = (key: string) => {
    if (ADR_LOCKED_COLUMN_KEYS.has(key)) return;
    const next = new Set(hiddenColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onHiddenColumnsChange(next);
  };

  const renderRow = (col: { key: string; label: string }) => {
    const locked = ADR_LOCKED_COLUMN_KEYS.has(col.key);
    return (
      <ListItemButton
        key={col.key}
        dense
        disabled={locked}
        onClick={() => toggleColumn(col.key)}
        sx={{ py: 0, borderRadius: 1 }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          <Checkbox
            edge="start"
            size="small"
            checked={locked || !hiddenColumns.has(col.key)}
            disabled={locked}
            tabIndex={-1}
            disableRipple
          />
        </ListItemIcon>
        <ListItemText
          primary={col.label}
          secondary={locked ? t("adr.columns.alwaysVisible") : undefined}
          primaryTypographyProps={{ fontSize: 13 }}
          secondaryTypographyProps={{ fontSize: 11 }}
        />
      </ListItemButton>
    );
  };

  return (
    <>
      <TextField
        size="small"
        fullWidth
        placeholder={t("adr.columns.searchPlaceholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 1, "& .MuiInputBase-root": { fontSize: 12, height: 30 } }}
      />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 0.5,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t("adr.columns.shownCount", { count: shownCount })}
        </Typography>
        {hiddenCount > 0 && (
          <Button
            size="small"
            onClick={() => onHiddenColumnsChange(new Set())}
            startIcon={<MaterialSymbol icon="restart_alt" size={16} />}
            sx={{ textTransform: "none", fontSize: 12 }}
          >
            {t("adr.columns.reset")}
          </Button>
        )}
      </Box>
      <List dense disablePadding>
        {builtInColumns.filter((c) => matchesSearch(c.label)).map(renderRow)}
      </List>
      {extColumns.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography
            variant="subtitle2"
            sx={{ fontSize: 13, fontWeight: 600, px: 0.5, mb: 0.5 }}
          >
            {t("adr.columns.extensions")}
          </Typography>
          <List dense disablePadding>
            {extColumns.filter((c) => matchesSearch(c.label)).map(renderRow)}
          </List>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdrFilterSidebar({
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  availableCardTypes,
  availableLinkedCards,
  availableSignatories,
  hiddenColumns,
  onHiddenColumnsChange,
  extensionColumns,
}: Props) {
  // delivery namespace — keys: adr.filter.* / adr.columns.*
  const { t } = useTranslation(["delivery", "common"]);

  const [tab, setTab] = useState(0);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    cardTypes: true,
    linkedCards: false,
    status: true,
    signedBy: false,
    dateCreated: false,
    dateModified: false,
    dateSigned: false,
  });

  const [linkedCardSearch, setLinkedCardSearch] = useState("");

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  /* ---- Toggle helpers ---- */

  const toggleCardType = useCallback(
    (key: string) => {
      const next = filters.cardTypes.includes(key)
        ? filters.cardTypes.filter((k) => k !== key)
        : [...filters.cardTypes, key];
      onFiltersChange({ ...filters, cardTypes: next });
    },
    [filters, onFiltersChange],
  );

  const toggleStatus = useCallback(
    (key: string) => {
      const next = filters.statuses.includes(key)
        ? filters.statuses.filter((k) => k !== key)
        : [...filters.statuses, key];
      onFiltersChange({ ...filters, statuses: next });
    },
    [filters, onFiltersChange],
  );

  const toggleLinkedCard = useCallback(
    (id: string) => {
      const next = filters.linkedCards.includes(id)
        ? filters.linkedCards.filter((k) => k !== id)
        : [...filters.linkedCards, id];
      onFiltersChange({ ...filters, linkedCards: next });
    },
    [filters, onFiltersChange],
  );

  const toggleSignatory = useCallback(
    (userId: string) => {
      const next = filters.signedBy.includes(userId)
        ? filters.signedBy.filter((k) => k !== userId)
        : [...filters.signedBy, userId];
      onFiltersChange({ ...filters, signedBy: next });
    },
    [filters, onFiltersChange],
  );

  const setDateField = useCallback(
    (field: keyof AdrFilters, value: string) => {
      onFiltersChange({ ...filters, [field]: value });
    },
    [filters, onFiltersChange],
  );

  /* ---- Clear / count ---- */

  const clearAll = () => onFiltersChange({ ...EMPTY_ADR_FILTERS });

  const activeCount = useMemo(
    () =>
      filters.cardTypes.length +
      filters.linkedCards.length +
      filters.statuses.length +
      filters.signedBy.length +
      (filters.dateCreatedFrom ? 1 : 0) +
      (filters.dateCreatedTo ? 1 : 0) +
      (filters.dateModifiedFrom ? 1 : 0) +
      (filters.dateModifiedTo ? 1 : 0) +
      (filters.dateSignedFrom ? 1 : 0) +
      (filters.dateSignedTo ? 1 : 0),
    [filters],
  );

  /* ---- Resize drag ---- */

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

  /* ---- Collapsed rail ---- */

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
        <Tooltip title={t("adr.filter.cardTypes")} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
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

  /* ---- Expanded sidebar ---- */

  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          minWidth: MIN_WIDTH,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        {/* Header — Filters / Columns tabs (mirrors the Inventory sidebar) */}
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
            onChange={(_, v) => setTab(v)}
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
                  {t("common:filter.title", "Filters")}
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
                  {t("adr.columns.title")}
                  {hiddenColumns.size > 0 && (
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

        {/* Scrollable content — Columns tab */}
        {tab === 1 && (
          <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
            <ColumnsTab
              hiddenColumns={hiddenColumns}
              onHiddenColumnsChange={onHiddenColumnsChange}
              extensionColumns={extensionColumns}
            />
          </Box>
        )}

        {/* Scrollable content — Filters tab */}
        {tab === 0 && (
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {/* Clear all */}
          {activeCount > 0 && (
            <Button
              size="small"
              onClick={clearAll}
              startIcon={<MaterialSymbol icon="filter_alt_off" size={16} />}
              sx={{ mb: 1, textTransform: "none", fontSize: 12 }}
            >
              {/* adr.filter.clearAll = "Clear All" */}
              {t("adr.filter.clearAll")}
            </Button>
          )}

          {/* ---- Card Types ---- */}
          {/* adr.filter.cardTypes = "Card Types" */}
          <SectionHeader
            label={t("adr.filter.cardTypes")}
            expanded={expandedSections.cardTypes}
            onToggle={() => toggleSection("cardTypes")}
          />
          <Collapse in={expandedSections.cardTypes}>
            <List dense disablePadding sx={{ mb: 1 }}>
              {availableCardTypes.map((ct) => (
                <ListItemButton
                  key={ct.key}
                  dense
                  onClick={() => toggleCardType(ct.key)}
                  sx={{ py: 0, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.cardTypes.includes(ct.key)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: ct.color,
                      mr: 1,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={ct.label}
                    primaryTypographyProps={{ fontSize: 13 }}
                  />
                </ListItemButton>
              ))}
              {availableCardTypes.length === 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ px: 1, py: 0.5, fontSize: 12 }}
                >
                  {t("adr.filter.all")}
                </Typography>
              )}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* ---- Linked Cards ---- */}
          <SectionHeader
            label={t("adr.filter.linkedCards")}
            expanded={expandedSections.linkedCards}
            onToggle={() => toggleSection("linkedCards")}
          />
          <Collapse in={expandedSections.linkedCards}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("adr.filter.searchLinkedCards")}
              value={linkedCardSearch}
              onChange={(e) => setLinkedCardSearch(e.target.value)}
              sx={{ mb: 0.5, "& .MuiInputBase-root": { fontSize: 12, height: 30 } }}
            />
            <List dense disablePadding sx={{ mb: 1, maxHeight: 240, overflow: "auto" }}>
              {availableLinkedCards
                .filter(
                  (card) =>
                    !linkedCardSearch ||
                    card.name.toLowerCase().includes(linkedCardSearch.toLowerCase()),
                )
                .map((card) => (
                <ListItemButton
                  key={card.id}
                  dense
                  onClick={() => toggleLinkedCard(card.id)}
                  sx={{ py: 0, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.linkedCards.includes(card.id)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: card.color,
                      mr: 1,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={card.name}
                    primaryTypographyProps={{ fontSize: 13 }}
                  />
                </ListItemButton>
              ))}
              {availableLinkedCards.length === 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ px: 1, py: 0.5, fontSize: 12 }}
                >
                  {t("adr.filter.noLinkedCards")}
                </Typography>
              )}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* ---- Status ---- */}
          {/* adr.filter.status = "Status" */}
          <SectionHeader
            label={t("adr.filter.status")}
            expanded={expandedSections.status}
            onToggle={() => toggleSection("status")}
          />
          <Collapse in={expandedSections.status}>
            <List dense disablePadding sx={{ mb: 1 }}>
              {STATUS_OPTIONS.map((opt) => (
                <ListItemButton
                  key={opt.key}
                  dense
                  onClick={() => toggleStatus(opt.key)}
                  sx={{ py: 0, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.statuses.includes(opt.key)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: opt.color,
                      mr: 1,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={t(opt.tKey)}
                    primaryTypographyProps={{ fontSize: 13 }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* ---- Signed By ---- */}
          <SectionHeader
            label={t("adr.filter.signedBy")}
            expanded={expandedSections.signedBy}
            onToggle={() => toggleSection("signedBy")}
          />
          <Collapse in={expandedSections.signedBy}>
            <List dense disablePadding sx={{ mb: 1, maxHeight: 240, overflow: "auto" }}>
              {availableSignatories.map((s) => (
                <ListItemButton
                  key={s.userId}
                  dense
                  onClick={() => toggleSignatory(s.userId)}
                  sx={{ py: 0, borderRadius: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={filters.signedBy.includes(s.userId)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={s.displayName}
                    primaryTypographyProps={{ fontSize: 13 }}
                  />
                </ListItemButton>
              ))}
              {availableSignatories.length === 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ px: 1, py: 0.5, fontSize: 12 }}
                >
                  {t("adr.filter.noSignatories")}
                </Typography>
              )}
            </List>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* ---- Date Created ---- */}
          {/* adr.filter.dateCreated = "Date Created" */}
          <SectionHeader
            label={t("adr.filter.dateCreated")}
            expanded={expandedSections.dateCreated}
            onToggle={() => toggleSection("dateCreated")}
          />
          <Collapse in={expandedSections.dateCreated}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1.5, mt: 0.5 }}>
              <TextField
                type="date"
                size="small"
                fullWidth
                label={t("adr.filter.from")}
                value={filters.dateCreatedFrom}
                onChange={(e) => setDateField("dateCreatedFrom", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                type="date"
                size="small"
                fullWidth
                label={t("adr.filter.to")}
                value={filters.dateCreatedTo}
                onChange={(e) => setDateField("dateCreatedTo", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* ---- Date Modified ---- */}
          {/* adr.filter.dateModified = "Date Modified" */}
          <SectionHeader
            label={t("adr.filter.dateModified")}
            expanded={expandedSections.dateModified}
            onToggle={() => toggleSection("dateModified")}
          />
          <Collapse in={expandedSections.dateModified}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1.5, mt: 0.5 }}>
              <TextField
                type="date"
                size="small"
                fullWidth
                label={t("adr.filter.from")}
                value={filters.dateModifiedFrom}
                onChange={(e) => setDateField("dateModifiedFrom", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                type="date"
                size="small"
                fullWidth
                label={t("adr.filter.to")}
                value={filters.dateModifiedTo}
                onChange={(e) => setDateField("dateModifiedTo", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          </Collapse>

          <Divider sx={{ my: 1 }} />

          {/* ---- Date Signed ---- */}
          {/* adr.filter.dateSigned = "Date Signed" */}
          <SectionHeader
            label={t("adr.filter.dateSigned")}
            expanded={expandedSections.dateSigned}
            onToggle={() => toggleSection("dateSigned")}
          />
          <Collapse in={expandedSections.dateSigned}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1.5, mt: 0.5 }}>
              <TextField
                type="date"
                size="small"
                fullWidth
                label={t("adr.filter.from")}
                value={filters.dateSignedFrom}
                onChange={(e) => setDateField("dateSignedFrom", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                type="date"
                size="small"
                fullWidth
                label={t("adr.filter.to")}
                value={filters.dateSignedTo}
                onChange={(e) => setDateField("dateSignedTo", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          </Collapse>
        </Box>
        )}
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 4,
          cursor: "col-resize",
          "&:hover": { bgcolor: "primary.main" },
          transition: "background-color 0.2s",
        }}
      />
    </Box>
  );
}
