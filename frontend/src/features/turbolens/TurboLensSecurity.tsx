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
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MetricCard from "@/features/reports/MetricCard";
import { api, ApiError } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useComplianceRegulations } from "@/hooks/useComplianceRegulations";
import { useTurboLensReady } from "@/hooks/useTurboLensReady";
import type {
  ComplianceDecision,
  ComplianceRegulation,
  ComplianceStatus,
  CveStatus,
  RegulationKey,
  SecurityActiveRuns,
  SecurityScanRun,
  TurboLensComplianceBundle,
  TurboLensComplianceFinding,
  TurboLensCveFinding,
  TurboLensSecurityOverview,
} from "@/types";
import ComplianceHeatmap from "./ComplianceHeatmap";
import ComplianceGrid from "@/features/grc/compliance/ComplianceGrid";
import type { ComplianceFilters } from "@/features/grc/compliance/ComplianceFilterSidebar";
import CreateComplianceFindingDialog from "@/features/grc/compliance/CreateComplianceFindingDialog";
import CreateRiskDialog from "@/features/grc/risk/CreateRiskDialog";
import CveGrid from "./cve/CveGrid";
import CreateCveFindingDialog from "./cve/CreateCveFindingDialog";
import { emptyCveFilters } from "./cve/types";
import type { CveFilters, CveProbability, CveSeverity } from "./cve/types";
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
import { cveSeverityColor, priorityColor } from "./utils";
import RiskMatrixLegend from "../grc/risk/RiskMatrixLegend";
import {
  deriveLevelFromPair,
  riskLevelBackground,
} from "../grc/risk/riskMatrixColors";

/**
 * Resolve a regulation key to a display label. Order of precedence:
 *   1. The DB row's `label` (from the singleton hook), so admin edits show.
 *   2. The i18n key `turbolens_security_regulation_<key>` if it exists
 *      (covers the 6 built-ins in non-English locales).
 *   3. The raw key, as a last-resort fallback for orphan findings whose
 *      regulation was deleted from the table.
 */
