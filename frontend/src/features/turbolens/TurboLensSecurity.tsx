/**
 * TurboLensSecurity — on-demand CVE + compliance scan.
 *
 * Mirrors the Duplicates / Vendors pattern: trigger via POST, poll the
 * analysis run, then reload findings. Three inner sub-tabs: Overview,
 * CVEs table, Compliance.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Grid from "@mui/material/Grid";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import type {
  ComplianceDecision,
  ComplianceStatus,
  CveStatus,
  CveFindingsPage,
  RegulationKey,
  SecurityActiveRuns,
  SecurityScanRun,
  TurboLensComplianceBundle,
  TurboLensComplianceFinding,
  TurboLensCveFinding,
  TurboLensSecurityOverview,
} from "@/types";
import ComplianceHeatmap from "./ComplianceHeatmap";
import CreateRiskDialog from "@/features/grc/risk/CreateRiskDialog";
import {
  RiskDialogSeed,
  seedFromCompliance,
  seedFromCve,
} from "@/features/grc/risk/riskDefaults";
import { useNavigate } from "react-router-dom";
import type { Risk } from "@/types";
import SecurityFindingDrawer from "./SecurityFindingDrawer";
import SecurityScanCard from "./SecurityScanCard";
import { useAnalysisPolling } from "./useAnalysisPolling";
import {
  complianceDecisionColor,
  complianceStatusColor,
  cveSeverityColor,
  cveStatusColor,
  priorityColor,
  probabilityColor,
} from "./utils";
import RiskMatrixLegend from "../grc/risk/RiskMatrixLegend";
import {
  deriveLevelFromPair,
  riskLevelBackground,
} from "../grc/risk/riskMatrixColors";

const REGULATIONS: RegulationKey[] = [
  "eu_ai_act",
  "gdpr",
  "nis2",
  "dora",
  "soc2",
  "iso27001",
];

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const STATUSES = ["open", "acknowledged", "in_progress", "mitigated", "accepted"] as const;
const CARD_TYPES = ["Application", "ITComponent"] as const;

const PROBABILITY_LABELS: Array<"very_high" | "high" | "medium" | "low" | "unknown"> = [
  "very_high",
  "high",
  "medium",
  "low",
  "unknown",
];
const SEVERITY_LABELS: Array<"critical" | "high" | "medium" | "low" | "unknown"> = [
  "critical",
  "high",
  "medium",
  "low",
  "unknown",
];

// ---------------------------------------------------------------------------

/**
 * Humanize a category slug emitted by the compliance LLM
 * (e.g. "risk_tier_classification" → "Risk Tier Classification").
 * The LLM is prompted to return a short slug, so we render it
 * presentably without round-tripping through i18n.
 */
