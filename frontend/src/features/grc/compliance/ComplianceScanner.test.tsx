/**
 * ComplianceScanner — the GRC → Compliance page: scan trigger, heatmap
 * overview and the per-regulation findings tab.
 *
 * The heavy children (heatmap, grid, drawer-bearing dialogs, card panel) are
 * stubbed with escape hatches; the analysis-polling hook is replaced by a
 * recording stand-in so a scan's lifecycle can be driven from the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useParams } from "react-router";
import type {
  ComplianceOverview,
  ComplianceRegulation,
  TurboLensComplianceBundle,
  TurboLensComplianceFinding,
} from "@/types";
import type { ComplianceFilters } from "./ComplianceFilterSidebar";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
// Own factory rather than the kit's `useComplianceRegulationsModule`: the
// real hook memoises `enabled` / `byKey` on the regulation list, and the page
// keys an effect on `enabled`. The kit rebuilds both on every call, which
// turns that effect into an endless passive-update loop under test.
vi.mock("@/hooks/useComplianceRegulations", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useComplianceRegulations")>(
    "@/hooks/useComplianceRegulations",
  );
  const { hookState } = await import("@/test/hooks");
  let memo: { source: ComplianceRegulation[]; value: ReturnType<typeof actual.useComplianceRegulations> } | null =
    null;
  return {
    ...actual,
    invalidateComplianceRegulations: vi.fn(),
    useComplianceRegulations: () => {
      const regulations = hookState.complianceRegulations;
      if (!memo || memo.source !== regulations) {
        memo = {
          source: regulations,
          value: {
            regulations,
            enabled: regulations.filter((r) => r.is_enabled),
            byKey: Object.fromEntries(regulations.map((r) => [r.key, r])),
            loaded: true,
            refresh: vi.fn(async () => {}),
          },
        };
      }
      return memo.value;
    },
  };
});
vi.mock("@/hooks/useTurboLensReady", () => import("@/test/hooks").then((m) => m.useTurboLensReadyModule()));

// A recording stand-in for the polling hook: `startPolling` is a spy, the
// `polling` flag is test-controlled, and the page's completion / error
// callbacks are captured so a run can be finished from the test.
const polling = vi.hoisted(() => ({
  startPolling: vi.fn<(id: string) => void>(),
  stopPolling: vi.fn(),
  active: false,
  onComplete: undefined as (() => void) | undefined,
  onError: undefined as ((msg: string) => void) | undefined,
}));
vi.mock("@/features/turbolens/useAnalysisPolling", () => ({
  useAnalysisPolling: (onComplete?: () => void, onError?: (msg: string) => void) => {
    polling.onComplete = onComplete;
    polling.onError = onError;
    return { startPolling: polling.startPolling, stopPolling: polling.stopPolling, polling: polling.active };
  },
}));

vi.mock("./ComplianceHeatmap", () => ({
  default: ({
    regulations,
    matrix,
    scores,
    onSelect,
    highlight,
  }: {
    regulations: { key: string; label: string }[];
    matrix: Record<string, Record<string, number>>;
    scores: Record<string, number>;
    onSelect?: (regulation: string, status: string | null) => void;
    highlight?: { regulation: string; status: string | null } | null;
  }) => (
    <div
      data-testid="heatmap"
      data-regulations={regulations.map((r) => `${r.key}=${r.label}`).join(";")}
      data-matrix={JSON.stringify(matrix)}
      data-scores={JSON.stringify(scores)}
      data-highlight={highlight ? `${highlight.regulation}:${highlight.status}` : ""}
    >
      <button type="button" data-testid="heatmap-pick" onClick={() => onSelect?.("gdpr", "non_compliant")} />
      <button type="button" data-testid="heatmap-pick-all" onClick={() => onSelect?.("gdpr", null)} />
    </div>
  ),
}));

vi.mock("@/features/grc/compliance/ComplianceGrid", () => ({
  default: ({
    findings,
    filters,
    loading,
    canManage,
    onFiltersChange,
    onFindingUpdated,
    onOpenCard,
    onPromoteToRisk,
    onOpenRisk,
    onEdit,
    onDelete,
    onBulkDelete,
    onBulkDecisionUpdate,
    onCreate,
    onExport,
  }: {
    findings: TurboLensComplianceFinding[];
    filters: ComplianceFilters;
    loading?: boolean;
    canManage?: boolean;
    onFiltersChange: (f: ComplianceFilters) => void;
    onFindingUpdated: (f: TurboLensComplianceFinding) => void;
    onOpenCard: (id: string) => void;
    onPromoteToRisk?: (f: TurboLensComplianceFinding) => void;
    onOpenRisk?: (id: string) => void;
    onEdit?: (f: TurboLensComplianceFinding) => void;
    onDelete?: (f: TurboLensComplianceFinding) => Promise<void> | void;
    onBulkDelete?: (ids: string[]) => Promise<{ updated: number; skipped: { id: string; reason: string }[] }>;
    onBulkDecisionUpdate?: (
      ids: string[],
      decision: string,
      note: string | null,
    ) => Promise<{ updated: number; skipped: { id: string; reason: string }[] }>;
    onCreate?: () => void;
    onExport?: () => void;
  }) => (
    <div
      data-testid="grid"
      data-ids={findings.map((f) => f.id).join(",")}
      data-loading={String(Boolean(loading))}
      data-can-manage={String(canManage)}
      data-ai-only={String(filters.aiOnly)}
    >
      <button type="button" data-testid="grid-delete" onClick={() => void onDelete?.(findings[0])} />
      <button type="button" data-testid="grid-promote" onClick={() => onPromoteToRisk?.(findings[0])} />
      <button type="button" data-testid="grid-open-risk" onClick={() => onOpenRisk?.("r9")} />
      <button type="button" data-testid="grid-edit" onClick={() => onEdit?.(findings[0])} />
      <button type="button" data-testid="grid-create" onClick={() => onCreate?.()} />
      <button type="button" data-testid="grid-export" onClick={() => onExport?.()} />
      <button type="button" data-testid="grid-open-card" onClick={() => onOpenCard("c1")} />
      <button
        type="button"
        data-testid="grid-updated"
        onClick={() => onFindingUpdated({ ...findings[0], status: "compliant" })}
      />
      <button
        type="button"
        data-testid="grid-include-resolved"
        onClick={() => onFiltersChange({ ...filters, includeResolved: true })}
      />
      <button type="button" data-testid="grid-ai-only" onClick={() => onFiltersChange({ ...filters, aiOnly: true })} />
      <button
        type="button"
        data-testid="grid-ai-confirmed"
        onClick={() => onFiltersChange({ ...filters, aiConfirmedOnly: true })}
      />
      <button
        type="button"
        data-testid="grid-only-itc"
        onClick={() => onFiltersChange({ ...filters, cardTypes: new Set(["ITComponent"]) })}
      />
      <button
        type="button"
        data-testid="grid-only-critical"
        onClick={() => onFiltersChange({ ...filters, severities: new Set(["critical"]) })}
      />
      <button
        type="button"
        data-testid="grid-only-new"
        onClick={() => onFiltersChange({ ...filters, decisions: new Set(["new"]) })}
      />
      <button
        type="button"
        data-testid="grid-only-compliant"
        onClick={() => onFiltersChange({ ...filters, statuses: new Set(["compliant"]) })}
      />
      <button
        type="button"
        data-testid="grid-bulk-delete"
        onClick={() => void onBulkDelete?.(["f1"]).then((r) => onFiltersChange({ ...filters, aiOnly: r.updated > 0 }))}
      />
      <button
        type="button"
        data-testid="grid-bulk-decision"
        onClick={() =>
          void onBulkDecisionUpdate?.(["f1"], "in_review", "note").then((r) =>
            onFiltersChange({ ...filters, aiOnly: r.updated > 0 }),
          )
        }
      />
    </div>
  ),
}));

vi.mock("@/features/grc/compliance/CreateComplianceFindingDialog", () => ({
  default: ({
    open,
    finding,
    defaultRegulation,
    onClose,
    onSaved,
  }: {
    open: boolean;
    finding?: TurboLensComplianceFinding | null;
    defaultRegulation?: string;
    onClose: () => void;
    onSaved: (f: TurboLensComplianceFinding) => void;
  }) =>
    open ? (
      <div data-testid="finding-dialog" data-mode={finding ? "edit" : "create"} data-regulation={defaultRegulation}>
        <button type="button" data-testid="finding-dialog-saved" onClick={() => onSaved(finding!)} />
        <button type="button" data-testid="finding-dialog-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("@/features/grc/risk/CreateRiskDialog", () => ({
  default: ({
    open,
    seed,
    onClose,
    onCreated,
  }: {
    open: boolean;
    seed: { title: string; findingId?: string; mode: string } | null;
    onClose: () => void;
    onCreated: (r: { id: string }) => void;
  }) =>
    open ? (
      <div data-testid="risk-dialog" data-title={seed?.title} data-finding={seed?.findingId} data-mode={seed?.mode}>
        <button type="button" data-testid="risk-dialog-created" onClick={() => onCreated({ id: "r-new" })} />
        <button type="button" data-testid="risk-dialog-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open, onClose }: { cardId: string | null; open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="card-panel" data-card-id={cardId}>
        <button type="button" data-testid="card-panel-close" onClick={onClose} />
      </div>
    ) : null,
}));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { installObjectUrl } from "@/test/dom";
import { hookState } from "@/test/hooks";
import { renderWithProviders, userWith } from "@/test/render";
import ComplianceScanner from "./ComplianceScanner";

const ta = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts as never) as string;
const tcards = (key: string) => i18n.t(`cards:${key}`) as string;

/** A MUI button whose `startIcon` is a Material Symbol carries the ligature
 *  word in its accessible name ("play_arrow Run compliance scan"). */
