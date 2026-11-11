import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import SpreadsheetImportDialog from "@/components/SpreadsheetImportDialog";
import AdrGrid from "@/features/ea-delivery/AdrGrid";
import AdrFilterSidebar from "@/features/ea-delivery/AdrFilterSidebar";
import {
  EMPTY_ADR_FILTERS,
  adrExportPath,
  filterAdrs,
  visibleSelection,
  type AdrFilters,
} from "@/features/ea-delivery/adrRegisterFilters";
import { exportAdrsToDocx } from "@/features/ea-delivery/adrExport";
import {
  downloadAdrTemplate,
  exportAdrsToXlsx,
  parseAdrWorkbook,
} from "@/features/ea-delivery/adrSpreadsheet";
import {
  loadAdrGridPrefs,
  updateAdrGridPrefs,
} from "@/features/ea-delivery/adrGridPrefs";
import CreateAdrDialog from "@/features/ea-delivery/CreateAdrDialog";
import { useAuthContext } from "@/hooks/AuthContext";
import { useExtensionAdrGridColumns } from "@/lib/extensionHost";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { ArchitectureDecision } from "@/types";

export default function DecisionsPanel() {
  const { t } = useTranslation(["grc", "delivery", "common"]);
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { types: metamodelTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  // A linked card whose type the metamodel does not know gets a neutral swatch.
  const unknownTypeColor = useTheme().palette.text.secondary;

  const canManage = !!user?.permissions?.["*"] || !!user?.permissions?.["adr.manage"];

  const [adrs, setAdrs] = useState<ArchitectureDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [adrSearch, setAdrSearch] = useState("");
  const [adrFilters, setAdrFilters] = useState<AdrFilters>({ ...EMPTY_ADR_FILTERS });
  const [adrSidebarCollapsed, setAdrSidebarCollapsed] = useState(false);
  const [adrSidebarWidth, setAdrSidebarWidth] = useState(280);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grid column visibility (sidebar Columns tab), persisted alongside the
  // grid's own filter/layout prefs in localStorage.
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(loadAdrGridPrefs()?.hiddenColumns ?? []),
  );
  const handleHiddenColumnsChange = useCallback((next: Set<string>) => {
    setHiddenColumns(next);
    updateAdrGridPrefs({ hiddenColumns: [...next] });
  }, []);

  // Frozen (pinned) columns, owned here for the same reason visibility is:
  // the column chooser lives in the sidebar, a sibling of the grid.
  const [frozenColumns, setFrozenColumns] = useState<string[]>(
    () => loadAdrGridPrefs()?.frozenColumns ?? [],
  );
  const handleFrozenColumnsChange = useCallback((next: string[]) => {
    setFrozenColumns(next);
    updateAdrGridPrefs({ frozenColumns: next });
  }, []);
  const frozenColumnSet = useMemo(() => new Set(frozenColumns), [frozenColumns]);

  // Column order, owned here for the same reason visibility and freezing are:
  // the Columns tab lives in the sidebar, a sibling of the grid. Seeded from
  // the positions of a layout saved before ordering had its own pref.
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const prefs = loadAdrGridPrefs();
    return (
      prefs?.columnOrder ??
      (prefs?.columnState ?? []).map((c) => c.colId).filter((id): id is string => !!id)
    );
  });
  const handleColumnOrderChange = useCallback((next: string[]) => {
    setColumnOrder(next);
    updateAdrGridPrefs({ columnOrder: next });
  }, []);
  const toggleFrozenColumn = useCallback(
    (colId: string) =>
      handleFrozenColumnsChange(
        frozenColumns.includes(colId)
          ? frozenColumns.filter((id) => id !== colId)
          : [...frozenColumns, colId],
      ),
    [frozenColumns, handleFrozenColumnsChange],
  );

  const extGridColumns = useExtensionAdrGridColumns();
  const extensionColumns = useMemo(
    () =>
      extGridColumns.map((c) => ({
        colId: `ext-${c.extKey}-${c.contribution.id}`,
        label: c.contribution.label,
      })),
    [extGridColumns],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ArchitectureDecision[]>("/adr");
      setAdrs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── ADR row handlers ─────────────────────────────────────────────

  const handleDelete = useCallback(
    async (adr: ArchitectureDecision) => {
      if (!confirm(t("delivery:adr.confirm.delete"))) return;
      try {
        await api.delete(`/adr/${adr.id}`);
        setAdrs((prev) => prev.filter((a) => a.id !== adr.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("delivery:error.deleteSoaw"));
      }
    },
    [t],
  );

  const handleDuplicate = useCallback(
    async (adr: ArchitectureDecision) => {
      try {
        const dup = await api.post<ArchitectureDecision>(`/adr/${adr.id}/duplicate`);
        navigate(`/ea-delivery/adr/${dup.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("delivery:adr.editor.error.duplicateFailed"));
      }
    },
    [navigate, t],
  );

  // ── ADR filter helpers ───────────────────────────────────────────
  // One `GET /adr` (earlier revisions included) feeds the grid; the
  // "Show earlier revisions" switch, the "In force" preset and every other
  // filter narrow the loaded rows here.

  const filteredAdrs = useMemo(() => filterAdrs(adrs, adrFilters), [adrs, adrFilters]);

  const handleExport = useCallback(
    async (picked: ArchitectureDecision[]) => {
      // Only rows the filters still show: a selection made before a filter
      // change never exports a row that is no longer on screen.
      const selected = visibleSelection(picked, filteredAdrs);
      if (selected.length === 0) return;
      try {
        // List endpoint returns a summary — fetch full ADRs to get rich-text fields.
        const full = await Promise.all(
          selected.map((a) => api.get<ArchitectureDecision>(`/adr/${a.id}`)),
        );
        await exportAdrsToDocx(full);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("delivery:adr.export.error"));
      }
    },
    [t, filteredAdrs],
  );

  // Spreadsheet export of what the filters show. The list rows are summaries,
  // so fetch them again with every section in one request, keep the ones on
  // screen and keep the on-screen order.
  const handleSheetExport = useCallback(
    async (visible: ArchitectureDecision[]) => {
      setExporting(true);
      try {
        const full = await api.get<ArchitectureDecision[]>(
          adrExportPath(adrFilters.showEarlierRevisions),
        );
        const byId = new Map(full.map((a) => [a.id, a]));
        exportAdrsToXlsx(visible.map((a) => byId.get(a.id) ?? a));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("grc:governance.decisions.exportError"));
      } finally {
        setExporting(false);
      }
    },
    [t, adrFilters.showEarlierRevisions],
  );

  const availableCardTypes = useMemo(() => {
    const typeKeys = new Set<string>();
    for (const adr of adrs) {
      for (const c of adr.linked_cards ?? []) typeKeys.add(c.type);
    }
    return [...typeKeys].map((key) => {
      const mt = metamodelTypes.find((mt) => mt.key === key);
      return {
        key,
        label: mt ? typeLabel(mt) : key,
        color: mt?.color ?? unknownTypeColor,
      };
    });
  }, [adrs, metamodelTypes, typeLabel, unknownTypeColor]);

  const availableLinkedCards = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; name: string; type: string; color: string }
    >();
    for (const adr of adrs) {
      for (const c of adr.linked_cards ?? []) {
        if (adrFilters.cardTypes.length > 0 && !adrFilters.cardTypes.includes(c.type)) {
          continue;
        }
        if (!seen.has(c.id)) {
          const mt = metamodelTypes.find((mt) => mt.key === c.type);
          seen.set(c.id, {
            id: c.id,
            name: c.name,
            type: c.type,
            color: mt?.color ?? unknownTypeColor,
          });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [adrs, metamodelTypes, adrFilters.cardTypes, unknownTypeColor]);

  const availableSignatories = useMemo(() => {
    const seen = new Map<string, { userId: string; displayName: string }>();
    for (const adr of adrs) {
      for (const s of adr.signatories) {
        if (s.status === "signed" && !seen.has(s.user_id)) {
          seen.set(s.user_id, { userId: s.user_id, displayName: s.display_name });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [adrs]);

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Typography variant="h6" fontWeight={600}>
          {t("grc:governance.decisions.title")}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            startIcon={<MaterialSymbol icon="download" size={18} />}
            onClick={() => void handleSheetExport(filteredAdrs)}
            disabled={exporting || filteredAdrs.length === 0}
            sx={{ textTransform: "none" }}
          >
            {t("common:actions.export")}
          </Button>
          {canManage && (
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              startIcon={<MaterialSymbol icon="upload" size={18} />}
              onClick={() => setImportOpen(true)}
              sx={{ textTransform: "none" }}
            >
              {t("common:actions.import")}
            </Button>
          )}
          {canManage && (
            <Button
              variant="contained"
              size="small"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => setCreateOpen(true)}
            >
              {t("grc:governance.decisions.create")}
            </Button>
          )}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        // Layout: filter sidebar grows with its own natural height, grid uses
        // AG Grid's autoHeight so it sizes to the row count instead of an
        // inner scrollbar. End result: one scroll context — the page itself.
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <Box sx={{ alignSelf: "stretch", display: "flex" }}>
            <AdrFilterSidebar
              filters={adrFilters}
              onFiltersChange={setAdrFilters}
              collapsed={adrSidebarCollapsed}
              onToggleCollapse={() => setAdrSidebarCollapsed((p) => !p)}
              width={adrSidebarWidth}
              onWidthChange={setAdrSidebarWidth}
              availableCardTypes={availableCardTypes}
              availableLinkedCards={availableLinkedCards}
              availableSignatories={availableSignatories}
              hiddenColumns={hiddenColumns}
              onHiddenColumnsChange={handleHiddenColumnsChange}
              frozenColumns={frozenColumnSet}
              onToggleFrozen={toggleFrozenColumn}
              columnOrder={columnOrder}
              onColumnOrderChange={handleColumnOrderChange}
              extensionColumns={extensionColumns}
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <AdrGrid
              adrs={filteredAdrs}
              metamodelTypes={metamodelTypes}
              loading={false}
              quickFilterText={adrSearch}
              onQuickFilterChange={setAdrSearch}
              hiddenColumns={hiddenColumns}
              frozenColumns={frozenColumns}
              onFrozenColumnsChange={handleFrozenColumnsChange}
              columnOrder={columnOrder}
              onColumnOrderChange={handleColumnOrderChange}
              onEdit={(adr) => navigate(`/ea-delivery/adr/${adr.id}`)}
              onPreview={(adr) => navigate(`/ea-delivery/adr/${adr.id}/preview`)}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onExport={handleExport}
              autoHeight
            />
          </Box>
        </Box>
      )}

      <SpreadsheetImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={() => void load()}
        title={t("grc:governance.decisions.import.title")}
        intro={t("grc:governance.decisions.import.intro")}
        skippedHint={t("grc:governance.decisions.import.skippedHint")}
        endpoint="/adr/bulk-import"
        parse={parseAdrWorkbook}
        downloadTemplate={downloadAdrTemplate}
      />

      <CreateAdrDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(adr) => {
          setCreateOpen(false);
          navigate(`/ea-delivery/adr/${adr.id}`);
        }}
      />
    </Box>
  );
}
