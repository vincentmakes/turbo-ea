---
paths:
  - "backend/app/services/turbolens_*.py"
  - "backend/app/services/compliance_*.py"
  - "backend/app/api/v1/turbolens.py"
  - "backend/app/api/v1/compliance*.py"
  - "frontend/src/features/turbolens/**"
  - "frontend/src/features/grc/compliance/**"
---

# TurboLens AI analyses and the GRC compliance scanner

> Loaded when you touch `backend/app/services/turbolens_*.py`, `backend/app/services/compliance_*.py`, `backend/app/api/v1/turbolens.py`, `backend/app/api/v1/compliance*.py`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

## TurboLens (AI-Powered EA Intelligence)

Native AI analysis module. Provides vendor analysis, duplicate detection, modernization assessment, and architecture AI recommendations using data directly from the `cards` table.

### Architecture
- **No separate container**: All logic runs natively in Turbo EA (FastAPI + PostgreSQL). No proxy layer, no SQLite.
- **AI infrastructure reuse**: Uses the same AI provider config from `app_settings.general_settings.ai` (supports Claude, OpenAI, DeepSeek, Gemini).
- **Background tasks + polling**: Long-running AI operations use FastAPI `BackgroundTasks` + `TurboLensAnalysisRun` status polling.
- **Direct data access**: Queries `cards`, `relations`, and `relation_types` tables via SQLAlchemy — no data copy or intermediate storage.
- **Session persistence**: The Architecture AI wizard saves progress to `sessionStorage` so users can navigate away and return without losing their place.

### Database Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `turbolens_vendor_analysis` | `TurboLensVendorAnalysis` | AI-categorized vendors with category, sub-category, app counts, costs |
| `turbolens_vendor_hierarchy` | `TurboLensVendorHierarchy` | Resolved canonical vendor tree (parent-child, aliases, confidence) |
| `turbolens_duplicate_clusters` | `TurboLensDuplicateCluster` | Functional duplicate groups with evidence, recommendation, status |
| `turbolens_modernization_assessments` | `TurboLensModernization` | Modernization opportunities with effort, priority, current tech |
| `turbolens_analysis_runs` | `TurboLensAnalysisRun` | Analysis execution history (type, status, timestamps, errors, progress JSONB). Used by all TurboLens analyses including the `compliance` compliance scanner. |
| `turbolens_assessments` | `TurboLensAssessment` | Saved Architecture-AI wizard runs — requirement, selected objectives/capabilities, phase answers, chosen option, gaps + dependencies, target architecture payload. Surfaced by the `/turbolens` Assessments tab. |
| `compliance_findings` | `TurboLensComplianceFinding` | Compliance gap / attestation per regulation (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001). Carries article, category, requirement, status, severity, gap, evidence, remediation, `ai_detected` flag for semantically-identified AI cards, and optional `risk_id`. |

### Backend Services

| File | Purpose |
|------|---------|
| `services/turbolens_ai.py` | Shared AI caller + JSON repair (truncation recovery, bracket balancing) |
| `services/turbolens_vendors.py` | Vendor categorization (45+ categories, batch=15) + resolution (batch=60, hierarchy building) |
| `services/turbolens_duplicates.py` | Duplicate detection (union-find merge, batch=40) + modernization assessment (batch=25) |
| `services/turbolens_architect.py` | 5-step architecture AI: objective-driven capability mapping, solution options, gap analysis, dependency analysis, and target architecture rendered with the Layered Dependency View |
| `services/compliance_scanner.py` | Compliance scanner orchestrator. Entry point (`run_compliance_scan`) that emits phase-aware progress to `run.results["progress"]`. Includes the EU AI Act **semantic detector** that flags cards embedding AI regardless of subtype. The legacy `run_security_scan` / `run_cve_scan` entry points have been removed — see `tests/services/test_compliance_scanner.py::test_service_exposes_compliance_scan_entry_point`. |
| `services/compliance_risk_sync.py` | Two-way bridge between compliance findings and the EA Risk Register (promote-to-risk + back-links). |

### Architecture AI Flow

The Architecture AI follows a 5-step guided wizard:

1. **Requirements** (Phase 0) — User enters a business requirement, selects existing Objective cards (autocomplete), and optionally selects or creates Business Capabilities (free-text for new ones).
2. **Business Fit** (Phase 1) — AI generates business clarification questions with typed inputs (text, single-choice, multi-choice with NFR categories).
3. **Technical Fit** (Phase 2) — AI generates technical deep-dive questions.
4. **Solution** (Phase 3) — Three sub-phases:
   - **3a: Options** — AI generates solution option cards (buy/build/extend/reuse) with impact preview (new/modified/retired components, integrations), estimated cost, duration, and complexity.
   - **3b: Gap Analysis** — After selecting an option, AI identifies capability gaps with ranked market product recommendations (gold/silver/bronze). Users select products via checkboxes.
   - **3c: Dependencies** — After selecting products, AI identifies additional infrastructure/platform dependencies needed. Users select dependencies via checkboxes.
