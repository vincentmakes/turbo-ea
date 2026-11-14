import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import { printPage } from "@/lib/printPage";
import { brand } from "@/theme/tokens";
import {
  exportReportToPptx,
  exportReportToXlsx,
  extractSheetsFromDOM,
  type ReportExportData,
} from "./reportExport";

export type ReportExportFormat = "xlsx" | "pptx";

export interface PrintParam {
  label: string;
  value: string;
}

export interface ReportShellProps<V extends string = "chart" | "table"> {
  title: string;
  icon: string;
  iconColor?: string;
  /** Filter toolbar rendered below title row */
  toolbar?: ReactNode;
  /** Legend rendered below visualization */
  legend?: ReactNode;
  /** Whether to show chart/table toggle (default true) */
  hasTableToggle?: boolean;
  view?: V;
  onViewChange?: (v: V) => void;
  /** Overrides the chart button's tooltip for this report only (default: shell.chartView) */
  chartViewLabel?: string;
  /** Extra toggle buttons rendered between the chart and table buttons */
  extraViews?: { value: V; icon: string; label: string }[];
  /** Called when user clicks "Save Report" — parent should open SaveReportDialog */
  onSaveReport?: () => void;
  /** If viewing a saved report, show banner with name and reset option */
  savedReportName?: string;
  onResetSavedReport?: () => void;
  /** Called when user clicks the reset icon — resets all parameters to defaults */
  onReset?: () => void;
  /** The ref to the chart container for thumbnail capture */
  chartRef?: React.RefObject<HTMLDivElement | null>;
  /** Override the max width of the report container (default 1200) */
  maxWidth?: number | string;
  /** Extra action buttons rendered in the title bar before the standard actions */
  actions?: ReactNode;
  /** Parameters to display in the print header (only non-empty ones) */
  printParams?: PrintParam[];
  /**
   * Optional override that returns custom export data. When omitted, the
   * shell auto-builds it by capturing the chart container and scraping any
   * `<table>` elements rendered inside it — so reports get XLSX/PPTX export
   * for free as long as they expose a chart ref and (optionally) a table view.
   */
  buildExportData?: () => ReportExportData;
  /** Set to true to hide the XLSX/PPTX export menu entries for this report. */
  disableExport?: boolean;
  /**
   * The export formats this report may offer. Omitted, each format shows by
   * the rules below (what the user is looking at, whether `buildExportData`
   * is given); a format left out of the list never shows.
   */
  exportFormats?: ReportExportFormat[];
  /**
   * Set to true to drop the "View all saved reports" menu entry. The shell is
   * also used outside /reports (the PPM Portfolio), where a link into the
   * saved-report gallery points at an unrelated part of the app.
   */
  disableSavedReportsLink?: boolean;
  /**
   * CSS selector identifying a single "card" / "row" inside the chart
   * area. Setting this opts the report into PPTX pagination — when the
   * captured chart exceeds one slide it will be split across multiple
   * slides, cutting only between matching elements. Reports that render
   * a single inseparable visualization (treemap, heatmap, network
   * graph) should leave this unset so the chart is always rendered on
   * one slide.
   */
  paginateRowSelector?: string;
  children: ReactNode;
}