function humanizeCategory(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TurboLensSecurity() {
  const { t } = useTranslation("admin");
  const { t: tDelivery } = useTranslation("delivery");
  const navigate = useNavigate();
  const phaseLabel = useCallback(
    (phase: string) => {
      const key = `turbolens_security_phase_${phase}`;
      const translated = t(key);
      return translated === key ? phase.replace(/_/g, " ") : translated;
    },
    [t],
  );

  // ── View state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(0);
  const [overview, setOverview] = useState<TurboLensSecurityOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [compliance, setCompliance] = useState<TurboLensComplianceBundle[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(true);

  // ── Findings table state ───────────────────────────────────────────
  const [findings, setFindings] = useState<TurboLensCveFinding[]>([]);
  const [findingsTotal, setFindingsTotal] = useState(0);
  const [findingsLoading, setFindingsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [severityFilter, setSeverityFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [probabilityFilter, setProbabilityFilter] = useState<string>("__all__");

  // ── Compliance filter ──────────────────────────────────────────────
  const [activeRegulation, setActiveRegulation] = useState<RegulationKey>("eu_ai_act");
  const [highlightCell, setHighlightCell] = useState<{
    regulation: RegulationKey;
    status: ComplianceStatus | null;
  } | null>(null);
  // Compliance subtab filters. Status / severity / decision filters are
  // "all selected" by default so every finding is shown. Auto-resolved
  // findings are hidden by default to keep the active workload front and
  // centre; users opt in to see history.
  const [complianceStatusFilter, setComplianceStatusFilter] = useState<
    Set<ComplianceStatus>
  >(
    new Set<ComplianceStatus>([
      "compliant",
      "partial",
      "non_compliant",
      "not_applicable",
      "review_needed",
    ]),
  );
  const [complianceSeverityFilter, setComplianceSeverityFilter] = useState<
    Set<TurboLensComplianceFinding["severity"]>
  >(
    new Set<TurboLensComplianceFinding["severity"]>([
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ]),
  );
  const [complianceDecisionFilter, setComplianceDecisionFilter] = useState<
    Set<ComplianceDecision>
  >(
    new Set<ComplianceDecision>([
      "open",
      "acknowledged",
      "accepted",
      "risk_tracked",
    ]),
  );
  const [complianceAiOnly, setComplianceAiOnly] = useState(false);
  const [complianceIncludeResolved, setComplianceIncludeResolved] =
    useState(false);

  // Card side panel triggered from a finding's card-name click.
  const [cardPanelId, setCardPanelId] = useState<string | null>(null);

  // Inline "accept with rationale" dialog state.
  const [acceptDialog, setAcceptDialog] = useState<{
    finding: TurboLensComplianceFinding;
    note: string;
    saving: boolean;
  } | null>(null);

  // ── Drawer ─────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<TurboLensCveFinding | null>(null);
  const [updating, setUpdating] = useState(false);

  // Risk promotion dialog (used from CVE drawer, CVE rows, compliance cards).
  const [riskSeed, setRiskSeed] = useState<RiskDialogSeed | null>(null);
  const openRisk = useCallback(
    (riskId: string) => navigate(`/grc/risks/${riskId}`),
    [navigate],
  );

  // ── Shared messaging ───────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ── Compliance regulation picker ──────────────────────────────────
  const [selectedRegs, setSelectedRegs] = useState<Set<RegulationKey>>(
    new Set(REGULATIONS),
  );

  // ── Loaders ────────────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const data = await api.get<TurboLensSecurityOverview>("/turbolens/security/overview");
      setOverview(data);
    } catch (e) {
      setOverview(null);
      if (e instanceof ApiError && e.status !== 404) setError(e.message);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadFindings = useCallback(async () => {
    setFindingsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(pageSize),
      });
      if (severityFilter !== "__all__") params.set("severity", severityFilter);
      if (probabilityFilter !== "__all__") params.set("probability", probabilityFilter);
      if (statusFilter !== "__all__") params.set("status", statusFilter);
      if (typeFilter !== "__all__") params.set("card_type", typeFilter);
      const data = await api.get<CveFindingsPage>(`/turbolens/security/findings?${params}`);
      setFindings(data.items);
      setFindingsTotal(data.total);
    } catch {
      setFindings([]);
      setFindingsTotal(0);
    } finally {
      setFindingsLoading(false);
    }
  }, [page, pageSize, severityFilter, probabilityFilter, statusFilter, typeFilter]);

  const loadCompliance = useCallback(async () => {
    setComplianceLoading(true);
    try {
      const data = await api.get<TurboLensComplianceBundle[]>(
        "/turbolens/security/compliance",
      );
      setCompliance(data);
    } catch {
      setCompliance([]);
    } finally {
      setComplianceLoading(false);
    }
  }, []);

  const reloadAll = useCallback(() => {
    loadOverview();
    loadFindings();
    loadCompliance();
  }, [loadOverview, loadFindings, loadCompliance]);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    loadFindings();
  }, [loadFindings]);

  // ── Scan triggers + polling (one pair per scan type) ──────────────
  const { startPolling: startCvePoll, polling: cvePolling } = useAnalysisPolling(
    () => {
      setInfo(t("turbolens_security_cve_scan_complete"));
      reloadAll();
    },
    (msg) => setError(msg),
  );
  const { startPolling: startCompliancePoll, polling: compliancePolling } = useAnalysisPolling(
    () => {
      setInfo(t("turbolens_security_compliance_scan_complete"));
      reloadAll();
    },
    (msg) => setError(msg),
  );

  // Resume polling after a full page refresh — the backend task keeps
  // running server-side, so if a run is still in progress we should
  // reattach the poll loop and keep showing progress.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const active = await api.get<SecurityActiveRuns>(
          "/turbolens/security/active-runs",
        );
        if (cancelled) return;
        if (active.cve?.id) startCvePoll(active.cve.id);
        if (active.compliance?.id) startCompliancePoll(active.compliance.id);
      } catch {
        // Non-fatal: we'll just miss the resume. User can re-trigger.
      }
    })();
    return () => {
      cancelled = true;
    };
    // startCvePoll / startCompliancePoll are stable between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCveScan = async () => {
    setError(null);
    setInfo(null);
    try {
      const res = await api.post<{ run_id: string }>(
        "/turbolens/security/cve-scan",
        {},
      );
      setInfo(t("turbolens_security_cve_scan_started"));
      startCvePoll(res.run_id);
      loadOverview();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(String(e));
    }
  };

  const handleComplianceScan = async () => {
    setError(null);
    setInfo(null);
    if (selectedRegs.size === 0) {
      setError(t("turbolens_security_pick_regulation"));
      return;
    }
    try {
      const res = await api.post<{ run_id: string }>(
        "/turbolens/security/compliance-scan",
        { regulations: Array.from(selectedRegs) },
      );
      setInfo(t("turbolens_security_compliance_scan_started"));
      startCompliancePoll(res.run_id);
      loadOverview();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(String(e));
    }
  };

  // Poll the overview while a scan is running so the progress bar advances
  // without needing extra WebSocket / SSE plumbing.
  useEffect(() => {
    if (!cvePolling && !compliancePolling) return;
    const id = setInterval(loadOverview, 3000);
    return () => clearInterval(id);
  }, [cvePolling, compliancePolling, loadOverview]);

  const handleExportCsv = async () => {
    try {
      const resp = await api.getRaw("/turbolens/security/export.csv");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "turbolens_cve_findings.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Status update (from drawer) ────────────────────────────────────
  const updateStatus = async (id: string, status: CveStatus) => {
    setUpdating(true);
    try {
      const updated = await api.patch<TurboLensCveFinding>(
        `/turbolens/security/findings/${id}`,
        { status },
      );
      setFindings((prev) => prev.map((f) => (f.id === id ? updated : f)));
      setSelected(updated);
      loadOverview();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    } finally {
      setUpdating(false);
    }
  };

  // ── Compliance cell selection ──────────────────────────────────────
  const handleComplianceCellSelect = (
    regulation: RegulationKey,
    status: ComplianceStatus | null,
  ) => {
    setActiveTab(2);
    setActiveRegulation(regulation);
    setHighlightCell({ regulation, status });
  };

  const filteredComplianceFindings = useMemo(() => {
    const bundle = compliance.find((b) => b.regulation === activeRegulation);
    if (!bundle) return [];
    let items = bundle.findings;
    // Heatmap drill-through takes precedence as a transient pre-filter on
    // status; once the user changes the explicit status filter chips,
    // they win.
    if (
      highlightCell &&
      highlightCell.regulation === activeRegulation &&
      highlightCell.status
    ) {
      items = items.filter((f) => f.status === highlightCell.status);
    } else {
      items = items.filter((f) => complianceStatusFilter.has(f.status));
    }
    items = items.filter((f) =>
      complianceSeverityFilter.has(f.severity),
    );
    items = items.filter((f) =>
      complianceDecisionFilter.has(f.decision as ComplianceDecision),
    );
    if (complianceAiOnly) items = items.filter((f) => f.ai_detected);
    if (!complianceIncludeResolved)
      items = items.filter((f) => !f.auto_resolved);
    return items;
  }, [
    compliance,
    activeRegulation,
    highlightCell,
    complianceStatusFilter,
    complianceSeverityFilter,
    complianceDecisionFilter,
    complianceAiOnly,
    complianceIncludeResolved,
  ]);

  const setDecision = useCallback(
    async (
      finding: TurboLensComplianceFinding,
      decision: ComplianceDecision,
      note?: string,
    ) => {
      try {
        const updated = await api.patch<TurboLensComplianceFinding>(
          `/turbolens/security/compliance-findings/${finding.id}`,
          {
            decision,
            ...(note !== undefined ? { review_note: note } : {}),
          },
        );
        // Splice the updated row back into the loaded compliance bundles
        // so the UI reflects the new decision immediately without a full
        // refetch.
        setCompliance((prev) =>
          prev.map((b) =>
            b.regulation === finding.regulation
              ? {
                  ...b,
                  findings: b.findings.map((f) =>
                    f.id === finding.id ? updated : f,
                  ),
                }
              : b,
          ),
        );
      } catch (e) {
        if (e instanceof ApiError) setError(e.message);
        else setError(String(e));
      }
    },
    [],
  );

  const toggleSetMember = <T,>(
    setter: (next: Set<T>) => void,
    current: Set<T>,
    value: T,
  ) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const activeBundle = compliance.find((b) => b.regulation === activeRegulation);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            {t("turbolens_security_title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 800 }}>
            {t("turbolens_security_description")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={handleExportCsv}
            startIcon={<MaterialSymbol icon="download" size={18} />}
            disabled={findingsTotal === 0}
          >
            {t("turbolens_security_export_csv")}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab label={t("turbolens_security_tab_overview")} />
        <Tab label={t("turbolens_security_tab_cves")} />
        <Tab label={t("turbolens_security_tab_compliance")} />
      </Tabs>

      {activeTab === 0 && renderOverview()}
      {activeTab === 1 && renderFindings()}
      {activeTab === 2 && renderCompliance()}

      <SecurityFindingDrawer
        finding={selected}
        onClose={() => setSelected(null)}
        onUpdateStatus={updateStatus}
        onPromoteToRisk={(f) => setRiskSeed(seedFromCve(f))}
        onOpenRisk={openRisk}
        updating={updating}
      />

      <CardDetailSidePanel
        cardId={cardPanelId}
        open={Boolean(cardPanelId)}
        onClose={() => setCardPanelId(null)}
      />

      <Dialog
        open={Boolean(acceptDialog)}
        onClose={() =>
          !acceptDialog?.saving && setAcceptDialog(null)
        }
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {t("turbolens_security_compliance_accept_title")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("turbolens_security_compliance_accept_help")}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label={t("turbolens_security_compliance_review_note")}
            value={acceptDialog?.note ?? ""}
            onChange={(e) =>
              setAcceptDialog((d) =>
                d ? { ...d, note: e.target.value } : d,
              )
            }
            disabled={acceptDialog?.saving}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setAcceptDialog(null)}
            disabled={acceptDialog?.saving}
          >
            {t("turbolens_security_compliance_accept_cancel")}
          </Button>
          <Button
            variant="contained"
            disabled={
              !acceptDialog?.note.trim() || Boolean(acceptDialog?.saving)
            }
            onClick={async () => {
              if (!acceptDialog) return;
              setAcceptDialog({ ...acceptDialog, saving: true });
              await setDecision(
                acceptDialog.finding,
                "accepted",
                acceptDialog.note.trim(),
              );
              setAcceptDialog(null);
            }}
          >
            {t("turbolens_security_compliance_accept_confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      <CreateRiskDialog
        open={Boolean(riskSeed)}
        seed={riskSeed}
        onClose={() => setRiskSeed(null)}
        onCreated={(risk: Risk) => {
          setRiskSeed(null);
          // Keep the drawer in sync: refresh findings + the selected row so
          // the button flips to "Open risk R-xxxxxx" without a reload.
          loadFindings();
          loadOverview();
          loadCompliance();
          if (selected) {
            setSelected({
              ...selected,
              risk_id: risk.id,
              risk_reference: risk.reference,
            });
          }
          navigate(`/grc/risks/${risk.id}`);
        }}
      />
    </Box>
  );

  // -----------------------------------------------------------------
  // Overview tab
  // -----------------------------------------------------------------
  function renderOverview() {
    if (overviewLoading && !overview) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      );
    }
    const cveRun: SecurityScanRun = overview?.cve_run ?? {
      run_id: null,
      status: null,
      started_at: null,
      completed_at: null,
      error: null,
      progress: null,
      summary: null,
    };
    const complianceRun: SecurityScanRun = overview?.compliance_run ?? {
      run_id: null,
      status: null,
      started_at: null,
      completed_at: null,
      error: null,
      progress: null,
      summary: null,
    };

    const hasEver = Boolean(cveRun.run_id || complianceRun.run_id);
    const complianceScoresVals = Object.values(overview?.compliance_scores || {});
    const avgCompliance =
      complianceScoresVals.length === 0
        ? 100
        : Math.round(
            complianceScoresVals.reduce((a, b) => a + b, 0) /
              complianceScoresVals.length,
          );

    return (
      <Stack spacing={3}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <SecurityScanCard
              title={t("turbolens_security_cve_scan_title")}
              description={t("turbolens_security_cve_scan_description")}
              icon="shield"
              run={cveRun}
              running={cvePolling}
              onRun={handleCveScan}
              buttonLabel={t("turbolens_security_run_cve_scan")}
              runningLabel={t("turbolens_security_scanning")}
              neverScannedLabel={t("turbolens_security_never_scanned")}
              phaseLabel={phaseLabel}
              summaryLabel={(s) =>
                t("turbolens_security_cve_summary", {
                  count: (s.cve_findings as number) ?? 0,
                  scanned: (s.cards_scanned as number) ?? 0,
                })
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <SecurityScanCard
              title={t("turbolens_security_compliance_scan_title")}
              description={t("turbolens_security_compliance_scan_description")}
              icon="verified"
              run={complianceRun}
              running={compliancePolling}
              onRun={handleComplianceScan}
              buttonLabel={t("turbolens_security_run_compliance_scan")}
              runningLabel={t("turbolens_security_scanning")}
              neverScannedLabel={t("turbolens_security_never_scanned")}
              phaseLabel={phaseLabel}
              summaryLabel={(s) =>
                t("turbolens_security_compliance_summary_label", {
                  count: (s.compliance_findings as number) ?? 0,
                  regs: Array.isArray(s.regulations) ? s.regulations.length : 0,
                })
              }
              disabled={selectedRegs.size === 0}
            >
              <FormGroup row sx={{ gap: 1 }}>
                {REGULATIONS.map((reg) => (
                  <FormControlLabel
                    key={reg}
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedRegs.has(reg)}
                        onChange={(e) => {
                          const next = new Set(selectedRegs);
                          if (e.target.checked) next.add(reg);
                          else next.delete(reg);
                          setSelectedRegs(next);
                        }}
                      />
                    }
                    label={t(`turbolens_security_regulation_${reg}`)}
                  />
                ))}
              </FormGroup>
            </SecurityScanCard>
          </Grid>
        </Grid>

        {!hasEver && (
          <Alert severity="info">{t("turbolens_security_never_scanned")}</Alert>
        )}

        {overview && renderKpisAndCharts(overview, avgCompliance)}
      </Stack>
    );
  }

  function renderKpisAndCharts(
    overview: TurboLensSecurityOverview,
    avgCompliance: number,
  ) {
    return (
      <Stack spacing={3}>
        <Grid container spacing={2}>
          <Grid item xs={6} md={2.4}>
            <MetricCard
              label={t("turbolens_security_kpi_total")}
              value={overview.total_findings}
              icon="shield"
              color="#1976d2"
            />
          </Grid>
          <Grid item xs={6} md={2.4}>
            <MetricCard
              label={t("turbolens_security_kpi_critical")}
              value={overview.by_severity.critical || 0}
              icon="error"
              color="#d32f2f"
              iconColor="#d32f2f"
            />
          </Grid>
          <Grid item xs={6} md={2.4}>
            <MetricCard
              label={t("turbolens_security_kpi_high")}
              value={overview.by_severity.high || 0}
              icon="warning"
              color="#f57c00"
              iconColor="#f57c00"
            />
          </Grid>
          <Grid item xs={6} md={2.4}>
            <MetricCard
              label={t("turbolens_security_kpi_medium")}
              value={overview.by_severity.medium || 0}
              icon="info"
              color="#0288d1"
              iconColor="#0288d1"
            />
          </Grid>
          <Grid item xs={6} md={2.4}>
            <MetricCard
              label={t("turbolens_security_kpi_compliance_score")}
              value={`${avgCompliance}%`}
              icon="verified"
              color={
                avgCompliance >= 80
                  ? "#2e7d32"
                  : avgCompliance >= 60
                    ? "#f57c00"
                    : "#d32f2f"
              }
            />
          </Grid>
        </Grid>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            {t("turbolens_security_risk_matrix_title")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("turbolens_security_risk_matrix_hint")}
          </Typography>
          <RiskMatrix
            matrix={overview.risk_matrix || []}
            onSelect={(prob, sev) => {
              setProbabilityFilter(prob ?? "__all__");
              setSeverityFilter(sev ?? "__all__");
              setStatusFilter("__all__");
              setTypeFilter("__all__");
              setActiveTab(1);
              setPage(0);
            }}
            highlight={
              probabilityFilter !== "__all__" && severityFilter !== "__all__"
                ? { probability: probabilityFilter, severity: severityFilter }
                : null
            }
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("turbolens_security_compliance_summary")}
          </Typography>
          <ComplianceHeatmap
            regulations={REGULATIONS}
            matrix={overview.compliance_by_status}
            scores={overview.compliance_scores}
            onSelect={handleComplianceCellSelect}
            highlight={highlightCell}
          />
        </Paper>

        {overview.top_critical.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              {t("turbolens_security_top_critical")}
            </Typography>
            <Grid container spacing={1.5}>
              {overview.top_critical.map((f) => (
                <Grid item xs={12} md={6} key={f.id}>
                  <Card variant="outlined" sx={{ cursor: "pointer" }} onClick={() => setSelected(f)}>
                    <CardContent sx={{ "&:last-child": { pb: 2 } }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                        <Chip size="small" label={f.cve_id} />
                        <Chip
                          size="small"
                          color={cveSeverityColor(f.severity)}
                          label={`${t(`turbolens_security_severity_${f.severity}`)}${
                            f.cvss_score != null ? ` · ${f.cvss_score.toFixed(1)}` : ""
                          }`}
                        />
                        <Chip
                          size="small"
                          color={priorityColor(f.priority)}
                          label={t(`turbolens_security_priority_${f.priority}`)}
                        />
                      </Stack>
                      <Typography variant="body2" fontWeight={600}>
                        {f.card_name || f.card_id}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {(f.business_impact || f.description).slice(0, 180)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Paper>
        )}
      </Stack>
    );
  }

  // -----------------------------------------------------------------
  // CVE findings tab
  // -----------------------------------------------------------------
  function renderFindings() {
    const matrixActive =
      probabilityFilter !== "__all__" && severityFilter !== "__all__";
    return (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
          <FilterSelect
            label={t("turbolens_security_filter_severity")}
            value={severityFilter}
            onChange={(v) => {
              setSeverityFilter(v);
              // Clear matrix highlight when severity diverges.
              if (v !== severityFilter) setProbabilityFilter("__all__");
            }}
            options={SEVERITIES.map((s) => ({
              value: s,
              label: t(`turbolens_security_severity_${s}`),
            }))}
          />
          <FilterSelect
            label={t("turbolens_security_filter_status")}
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUSES.map((s) => ({
              value: s,
              label: t(`turbolens_security_status_${s}`),
            }))}
          />
          <FilterSelect
            label={t("turbolens_security_filter_type")}
            value={typeFilter}
            onChange={setTypeFilter}
            options={CARD_TYPES.map((c) => ({ value: c, label: c }))}
          />
          {matrixActive && (
            <Chip
              color="primary"
              size="small"
              label={`${t(`turbolens_security_probability_${probabilityFilter}`)} × ${t(
                `turbolens_security_severity_${severityFilter}`,
              )}`}
              onDelete={() => {
                setProbabilityFilter("__all__");
                setSeverityFilter("__all__");
              }}
            />
          )}
        </Stack>

        {findingsLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : findings.length === 0 ? (
          <Alert severity="info">{t("turbolens_security_no_findings")}</Alert>
        ) : (
          <Paper variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("turbolens_security_col_card")}</TableCell>
                  <TableCell>{t("turbolens_security_col_cve")}</TableCell>
                  <TableCell align="right">{t("turbolens_security_col_cvss")}</TableCell>
                  <TableCell>{t("turbolens_security_col_severity")}</TableCell>
                  <TableCell>{t("turbolens_security_col_priority")}</TableCell>
                  <TableCell>{t("turbolens_security_col_probability")}</TableCell>
                  <TableCell>{t("turbolens_security_col_patch")}</TableCell>
                  <TableCell>{t("turbolens_security_col_status")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {findings.map((f) => (
                  <TableRow
                    key={f.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSelected(f)}
                  >
                    <TableCell>
                      <Box component="span" sx={{ fontWeight: 600 }}>
                        {f.card_name || f.card_id}
                      </Box>
                      <Box
                        component="span"
                        sx={{ ml: 1, color: "text.secondary", fontSize: 12 }}
                      >
                        ({f.card_type})
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box
                        component="a"
                        href={`https://nvd.nist.gov/vuln/detail/${f.cve_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        sx={{ color: "primary.main", textDecoration: "none" }}
                      >
                        {f.cve_id}
                      </Box>
                    </TableCell>
                    <TableCell align="right">
                      {f.cvss_score != null ? f.cvss_score.toFixed(1) : "—"}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={cveSeverityColor(f.severity)}
                        label={t(`turbolens_security_severity_${f.severity}`)}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={priorityColor(f.priority)}
                        label={t(`turbolens_security_priority_${f.priority}`)}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={probabilityColor(f.probability)}
                        label={t(`turbolens_security_probability_${f.probability}`)}
                      />
                    </TableCell>
                    <TableCell>
                      {f.patch_available
                        ? t("turbolens_security_patch_yes")
                        : t("turbolens_security_patch_no")}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={cveStatusColor(f.status)}
                        variant="outlined"
                        label={t(`turbolens_security_status_${f.status}`)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={findingsTotal}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100, 200]}
              labelRowsPerPage={t("turbolens_security_page_size")}
            />
          </Paper>
        )}
      </Stack>
    );
  }

  // -----------------------------------------------------------------
  // Compliance tab
  // -----------------------------------------------------------------
  function renderCompliance() {
    if (complianceLoading) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      );
    }
    const statusOptions: ComplianceStatus[] = [
      "compliant",
      "partial",
      "non_compliant",
      "not_applicable",
      "review_needed",
    ];
    const severityOptions: TurboLensComplianceFinding["severity"][] = [
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ];
    const decisionOptions: ComplianceDecision[] = [
      "open",
      "acknowledged",
      "accepted",
      "risk_tracked",
      "auto_resolved",
    ];
    return (
      <Stack spacing={2}>
        <Tabs
          value={activeRegulation}
          onChange={(_, v) => {
            setActiveRegulation(v as RegulationKey);
            setHighlightCell(null);
          }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {REGULATIONS.map((reg) => {
            const bundle = compliance.find((b) => b.regulation === reg);
            return (
              <Tab
                key={reg}
                value={reg}
                label={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{t(`turbolens_security_regulation_${reg}`)}</span>
                    {bundle && (
                      <Chip
                        size="small"
                        label={`${bundle.score}%`}
                        color={
                          bundle.score >= 80
                            ? "success"
                            : bundle.score >= 60
                              ? "warning"
                              : "error"
                        }
                      />
                    )}
                  </Stack>
                }
              />
            );
          })}
        </Tabs>

        {/* Filter bar — everything is on by default; user opts down. */}
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1}>
            {highlightCell?.status && (
              <Alert
                severity="info"
                sx={{ py: 0 }}
                onClose={() => setHighlightCell(null)}
              >
                {t("turbolens_security_compliance_filter_from_heatmap", {
                  status: t(
                    `turbolens_security_compliance_status_${highlightCell.status}`,
                  ),
                })}
              </Alert>
            )}
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              alignItems={{ md: "center" }}
              flexWrap="wrap"
              useFlexGap
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("turbolens_security_compliance_filter_status")}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {statusOptions.map((s) => (
                    <Chip
                      key={s}
                      size="small"
                      label={t(`turbolens_security_compliance_status_${s}`)}
                      color={
                        complianceStatusFilter.has(s)
                          ? complianceStatusColor(s)
                          : "default"
                      }
                      variant={
                        complianceStatusFilter.has(s) ? "filled" : "outlined"
                      }
                      onClick={() =>
                        toggleSetMember(
                          setComplianceStatusFilter,
                          complianceStatusFilter,
                          s,
                        )
                      }
                    />
                  ))}
                </Stack>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("turbolens_security_compliance_filter_severity")}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {severityOptions.map((s) => (
                    <Chip
                      key={s}
                      size="small"
                      label={t(`turbolens_security_severity_${s}`)}
                      color={
                        complianceSeverityFilter.has(s)
                          ? cveSeverityColor(s)
                          : "default"
                      }
                      variant={
                        complianceSeverityFilter.has(s)
                          ? "filled"
                          : "outlined"
                      }
                      onClick={() =>
                        toggleSetMember(
                          setComplianceSeverityFilter,
                          complianceSeverityFilter,
                          s,
                        )
                      }
                    />
                  ))}
                </Stack>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("turbolens_security_compliance_filter_decision")}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {decisionOptions.map((d) => (
                    <Chip
                      key={d}
                      size="small"
                      label={t(`turbolens_security_compliance_decision_${d}`)}
                      color={
                        complianceDecisionFilter.has(d)
                          ? complianceDecisionColor(d)
                          : "default"
                      }
                      variant={
                        complianceDecisionFilter.has(d)
                          ? "filled"
                          : "outlined"
                      }
                      onClick={() =>
                        toggleSetMember(
                          setComplianceDecisionFilter,
                          complianceDecisionFilter,
                          d,
                        )
                      }
                    />
                  ))}
                </Stack>
              </Box>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={complianceAiOnly}
                    onChange={(e) => setComplianceAiOnly(e.target.checked)}
                  />
                }
                label={t("turbolens_security_compliance_filter_ai_only")}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={complianceIncludeResolved}
                    onChange={(e) =>
                      setComplianceIncludeResolved(e.target.checked)
                    }
                  />
                }
                label={t(
                  "turbolens_security_compliance_filter_include_resolved",
                )}
              />
            </Stack>
          </Stack>
        </Paper>

        {activeBundle && filteredComplianceFindings.length === 0 ? (
          <Alert severity="info">
            {t("turbolens_security_compliance_no_findings")}
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {filteredComplianceFindings.map((f) => (
              <Paper
                key={f.id}
                variant="outlined"
                sx={{
                  p: 2,
                  borderLeft: 4,
                  borderLeftColor: `${complianceStatusColor(f.status)}.main`,
                  opacity: f.auto_resolved ? 0.65 : 1,
                }}
              >
                {f.card_name && f.card_id && (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    sx={{
                      mb: 0.75,
                      cursor: "pointer",
                      "&:hover .card-name": { textDecoration: "underline" },
                    }}
                    onClick={() => setCardPanelId(f.card_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCardPanelId(f.card_id);
                      }
                    }}
                  >
                    <Typography
                      className="card-name"
                      variant="subtitle2"
                      sx={{ fontWeight: 600, color: "primary.main" }}
                    >
                      {f.card_name}
                    </Typography>
                    <MaterialSymbol
                      icon="open_in_new"
                      size={14}
                      color="primary"
                    />
                  </Stack>
                )}
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mb: 0.5 }}
                  flexWrap="wrap"
                  useFlexGap
                >
                  <Chip
                    size="small"
                    color={complianceStatusColor(f.status)}
                    label={t(
                      `turbolens_security_compliance_status_${f.status}`,
                    )}
                  />
                  <Tooltip
                    title={
                      f.review_note ||
                      t(
                        `turbolens_security_compliance_decision_help_${f.decision}`,
                      )
                    }
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      color={complianceDecisionColor(f.decision)}
                      icon={
                        <MaterialSymbol
                          icon={
                            f.decision === "risk_tracked"
                              ? "policy"
                              : f.decision === "accepted"
                                ? "verified"
                                : f.decision === "acknowledged"
                                  ? "visibility"
                                  : f.decision === "auto_resolved"
                                    ? "task_alt"
                                    : "radio_button_unchecked"
                          }
                          size={14}
                        />
                      }
                      label={t(
                        `turbolens_security_compliance_decision_${f.decision}`,
                      )}
                    />
                  </Tooltip>
                  {f.regulation_article && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${t("turbolens_security_compliance_article")} · ${f.regulation_article}`}
                    />
                  )}
                  {f.scope_type === "landscape" && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(
                        "turbolens_security_compliance_scope_landscape",
                      )}
                    />
                  )}
                  {f.ai_detected && (
                    <Tooltip title={t("turbolens_security_ai_detected_hint")}>
                      <Chip
                        size="small"
                        color="secondary"
                        icon={
                          <MaterialSymbol icon="auto_awesome" size={14} />
                        }
                        label={t("turbolens_security_ai_detected")}
                      />
                    </Tooltip>
                  )}
                  {f.category && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={humanizeCategory(f.category)}
                    />
                  )}
                </Stack>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {f.requirement}
                </Typography>
                {f.gap_description && f.status !== "compliant" && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1 }}
                  >
                    <strong>
                      {t("turbolens_security_compliance_gap")}:
                    </strong>{" "}
                    {f.gap_description}
                  </Typography>
                )}
                {f.remediation && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    <strong>
                      {t("turbolens_security_compliance_remediation")}:
                    </strong>{" "}
                    {f.remediation}
                  </Typography>
                )}
                {f.evidence && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 0.5, display: "block" }}
                  >
                    {t("turbolens_security_compliance_evidence")}:{" "}
                    {f.evidence}
                  </Typography>
                )}
                {f.review_note && f.decision === "accepted" && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 0.5, display: "block", fontStyle: "italic" }}
                  >
                    {t("turbolens_security_compliance_accepted_by", {
                      name: f.reviewer_name || "—",
                    })}
                    : {f.review_note}
                  </Typography>
                )}
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mt: 1 }}
                  flexWrap="wrap"
                  useFlexGap
                >
                  {f.risk_id ? (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={
                        <MaterialSymbol icon="open_in_new" size={14} />
                      }
                      onClick={() => openRisk(f.risk_id!)}
                    >
                      {tDelivery("risks.openRisk", {
                        reference: f.risk_reference ?? f.risk_id,
                      })}
                    </Button>
                  ) : (
                    f.status !== "compliant" &&
                    f.status !== "not_applicable" &&
                    !f.auto_resolved && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={
                          <MaterialSymbol icon="policy" size={14} />
                        }
                        onClick={() => setRiskSeed(seedFromCompliance(f))}
                      >
                        {tDelivery("risks.createRisk")}
                      </Button>
                    )
                  )}
                  {!f.auto_resolved &&
                    f.decision !== "risk_tracked" &&
                    f.decision !== "acknowledged" && (
                      <Button
                        size="small"
                        variant="text"
                        startIcon={
                          <MaterialSymbol icon="visibility" size={14} />
                        }
                        onClick={() => setDecision(f, "acknowledged")}
                      >
                        {t("turbolens_security_compliance_acknowledge")}
                      </Button>
                    )}
                  {!f.auto_resolved &&
                    f.decision !== "risk_tracked" &&
                    f.decision !== "accepted" && (
                      <Button
                        size="small"
                        variant="text"
                        startIcon={
                          <MaterialSymbol icon="verified" size={14} />
                        }
                        onClick={() =>
                          setAcceptDialog({
                            finding: f,
                            note: f.review_note ?? "",
                            saving: false,
                          })
                        }
                      >
                        {t("turbolens_security_compliance_accept")}
                      </Button>
                    )}
                  {f.auto_resolved && (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={
                        <MaterialSymbol icon="restart_alt" size={14} />
                      }
                      onClick={() => setDecision(f, "open")}
                    >
                      {t("turbolens_security_compliance_reopen")}
                    </Button>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-components local to this file
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const { t } = useTranslation("admin");
  return (
    <FormControl size="small" sx={{ minWidth: 140 }}>
      <InputLabel>{label}</InputLabel>
      <Select
        value={value}
        label={label}
        onChange={(e) => onChange(e.target.value)}
      >
        <MenuItem value="__all__">{t("turbolens_security_filter_all")}</MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function RiskMatrix({
  matrix,
  onSelect,
  highlight,
}: {
  matrix: number[][];
  onSelect?: (probability: string | null, severity: string | null) => void;
  highlight?: { probability: string; severity: string } | null;
}) {
  const { t } = useTranslation("admin");
  if (matrix.length === 0) return null;
  return (
    <>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `100px repeat(${SEVERITY_LABELS.length}, 1fr)`,
          gap: 0.5,
          mt: 1,
        }}
      >
        <Box />
        {SEVERITY_LABELS.map((s) => (
          <Typography key={s} variant="caption" color="text.secondary" align="center">
            {t(`turbolens_security_severity_${s}`)}
        </Typography>
      ))}
      {PROBABILITY_LABELS.map((probKey, probIdx) => (
        <Fragment key={probKey}>
          <Typography
            variant="caption"
            color="text.secondary"
            align="right"
            sx={{ pr: 1, display: "flex", alignItems: "center", justifyContent: "flex-end" }}
          >
            {t(`turbolens_security_probability_${probKey}`)}
          </Typography>
          {SEVERITY_LABELS.map((sevKey, sevIdx) => {
            const count = matrix[probIdx]?.[sevIdx] ?? 0;
            const isActive =
              highlight &&
              highlight.probability === probKey &&
              highlight.severity === sevKey;
            const clickable = Boolean(onSelect) && count > 0;
            return (
              <Box
                key={sevIdx}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={
                  clickable
                    ? () =>
                        onSelect?.(
                          isActive ? null : probKey,
                          isActive ? null : sevKey,
                        )
                    : undefined
                }
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect?.(
                            isActive ? null : probKey,
                            isActive ? null : sevKey,
                          );
                        }
                      }
                    : undefined
                }
                sx={{
                  py: 1.5,
                  textAlign: "center",
                  borderRadius: 1,
                  cursor: clickable ? "pointer" : "default",
                  bgcolor: riskLevelBackground(
                    deriveLevelFromPair(probKey, sevKey),
                  ),
                  outline: isActive ? "2px solid" : "none",
                  outlineColor: "primary.main",
                  fontWeight: count ? 700 : 400,
                  fontSize: 14,
                  "&:hover": clickable ? { filter: "brightness(1.05)" } : undefined,
                  "&:focus-visible": {
                    outline: "2px solid",
                    outlineColor: "primary.main",
                  },
                }}
              >
                {count || "—"}
              </Box>
            );
          })}
        </Fragment>
      ))}
      </Box>
      <RiskMatrixLegend />
    </>
  );
}
