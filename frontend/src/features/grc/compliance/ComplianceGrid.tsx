/**
 * ComplianceGrid — AG Grid for the GRC > Compliance regulation sub-tab.
 *
 * Layout (matches the Inventory page convention):
 *
 *     ┌─────────────┬─────────────────────────────────┐
 *     │ filter      │ toolbar (group toggle, count)   │
 *     │ sidebar     ├─────────────────────────────────┤
 *     │ (left,      │            AG GRID              │
 *     │ collapsible)│                                 │
 *     └─────────────┴─────────────────────────────────┘
 *
 * Column order: Card → Severity → Status → Article → Requirement →
 * Decision → AI (icon-only column with a header tooltip explaining
 * what the icon means).
 *
 * Grouping by card uses AG Grid Community's per-cell ``rowSpan`` to
 * visually merge the Card column for consecutive same-card rows,
 * combined with sort by card_name. No row-group rendering, no
 * Enterprise feature dependency.
 *
 * Side panels:
 * - Row click → finding drawer (right anchor)
 * - Card-name click → bubbles up to the parent which closes the
 *   finding drawer and opens the card panel in the same slot
 *   (single-drawer discipline).
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type {
  CellClickedEvent,
  ColDef,
  ICellRendererParams,
  IHeaderParams,
  SelectionChangedEvent,
  SortChangedEvent,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { RAG_COLORS } from "@/theme";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useTheme } from "@mui/material/styles";
import type {
  ComplianceDecision,
  ComplianceStatus,
  TurboLensComplianceFinding,
} from "@/types";
import {
  complianceDecisionColor,
  complianceStatusColor,
  severityChipColor,
} from "@/features/turbolens/utils";
import ComplianceFilterSidebar, {
  COMPLIANCE_GRID_COLUMNS,
  LOCKED_COMPLIANCE_COLUMNS,
  type ComplianceFilters,
} from "./ComplianceFilterSidebar";
import FindingDetailDrawer from "./FindingDetailDrawer";

interface Props {
  findings: TurboLensComplianceFinding[];
  filters: ComplianceFilters;
  onFiltersChange: (next: ComplianceFilters) => void;
  onFindingUpdated: (updated: TurboLensComplianceFinding) => void;
  onOpenCard: (cardId: string) => void;
  onPromoteToRisk?: (finding: TurboLensComplianceFinding) => void;
  onOpenRisk?: (riskId: string) => void;
  onEdit?: (finding: TurboLensComplianceFinding) => void;
  onDelete?: (finding: TurboLensComplianceFinding) => Promise<void> | void;
  /** Bulk delete a selection of findings. Returns the partial-success
   *  result so the grid can surface skipped rows to the user. */
  onBulkDelete?: (
    ids: string[],
  ) => Promise<{ updated: number; skipped: { id: string; reason: string }[] }>;
  /** Bulk-transition selected findings to a single decision. */
  onBulkDecisionUpdate?: (
    ids: string[],
    decision: ComplianceDecision,
    reviewNote: string | null,
  ) => Promise<{ updated: number; skipped: { id: string; reason: string }[] }>;
  canManage?: boolean;
  /** Render AG Grid's native loading overlay while findings refresh. */
  loading?: boolean;
  /** Table-level toolbar actions (Inventory pattern). */
  onCreate?: () => void;
  onExport?: () => void;
}

type GroupMode = "ungrouped" | "by_card";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// Per-user grid preferences (mirrors the Inventory page's localStorage
// pattern). Default groupMode = "by_card" so first-time users see the
// cleaner grouped view.
const PREFS_STORAGE_KEY = "turboea_grc_compliance_prefs";

interface CompliancePrefs {
  groupMode: GroupMode;
  filtersCollapsed: boolean;
  visibleColumns: string[];
  sortModel: { colId: string; sort: "asc" | "desc" }[];
}

const ALL_COLUMN_IDS = COMPLIANCE_GRID_COLUMNS.map((c) => c.id);