export default function ReportShell<V extends string = "chart" | "table">({
  title,
  icon,
  iconColor = brand.primary,
  toolbar,
  legend,
  hasTableToggle = true,
  view = "chart" as V,
  onViewChange,
  chartViewLabel,
  extraViews = [],
  onSaveReport,
  savedReportName,
  onResetSavedReport,
  onReset,
  chartRef,
  actions,
  maxWidth = 1200,
  printParams,
  buildExportData,
  disableExport,
  exportFormats,
  disableSavedReportsLink,
  paginateRowSelector,
  children,
}: ReportShellProps<V>) {
  const { t } = useTranslation(["reports", "common"]);
  const navigate = useNavigate();
  const theme = useTheme();
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const exporting = useSubmitOnce();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setExportMenu(null);
  };

  const activeParams = useMemo(
    () => printParams?.filter((p) => p.value) ?? [],
    [printParams],
  );

  const collectExportData = useCallback((): ReportExportData => {
    if (buildExportData) return buildExportData();
    const node = chartRef?.current ?? null;
    return {
      title,
      filterSummary: activeParams,
      sheets: extractSheetsFromDOM(node),
      chartNode: node,
      paginateRowSelector,
    };
  }, [buildExportData, chartRef, title, activeParams, paginateRowSelector]);

  const handleExport = useCallback(
    async (format: ReportExportFormat) => {
      setExportMenu(null);
      setExportFailed(false);
      try {
        await exporting.run(async () => {
          const data = collectExportData();
          if (format === "xlsx") {
            await exportReportToXlsx(data);
          } else {
            await exportReportToPptx(data);
          }
        });
      } catch {
        setExportFailed(true);
      }
    },
    [collectExportData, exporting],
  );

  const exportEnabled = !disableExport && !!chartRef;
  // Match the export format to what the user is currently looking at:
  // PPTX captures the chart, XLSX harvests the rendered tables. Reports
  // without a table toggle are inherently chart-only — unless they supply
  // their own `buildExportData`, which means they hand over real tabular
  // data instead of relying on the DOM scrape, so XLSX always applies.
  // `exportFormats`, when given, narrows that further.
  const allows = (format: ReportExportFormat) => !exportFormats || exportFormats.includes(format);
  const showXlsxItem =
    exportEnabled &&
    allows("xlsx") &&
    (!!buildExportData || (hasTableToggle && view === "table"));
  const showPptxItem = exportEnabled && allows("pptx") && (!hasTableToggle || view !== "table");

  return (
    // `data-theme-mode`: a dark-theme report prints the text set on the page
    // itself in ink, since the page prints on white paper (print.css).
    <Box
      className="report-container"
      data-theme-mode={theme.palette.mode}
      sx={{ maxWidth, mx: "auto" }}
    >
      {/* Saved report banner */}
      {savedReportName && (
        <Alert
          className="report-saved-banner"
          severity="info"
          icon={<MaterialSymbol icon="bookmark" size={20} />}
          sx={{ mb: 2 }}
          action={
            onResetSavedReport && (
              <Button
                size="small"
                onClick={onResetSavedReport}
                sx={{ textTransform: "none" }}
              >
                {t("shell.resetDefaults")}
              </Button>
            )
          }
        >
          <Trans
            i18nKey="shell.viewingSavedReport"
            ns="reports"
            values={{ name: savedReportName }}
          >
            Viewing saved report: <strong>{{ savedReportName } as any}</strong>
          </Trans>
        </Alert>
      )}

      {/* Title bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          mb: 2,
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <MaterialSymbol icon={icon} size={26} color={iconColor} />
        <Typography
          className="report-title"
          variant="h5"
          sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}
          noWrap
        >
          {title}
        </Typography>

        <Box
          className="report-actions"
          sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
        >
          {actions}
          {hasTableToggle && onViewChange && (
            <ToggleButtonGroup
              value={view}
              exclusive
              size="small"
              onChange={(_, v) => v && onViewChange(v)}
            >
              <ToggleButton value="chart">
                <Tooltip title={chartViewLabel ?? t("shell.chartView")}>
                  <Box sx={{ display: "flex" }}>
                    <MaterialSymbol icon="bar_chart" size={18} />
                  </Box>
                </Tooltip>
              </ToggleButton>
              {extraViews.map((v) => (
                <ToggleButton key={v.value} value={v.value}>
                  <Tooltip title={v.label}>
                    <Box sx={{ display: "flex" }}>
                      <MaterialSymbol icon={v.icon} size={18} />
                    </Box>
                  </Tooltip>
                </ToggleButton>
              ))}
              <ToggleButton value="table">
                <Tooltip title={t("shell.tableView")}>
                  <Box sx={{ display: "flex" }}>
                    <MaterialSymbol icon="table_rows" size={18} />
                  </Box>
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          )}

          {onSaveReport && (
            <Tooltip title={t("shell.saveReport")}>
              <IconButton size="small" onClick={onSaveReport}>
                <MaterialSymbol icon="bookmark_add" size={20} />
              </IconButton>
            </Tooltip>
          )}

          {onReset && (
            <Tooltip title={t("shell.resetDefaults")}>
              <IconButton size="small" onClick={onReset}>
                <MaterialSymbol icon="restart_alt" size={20} />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title={t("shell.printPdf")}>
            <IconButton size="small" onClick={printPage}>
              <MaterialSymbol icon="print" size={20} />
            </IconButton>
          </Tooltip>

          <Tooltip title={exporting.busy ? t("shell.exporting") : t("shell.moreActions")}>
            {/* A span keeps the tooltip working while the button is disabled. */}
            <span>
              <IconButton
                size="small"
                aria-label={exporting.busy ? t("shell.exporting") : t("shell.moreActions")}
                aria-busy={exporting.busy}
                disabled={exporting.busy}
                onClick={(e) => setExportMenu(e.currentTarget)}
              >
                {exporting.busy ? (
                  <CircularProgress size={20} data-testid="report-export-progress" />
                ) : (
                  <MaterialSymbol icon="more_vert" size={20} />
                )}
              </IconButton>
            </span>
          </Tooltip>

          <Menu
            anchorEl={exportMenu}
            open={!!exportMenu}
            onClose={() => setExportMenu(null)}
          >
            {showXlsxItem && (
              <MenuItem onClick={() => handleExport("xlsx")}>
                <ListItemIcon>
                  <MaterialSymbol icon="table_view" size={18} />
                </ListItemIcon>
                <ListItemText>{t("shell.exportXlsx")}</ListItemText>
              </MenuItem>
            )}
            {showPptxItem && (
              <MenuItem onClick={() => handleExport("pptx")}>
                <ListItemIcon>
                  <MaterialSymbol icon="slideshow" size={18} />
                </ListItemIcon>
                <ListItemText>{t("shell.exportPptx")}</ListItemText>
              </MenuItem>
            )}
            <MenuItem onClick={handleCopyLink}>
              <ListItemIcon>
                <MaterialSymbol icon="link" size={18} />
              </ListItemIcon>
              <ListItemText>{t("shell.copyLink")}</ListItemText>
            </MenuItem>
            {!disableSavedReportsLink && (
              <MenuItem
                onClick={() => {
                  setExportMenu(null);
                  navigate("/reports/saved");
                }}
              >
                <ListItemIcon>
                  <MaterialSymbol icon="bookmarks" size={18} />
                </ListItemIcon>
                <ListItemText>{t("shell.viewAllSaved")}</ListItemText>
              </MenuItem>
            )}
          </Menu>
        </Box>
      </Box>

      <Snackbar
        open={exportFailed}
        autoHideDuration={6000}
        onClose={() => setExportFailed(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setExportFailed(false)} variant="filled">
          {t("shell.exportFailed")}
        </Alert>
      </Snackbar>

      {/* Print-only: compact parameter summary */}
      {activeParams.length > 0 && (
        <Box
          className="report-print-params"
          sx={{
            gap: 0.5,
            flexWrap: "wrap",
            alignItems: "center",
            mb: 1,
            pb: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {activeParams.map((p, i) => (
            <Typography
              key={i}
              variant="caption"
              sx={{ color: "text.secondary", lineHeight: 1.6 }}
            >
              <strong>{p.label}:</strong> {p.value}
              {i < activeParams.length - 1 && (
                <Box component="span" sx={{ mx: 0.75, color: "divider" }}>
                  |
                </Box>
              )}
            </Typography>
          ))}
        </Box>
      )}

      {/* Filter toolbar */}
      {toolbar && (
        <Box
          className="report-toolbar"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mb: 2,
            flexWrap: "wrap",
          }}
        >
          {toolbar}
        </Box>
      )}

      {/* Main content */}
      <Box ref={chartRef} className="report-chart-area" sx={{ minHeight: 300 }}>
        {children}
      </Box>

      {/* Legend */}
      {legend && (
        <Box
          className="report-legend"
          sx={{
            mt: 2,
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          {legend}
        </Box>
      )}
    </Box>
  );
}
