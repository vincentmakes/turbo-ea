import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Alert from "@mui/material/Alert";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useIsRtl } from "@/hooks/useIsRtl";
import { makeRtlAxisTick, mirrorChartMargin } from "@/lib/rechartsRtl";
import { api, ApiError } from "@/api/client";

interface Column {
  key: string;
  label: string;
  kind: "dimension" | "measure";
  type: string;
}

interface CustomReportResult {
  columns: Column[];
  rows: Record<string, string | number>[];
  meta: {
    title: string;
    card_type: string;
    effective_type: string;
    visualization: string;
    total_source_cards: number;
    total_working_cards: number;
    group_count: number;
    truncated: boolean;
  };
}

// Distinct, colour-blind-friendly-ish palette for series / slices.
const PALETTE = [
  "#1976d2",
  "#2e7d32",
  "#e65100",
  "#6a1b9a",
  "#00838f",
  "#c62828",
  "#f9a825",
  "#5d4037",
  "#283593",
  "#ad1457",
];

export default function CustomReport() {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const isRtl = useIsRtl();
  const saved = useSavedReport("custom");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() =>
    saved.setSaveDialogOpen(true),
  );

  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [data, setData] = useState<CustomReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  // Pull the spec from the saved report config (set on the saved_reports row by
  // the MCP `create_saved_report` tool, or by editing an existing custom report).
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg && Object.keys(cfg).length > 0) setSpec(cfg);
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!spec) return;
    setLoading(true);
    setError(null);
    api
      .post<CustomReportResult>("/reports/custom", spec)
      .then((res) => {
        setData(res);
        // Honour the spec's preferred presentation for the initial view.
        const viz = (res.meta?.visualization as string) || "table";
        setView(viz === "table" ? "table" : "chart");
      })
      .catch((e) => setError(String(e instanceof ApiError ? e.detail : e)))
      .finally(() => setLoading(false));
  }, [spec]);

  const handleReset = useCallback(() => {
    saved.resetAll();
  }, [saved]);

  const vizKind = (data?.meta?.visualization as string) || "table";
  const dims = useMemo(() => data?.columns.filter((c) => c.kind === "dimension") ?? [], [data]);
  const measures = useMemo(() => data?.columns.filter((c) => c.kind === "measure") ?? [], [data]);

  // Recharts needs a display-labelled copy: replace the dN/mN keys with labels.
  const chartRows = useMemo(() => {
    if (!data) return [];
    return data.rows.map((row) => {
      const out: Record<string, string | number> = {};
      for (const col of data.columns) out[col.label] = row[col.key];
      return out;
    });
  }, [data]);

  if (!spec) {
    return (
      <ReportShell title={t("reports:custom.title")} icon="auto_awesome" iconColor="#1976d2">
        <Alert severity="info" variant="outlined">
          {t("reports:custom.empty")}
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t("reports:custom.emptyHint")}
        </Typography>
      </ReportShell>
    );
  }

  const baseTick = { fontSize: 12, fill: theme.palette.text.secondary };
  const rtlTick = isRtl ? makeRtlAxisTick(theme.palette.text.secondary) : baseTick;

  const renderChart = () => {
    if (!data || data.rows.length === 0) {
      return (
        <Alert severity="info" variant="outlined">
          {t("reports:custom.noData")}
        </Alert>
      );
    }
    const dimLabel = dims[0]?.label;
    const measureLabels = measures.map((m) => m.label);

    if (vizKind === "kpi") {
      return (
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {measures.map((m, i) => (
            <MetricCard
              key={m.key}
              label={m.label}
              value={String(data.rows[0]?.[m.key] ?? 0)}
              icon="insights"
              iconColor={PALETTE[i % PALETTE.length]}
              color={PALETTE[i % PALETTE.length]}
            />
          ))}
        </Box>
      );
    }

    if (vizKind === "pie" || vizKind === "donut") {
      const measureLabel = measureLabels[0];
      return (
        <ResponsiveContainer width="100%" height={420}>
          <PieChart>
            <Pie
              data={chartRows}
              dataKey={measureLabel}
              nameKey={dimLabel}
              cx="50%"
              cy="50%"
              outerRadius={150}
              innerRadius={vizKind === "donut" ? 80 : 0}
              label
            >
              {chartRows.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <RTooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (vizKind === "scatter") {
      const [xLabel, yLabel] = measureLabels;
      return (
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={mirrorChartMargin({ top: 20, right: 30, bottom: 20, left: 20 }, isRtl)}>
            <CartesianGrid />
            <XAxis type="number" dataKey={xLabel} name={xLabel} tick={rtlTick} />
            <YAxis type="number" dataKey={yLabel} name={yLabel} />
            <ZAxis range={[80, 80]} />
            <RTooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={chartRows} fill={PALETTE[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    if (vizKind === "treemap") {
      const measureLabel = measureLabels[0];
      const treeData = chartRows.map((r, i) => ({
        name: String(r[dimLabel ?? ""] ?? ""),
        size: Number(r[measureLabel] ?? 0),
        fill: PALETTE[i % PALETTE.length],
      }));
      return (
        <ResponsiveContainer width="100%" height={420}>
          <Treemap data={treeData} dataKey="size" nameKey="name" stroke="#fff">
            <RTooltip />
          </Treemap>
        </ResponsiveContainer>
      );
    }

    if (vizKind === "line") {
      return (
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={chartRows} margin={mirrorChartMargin({ top: 20, right: 30, bottom: 20, left: 20 }, isRtl)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={dimLabel} tick={rtlTick} />
            <YAxis />
            <RTooltip />
            <Legend />
            {measureLabels.map((ml, i) => (
              <Line key={ml} type="monotone" dataKey={ml} stroke={PALETTE[i % PALETTE.length]} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    // bar (horizontal) / column (vertical) — default.
    const horizontal = vizKind === "bar";
    return (
      <ResponsiveContainer width="100%" height={420}>
        <BarChart
          data={chartRows}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={mirrorChartMargin({ top: 20, right: 30, bottom: 20, left: 20 }, isRtl)}
        >
          <CartesianGrid strokeDasharray="3 3" />
          {horizontal ? (
            <>
              <XAxis type="number" tick={rtlTick} />
              <YAxis type="category" dataKey={dimLabel} width={140} />
            </>
          ) : (
            <>
              <XAxis dataKey={dimLabel} tick={rtlTick} />
              <YAxis />
            </>
          )}
          <RTooltip />
          <Legend />
          {measureLabels.map((ml, i) => (
            <Bar key={ml} dataKey={ml} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  const renderTable = () => {
    if (!data) return null;
    return (
      <Paper variant="outlined" sx={{ overflow: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {data.columns.map((c) => (
                <TableCell key={c.key} align={c.kind === "measure" ? "right" : "left"}>
                  {c.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.rows.map((row, i) => (
              <TableRow key={i} data-export-row>
                {data.columns.map((c) => (
                  <TableCell key={c.key} align={c.kind === "measure" ? "right" : "left"}>
                    {row[c.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    );
  };

  return (
    <ReportShell
      title={(spec.title as string) || t("reports:custom.title")}
      icon="auto_awesome"
      iconColor="#1976d2"
      paginateRowSelector="[data-export-row]"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
    >
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!loading && !error && data && (
        <>
          {data.meta.truncated && (
            <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
              {t("reports:custom.truncated")}
            </Alert>
          )}
          <div ref={chartRef}>{view === "chart" ? renderChart() : renderTable()}</div>
        </>
      )}
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="custom"
        config={spec}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