function loadPrefs(): CompliancePrefs {
  const defaults: CompliancePrefs = {
    groupMode: "by_card",
    filtersCollapsed: false,
    visibleColumns: ALL_COLUMN_IDS,
    sortModel: [],
  };
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<CompliancePrefs>;
    return {
      groupMode: parsed.groupMode === "ungrouped" ? "ungrouped" : "by_card",
      filtersCollapsed: !!parsed.filtersCollapsed,
      visibleColumns:
        Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length
          ? // Ensure locked columns are always present and ignore unknown ids.
            Array.from(
              new Set([
                ...LOCKED_COMPLIANCE_COLUMNS,
                ...parsed.visibleColumns.filter((id): id is string =>
                  typeof id === "string" && ALL_COLUMN_IDS.includes(id),
                ),
              ]),
            )
          : ALL_COLUMN_IDS,
      sortModel: Array.isArray(parsed.sortModel)
        ? parsed.sortModel.filter(
            (s): s is { colId: string; sort: "asc" | "desc" } =>
              !!s &&
              typeof s.colId === "string" &&
              (s.sort === "asc" || s.sort === "desc"),
          )
        : [],
    };
  } catch {
    return defaults;
  }
}

function savePrefs(p: CompliancePrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be full or disabled — ignore.
  }
}

