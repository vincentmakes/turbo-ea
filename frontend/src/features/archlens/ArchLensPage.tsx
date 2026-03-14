import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type {
  ArchLensAnalysisRun,
  ArchLensConnection,
  ArchLensDuplicateCluster,
  ArchLensVendor,
  ArchitectureResult,
} from "@/types";

interface TabPanelProps {
  children: React.ReactNode;
  index: number;
  value: number;
}
function TabPanel({ children, value, index }: TabPanelProps) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ── Mermaid diagram renderer ─────────────────────────────────────────────────
let mermaidLoadPromise: Promise<void> | null = null;
function ensureMermaid(): Promise<void> {
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).mermaid) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
    s.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });
      resolve();
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return mermaidLoadPromise;
}

function MermaidDiagram({ code }: { code: string }) {
  const { t } = useTranslation("admin");
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!code) return;
    setSvg(""); setErr("");
    ensureMermaid().then(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = (window as any).mermaid;
        const res = await m.render("mmd-" + Date.now(), code);
        setSvg(res.svg);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Render failed");
      }
    }).catch(() => setErr("Failed to load Mermaid library"));
  }, [code]);

  if (err) return (
    <Box sx={{ p: 2 }}>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t("archlens_arch_diagram_error")}
      </Alert>
      <Box component="pre" sx={{ fontFamily: "monospace", fontSize: 12, bgcolor: "grey.50", p: 2, borderRadius: 1, overflow: "auto", maxHeight: 500 }}>
        {code}
      </Box>
    </Box>
  );

  if (!svg) return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 4 }}>
      <CircularProgress size={24} />
      <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
        {t("archlens_arch_rendering_diagram")}
      </Typography>
    </Box>
  );

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", alignItems: "center" }}>
        <IconButton size="small" onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}>
          <MaterialSymbol icon="remove" size={18} />
        </IconButton>
        <Typography variant="caption" sx={{ minWidth: 40, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </Typography>
        <IconButton size="small" onClick={() => setZoom(z => Math.min(3, z + 0.1))}>
          <MaterialSymbol icon="add" size={18} />
        </IconButton>
        <Button size="small" onClick={() => setZoom(1)}>Reset</Button>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="download" size={16} />}
          onClick={() => {
            const b = new Blob([svg], { type: "image/svg+xml" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b);
            a.download = "architecture.svg";
            a.click();
          }}
        >
          SVG
        </Button>
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="content_copy" size={16} />}
          onClick={() => navigator.clipboard?.writeText(code)}
        >
          Mermaid
        </Button>
      </Stack>
      <Box sx={{ overflow: "auto", p: 3, bgcolor: "#fff", minHeight: 300 }}>
        <Box
          sx={{ transform: `scale(${zoom})`, transformOrigin: "top left", transition: "transform .15s" }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </Box>
    </Box>
  );
}

// ── Architecture result view ─────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  existing: "#4caf50",
  new: "#2196f3",
  recommended: "#ff9800",
};