5. **Target Architecture** (Phase 5) — Capability mapping with matched capabilities (existing vs new), proposed new cards (typed per metamodel, including new BusinessCapabilities), proposed relations, and an interactive **Layered Dependency View** rendered via `LayeredDependencyView` (React Flow). Proposed nodes appear with dashed borders and a green "NEW" badge. Backend guardrails automatically enforce: every new Application links to a BusinessCapability, every new BusinessCapability links to selected Objectives, and orphan cards (no relations) are removed.
6. **Commit** — Save assessment, then commit via `CommitInitiativeDialog`: creates Initiative card (name defaults to selected option title, editable), all selected new cards with AI-generated descriptions, relations, and a draft ADR capturing the decision context, selected products, and alternatives. Changing approach resets the assessment for re-saving.

### Frontend Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/turbolens` | `TurboLensPage` | Tab container: Dashboard, Vendors, Resolution, Duplicates, Architect, Assessments, History. **No Security / Compliance tab** — compliance moved to `/grc?tab=compliance` when the CVE half of the old "Security & Compliance" feature was removed. |
| `/turbolens` (Dashboard tab) | `TurboLensDashboard` | KPI tiles, cards by type, quality tiers (Bronze/Silver/Gold), top issues |
| `/turbolens` (Vendors tab) | `TurboLensVendors` | Vendor analysis with category breakdown, grid/table toggle |
| `/turbolens` (Resolution tab) | `TurboLensResolution` | Canonical vendor hierarchy with confidence scores |
| `/turbolens` (Duplicates tab) | `TurboLensDuplicates` | Duplicate clusters + modernization assessment (sub-tabs) |
| `/turbolens` (Architect tab) | `TurboLensArchitect` | 5-step architecture AI wizard with Layered Dependency View visualization |
| `/turbolens` (Assessments tab) | `TurboLensAssessments` | Saved architecture-AI assessments |
| `/turbolens` (History tab) | `TurboLensHistory` | Analysis run history table |
| `/grc?tab=risk` | `RiskRegisterPage` (embedded in `GrcPage`) | Risk Register — KPIs, Initial/Residual 4×4 matrix toggle, filters, risk table. (`/ea-delivery/risks` 301-redirects here for backwards compatibility.) |
| `/grc?tab=compliance` | `ComplianceScanner` + `ComplianceGrid` / `ComplianceHeatmap` (embedded in `GrcPage`) | On-demand compliance scan with phase-aware progress bar, compliance heatmap, finding grid, and **Create risk** / **Open risk** actions on every finding. **The CVE scan that used to live here has been removed** — compliance is now regulation-driven only (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001). |
| `/grc?tab=governance` | `GovernanceTab` (embedded in `GrcPage`) | Principles + Decisions panels |
| `/grc/risks/:id` | `RiskDetailPage` | Full TOGAF-shaped detail: Identification, Initial assessment, Mitigation & residual (with Owner picker), Affected cards (M:N), Status stepper + primary **Next step** + secondary side actions (Accept / Reopen / Close-early), Audit. (`/ea-delivery/risks/:id` redirects here.) |

### Key Frontend Components

| Component | Purpose |
|-----------|---------|
| `TurboLensArchitect.tsx` | 5-step wizard: requirement input → Q&A → options → gaps → deps → capability mapping |
| `CommitInitiativeDialog.tsx` | Initiative creation dialog with card/relation selection, renaming, and progress tracking |
| `AssessmentViewer.tsx` | Read-only assessment viewer with the Layered Dependency View |
| `LayeredDependencyView.tsx` | React Flow-based renderer for the **Layered Dependency View** — grouped swim lanes per EA layer with mirrored handles for cross-layer edges |
| `layeredDependencyLayout.ts` | Automatic layout engine for the Layered Dependency View (node positioning, edge routing, handle allocation) |
| `ArchitectureDiagram.tsx` | Mermaid diagram renderer for architecture visualizations |
| `useAnalysisPolling.ts` | Custom hook: polls analysis runs every 3s until completion/failure |
| `utils.ts` | Shared helpers: `formatCost()`, color mappers, `ARCHITECT_STEPS` stepper config |

### Permissions
- **`turbolens.view`**: View analysis results. Granted to admin, bpm_admin, member roles.
- **`turbolens.manage`**: Trigger analyses. Granted to admin role.