const buttonName = (label: string) =>
  new RegExp(`^(?:[a-z_]+ )?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: [a-z_]+)?$`);
const scanButton = () => screen.getByRole("button", { name: buttonName(ta("compliance_run_compliance_scan")) });
const queryScanButton = () =>
  screen.queryByRole("button", { name: buttonName(ta("compliance_run_compliance_scan")) });

function makeRegulation(overrides: Partial<ComplianceRegulation> & { key: string }): ComplianceRegulation {
  return {
    id: `reg-${overrides.key}`,
    label: overrides.key.toUpperCase(),
    description: null,
    is_enabled: true,
    built_in: true,
    sort_order: 0,
    translations: {},
    ...overrides,
  };
}

const REGULATIONS: ComplianceRegulation[] = [
  makeRegulation({ key: "eu_ai_act", label: "EU AI Act (custom)" }),
  makeRegulation({ key: "gdpr", label: "" }),
  makeRegulation({ key: "soc2", is_enabled: false }),
];

function makeFinding(overrides: Partial<TurboLensComplianceFinding> & { id: string }): TurboLensComplianceFinding {
  return {
    run_id: "run-0",
    regulation: "gdpr",
    regulation_article: "Art. 5",
    card_id: "c1",
    card_name: "ERP",
    card_type: "Application",
    card_has_ai_features: null,
    scope_type: "card",
    category: "data",
    requirement: "Keep records.",
    status: "non_compliant",
    severity: "high",
    gap_description: "No records.",
    evidence: null,
    remediation: null,
    ai_detected: false,
    risk_id: null,
    risk_reference: null,
    decision: "new",
    reviewed_by: null,
    reviewer_name: null,
    reviewed_at: null,
    review_note: null,
    auto_resolved: false,
    last_seen_run_id: null,
    created_at: "2026-04-01T10:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

const GDPR_FINDINGS: TurboLensComplianceFinding[] = [
  makeFinding({ id: "f1" }),
  makeFinding({ id: "f2", status: "compliant", severity: "low", decision: "verified", card_type: "ITComponent", card_name: "Postgres", card_id: "c2" }),
  makeFinding({ id: "f3", status: "non_compliant", severity: "critical", ai_detected: true, card_has_ai_features: true }),
  makeFinding({ id: "f4", auto_resolved: true, severity: "medium" }),
  makeFinding({ id: "f5", card_id: null, card_name: null, card_type: null, scope_type: "landscape", status: "partial", severity: "info", decision: "in_review" }),
];

const BUNDLES: TurboLensComplianceBundle[] = [
  { regulation: "eu_ai_act", label: "EU AI Act", is_enabled: true, is_known: true, score: 90, findings: [makeFinding({ id: "a1", regulation: "eu_ai_act", requirement: 'He said "hi", twice' })] },
  { regulation: "gdpr", label: null, is_enabled: true, is_known: true, score: 55, findings: GDPR_FINDINGS },
  { regulation: "soc2", label: "SOC 2", is_enabled: false, is_known: true, score: 70, findings: [] },
  { regulation: "old_reg", label: null, is_enabled: false, is_known: false, score: 100, findings: [] },
];

const OVERVIEW: ComplianceOverview = {
  compliance_run: {
    run_id: "run-0",
    status: "completed",
    started_at: "2026-04-01T09:00:00Z",
    completed_at: "2026-04-01T09:10:00Z",
    error: null,
    progress: null,
    summary: { compliance_findings: 6, regulations: ["eu_ai_act", "gdpr"] },
  },
  compliance_scores: { eu_ai_act: 90, gdpr: 50 },
  compliance_by_status: { gdpr: { non_compliant: 2, compliant: 1 } },
};

const NEVER_RAN: ComplianceOverview = {
  compliance_run: {
    run_id: null,
    status: null,
    started_at: null,
    completed_at: null,
    error: null,
    progress: null,
    summary: null,
  },
  compliance_scores: {},
  compliance_by_status: {},
};

function RiskMarker() {
  const { id } = useParams();
  return <div data-testid="risk-page" data-id={id} />;
}

function renderPage(opts: { user?: ReturnType<typeof userWith> } = {}) {
  return renderWithProviders(<ComplianceScanner />, {
    route: "/grc",
    routes: [
      { path: "/grc" },
      { path: "/grc/risks/:id", element: <RiskMarker /> },
      { path: "/admin/settings", element: <div data-testid="settings-page" /> },
    ],
    ...(opts.user ? { user: opts.user } : {}),
  });
}

const overviewCalls = () => mockApi.callsOf("get", "/compliance/overview");
const complianceCalls = () => mockApi.callsOf("get", "/compliance/compliance");
const gridIds = () => screen.getByTestId("grid").getAttribute("data-ids");

async function waitForOverview() {
  await screen.findByText(ta("compliance_kpi_compliance_score"));
}

async function openComplianceTab(user: ReturnType<typeof renderPage>["user"]) {
  await user.click(screen.getByRole("tab", { name: ta("compliance_tab_compliance") }));
  await screen.findByTestId("grid");
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  hookState.complianceRegulations = REGULATIONS;
  polling.startPolling.mockReset();
  polling.stopPolling.mockReset();
  polling.active = false;
  polling.onComplete = undefined;
  polling.onError = undefined;
  mockApi.on("get", "/compliance/overview", OVERVIEW);
  mockApi.on("get", "/compliance/compliance", BUNDLES);
  mockApi.on("get", "/compliance/active-runs", { compliance: null });
  mockApi.on("post", "/compliance/compliance-scan", { run_id: "run-1" });
  mockApi.on("delete", /^\/compliance\/compliance-findings\/[^/]+$/, undefined);
  mockApi.on("delete", "/compliance/compliance-findings/bulk", { updated: 1, skipped: [] });
  mockApi.on("patch", "/compliance/compliance-findings/bulk", { updated: 1, skipped: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ComplianceScanner — overview", () => {
  it("loads the overview and the bundles once, then renders the score and heatmap", async () => {
    renderPage();
    await waitForOverview();

    expect(overviewCalls()).toHaveLength(1);
    expect(complianceCalls()).toHaveLength(1);
    expect(mockApi.callsOf("get", "/compliance/active-runs")).toHaveLength(1);
    expect(polling.startPolling).not.toHaveBeenCalled();

    // (90 + 50) / 2
    expect(screen.getByText("70%")).toBeInTheDocument();
    const heatmap = screen.getByTestId("heatmap");
    // Only enabled regulations, labelled from the DB row, the i18n catalogue or the key.
    expect(heatmap).toHaveAttribute("data-regulations", "eu_ai_act=EU AI Act (custom);gdpr=GDPR");
    expect(heatmap).toHaveAttribute("data-scores", JSON.stringify(OVERVIEW.compliance_scores));
    expect(heatmap).toHaveAttribute("data-matrix", JSON.stringify(OVERVIEW.compliance_by_status));
    expect(screen.queryByText(ta("compliance_never_scanned"))).not.toBeInTheDocument();
    // Regulation checkboxes: the enabled ones, ticked.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(ta("compliance_summary_label", { count: 6, regs: 2 }))).toBeInTheDocument();
  });

  it("says so when no scan has ever run and scores to 100 without data", async () => {
    mockApi.on("get", "/compliance/overview", NEVER_RAN);
    renderPage();
    await waitForOverview();
    expect(screen.getAllByText(ta("compliance_never_scanned")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("colours the score tile by band", async () => {
    mockApi.on("get", "/compliance/overview", { ...OVERVIEW, compliance_scores: { gdpr: 65 } });
    renderPage();
    await waitForOverview();
    expect(screen.getByText("65%")).toBeInTheDocument();
  });

  it("reports an overview failure, but treats a 404 as 'nothing yet'", async () => {
    mockApi.fail("get", "/compliance/overview", 500, "boom");
    const { unmount } = renderPage();
    expect(await screen.findByText(/GET \/compliance\/overview failed/)).toBeInTheDocument();
    expect(screen.queryByText(ta("compliance_kpi_compliance_score"))).not.toBeInTheDocument();
    unmount();

    mockApi.reset();
    mockApi.on("get", "/compliance/compliance", BUNDLES);
    mockApi.on("get", "/compliance/active-runs", { compliance: null });
    mockApi.fail("get", "/compliance/overview", 404);
    renderPage();
    await waitFor(() => expect(overviewCalls()).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("falls back to an empty register when the bundles cannot be loaded", async () => {
    mockApi.fail("get", "/compliance/compliance", 500);
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);
    expect(gridIds()).toBe("");
    expect(screen.queryByRole("tab", { name: /GDPR/ })).not.toBeInTheDocument();
  });

  it("offers the AI setup link to an admin when AI is not configured", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensAiConfigured: false };
    const { user } = renderPage();
    await waitForOverview();
    expect(screen.getByText(ta("compliance_ai_not_configured_register_still_available"))).toBeInTheDocument();
    expect(queryScanButton()).not.toBeInTheDocument();
    expect(screen.queryByText(ta("compliance_never_scanned"))).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: i18n.t("grc:compliance.aiRequired.configureCta") as string }));
    expect(await screen.findByTestId("settings-page")).toBeInTheDocument();
  });

  it("hides the AI setup link from a user without admin.settings", async () => {
    hookState.turboLens = { ...hookState.turboLens, turboLensAiConfigured: false };
    renderPage({ user: userWith("compliance.view") });
    await waitForOverview();
    expect(screen.getByText(ta("compliance_ai_not_configured_register_still_available"))).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("explains an empty regulation list and disables the scan", async () => {
    hookState.complianceRegulations = [];
    renderPage();
    await waitForOverview();
    expect(screen.getByText(ta("compliance_no_regulations_enabled"))).toBeInTheDocument();
    expect(scanButton()).toBeDisabled();
    expect(screen.getByTestId("heatmap")).toHaveAttribute("data-regulations", "");
  });
});

describe("ComplianceScanner — running a scan", () => {
  it("posts the ticked regulations, starts polling the run and refreshes the overview", async () => {
    const { user } = renderPage();
    await waitForOverview();

    // Untick GDPR so only the AI Act goes out.
    await user.click(screen.getByRole("checkbox", { name: "GDPR" }));
    await user.click(scanButton());

    await waitFor(() => expect(mockApi.callsOf("post", "/compliance/compliance-scan")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/compliance/compliance-scan")[0].body).toEqual({ regulations: ["eu_ai_act"] });
    expect(await screen.findByText(ta("compliance_scan_started"))).toBeInTheDocument();
    expect(polling.startPolling).toHaveBeenCalledWith("run-1");
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));

    // Re-tick: the next scan carries both again.
    await user.click(screen.getByRole("checkbox", { name: "GDPR" }));
    await user.click(scanButton());
    await waitFor(() => expect(mockApi.callsOf("post", "/compliance/compliance-scan")).toHaveLength(2));
    expect(mockApi.callsOf("post", "/compliance/compliance-scan")[1].body).toEqual({
      regulations: ["eu_ai_act", "gdpr"],
    });
  });

  it("disables the scan button once every regulation is unticked", async () => {
    const { user } = renderPage();
    await waitForOverview();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    expect(scanButton()).toBeDisabled();
    expect(mockApi.callsOf("post", "/compliance/compliance-scan")).toHaveLength(0);
  });

  it("reports a refused scan", async () => {
    mockApi.fail("post", "/compliance/compliance-scan", 403, "no");
    const { user } = renderPage();
    await waitForOverview();
    await user.click(scanButton());
    expect(await screen.findByText(/POST \/compliance\/compliance-scan failed/)).toBeInTheDocument();
    expect(polling.startPolling).not.toHaveBeenCalled();
  });

  it("resumes polling an active run found on mount", async () => {
    mockApi.on("get", "/compliance/active-runs", {
      compliance: { id: "run-9", analysis_type: "compliance", status: "running" },
    });
    renderPage();
    await waitFor(() => expect(polling.startPolling).toHaveBeenCalledWith("run-9"));
  });

  it("shrugs off an active-runs failure", async () => {
    mockApi.fail("get", "/compliance/active-runs", 500);
    renderPage();
    await waitForOverview();
    expect(polling.startPolling).not.toHaveBeenCalled();
    expect(screen.queryByText(/active-runs failed/)).not.toBeInTheDocument();
  });

  it("announces completion and reloads both feeds; an error lands in the alert", async () => {
    const { user } = renderPage();
    await waitForOverview();

    await act(async () => {
      polling.onComplete?.();
    });
    expect(await screen.findByText(ta("compliance_scan_complete"))).toBeInTheDocument();
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    await waitFor(() => expect(complianceCalls()).toHaveLength(2));

    await act(async () => {
      polling.onError?.("The model timed out");
    });
    expect(await screen.findByText("The model timed out")).toBeInTheDocument();
    // Both notes close.
    for (const alert of screen.getAllByRole("alert")) {
      const close = within(alert).queryByRole("button");
      if (close) await user.click(close);
    }
    expect(screen.queryByText("The model timed out")).not.toBeInTheDocument();
    expect(screen.queryByText(ta("compliance_scan_complete"))).not.toBeInTheDocument();
  });

  it("re-reads the overview every 3 seconds while a run is polling", async () => {
    vi.useFakeTimers();
    polling.active = true;
    renderPage();
    await act(async () => {});
    expect(overviewCalls()).toHaveLength(1);
    expect(screen.getByRole("button", { name: buttonName(ta("compliance_scanning")) })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(overviewCalls()).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(overviewCalls()).toHaveLength(3);
  });
});

describe("ComplianceScanner — compliance tab", () => {
  it("renders one tab per bundle with its score, muting disabled and removed regulations", async () => {
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);

    // Labels: DB row > bundle label > i18n catalogue > raw key.
    expect(screen.getByRole("tab", { name: /EU AI Act \(custom\)/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /GDPR/ })).toBeInTheDocument();
    // The DB row's label wins over the bundle's own ("SOC 2") even when disabled.
    expect(screen.getByRole("tab", { name: /SOC2/ })).toHaveTextContent(ta("compliance_regulation_disabled"));
    expect(screen.getByRole("tab", { name: /old_reg/ })).toHaveTextContent(ta("compliance_regulation_orphan"));
    expect(screen.getByRole("tab", { name: /GDPR/ })).toHaveTextContent("55%");

    // Default regulation is the AI Act: one finding.
    expect(gridIds()).toBe("a1");
    await user.click(screen.getByRole("tab", { name: /GDPR/ }));
    // Auto-resolved f4 is hidden by default; everything else shows.
    expect(gridIds()).toBe("f1,f2,f3,f5");
    expect(screen.getByTestId("grid")).toHaveAttribute("data-loading", "false");
  });

  it("pins the active regulation to the first bundle when the default is absent", async () => {
    mockApi.on("get", "/compliance/compliance", BUNDLES.slice(1));
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);
    expect(gridIds()).toBe("f1,f2,f3,f5");
  });

  it("applies every sidebar filter the grid reports back", async () => {
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);
    await user.click(screen.getByRole("tab", { name: /GDPR/ }));

    await user.click(screen.getByTestId("grid-include-resolved"));
    expect(gridIds()).toBe("f1,f2,f3,f4,f5");

    await user.click(screen.getByTestId("grid-ai-only"));
    expect(screen.getByTestId("grid")).toHaveAttribute("data-ai-only", "true");
    expect(gridIds()).toBe("f3");

    await user.click(screen.getByTestId("grid-ai-confirmed"));
    expect(gridIds()).toBe("f3");
  });

  it("filters by card type, letting landscape findings through", async () => {
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);
    await user.click(screen.getByRole("tab", { name: /GDPR/ }));
    await user.click(screen.getByTestId("grid-only-itc"));
    expect(gridIds()).toBe("f2,f5");
  });

  it("filters by severity, decision and status", async () => {
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);
    await user.click(screen.getByRole("tab", { name: /GDPR/ }));
    await user.click(screen.getByTestId("grid-only-critical"));
    expect(gridIds()).toBe("f3");
    await user.click(screen.getByTestId("grid-only-new"));
    expect(gridIds()).toBe("f3");
    await user.click(screen.getByTestId("grid-only-compliant"));
    expect(gridIds()).toBe("");
  });

  it("drills through from a heatmap cell, then clears the transient status filter", async () => {
    const { user } = renderPage();
    await waitForOverview();

    await user.click(screen.getByTestId("heatmap-pick"));
    expect(await screen.findByTestId("grid")).toBeInTheDocument();
    expect(gridIds()).toBe("f1,f3");
    const note = screen.getByText(
      ta("compliance_filter_from_heatmap", { status: ta("compliance_status_non_compliant") }),
    );
    expect(note).toBeInTheDocument();

    await user.click(within(note.closest(".MuiAlert-root") as HTMLElement).getByRole("button"));
    expect(screen.queryByText(/from the heatmap/)).not.toBeInTheDocument();
    expect(gridIds()).toBe("f1,f2,f3,f5");

    // Picking a whole regulation (no status) just switches tabs.
    await user.click(screen.getByRole("tab", { name: ta("compliance_tab_overview") }));
    await user.click(screen.getByTestId("heatmap-pick-all"));
    expect(await screen.findByTestId("grid")).toBeInTheDocument();
    expect(screen.queryByText(/from the heatmap/)).not.toBeInTheDocument();
    expect(gridIds()).toBe("f1,f2,f3,f5");

    // Switching regulation drops the highlight.
    await user.click(screen.getByRole("tab", { name: ta("compliance_tab_overview") }));
    await user.click(screen.getByTestId("heatmap-pick"));
    await screen.findByTestId("grid");
    await user.click(screen.getByRole("tab", { name: /EU AI Act/ }));
    expect(screen.queryByText(/from the heatmap/)).not.toBeInTheDocument();
    expect(gridIds()).toBe("a1");
  });

  it("replaces an updated finding in its bundle", async () => {
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);
    await user.click(screen.getByRole("tab", { name: /GDPR/ }));
    await user.click(screen.getByTestId("grid-only-new"));
    expect(gridIds()).toBe("f1,f3");
    // The grid reports f1 flipped to compliant: same row, new status.
    await user.click(screen.getByTestId("grid-updated"));
    expect(gridIds()).toBe("f1,f3");
    await user.click(screen.getByTestId("grid-only-compliant"));
    expect(gridIds()).toBe("f1");
    // The filters are global, not per regulation: a1 (non-compliant) is
    // excluded by the compliant-only filter on the AI Act tab too.
    await user.click(screen.getByRole("tab", { name: /EU AI Act/ }));
    expect(gridIds()).toBe("");
  });
});

describe("ComplianceScanner — finding actions", () => {
  async function onGdpr(user: ReturnType<typeof renderPage>["user"]) {
    await waitForOverview();
    await openComplianceTab(user);
    await user.click(screen.getByRole("tab", { name: /GDPR/ }));
  }

  it("deletes a finding and drops it from the register", async () => {
    const { user } = renderPage();
    await onGdpr(user);
    await user.click(screen.getByTestId("grid-delete"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/compliance/compliance-findings/f1")).toHaveLength(1));
    await waitFor(() => expect(gridIds()).toBe("f2,f3,f5"));
  });

  it("reports a refused delete and keeps the finding", async () => {
    mockApi.fail("delete", /^\/compliance\/compliance-findings\/[^/]+$/, 403, "no");
    const { user } = renderPage();
    await onGdpr(user);
    await user.click(screen.getByTestId("grid-delete"));
    expect(await screen.findByText(/DELETE \/compliance\/compliance-findings\/f1 failed/)).toBeInTheDocument();
    expect(gridIds()).toBe("f1,f2,f3,f5");
  });

  it("promotes a finding to a risk and navigates to the new risk", async () => {
    const { user } = renderPage();
    await onGdpr(user);
    await user.click(screen.getByTestId("grid-promote"));
    const dialog = screen.getByTestId("risk-dialog");
    expect(dialog).toHaveAttribute("data-mode", "compliance");
    expect(dialog).toHaveAttribute("data-finding", "f1");
    expect(dialog).toHaveAttribute("data-title", "Art. 5: ERP");

    await user.click(screen.getByTestId("risk-dialog-created"));
    expect(await screen.findByTestId("risk-page")).toHaveAttribute("data-id", "r-new");
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    await waitFor(() => expect(complianceCalls()).toHaveLength(2));
  });

  it("closes the risk dialog without creating", async () => {
    const { user } = renderPage();
    await onGdpr(user);
    await user.click(screen.getByTestId("grid-promote"));
    await user.click(screen.getByTestId("risk-dialog-close"));
    expect(screen.queryByTestId("risk-dialog")).not.toBeInTheDocument();
    expect(complianceCalls()).toHaveLength(1);
  });

  it("opens an existing risk", async () => {
    const { user } = renderPage();
    await onGdpr(user);
    await user.click(screen.getByTestId("grid-open-risk"));
    expect(await screen.findByTestId("risk-page")).toHaveAttribute("data-id", "r9");
  });

  it("opens the finding dialog in edit and in create mode, reloading on save", async () => {
    const { user } = renderPage();
    await onGdpr(user);

    await user.click(screen.getByTestId("grid-edit"));
    expect(screen.getByTestId("finding-dialog")).toHaveAttribute("data-mode", "edit");
    await user.click(screen.getByTestId("finding-dialog-saved"));
    await waitFor(() => expect(complianceCalls()).toHaveLength(2));
    // The dialog stays open until closed (the page only reloads on save).
    await user.click(screen.getByTestId("finding-dialog-close"));
    expect(screen.queryByTestId("finding-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("grid-create"));
    expect(screen.getByTestId("finding-dialog")).toHaveAttribute("data-mode", "create");
    expect(screen.getByTestId("finding-dialog")).toHaveAttribute("data-regulation", "gdpr");
    await user.click(screen.getByTestId("finding-dialog-close"));
    expect(screen.queryByTestId("finding-dialog")).not.toBeInTheDocument();
  });

  it("opens and closes the card side panel", async () => {
    const { user } = renderPage();
    await onGdpr(user);
    await user.click(screen.getByTestId("grid-open-card"));
    expect(screen.getByTestId("card-panel")).toHaveAttribute("data-card-id", "c1");
    await user.click(screen.getByTestId("card-panel-close"));
    expect(screen.queryByTestId("card-panel")).not.toBeInTheDocument();
  });

  it("runs bulk delete and bulk decision updates through the API and reloads", async () => {
    const { user } = renderPage();
    await onGdpr(user);

    await user.click(screen.getByTestId("grid-bulk-delete"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/compliance/compliance-findings/bulk")).toHaveLength(1));
    expect(mockApi.callsOf("delete", "/compliance/compliance-findings/bulk")[0].body).toEqual({ ids: ["f1"] });
    await waitFor(() => expect(complianceCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId("grid")).toHaveAttribute("data-ai-only", "true"));

    await user.click(screen.getByTestId("grid-bulk-decision"));
    await waitFor(() => expect(mockApi.callsOf("patch", "/compliance/compliance-findings/bulk")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/compliance/compliance-findings/bulk")[0].body).toEqual({
      ids: ["f1"],
      decision: "in_review",
      review_note: "note",
    });
    await waitFor(() => expect(complianceCalls()).toHaveLength(3));
  });

  it("reports failed bulk operations as empty results", async () => {
    mockApi.fail("delete", "/compliance/compliance-findings/bulk", 500);
    mockApi.fail("patch", "/compliance/compliance-findings/bulk", 500);
    const { user } = renderPage();
    await onGdpr(user);

    await user.click(screen.getByTestId("grid-bulk-delete"));
    expect(await screen.findByText(/DELETE \/compliance\/compliance-findings\/bulk failed/)).toBeInTheDocument();
    expect(screen.getByTestId("grid")).toHaveAttribute("data-ai-only", "false");

    await user.click(screen.getByTestId("grid-bulk-decision"));
    expect(await screen.findByText(/PATCH \/compliance\/compliance-findings\/bulk failed/)).toBeInTheDocument();
    expect(complianceCalls()).toHaveLength(1);
  });

  it("exports the visible findings as a CSV with escaped cells", async () => {
    const objectUrl = installObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { user } = renderPage();
    await waitForOverview();
    await openComplianceTab(user);

    await user.click(screen.getByTestId("grid-export"));
    expect(objectUrl.created).toHaveLength(1);
    expect(click).toHaveBeenCalledTimes(1);
    // jsdom's Blob has no `text()`; read it the way a browser of its era would.
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(objectUrl.created[0]);
    });
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    // Every header cell is translated (2.157.0): none of them is a bare English string.
    expect(lines[0].split(",")).toEqual([
      tcards("compliance.grid.col.card"),
      tcards("compliance.grid.col.severity"),
      tcards("compliance.grid.col.status"),
      tcards("compliance.grid.col.article"),
      tcards("compliance.grid.col.requirement"),
      tcards("compliance.grid.col.lifecycle"),
      ta("compliance_ai_detected"),
      ta("compliance_auto_resolved"),
      tcards("compliance.cardTab.col.regulation"),
      ta("compliance_gap"),
      ta("compliance_evidence"),
      ta("compliance_remediation"),
      ta("compliance_reviewer"),
      ta("compliance_reviewed_at"),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`ERP,${ta("compliance_severity_high")},${ta("compliance_status_non_compliant")},Art. 5,"He said ""hi"", twice"`);
    const no = i18n.t("common:labels.no");
    expect(lines[1]).toContain(`,${no},${no},eu_ai_act,`);
    expect(objectUrl.revoked).toHaveLength(1);

    click.mockRestore();
    objectUrl();
  });

  it("hands the grid canManage=false and disables the scan for a viewer (2.157.0)", async () => {
    // The scanner used to read no permission at all, so `ComplianceGrid`
    // fell back to its `canManage = true` default and a viewer saw Create,
    // Delete and the bulk actions; only the backend's 403 stopped the write.
    const { user } = renderPage({ user: userWith("compliance.view") });
    await waitForOverview();
    expect(scanButton()).toBeDisabled();
    await openComplianceTab(user);
    expect(screen.getByTestId("grid")).toHaveAttribute("data-can-manage", "false");
  });

  it("hands the grid canManage=true to a user holding compliance.manage", async () => {
    const { user } = renderPage({ user: userWith("compliance.view", "compliance.manage") });
    await waitForOverview();
    await openComplianceTab(user);
    expect(screen.getByTestId("grid")).toHaveAttribute("data-can-manage", "true");
  });
});