export default function ComplianceGrid({
  findings,
  filters,
  onFiltersChange,
  onFindingUpdated,
  onOpenCard,
  onPromoteToRisk,
  onOpenRisk,
  onEdit,
  onDelete,
  onBulkDelete,
  onBulkDecisionUpdate,
  canManage = true,
  loading = false,
  onCreate,
  onExport,
}: Props) {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const { t: tCommon } = useTranslation("common");
  const theme = useTheme();
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const { formatDate } = useDateFormat();

  const [deleteConfirm, setDeleteConfirm] =
    useState<TurboLensComplianceFinding | null>(null);
  const [deleting, setDeleting] = useState(false);

  const initialPrefs = useMemo(loadPrefs, []);
  const [groupMode, setGroupModeRaw] = useState<GroupMode>(initialPrefs.groupMode);
  const [filtersCollapsed, setFiltersCollapsedRaw] = useState(
    initialPrefs.filtersCollapsed,
  );
  const [visibleColumns, setVisibleColumnsRaw] = useState<Set<string>>(
    () => new Set(initialPrefs.visibleColumns),
  );
  const [sortModel, setSortModel] = useState<
    { colId: string; sort: "asc" | "desc" }[]
  >(initialPrefs.sortModel);
  const [findingDrawer, setFindingDrawer] =
    useState<TurboLensComplianceFinding | null>(null);

  // ── Bulk-selection state ────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    updated: number;
    skipped: { id: string; reason: string }[];
  } | null>(null);
  // Bulk-edit form state — persisted only while the dialog is open.
  const [bulkEditDecision, setBulkEditDecision] =
    useState<ComplianceDecision>("in_review");
  const [bulkEditNote, setBulkEditNote] = useState("");

  // AG Grid v32 multi-select API. ``selectAll: "filtered"`` makes the
  // header checkbox respect the current filter state, matching the
  // Inventory grid's behaviour.
  const rowSelection = useMemo(
    () =>
      ({
        mode: "multiRow" as const,
        enableClickSelection: false,
        headerCheckbox: true,
        selectAll: "filtered" as const,
      }),
    [],
  );

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<TurboLensComplianceFinding>) => {
      const rows = event.api.getSelectedRows();
      setSelectedIds(rows.map((r) => r.id));
    },
    [],
  );

  const clearSelection = () => {
    setSelectedIds([]);
    // No grid api access here; selection state lives both in our React
    // state and the grid's internal model. The next render won't auto-sync,
    // so callers that need to clear visual checkboxes after a bulk op should
    // re-render the grid (we do — the parent updates findings).
  };

  const persist = (next: Partial<CompliancePrefs>) => {
    savePrefs({
      groupMode,
      filtersCollapsed,
      visibleColumns: Array.from(visibleColumns),
      sortModel,
      ...next,
    });
  };

  const setGroupMode = (next: GroupMode) => {
    setGroupModeRaw(next);
    persist({ groupMode: next });
  };
  const setFiltersCollapsed = (updater: boolean | ((prev: boolean) => boolean)) => {
    setFiltersCollapsedRaw((prev) => {
      const nextValue = typeof updater === "function" ? updater(prev) : updater;
      persist({ filtersCollapsed: nextValue });
      return nextValue;
    });
  };
  const setVisibleColumns = (next: Set<string>) => {
    // Guard: locked columns can never be hidden.
    const guarded = new Set<string>(next);
    for (const id of LOCKED_COMPLIANCE_COLUMNS) guarded.add(id);
    setVisibleColumnsRaw(guarded);
    persist({ visibleColumns: Array.from(guarded) });
  };
  const resetVisibleColumns = () => setVisibleColumns(new Set(ALL_COLUMN_IDS));

  const handleOpenCard = (cardId: string) => {
    // Single-drawer discipline: close the finding drawer first so the
    // parent's CardDetailSidePanel is the only thing on screen.
    setFindingDrawer(null);
    onOpenCard(cardId);
  };

  /* ---------- Sorted view for grouping ---------- */
  const sortedFindings = useMemo(() => {
    if (groupMode !== "by_card") return findings;
    return [...findings].sort((a, b) => {
      const an = a.card_name || "￿landscape"; // landscape rows last
      const bn = b.card_name || "￿landscape";
      if (an !== bn) return an.localeCompare(bn);
      return (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    });
  }, [findings, groupMode]);

  /* ---------- Group helpers ----------
   *
   * AG Grid Community's ``rowSpan`` requires ``suppressRowTransform`` which
   * breaks ``pinned: "left"`` columns. Simpler approach: render the card
   * name only on the FIRST row of each card cluster and an empty cell on
   * the rest. Visually identical to a real row-group header and works with
   * the pinned column.
   */
  const isFirstOfCardGroup = (data: TurboLensComplianceFinding | undefined): boolean => {
    if (!data) return false;
    if (groupMode !== "by_card") return true;
    const idx = sortedFindings.findIndex((f) => f.id === data.id);
    if (idx <= 0) return true;
    return (sortedFindings[idx - 1].card_name || "") !== (data.card_name || "");
  };

  /* ---------- Columns: Card first ---------- */
  const columnDefs = useMemo<ColDef<TurboLensComplianceFinding>[]>(() => [
    {
      headerName: tCards("compliance.grid.col.card"),
      field: "card_name",
      width: 280,
      minWidth: 200,
      pinned: "left",
      cellClassRules: {
        "compliance-grid--group-start": (p) =>
          groupMode === "by_card" && isFirstOfCardGroup(p.data),
        "compliance-grid--group-continuation": (p) =>
          groupMode === "by_card" && !isFirstOfCardGroup(p.data),
      },
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding>) => {
        const data = p.data;
        // In grouped mode, only render the card name on the first row
        // of each card cluster; subsequent rows render an empty cell so
        // the card name appears exactly once per group.
        if (groupMode === "by_card" && !isFirstOfCardGroup(data)) {
          return null;
        }
        if (!data?.card_name || !data.card_id) {
          // Landscape (estate-wide, card-less) finding — style it like a card
          // name (same weight, not greyed/italic) but in green so it reads as
          // an intentional scope choice rather than missing data. Use the
          // theme-aware success hue so it stays legible in dark mode.
          return (
            <Box
              sx={{
                color:
                  theme.palette.mode === "dark"
                    ? theme.palette.success.light
                    : RAG_COLORS.green,
                fontWeight: groupMode === "by_card" ? 700 : 500,
              }}
            >
              {tCards("compliance.grid.landscape")}
            </Box>
          );
        }
        return (
          <Box
            data-card-link
            sx={{
              cursor: "pointer",
              color: "primary.main",
              fontWeight: groupMode === "by_card" ? 700 : 500,
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {data.card_name}
          </Box>
        );
      },
    },
    {
      headerName: t("compliance_filter_severity"),
      field: "severity",
      width: 120,
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) =>
        p.value ? (
          <Chip
            size="small"
            color={severityChipColor(p.value as TurboLensComplianceFinding["severity"])}
            label={t(`compliance_severity_${p.value}`)}
          />
        ) : null,
    },
    {
      headerName: t("compliance_filter_status"),
      field: "status",
      width: 170,
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) =>
        p.value ? (
          <Chip
            size="small"
            color={complianceStatusColor(p.value as ComplianceStatus)}
            label={t(`compliance_status_${p.value}`)}
          />
        ) : null,
    },
    {
      headerName: tCards("compliance.grid.col.article"),
      field: "regulation_article",
      width: 150,
      valueFormatter: (p) => p.value ?? "—",
    },
    {
      headerName: tCards("compliance.grid.col.requirement"),
      field: "requirement",
      flex: 1,
      minWidth: 240,
      tooltipField: "requirement",
      cellStyle: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
    },
    {
      headerName: tCards("compliance.grid.col.lifecycle"),
      field: "decision",
      width: 160,
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, string>) =>
        p.value ? (
          <Tooltip title={p.data?.review_note || ""}>
            <Chip
              size="small"
              variant="outlined"
              color={complianceDecisionColor(p.value as ComplianceDecision)}
              label={t(`compliance_decision_${p.value}`)}
            />
          </Tooltip>
        ) : null,
    },
    {
      headerName: tCards("compliance.grid.col.ai"),
      field: "ai_detected",
      width: 90,
      headerComponent: AiHeader,
      headerComponentParams: { tooltip: t("compliance_ai_detected_help") },
      cellRenderer: (p: ICellRendererParams<TurboLensComplianceFinding, boolean>) => {
        const f = p.data;
        if (!f) return null;
        // Confirmed AI by user verdict — green check.
        if (f.card_has_ai_features === true) {
          return (
            <Tooltip title={t("compliance_ai_confirmed")}>
              <Box sx={{ display: "inline-flex" }}>
                <MaterialSymbol
                  icon="check_circle"
                  size={18}
                  color={theme.palette.success.main}
                />
              </Box>
            </Tooltip>
          );
        }
        // Confirmed NOT AI — strikethrough psychology icon.
        if (f.card_has_ai_features === false) {
          return (
            <Tooltip title={t("compliance_ai_rejected")}>
              <Box sx={{ display: "inline-flex" }}>
                <MaterialSymbol
                  icon="cancel"
                  size={18}
                  color={theme.palette.text.disabled}
                />
              </Box>
            </Tooltip>
          );
        }
        // Scanner flagged it, no user verdict yet — yellow "needs review".
        if (f.ai_detected) {
          return (
            <Tooltip title={t("compliance_ai_detected_help")}>
              <Box sx={{ display: "inline-flex" }}>
                <MaterialSymbol
                  icon="psychology"
                  size={18}
                  color={theme.palette.warning.main}
                />
              </Box>
            </Tooltip>
          );
        }
        return null;
      },
    },
    {
      headerName: tCards("compliance.grid.col.created"),
      field: "created_at",
      width: 130,
      filter: "agDateColumnFilter",
      valueFormatter: (p) => (p.value ? formatDate(p.value as string) : ""),
    },
    {
      headerName: tCards("compliance.grid.col.modified"),
      field: "updated_at",
      width: 130,
      filter: "agDateColumnFilter",
      valueFormatter: (p) => (p.value ? formatDate(p.value as string) : ""),
    },
    // Delete action — admin-grade (canManage gates rendering, the
    // endpoint additionally enforces compliance.manage).
    ...(canManage && onDelete
      ? [
          {
            headerName: "",
            colId: "delete_action",
            width: 56,
            sortable: false,
            filter: false,
            resizable: false,
            suppressMovable: true,
            // Don't let a click inside the action cell open the finding
            // drawer (the row click handler bubbles otherwise).
            cellStyle: { cursor: "default" },
            cellRenderer: (
              p: ICellRendererParams<TurboLensComplianceFinding>,
            ) =>
              p.data ? (
                <Tooltip title={tCommon("actions.delete")}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(p.data ?? null);
                    }}
                  >
                    <MaterialSymbol icon="delete" size={18} />
                  </IconButton>
                </Tooltip>
              ) : null,
          } as ColDef<TurboLensComplianceFinding>,
        ]
      : []),
  ], [t, tCards, tCommon, theme, groupMode, sortedFindings, formatDate, canManage, onDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply column visibility from prefs without rebuilding the colDef
  // factory closure on every toggle.
  const visibleColumnDefs = useMemo<ColDef<TurboLensComplianceFinding>[]>(
    () =>
      columnDefs.map((c) => ({
        ...c,
        hide: c.field ? !visibleColumns.has(c.field) : false,
      })),
    [columnDefs, visibleColumns],
  );

  // Match the Inventory grid's defaults so the GRC table feels the same:
  // sortable + filterable + resizable on every column. Per-column filter
  // overrides below for Chip-rendered columns (severity / status /
  // decision / ai) use a 'set' filter type so the user picks from valid
  // values rather than typing free-form text.
  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true, filter: true }),
    [],
  );

  const onSortChanged = (e: SortChangedEvent<TurboLensComplianceFinding>) => {
    const next = e.api
      .getColumnState()
      .filter((c) => c.sort === "asc" || c.sort === "desc")
      .map((c) => ({
        colId: c.colId!,
        sort: c.sort as "asc" | "desc",
      }));
    setSortModel(next);
    persist({ sortModel: next });
  };

  const onCellClicked = (e: CellClickedEvent<TurboLensComplianceFinding>) => {
    if (!e.data) return;
    // Action cells (currently just delete) handle their own click and
    // must not also open the finding drawer.
    if (e.colDef.colId === "delete_action") return;
    // Click on the Card cell → open card panel only (single-drawer
    // discipline). Click anywhere else on the row → open finding drawer.
    if (e.colDef.field === "card_name") {
      if (e.data.card_id) handleOpenCard(e.data.card_id);
      return;
    }
    setFindingDrawer(e.data);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(deleteConfirm);
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  const runBulkDelete = async () => {
    if (!onBulkDelete || selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await onBulkDelete(selectedIds);
      setBulkResult(result);
      setBulkDeleteOpen(false);
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkEdit = async () => {
    if (!onBulkDecisionUpdate || selectedIds.length === 0) return;
    const note = bulkEditNote.trim();
    if (bulkEditDecision === "accepted" && !note) {
      // Server enforces this too, but failing fast in the UI saves a
      // round-trip and gives a clearer message.
      return;
    }
    setBulkBusy(true);
    try {
      const result = await onBulkDecisionUpdate(
        selectedIds,
        bulkEditDecision,
        note || null,
      );
      setBulkResult(result);
      setBulkEditOpen(false);
      setBulkEditNote("");
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const getRowStyle = (params: { data?: TurboLensComplianceFinding }) =>
    params.data?.auto_resolved ? { opacity: 0.65 } : undefined;

  return (
    <Box
      sx={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        height: "100%",
        gap: 0,
      }}
    >
      <ComplianceFilterSidebar
        filters={filters}
        onFiltersChange={onFiltersChange}
        collapsed={filtersCollapsed}
        onToggleCollapsed={() => setFiltersCollapsed((v) => !v)}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={setVisibleColumns}
        onResetColumns={resetVisibleColumns}
      />

      {/* Grid + toolbar */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          pl: 1.5,
          pr: { xs: 1, md: 2 },
          py: 1.5,
        }}
      >
        {/* Table-level toolbar — title + count pill on the left, group
            toggle in the middle, Export + Create actions on the right.
            Mirrors the Inventory header pattern. */}
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}
          useFlexGap
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="h6" fontWeight={700}>
              {tCards("compliance.tableTitle")}
            </Typography>
            <Chip
              size="small"
              label={tCards("compliance.grid.count", { count: findings.length })}
              sx={{ bgcolor: "action.hover", fontWeight: 500 }}
            />
          </Stack>
          <ToggleButtonGroup
            size="small"
            value={groupMode}
            exclusive
            onChange={(_, v) => v && setGroupMode(v as GroupMode)}
            aria-label="group mode"
          >
            <Tooltip title={tCards("compliance.grid.group.flatHelp")}>
              <ToggleButton value="ungrouped" sx={{ textTransform: "none" }}>
                <MaterialSymbol icon="list" size={16} />
                <Box sx={{ ml: 0.5 }}>
                  {tCards("compliance.grid.group.flat")}
                </Box>
              </ToggleButton>
            </Tooltip>
            <Tooltip title={tCards("compliance.grid.group.byCardHelp")}>
              <ToggleButton value="by_card" sx={{ textTransform: "none" }}>
                <MaterialSymbol icon="view_agenda" size={16} />
                <Box sx={{ ml: 0.5 }}>
                  {tCards("compliance.grid.group.byCard")}
                </Box>
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1}>
            {onExport && (
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<MaterialSymbol icon="download" size={18} />}
                onClick={onExport}
                disabled={findings.length === 0}
                sx={{ textTransform: "none" }}
              >
                {tCommon("actions.export", { defaultValue: "Export" })}
              </Button>
            )}
            {onCreate && canManage && (
              <Button
                variant="contained"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={onCreate}
                sx={{ textTransform: "none" }}
              >
                {tCommon("actions.create", { defaultValue: "Create" })}
              </Button>
            )}
          </Stack>
        </Stack>

        {/* Bulk-action toolbar — only renders when the user has selected
            ≥1 row AND the parent passed bulk handlers. Sticks above the
            grid so it scrolls with the page. */}
        {canManage && selectedIds.length > 0 && (onBulkDelete || onBulkDecisionUpdate) && (
          <Paper
            variant="outlined"
            sx={{
              mb: 1,
              px: 1.5,
              py: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              flexWrap: "wrap",
              bgcolor: "action.hover",
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2" fontWeight={600}>
                {tCards("compliance.bulk.selectedCount", { count: selectedIds.length })}
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={clearSelection}
                sx={{ textTransform: "none" }}
              >
                {tCards("compliance.bulk.clear")}
              </Button>
            </Stack>
            <Stack direction="row" spacing={1}>
              {onBulkDecisionUpdate && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<MaterialSymbol icon="edit" size={16} />}
                  onClick={() => {
                    setBulkEditDecision("in_review");
                    setBulkEditNote("");
                    setBulkEditOpen(true);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  {tCards("compliance.bulk.editDecision")}
                </Button>
              )}
              {onBulkDelete && (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<MaterialSymbol icon="delete" size={16} />}
                  onClick={() => setBulkDeleteOpen(true)}
                  sx={{ textTransform: "none" }}
                >
                  {tCards("compliance.bulk.delete")}
                </Button>
              )}
            </Stack>
          </Paper>
        )}

        <Box
          className={mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
          sx={{
            width: "100%",
            // Visual grouping: emphasise the first row of each card
            // cluster and put a clean divider above it. Continuation
            // rows render an empty Card cell so the name shows once
            // per group.
            "& .compliance-grid--group-start": {
              fontWeight: 600,
              backgroundColor: theme.palette.action.hover,
            },
            "& .ag-row:has(.compliance-grid--group-start)": {
              borderTop: `2px solid ${theme.palette.divider}`,
            },
            "& .compliance-grid--group-continuation": {
              backgroundColor: "transparent",
              borderRight: `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          <AgGridReact<TurboLensComplianceFinding>
            key={isRtl ? "rtl" : "ltr"}
            enableRtl={isRtl}
            rowData={sortedFindings}
            columnDefs={visibleColumnDefs}
            defaultColDef={defaultColDef}
            loading={loading}
            onCellClicked={onCellClicked}
            onSortChanged={onSortChanged}
            rowSelection={canManage ? rowSelection : undefined}
            onSelectionChanged={canManage ? handleSelectionChanged : undefined}
            animateRows
            getRowId={(p) => p.data.id}
            getRowStyle={getRowStyle}
            initialState={
              sortModel.length > 0
                ? { sort: { sortModel } }
                : undefined
            }
            domLayout="autoHeight"
          />
        </Box>
      </Box>

      <FindingDetailDrawer
        finding={findingDrawer}
        onClose={() => setFindingDrawer(null)}
        canManage={canManage}
        onOpenCard={handleOpenCard}
        onPromoteToRisk={
          onPromoteToRisk
            ? (f) => {
                setFindingDrawer(null);
                onPromoteToRisk(f);
              }
            : undefined
        }
        onOpenRisk={onOpenRisk}
        onEdit={
          onEdit
            ? (f) => {
                setFindingDrawer(null);
                onEdit(f);
              }
            : undefined
        }
        onUpdated={(updated) => {
          onFindingUpdated(updated);
          setFindingDrawer(updated);
        }}
      />

      <Dialog
        open={!!deleteConfirm}
        onClose={() => !deleting && setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{tCards("compliance.delete.title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {tCards("compliance.delete.confirm", {
              card: deleteConfirm?.card_name || tCards("compliance.delete.landscapeScope"),
            })}
          </Typography>
          {deleteConfirm?.risk_id && (
            <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1 }}>
              {tCards("compliance.delete.riskWarning", {
                ref: deleteConfirm.risk_reference || "",
              })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} disabled={deleting}>
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDelete}
            disabled={deleting}
          >
            {tCommon("actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk delete confirmation. */}
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => !bulkBusy && setBulkDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {tCards("compliance.bulk.deleteTitle", { count: selectedIds.length })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {tCards("compliance.bulk.deleteConfirm", { count: selectedIds.length })}
          </Typography>
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1 }}>
            {tCards("compliance.bulk.deleteRiskWarning")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDeleteOpen(false)} disabled={bulkBusy}>
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={runBulkDelete}
            disabled={bulkBusy}
          >
            {tCommon("actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk decision update. The decision picker only lists the
          user-settable lifecycle states; the server runs per-row
          validation and reports rows where the transition isn't legal
          via the post-run snackbar (bulkResult.skipped). */}
      <Dialog
        open={bulkEditOpen}
        onClose={() => !bulkBusy && setBulkEditOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {tCards("compliance.bulk.editTitle", { count: selectedIds.length })}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              fullWidth
              size="small"
              label={tCards("compliance.bulk.decisionLabel")}
              value={bulkEditDecision}
              onChange={(e) => setBulkEditDecision(e.target.value as ComplianceDecision)}
            >
              {(
                [
                  "new",
                  "in_review",
                  "mitigated",
                  "verified",
                  "accepted",
                  "not_applicable",
                ] as ComplianceDecision[]
              ).map((d) => (
                <MenuItem key={d} value={d}>
                  {t(`compliance_decision_${d}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={2}
              label={tCards("compliance.bulk.noteLabel")}
              placeholder={tCards("compliance.bulk.notePlaceholder")}
              value={bulkEditNote}
              onChange={(e) => setBulkEditNote(e.target.value)}
              required={bulkEditDecision === "accepted"}
              error={bulkEditDecision === "accepted" && bulkEditNote.trim() === ""}
              helperText={
                bulkEditDecision === "accepted"
                  ? tCards("compliance.bulk.acceptedNoteHelp")
                  : undefined
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkEditOpen(false)} disabled={bulkBusy}>
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={runBulkEdit}
            disabled={
              bulkBusy ||
              (bulkEditDecision === "accepted" && bulkEditNote.trim() === "")
            }
          >
            {tCommon("actions.apply", { defaultValue: "Apply" })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Post-run summary. Shown for ~6s — auto-dismisses or close on
          click anywhere off it. Skipped rows include their reason so the
          user knows why some weren't applied (illegal transition,
          tracked by Risk, missing). */}
      <Dialog
        open={!!bulkResult}
        onClose={() => setBulkResult(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{tCards("compliance.bulk.resultTitle")}</DialogTitle>
        <DialogContent>
          {bulkResult && (
            <Stack spacing={1.5}>
              <Alert
                severity={bulkResult.skipped.length === 0 ? "success" : "info"}
              >
                {tCards("compliance.bulk.resultUpdated", {
                  count: bulkResult.updated,
                })}
              </Alert>
              {bulkResult.skipped.length > 0 && (
                <>
                  <Typography variant="body2" fontWeight={600}>
                    {tCards("compliance.bulk.resultSkipped", {
                      count: bulkResult.skipped.length,
                    })}
                  </Typography>
                  <Stack spacing={0.5} sx={{ pl: 1 }}>
                    {bulkResult.skipped.slice(0, 10).map((s) => (
                      <Typography
                        key={s.id}
                        variant="caption"
                        color="text.secondary"
                      >
                        {tCards(`compliance.bulk.skipReason.${s.reason}`, {
                          defaultValue: s.reason,
                        })}
                      </Typography>
                    ))}
                    {bulkResult.skipped.length > 10 && (
                      <Typography variant="caption" color="text.secondary">
                        +{bulkResult.skipped.length - 10}…
                      </Typography>
                    )}
                  </Stack>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkResult(null)}>
            {tCommon("actions.close", { defaultValue: "Close" })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* Header renderer with a tooltip explaining the AI icon column. */
function AiHeader(props: IHeaderParams & { tooltip: string }) {
  return (
    <Tooltip title={props.tooltip} placement="top">
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <MaterialSymbol icon="psychology" size={16} />
        <span>{props.displayName}</span>
      </Stack>
    </Tooltip>
  );
}