function ArchitectureResultView({ arch, onReset }: { arch: ArchitectureResult; onReset: () => void }) {
  const { t } = useTranslation("admin");
  const [resultTab, setResultTab] = useState(0);

  const allComps = (arch.layers ?? []).flatMap(l => l.components ?? []);
  const existingCnt = allComps.filter(c => c.existsInLandscape || c.type === "existing").length;
  const newCnt = allComps.length - existingCnt;
  const gapCount = (arch.gaps ?? []).length;
  const criticalGaps = (arch.gaps ?? []).filter(g => g.urgency === "critical").length;
  const integrationCount = (arch.integrations ?? []).length;
  const hasStructuredData = (arch.layers?.length ?? 0) > 0 || gapCount > 0 || integrationCount > 0;

  const typeChipColor = (tp: string) => tp === "existing" ? "success" as const : tp === "new" ? "primary" as const : "warning" as const;
  const urgencyColor = (u?: string) => u === "critical" ? "error" as const : u === "high" ? "warning" as const : "default" as const;
  const severityIcon = (s?: string) => s === "high" ? "error" : s === "medium" ? "warning" : "check_circle";
  const severityColor = (s?: string) => s === "high" ? "#d32f2f" : s === "medium" ? "#ed6c02" : "#2e7d32";
  const effortColor = (e?: string) => e === "high" ? "error" as const : e === "medium" ? "warning" as const : "success" as const;

  // If the result is legacy (no structured layers), fall back to raw display
  if (!hasStructuredData) {
    return (
      <Box>
        {typeof arch.summary === "string" && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{t("archlens_architect_summary")}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{arch.summary}</Typography>
          </Paper>
        )}
        {typeof arch.architecture === "string" && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{t("archlens_architect_result_title")}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>
              {arch.architecture}
            </Typography>
          </Paper>
        )}
        {typeof arch.diagram === "string" && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{t("archlens_architect_diagram")}</Typography>
            <Box component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, fontFamily: "monospace", bgcolor: "grey.50", p: 2, borderRadius: 1, overflow: "auto" }}>
              {arch.diagram}
            </Box>
          </Paper>
        )}
        {!arch.summary && !arch.architecture && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0 }}>
              {JSON.stringify(arch, null, 2)}
            </pre>
          </Paper>
        )}
        <Button variant="outlined" onClick={onReset}>{t("archlens_architect_start_over")}</Button>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header: Title + pattern + summary + duration/complexity */}
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }} flexWrap="wrap">
              {arch.title && <Typography variant="h6" fontWeight={700}>{arch.title}</Typography>}
              {arch.architecturalPattern && (
                <Chip label={arch.architecturalPattern} size="small" color="primary" variant="outlined" />
              )}
            </Stack>
            {arch.summary && (
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6, maxWidth: 760 }}>
                {arch.summary}
              </Typography>
            )}
            {(arch.estimatedDuration || arch.estimatedComplexity) && (
              <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                {arch.estimatedDuration && (
                  <Typography variant="caption" color="text.secondary">
                    {t("archlens_arch_timeline")}: <strong>{arch.estimatedDuration}</strong>
                  </Typography>
                )}
                {arch.estimatedComplexity && (
                  <Typography variant="caption" color="text.secondary">
                    {t("archlens_arch_complexity")}: <strong>{arch.estimatedComplexity.replace("_", " ")}</strong>
                  </Typography>
                )}
              </Stack>
            )}
          </Box>
          <Button variant="outlined" size="small" onClick={onReset}>
            {t("archlens_architect_start_over")}
          </Button>
        </Stack>

        {/* KPI strip */}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
          <Chip
            icon={<MaterialSymbol icon="check_circle" size={16} />}
            label={`${existingCnt} ${t("archlens_arch_existing_reused")}`}
            color="success"
            variant="outlined"
            size="small"
          />
          <Chip
            icon={<MaterialSymbol icon="add_circle" size={16} />}
            label={`${newCnt} ${t("archlens_arch_new_components")}`}
            color="primary"
            variant="outlined"
            size="small"
          />
          {gapCount > 0 && (
            <Chip
              icon={<MaterialSymbol icon="report_problem" size={16} />}
              label={`${gapCount} ${t("archlens_arch_gaps")}${criticalGaps > 0 ? ` (${criticalGaps} ${t("archlens_arch_critical")})` : ""}`}
              color={criticalGaps > 0 ? "error" : "warning"}
              variant="outlined"
              size="small"
            />
          )}
          <Chip
            icon={<MaterialSymbol icon="sync_alt" size={16} />}
            label={`${integrationCount} ${t("archlens_arch_integrations")}`}
            variant="outlined"
            size="small"
          />
        </Stack>

        {/* NFR decisions grid */}
        {arch.nfrDecisions && Object.values(arch.nfrDecisions).some(Boolean) && (
          <Grid container spacing={1} sx={{ mt: 1 }}>
            {Object.entries(arch.nfrDecisions).map(([key, val]) => val ? (
              <Grid item key={key} xs={6} sm={4} md={3}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1.2 }}>
                    {key}
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ lineHeight: 1.4 }}>
                    {val}
                  </Typography>
                </Paper>
              </Grid>
            ) : null)}
          </Grid>
        )}
      </Box>

      {/* Tabs */}
      <Tabs value={resultTab} onChange={(_, v) => setResultTab(v)} sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tab label={t("archlens_architect_diagram")} />
        <Tab label={t("archlens_arch_tab_layers")} />
        <Tab label={`${t("archlens_arch_tab_gaps")}${gapCount > 0 ? ` (${gapCount})` : ""}`} />
        <Tab label={t("archlens_arch_tab_integrations")} />
        <Tab label={t("archlens_arch_tab_plan")} />
      </Tabs>

      {/* Tab 0: Diagram */}
      <TabPanel value={resultTab} index={0}>
        <Paper variant="outlined">
          <Stack direction="row" spacing={1} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
            {([["existing", t("archlens_arch_legend_existing")], ["new", t("archlens_arch_legend_new")], ["recommended", t("archlens_arch_legend_recommended")]] as [string, string][]).map(([key, label]) => (
              <Chip
                key={key}
                size="small"
                label={label}
                sx={{ bgcolor: TYPE_COLORS[key] + "18", color: TYPE_COLORS[key], border: `1px solid ${TYPE_COLORS[key]}44`, fontWeight: 600, fontSize: 11 }}
              />
            ))}
          </Stack>
          {arch.mermaidDiagram ? (
            <MermaidDiagram code={arch.mermaidDiagram} />
          ) : (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography color="text.secondary">{t("archlens_arch_no_diagram")}</Typography>
            </Box>
          )}
        </Paper>
      </TabPanel>

      {/* Tab 1: Component Layers */}
      <TabPanel value={resultTab} index={1}>
        <Stack spacing={2}>
          {(arch.layers ?? []).map((layer, li) => (
            <Paper key={li} variant="outlined">
              <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="subtitle2" fontWeight={700}>{layer.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {(layer.components ?? []).length} {t("archlens_arch_components")}
                </Typography>
              </Box>
              <Grid container spacing={0} sx={{ "& > *": { borderBottom: 1, borderRight: 1, borderColor: "divider" } }}>
                {(layer.components ?? []).map((comp, ci) => (
                  <Grid item key={ci} xs={12} sm={6} md={4}>
                    <Box sx={{ p: 2, borderLeft: 3, borderColor: TYPE_COLORS[comp.type] || "#999" }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={600}>{comp.name}</Typography>
                        <Chip
                          label={comp.type === "existing" ? t("archlens_arch_in_landscape") : comp.type === "new" ? t("archlens_arch_custom_build") : t("archlens_arch_legend_recommended")}
                          size="small"
                          color={typeChipColor(comp.type)}
                          variant="outlined"
                          sx={{ fontSize: 10, height: 20 }}
                        />
                      </Stack>
                      {comp.product && comp.product !== comp.name && (
                        <Typography variant="caption" color="primary" sx={{ fontWeight: 500 }}>
                          {comp.product}
                        </Typography>
                      )}
                      {comp.category && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {comp.category}
                        </Typography>
                      )}
                      {comp.role && (
                        <Typography variant="caption" display="block" color="text.secondary" sx={{ lineHeight: 1.5, mt: 0.5 }}>
                          {comp.role}
                        </Typography>
                      )}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          ))}
        </Stack>
      </TabPanel>

      {/* Tab 2: Gaps & Recommendations */}
      <TabPanel value={resultTab} index={2}>
        {gapCount === 0 ? (
          <Alert severity="success">{t("archlens_arch_no_gaps")}</Alert>
        ) : (
          <Stack spacing={3}>
            {(arch.gaps ?? []).map((gap, gi) => (
              <Paper key={gi} variant="outlined" sx={{ borderTop: 3, borderColor: gap.urgency === "critical" ? "error.main" : gap.urgency === "high" ? "warning.main" : "grey.400" }}>
                <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="subtitle2" fontWeight={700}>{gap.capability}</Typography>
                    {gap.urgency && (
                      <Chip
                        label={gap.urgency.toUpperCase()}
                        size="small"
                        color={urgencyColor(gap.urgency)}
                        sx={{ fontSize: 10, fontWeight: 700, height: 20 }}
                      />
                    )}
                  </Stack>
                  {gap.impact && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {t("archlens_arch_impact")}: {gap.impact}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ p: 2 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, mb: 1.5, display: "block" }}>
                    {t("archlens_arch_market_recommendations")}
                  </Typography>
                  <Grid container spacing={1.5}>
                    {(gap.recommendations ?? []).map((rec, ri) => (
                      <Grid item key={ri} xs={12} sm={6} md={4}>
                        <Paper
                          variant="outlined"
                          sx={{
                            p: 2,
                            height: "100%",
                            bgcolor: rec.recommended ? "primary.50" : undefined,
                            borderTop: 3,
                            borderColor: ri === 0 ? "#FFD700" : ri === 1 ? "#C0C0C0" : "#CD7F32",
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                            <Typography variant="caption" fontWeight={700} sx={{ color: ri === 0 ? "#B8860B" : ri === 1 ? "#808080" : "#8B4513" }}>
                              #{ri + 1}
                            </Typography>
                            <Typography variant="body2" fontWeight={600}>{rec.name}</Typography>
                            {rec.recommended && (
                              <Chip label={t("archlens_arch_top_pick")} size="small" color="primary" sx={{ fontSize: 10, height: 18 }} />
                            )}
                          </Stack>
                          {rec.vendor && (
                            <Typography variant="caption" color="primary">{rec.vendor}</Typography>
                          )}
                          {rec.why && (
                            <Typography variant="caption" display="block" color="text.secondary" sx={{ lineHeight: 1.5, my: 0.5 }}>
                              {rec.why}
                            </Typography>
                          )}
                          {rec.pros?.map((p, i) => (
                            <Typography key={`p${i}`} variant="caption" display="block" sx={{ color: "success.main" }}>
                              + {p}
                            </Typography>
                          ))}
                          {rec.cons?.map((c, i) => (
                            <Typography key={`c${i}`} variant="caption" display="block" color="text.secondary">
                              - {c}
                            </Typography>
                          ))}
                          <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap">
                            {rec.estimatedCost && (
                              <Chip label={rec.estimatedCost} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                            )}
                            {rec.integrationEffort && (
                              <Chip
                                label={`${rec.integrationEffort} ${t("archlens_arch_effort")}`}
                                size="small"
                                color={effortColor(rec.integrationEffort)}
                                variant="outlined"
                                sx={{ fontSize: 10, height: 20 }}
                              />
                            )}
                          </Stack>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              </Paper>
            ))}
          </Stack>
        )}
      </TabPanel>

      {/* Tab 3: Integrations */}
      <TabPanel value={resultTab} index={3}>
        <Paper variant="outlined">
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between" }}>
            <Typography variant="subtitle2" fontWeight={700}>{t("archlens_arch_integration_map")}</Typography>
            <Typography variant="caption" color="text.secondary">
              {integrationCount} {t("archlens_arch_integrations")}
            </Typography>
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("archlens_arch_from")}</TableCell>
                  <TableCell>{t("archlens_arch_to")}</TableCell>
                  <TableCell>{t("archlens_arch_protocol")}</TableCell>
                  <TableCell>{t("archlens_arch_direction")}</TableCell>
                  <TableCell>{t("archlens_arch_data_flows")}</TableCell>
                  <TableCell>{t("archlens_arch_notes")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(arch.integrations ?? []).map((intg, i) => (
                  <TableRow key={i}>
                    <TableCell><Typography variant="body2" fontWeight={600}>{intg.from}</Typography></TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <MaterialSymbol icon="arrow_forward" size={14} color="#999" />
                        <Typography variant="body2" fontWeight={600}>{intg.to}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip label={intg.protocol || "API"} size="small" color="primary" variant="outlined" sx={{ fontSize: 11 }} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={intg.direction || "sync"}
                        size="small"
                        color={intg.direction === "async" ? "warning" : "default"}
                        variant="outlined"
                        sx={{ fontSize: 10 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 200, display: "block" }}>
                        {intg.dataFlows}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 180, display: "block" }}>
                        {intg.notes}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      </TabPanel>

      {/* Tab 4: Risks & Next Steps */}
      <TabPanel value={resultTab} index={4}>
        <Grid container spacing={2}>
          {/* Next Steps */}
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ height: "100%" }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                <Typography variant="subtitle2" fontWeight={700}>{t("archlens_arch_next_steps")}</Typography>
              </Box>
              <List dense disablePadding>
                {(arch.nextSteps ?? []).map((step, i) => {
                  const s = typeof step === "string" ? { step } : step;
                  return (
                    <ListItem
                      key={i}
                      sx={{ borderBottom: i < (arch.nextSteps?.length ?? 0) - 1 ? 1 : 0, borderColor: "divider", alignItems: "flex-start", py: 1.5 }}
                    >
                      <Box sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: "primary.main", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mr: 1.5, mt: 0.3 }}>
                        {i + 1}
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{s.step}</Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap">
                          {s.owner && <Chip label={s.owner} size="small" color="primary" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                          {s.timeline && <Chip label={s.timeline} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                          {s.effort && <Chip label={s.effort} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                        </Stack>
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
          </Grid>
          {/* Risks */}
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ height: "100%" }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                <Typography variant="subtitle2" fontWeight={700}>{t("archlens_arch_risks")}</Typography>
              </Box>
              <List dense disablePadding>
                {(arch.risks ?? []).map((risk, i) => {
                  const r = typeof risk === "string" ? { risk, severity: "medium" } : risk;
                  return (
                    <ListItem
                      key={i}
                      sx={{ borderBottom: i < (arch.risks?.length ?? 0) - 1 ? 1 : 0, borderColor: "divider", alignItems: "flex-start", py: 1.5 }}
                    >
                      <MaterialSymbol
                        icon={severityIcon(r.severity)}
                        size={20}
                        color={severityColor(r.severity)}
                        style={{ marginRight: 8, marginTop: 2, flexShrink: 0 }}
                      />
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight={500} sx={{ lineHeight: 1.5 }}>
                          {r.risk}
                        </Typography>
                        {r.mitigation && (
                          <Typography variant="caption" color="text.secondary" fontStyle="italic">
                            {t("archlens_arch_mitigation")}: {r.mitigation}
                          </Typography>
                        )}
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
          </Grid>
        </Grid>
      </TabPanel>
    </Box>
  );
}

export default function ArchLensPage() {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState(0);
  const [connections, setConnections] = useState<ArchLensConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<ArchLensConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<ArchLensVendor[]>([]);
  const [duplicates, setDuplicates] = useState<ArchLensDuplicateCluster[]>([]);
  const [analysisRuns, setAnalysisRuns] = useState<ArchLensAnalysisRun[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(
    null,
  );

  // Architect state
  const [archReq, setArchReq] = useState("");
  const [archPhase, setArchPhase] = useState(0);
  const [archResult, setArchResult] = useState<Record<string, unknown> | null>(null);
  const [archLoading, setArchLoading] = useState(false);
  // Q&A state: questions extracted from phase responses, answers keyed by index
  const [archQuestions, setArchQuestions] = useState<
    { question: string; context?: string; answer: string }[]
  >([]);
  // Accumulated Q&A from previous phases for passing to phase 3
  const [phase1Answers, setPhase1Answers] = useState<
    { question: string; answer: string }[]
  >([]);

  const loadConnections = useCallback(async () => {
    try {
      const data = await api.get<ArchLensConnection[]>("/archlens/connections");
      setConnections(data);
      if (data.length && !selectedConn) setSelectedConn(data[0]);
    } catch {
      /* noop */
    }
  }, [selectedConn]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const hasConnection = connections.length > 0 && selectedConn;

  // ── Vendor analysis ──
  const loadVendors = async () => {
    if (!selectedConn) return;
    try {
      const data = await api.get<ArchLensVendor[]>(
        `/archlens/connections/${selectedConn.id}/vendors`,
      );
      setVendors(data);
    } catch {
      /* noop */
    }
  };

  const triggerVendorAnalysis = async () => {
    if (!selectedConn) return;
    setLoading(true);
    try {
      await api.post(`/archlens/connections/${selectedConn.id}/analyse/vendors`);
      setFeedback({ type: "success", msg: t("archlens_analysis_started") });
      loadVendors();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Duplicate detection ──
  const loadDuplicates = async () => {
    if (!selectedConn) return;
    try {
      const data = await api.get<ArchLensDuplicateCluster[]>(
        `/archlens/connections/${selectedConn.id}/duplicates`,
      );
      setDuplicates(data);
    } catch {
      /* noop */
    }
  };

  const triggerDuplicateDetection = async () => {
    if (!selectedConn) return;
    setLoading(true);
    try {
      await api.post(`/archlens/connections/${selectedConn.id}/analyse/duplicates`);
      setFeedback({ type: "success", msg: t("archlens_analysis_started") });
      loadDuplicates();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Architecture AI ──

  // Extract questions array from a phase response (handles various formats)
  const extractQuestions = (
    data: Record<string, unknown>,
  ): { question: string; context?: string }[] => {
    // Could be { questions: [...] } or the response itself could be an array
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data.questions)
        ? data.questions
        : Array.isArray(data.items)
          ? data.items
          : null;
    if (!raw) return [];
    return raw.map((q: Record<string, unknown> | string) =>
      typeof q === "string"
        ? { question: q }
        : { question: String(q.question || q.text || q.q || ""), context: q.context as string },
    );
  };

  const runArchitectPhase = async (phase: number) => {
    if (!selectedConn) return;
    setArchLoading(true);
    try {
      const payload: Record<string, unknown> = { phase, requirement: archReq };

      if (phase === 2) {
        // Send phase 1 answers as an array of {question, answer} objects
        const qa = archQuestions.map((q) => ({ question: q.question, answer: q.answer }));
        payload.phase1QA = qa;
        setPhase1Answers(qa);
      }
      if (phase === 3) {
        // Send all Q&A (phase 1 + phase 2 answers)
        const phase2qa = archQuestions.map((q) => ({ question: q.question, answer: q.answer }));
        payload.allQA = [...phase1Answers, ...phase2qa];
      }

      const result = await api.post<Record<string, unknown>>(
        `/archlens/connections/${selectedConn.id}/architect`,
        payload,
      );
      setArchResult(result);
      setArchPhase(phase);

      // For phases 1 and 2, extract questions for the user to answer
      if (phase < 3) {
        const questions = extractQuestions(result);
        setArchQuestions(questions.map((q) => ({ ...q, answer: "" })));
      } else {
        setArchQuestions([]);
      }
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setArchLoading(false);
    }
  };

  const handleArchAnswerChange = (index: number, value: string) => {
    setArchQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, answer: value } : q)),
    );
  };

  const allQuestionsAnswered = archQuestions.length > 0 && archQuestions.every((q) => q.answer.trim());

  const resetArchitect = () => {
    setArchPhase(0);
    setArchResult(null);
    setArchQuestions([]);
    setPhase1Answers([]);
  };

  // ── Analysis runs ──
  const loadAnalysisRuns = async () => {
    try {
      const params = selectedConn ? `?connection_id=${selectedConn.id}` : "";
      const data = await api.get<ArchLensAnalysisRun[]>(`/archlens/analysis-runs${params}`);
      setAnalysisRuns(data);
    } catch {
      /* noop */
    }
  };

  // Load tab data on tab change
  useEffect(() => {
    if (tab === 0) loadVendors();
    if (tab === 1) loadDuplicates();
    if (tab === 3) loadAnalysisRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedConn]);

  // ── No connection state ──
  if (!hasConnection) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          <MaterialSymbol
            icon="psychology"
            style={{ marginRight: 8, verticalAlign: "middle" }}
          />
          {t("archlens_title")}
        </Typography>
        <Paper sx={{ p: 4, textAlign: "center", mt: 2 }}>
          <MaterialSymbol icon="link_off" size={48} color="#999" />
          <Typography variant="h6" sx={{ mt: 2 }}>
            {t("archlens_no_connection_title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("archlens_no_connection_description")}
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h5">
          <MaterialSymbol
            icon="psychology"
            style={{ marginRight: 8, verticalAlign: "middle" }}
          />
          {t("archlens_title")}
        </Typography>
        {connections.length > 1 ? (
          <Stack direction="row" spacing={1} alignItems="center">
            {connections.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                variant={selectedConn?.id === c.id ? "filled" : "outlined"}
                color={selectedConn?.id === c.id ? "primary" : "default"}
                onClick={() => setSelectedConn(c)}
                size="small"
              />
            ))}
          </Stack>
        ) : (
          <Tooltip title={selectedConn?.instance_url ?? ""}>
            <Chip
              label={selectedConn?.name}
              color={selectedConn?.test_status === "ok" ? "success" : "default"}
              size="small"
              icon={
                <MaterialSymbol
                  icon={selectedConn?.test_status === "ok" ? "check_circle" : "pending"}
                  size={16}
                />
              }
            />
          </Tooltip>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("archlens_description")}
      </Typography>

      {feedback && (
        <Alert severity={feedback.type} onClose={() => setFeedback(null)} sx={{ mb: 2 }}>
          {feedback.msg}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
        <Tab label={t("archlens_tab_vendors")} />
        <Tab label={t("archlens_tab_duplicates")} />
        <Tab label={t("archlens_tab_architect")} />
        <Tab label={t("archlens_tab_history")} />
      </Tabs>

      {/* ── Vendor Analysis Tab ────────────────────────────────────────── */}
      <TabPanel value={tab} index={0}>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button variant="contained" onClick={triggerVendorAnalysis} disabled={loading}>
            {loading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            {t("archlens_run_vendor_analysis")}
          </Button>
        </Stack>
        {vendors.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">{t("archlens_no_vendor_data")}</Typography>
          </Paper>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("archlens_vendor_name")}</TableCell>
                <TableCell>{t("archlens_vendor_category")}</TableCell>
                <TableCell align="right">{t("archlens_vendor_apps")}</TableCell>
                <TableCell align="right">{t("archlens_vendor_cost")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {vendors.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{v.vendor_name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={v.category || "—"} />
                  </TableCell>
                  <TableCell align="right">{v.app_count}</TableCell>
                  <TableCell align="right">
                    {v.total_cost ? v.total_cost.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabPanel>

      {/* ── Duplicate Detection Tab ────────────────────────────────────── */}
      <TabPanel value={tab} index={1}>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button variant="contained" onClick={triggerDuplicateDetection} disabled={loading}>
            {loading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            {t("archlens_run_duplicate_detection")}
          </Button>
        </Stack>
        {duplicates.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">{t("archlens_no_duplicate_data")}</Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {duplicates.map((cluster) => (
              <Card key={cluster.id} variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight="bold">
                      {cluster.cluster_name}
                    </Typography>
                    <Chip size="small" label={cluster.fs_type} color="primary" />
                    <Chip
                      size="small"
                      label={cluster.status}
                      color={cluster.status === "pending" ? "warning" : "default"}
                    />
                  </Stack>
                  {cluster.functional_domain && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {cluster.functional_domain}
                    </Typography>
                  )}
                  <List dense disablePadding>
                    {(cluster.fs_names || []).map((name, i) => (
                      <ListItem key={i} disableGutters>
                        <ListItemText primary={name} />
                      </ListItem>
                    ))}
                  </List>
                  {cluster.evidence && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mt: 1, display: "block" }}
                    >
                      {cluster.evidence}
                    </Typography>
                  )}
                  {cluster.recommendation && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      {cluster.recommendation}
                    </Alert>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </TabPanel>

      {/* ── Architecture AI Tab ────────────────────────────────────────── */}
      <TabPanel value={tab} index={2}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            {t("archlens_architect_title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("archlens_architect_description")}
          </Typography>

          {/* Step indicator */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            {[1, 2, 3].map((p) => (
              <Chip
                key={p}
                label={`${t("archlens_phase")} ${p}`}
                color={archPhase >= p ? "primary" : "default"}
                variant={archPhase === p ? "filled" : "outlined"}
                size="small"
              />
            ))}
          </Stack>

          {/* Phase 0: Enter requirement */}
          {archPhase === 0 && (
            <>
              <TextField
                label={t("archlens_architect_requirement")}
                value={archReq}
                onChange={(e) => setArchReq(e.target.value)}
                fullWidth
                multiline
                minRows={3}
                sx={{ mb: 2 }}
              />
              <Button
                variant="contained"
                onClick={() => runArchitectPhase(1)}
                disabled={archLoading || !archReq}
                startIcon={
                  archLoading ? <CircularProgress size={18} /> : undefined
                }
              >
                {t("archlens_architect_generate_questions")}
              </Button>
            </>
          )}

          {/* Phase 1 & 2: Show questions with answer inputs */}
          {(archPhase === 1 || archPhase === 2) && !archLoading && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {archPhase === 1
                  ? t("archlens_architect_phase1_intro")
                  : t("archlens_architect_phase2_intro")}
              </Typography>
              <Stack spacing={2} sx={{ mb: 2 }}>
                {archQuestions.map((q, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body2" fontWeight="bold" sx={{ mb: 0.5 }}>
                      {i + 1}. {q.question}
                    </Typography>
                    {q.context && (
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
                        {q.context}
                      </Typography>
                    )}
                    <TextField
                      value={q.answer}
                      onChange={(e) => handleArchAnswerChange(i, e.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                      size="small"
                      placeholder={t("archlens_architect_answer_placeholder")}
                      sx={{ mt: 1 }}
                    />
                  </Paper>
                ))}
              </Stack>
              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  onClick={() => runArchitectPhase(archPhase + 1)}
                  disabled={!allQuestionsAnswered}
                >
                  {archPhase === 1
                    ? t("archlens_architect_submit_phase2")
                    : t("archlens_architect_generate_architecture")}
                </Button>
                <Button variant="text" onClick={resetArchitect} color="inherit">
                  {t("archlens_architect_start_over")}
                </Button>
              </Stack>
            </>
          )}

          {/* Phase 3: Show architecture result */}
          {archPhase === 3 && !archLoading && archResult && (
            <ArchitectureResultView
              arch={archResult as ArchitectureResult}
              onReset={resetArchitect}
            />
          )}

          {archLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 3 }}>
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary">
                {t("archlens_architect_loading")}
              </Typography>
            </Box>
          )}
        </Paper>
      </TabPanel>

      {/* ── Analysis History Tab ───────────────────────────────────────── */}
      <TabPanel value={tab} index={3}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("archlens_analysis_type")}</TableCell>
              <TableCell>{t("archlens_status")}</TableCell>
              <TableCell>{t("archlens_started_at")}</TableCell>
              <TableCell>{t("archlens_completed_at")}</TableCell>
              <TableCell>{t("archlens_error")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {analysisRuns.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{run.analysis_type}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={run.status}
                    color={
                      run.status === "completed"
                        ? "success"
                        : run.status === "failed"
                          ? "error"
                          : "warning"
                    }
                  />
                </TableCell>
                <TableCell>
                  {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>
                  {run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>{run.error_message || "—"}</TableCell>
              </TableRow>
            ))}
            {analysisRuns.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography variant="body2" color="text.secondary">
                    {t("archlens_no_history")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TabPanel>
    </Box>
  );
}