function resolveRegulationLabel(
  key: string,
  byKey: Record<string, ComplianceRegulation>,
  t: (k: string, opts?: { defaultValue?: string }) => string,
  fallbackLabel?: string | null,
): string {
  const reg = byKey[key];
  if (reg?.label) return reg.label;
  if (fallbackLabel) return fallbackLabel;
  const i18nKey = `turbolens_security_regulation_${key}`;
  const translated = t(i18nKey, { defaultValue: key });
  return translated && translated !== i18nKey ? translated : key;
}

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

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportComplianceToCsv(
  findings: TurboLensComplianceFinding[],
  t: (k: string) => string,
  tCards: (k: string) => string,
): void {
  const header = [
    tCards("compliance.grid.col.card"),
    tCards("compliance.grid.col.severity"),
    tCards("compliance.grid.col.status"),
    tCards("compliance.grid.col.article"),
    tCards("compliance.grid.col.requirement"),
    tCards("compliance.grid.col.lifecycle"),
    "AI detected",
    "Auto-resolved",
    "Regulation",
    "Gap",
    "Evidence",
    "Remediation",
    "Reviewer",
    "Reviewed at",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const f of findings) {
    lines.push(
      [
        f.card_name ?? "",
        t(`turbolens_security_severity_${f.severity}`),
        t(`turbolens_security_compliance_status_${f.status}`),
        f.regulation_article ?? "",
        f.requirement ?? "",
        t(`turbolens_security_compliance_decision_${f.decision}`),
        f.ai_detected ? "Yes" : "No",
        f.auto_resolved ? "Yes" : "No",
        f.regulation,
        f.gap_description ?? "",
        f.evidence ?? "",
        f.remediation ?? "",
        f.reviewer_name ?? "",
        f.reviewed_at ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `compliance-findings-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function TurboLensSecurity() {
  const { t } = useTranslation("admin");
  const { t: tCards } = useTranslation("cards");
  const navigate = useNavigate();
  const { user } = useAuth();

  // canManage: security_compliance.manage permission (or wildcard admin).
  const canManage = useMemo(() => {
    const p = user?.permissions;
    if (!p) return false;
    if (p["*"]) return true;
    return !!p["security_compliance.manage"];
  }, [user]);

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
  const [createFindingOpen, setCreateFindingOpen] = useState(false);

  // ── Findings state ─────────────────────────────────────────────────
  const [findings, setFindings] = useState<TurboLensCveFinding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(true);
  const [cveFilters, setCveFilters] = useState<CveFilters>(emptyCveFilters());
  const [cveFiltersCollapsed, setCveFiltersCollapsed] = useState(false);
  const [cveCreateOpen, setCveCreateOpen] = useState(false);

  // ── Compliance filter ──────────────────────────────────────────────
  const [activeRegulation, setActiveRegulation] = useState<RegulationKey>("eu_ai_act");

  // If the current activeRegulation doesn't match any returned bundle
  // (e.g. all built-ins were disabled, or the user is on a fresh
  // install with no compliance scan yet), pin it to the first bundle.
  // This avoids MUI Tabs "no matching value" console noise.
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
      "new",
      "in_review",
      "mitigated",
      "verified",
      "risk_tracked",
      "accepted",
    ]),
  );
  const [complianceAiOnly, setComplianceAiOnly] = useState(false);
  const [complianceAiConfirmedOnly, setComplianceAiConfirmedOnly] =
    useState(false);
  const [complianceIncludeResolved, setComplianceIncludeResolved] =
    useState(false);
  const [complianceCardTypeFilter, setComplianceCardTypeFilter] = useState<
    Set<"Application" | "ITComponent">
  >(new Set<"Application" | "ITComponent">(["Application", "ITComponent"]));

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

  // ── Admin-managed regulations + AI status ─────────────────────────
  const { enabled: enabledRegulations, byKey: regulationsByKey } =
    useComplianceRegulations();
  const { turboLensAiConfigured } = useTurboLensReady();

  // ── Compliance regulation picker ──────────────────────────────────
  // Initially empty; the effect below populates it from the enabled
  // regulations once the singleton hook resolves. Admins can untick
  // individual rows to narrow the next scan.
  const [selectedRegs, setSelectedRegs] = useState<Set<RegulationKey>>(
    new Set(),
  );

  // Keep `selectedRegs` in sync with newly-enabled regulations and drop
  // keys that have since been disabled, while preserving the admin's
  // manual unticks within the still-enabled set.
  useEffect(() => {
    setSelectedRegs((prev) => {
      const enabledKeys = new Set(enabledRegulations.map((r) => r.key));
      if (prev.size === 0) return enabledKeys;
      const next = new Set<RegulationKey>();
      for (const k of prev) if (enabledKeys.has(k)) next.add(k);
      // Auto-select newly added regulations on first appearance.
      for (const k of enabledKeys) {
        if (!Array.from(prev).some((existing) => existing === k)) {
          next.add(k);
        }
      }
      return next;
    });
  }, [enabledRegulations]);

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
      const data = await api.get<{ items: TurboLensCveFinding[]; total: number }>(
        "/turbolens/security/findings?page=1&page_size=10000",
      );
      setFindings(data.items);
    } catch {
      setFindings([]);
    } finally {
      setFindingsLoading(false);
    }
  }, []);

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

  // Pin activeRegulation to a valid bundle whenever the list changes.
  useEffect(() => {
    if (compliance.length === 0) return;
    if (!compliance.some((b) => b.regulation === activeRegulation)) {
      setActiveRegulation(compliance[0].regulation);
    }
  }, [compliance, activeRegulation]);

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
    if (complianceAiConfirmedOnly)
      items = items.filter((f) => f.card_has_ai_features === true);
    if (!complianceIncludeResolved)
      items = items.filter((f) => !f.auto_resolved);
    // Card-type filter: landscape-scoped findings (no card_type) always
    // pass; otherwise drop findings whose card_type is not in the set.
    items = items.filter(
      (f) =>
        !f.card_type ||
        complianceCardTypeFilter.has(
          f.card_type as "Application" | "ITComponent",
        ),
    );
    return items;
  }, [
    compliance,
    activeRegulation,
    highlightCell,
    complianceStatusFilter,
    complianceSeverityFilter,
    complianceDecisionFilter,
    complianceAiOnly,
    complianceAiConfirmedOnly,
    complianceIncludeResolved,
    complianceCardTypeFilter,
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
            disabled={findings.length === 0}
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
      {activeTab === 1 && (
        <CveGrid
          findings={findings}
          loading={findingsLoading}
          canManage={canManage}
          filters={cveFilters}
          onFiltersChange={setCveFilters}
          filtersCollapsed={cveFiltersCollapsed}
          onToggleFiltersCollapsed={() => setCveFiltersCollapsed((c) => !c)}
          availableCardTypes={["Application", "ITComponent"]}
          onRowClick={setSelected}
          onCreate={() => setCveCreateOpen(true)}
          onDelete={async (id) => {
            await api.delete(`/turbolens/security/cve-findings/${id}`);
            setFindings((rows) => rows.filter((r) => r.id !== id));
          }}
          onBulkDelete={async (ids) => {
            const result = await api.delete<{
              updated: number;
              skipped: { id: string; reason: string }[];
            }>("/turbolens/security/cve-findings/bulk", { ids });
            await loadFindings();
            return result;
          }}
          onBulkStatusUpdate={async (ids, status) => {
            const result = await api.patch<{
              updated: number;
              skipped: { id: string; reason: string }[];
            }>("/turbolens/security/cve-findings/bulk", { ids, status });
            await loadFindings();
            return result;
          }}
          onExportCsv={handleExportCsv}
        />
      )}
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

      <CreateComplianceFindingDialog
        open={createFindingOpen}
        defaultRegulation={activeRegulation}
        onClose={() => setCreateFindingOpen(false)}
        onCreated={() => {
          // Refresh the compliance bundle so the new manual finding lands
          // on the active regulation tab.
          loadCompliance();
        }}
      />

      <CreateCveFindingDialog
        open={cveCreateOpen}
        onClose={() => setCveCreateOpen(false)}
        onCreated={(row) => setFindings((rows) => [row, ...rows])}
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
        {turboLensAiConfigured ? (
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
                disabled={selectedRegs.size === 0 || enabledRegulations.length === 0}
              >
                {enabledRegulations.length === 0 ? (
                  <Alert severity="info" sx={{ mt: 1 }}>
                    {t("turbolens_security_no_regulations_enabled")}
                  </Alert>
                ) : (
                  <FormGroup row sx={{ gap: 1 }}>
                    {enabledRegulations.map((reg) => (
                      <FormControlLabel
                        key={reg.key}
                        control={
                          <Checkbox
                            size="small"
                            checked={selectedRegs.has(reg.key)}
                            onChange={(e) => {
                              const next = new Set(selectedRegs);
                              if (e.target.checked) next.add(reg.key);
                              else next.delete(reg.key);
                              setSelectedRegs(next);
                            }}
                          />
                        }
                        label={resolveRegulationLabel(
                          reg.key,
                          regulationsByKey,
                          t,
                          reg.label,
                        )}
                      />
                    ))}
                  </FormGroup>
                )}
              </SecurityScanCard>
            </Grid>
          </Grid>
        ) : (
          <Alert severity="info">
            {t("turbolens_security_ai_not_configured_register_still_available")}
          </Alert>
        )}

        {!hasEver && turboLensAiConfigured && (
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
              setCveFilters({
                ...emptyCveFilters(),
                ...(prob ? { probabilities: new Set([prob as CveProbability]) } : {}),
                ...(sev ? { severities: new Set([sev as CveSeverity]) } : {}),
              });
              setActiveTab(1);
            }}
            highlight={
              cveFilters.probabilities.size === 1 && cveFilters.severities.size === 1
                ? {
                    probability: Array.from(cveFilters.probabilities)[0],
                    severity: Array.from(cveFilters.severities)[0],
                  }
                : null
            }
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t("turbolens_security_compliance_summary")}
          </Typography>
          <ComplianceHeatmap
            regulations={enabledRegulations.map((r) => ({
              key: r.key,
              label: resolveRegulationLabel(r.key, regulationsByKey, t, r.label),
            }))}
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
  // Compliance tab
  // -----------------------------------------------------------------
  function renderCompliance() {
    // Loading state is rendered as AG Grid's native overlay via the
    // ComplianceGrid `loading` prop; the regulation tabs and filter
    // sidebar stay visible during the initial fetch.
    return (
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Tabs
          value={activeRegulation}
          onChange={(_, v) => {
            setActiveRegulation(v as RegulationKey);
            setHighlightCell(null);
          }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {/* Tabs iterate the bundles returned by /security/compliance,
              which already include enabled regulations + any orphans
              that still have findings. Disabled/unknown regulations are
              rendered muted so historical findings remain auditable. */}
          {compliance.map((bundle) => {
            const reg = bundle.regulation;
            const label = resolveRegulationLabel(
              reg,
              regulationsByKey,
              t,
              bundle.label,
            );
            const muted =
              bundle.is_enabled === false || bundle.is_known === false;
            return (
              <Tab
                key={reg}
                value={reg}
                sx={muted ? { opacity: 0.55 } : undefined}
                label={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{label}</span>
                    {bundle.is_known === false && (
                      <Chip
                        size="small"
                        label={t("turbolens_security_regulation_orphan")}
                        sx={{ height: 18, fontSize: 10 }}
                      />
                    )}
                    {bundle.is_known !== false && bundle.is_enabled === false && (
                      <Chip
                        size="small"
                        label={t("turbolens_security_regulation_disabled")}
                        sx={{ height: 18, fontSize: 10 }}
                      />
                    )}
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
                  </Stack>
                }
              />
            );
          })}
        </Tabs>

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

        <ComplianceGrid
          findings={filteredComplianceFindings}
          filters={{
            statuses: complianceStatusFilter,
            severities: complianceSeverityFilter,
            decisions: complianceDecisionFilter,
            cardTypes: complianceCardTypeFilter,
            aiOnly: complianceAiOnly,
            aiConfirmedOnly: complianceAiConfirmedOnly,
            includeResolved: complianceIncludeResolved,
          } as ComplianceFilters}
          onFiltersChange={(next) => {
            setComplianceStatusFilter(next.statuses);
            setComplianceSeverityFilter(next.severities);
            setComplianceDecisionFilter(next.decisions);
            setComplianceCardTypeFilter(next.cardTypes);
            setComplianceAiOnly(next.aiOnly);
            setComplianceAiConfirmedOnly(next.aiConfirmedOnly);
            setComplianceIncludeResolved(next.includeResolved);
          }}
          onFindingUpdated={(updated) => {
            setCompliance((prev) =>
              prev.map((b) =>
                b.regulation === updated.regulation
                  ? {
                      ...b,
                      findings: b.findings.map((f) =>
                        f.id === updated.id ? updated : f,
                      ),
                    }
                  : b,
              ),
            );
          }}
          onOpenCard={setCardPanelId}
          onPromoteToRisk={(f) => setRiskSeed(seedFromCompliance(f))}
          onOpenRisk={openRisk}
          onRequestAccept={(f) =>
            setAcceptDialog({ finding: f, note: "", saving: false })
          }
          loading={complianceLoading}
          onCreate={() => setCreateFindingOpen(true)}
          onExport={() =>
            exportComplianceToCsv(filteredComplianceFindings, t, tCards)
          }
          onDelete={async (f) => {
            try {
              await api.delete(`/turbolens/security/compliance-findings/${f.id}`);
              setCompliance((prev) =>
                prev.map((b) =>
                  b.regulation === f.regulation
                    ? {
                        ...b,
                        findings: b.findings.filter((x) => x.id !== f.id),
                      }
                    : b,
                ),
              );
            } catch (e) {
              if (e instanceof ApiError) setError(e.message);
            }
          }}
          onBulkDelete={async (ids) => {
            try {
              const result = await api.delete<{
                updated: number;
                skipped: { id: string; reason: string }[];
              }>("/turbolens/security/compliance-findings/bulk", { ids });
              // Optimistic-but-safe: just reload — bulk ops can affect
              // many rows across regulations and the server's partial-success
              // contract means we can't easily compute the new state locally.
              await loadCompliance();
              return result;
            } catch (e) {
              if (e instanceof ApiError) setError(e.message);
              return { updated: 0, skipped: [] };
            }
          }}
          onBulkDecisionUpdate={async (ids, decision, reviewNote) => {
            try {
              const result = await api.patch<{
                updated: number;
                skipped: { id: string; reason: string }[];
              }>("/turbolens/security/compliance-findings/bulk", {
                ids,
                decision,
                review_note: reviewNote,
              });
              await loadCompliance();
              return result;
            } catch (e) {
              if (e instanceof ApiError) setError(e.message);
              return { updated: 0, skipped: [] };
            }
          }}
        />
      </Stack>
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-components local to this file
// ---------------------------------------------------------------------------

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
