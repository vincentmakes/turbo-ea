/**
 * Raw colours ratchet down to zero — CLAUDE.md "Design tokens": "Never hardcode
 * hex codes — import the named token", UI_GUIDELINES.md §1.3.
 *
 * Every colour the app draws is a design token (`src/theme/tokens.ts`) or a MUI
 * theme value. About a thousand hex / `rgb()` literals predate the rule, so
 * this is a per-file baseline with EXACT counts rather than a flat ban:
 *
 *   - a file above its count (or an unlisted file with any hit) fails and lists
 *     every hit — a new raw colour is never allowed in;
 *   - a file below its count fails too, asking for the entry to be lowered — so
 *     every PR that swaps colours for tokens moves the number, and the baseline
 *     can never rot into headroom a later PR spends quietly;
 *   - a listed file at zero fails, asking for the entry to be deleted.
 *
 * What counts is `rawColours` (`src/test/sourceScanners.ts`): comments are
 * skipped, string literals, template literals and JSX text are not; selectors,
 * translation keys and links are not colours. `src/theme/**` is where tokens
 * are defined, and `EXEMPT` holds the few files whose colours are data, not
 * styling. Measured 2026-11-02: 170 files, 972 hits, 624 files scanned.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, rawColours, rel, walkSources } from "@/test/sourceScanners";

/** Files whose colours are the data itself, not styling. One-line reason each. */
const EXEMPT: Record<string, string> = {
  "src/components/ColorPicker.tsx": "user-facing swatch palette, the colours are the data",
  "src/lib/color.ts": "contrast math returns black or white",
  "src/features/diagrams/drawio-shapes.ts":
    "draw.io style strings and inline SVG written at export time",
};

/**
 * Raw colours per file, exact. Lower an entry in the PR that removes colours
 * from that file; delete it when the file reaches zero. Never raise one: use a
 * token from `src/theme/tokens.ts` (add a named one if none fits). When the
 * last entry goes, replace this dict and the per-file checks with a strict
 * `expect(hits).toEqual([])` over the whole scan.
 */
const RAW_COLOUR_BASELINE: Record<string, number> = {
  "src/components/CreateCardDialog.tsx": 3,
  "src/components/EolLinkSection.tsx": 4,
  "src/components/FilterSelect.tsx": 1,
  "src/components/IconPicker.tsx": 3,
  "src/components/ModuleGate.tsx": 1,
  "src/components/NotificationBell.tsx": 4,
  "src/components/RequirePermission.tsx": 1,
  "src/components/SearchDialog.tsx": 2,
  "src/components/SponsorshipDialog.tsx": 2,
  "src/components/TimelineSlider.tsx": 1,
  "src/features/admin/AiAdmin.tsx": 4,
  "src/features/admin/AuthAdmin.tsx": 2,
  "src/features/admin/CalculationsAdmin.tsx": 14,
  "src/features/admin/CardLayoutEditor.tsx": 17,
  "src/features/admin/EolAdmin.tsx": 12,
  "src/features/admin/ExtensionsAdmin.tsx": 1,
  "src/features/admin/MetamodelAdmin.tsx": 4,
  "src/features/admin/NavbarStyleCard.tsx": 1,
  "src/features/admin/PrinciplesAdmin.tsx": 3,
  "src/features/admin/RegulationsAdmin.tsx": 2,
  "src/features/admin/ResourceTypesAdmin.tsx": 1,
  "src/features/admin/ResourcesFilterSidebar.tsx": 1,
  "src/features/admin/ResourcesStatsPanel.tsx": 1,
  "src/features/admin/RolesAdmin.tsx": 16,
  "src/features/admin/ServiceNowAdmin.tsx": 15,
  "src/features/admin/SettingsAdmin.tsx": 18,
  "src/features/admin/SurveyBuilder.tsx": 6,
  "src/features/admin/SurveyResults.tsx": 2,
  "src/features/admin/SurveysAdmin.tsx": 2,
  "src/features/admin/TagsAdmin.tsx": 3,
  "src/features/admin/UsersAdmin.tsx": 2,
  "src/features/admin/UsersFilterSidebar.tsx": 7,
  "src/features/admin/WebPortalsAdmin.tsx": 2,
  "src/features/admin/extensions/ExtensionLogo.tsx": 1,
  "src/features/admin/metamodel/CardTypePermissionsPanel.tsx": 6,
  "src/features/admin/metamodel/DataQualityPanel.tsx": 1,
  "src/features/admin/metamodel/ImportanceSlider.tsx": 1,
  "src/features/admin/metamodel/MetamodelGraph.tsx": 9,
  "src/features/admin/metamodel/RelationTranslationDialog.tsx": 1,
  "src/features/admin/metamodel/RelationTypeValuesDialog.tsx": 3,
  "src/features/admin/metamodel/RelationTypesPanel.tsx": 4,
  "src/features/admin/metamodel/StakeholderRolePanel.tsx": 4,
  "src/features/admin/metamodel/TranslationDialog.tsx": 1,
  "src/features/admin/metamodel/TypeColorPreview.tsx": 8,
  "src/features/admin/metamodel/TypeDetailDrawer.tsx": 5,
  "src/features/admin/metamodel/constants.ts": 1,
  "src/features/admin/users/UserImportDialog.tsx": 2,
  "src/features/auth/ForgotPasswordPage.tsx": 2,
  "src/features/auth/LoginPage.tsx": 13,
  "src/features/auth/ResetPasswordPage.tsx": 6,
  "src/features/auth/SetPasswordPage.tsx": 6,
  "src/features/auth/SsoCallback.tsx": 5,
  "src/features/capability-catalogue/CapabilityCataloguePage.tsx": 2,
  "src/features/cards/CardDetail.tsx": 9,
  "src/features/cards/sections/AdrsTab.tsx": 2,
  "src/features/cards/sections/ComplianceTab.tsx": 2,
  "src/features/cards/sections/DescriptionSection.tsx": 1,
  "src/features/cards/sections/HierarchySection.tsx": 7,
  "src/features/cards/sections/HistoryTab.tsx": 3,
  "src/features/cards/sections/LifecycleSection.tsx": 6,
  "src/features/cards/sections/ResourcesTab.tsx": 1,
  "src/features/cards/sections/SoAWTab.tsx": 2,
  "src/features/cards/sections/SuccessorsSection.tsx": 2,
  "src/features/cards/sections/TodosTab.tsx": 1,
  "src/features/cards/sections/cardDetailUtils.tsx": 3,
  "src/features/cards/sections/historyChanges.ts": 39,
  "src/features/dashboard/admin/ApprovalPipelineSection.tsx": 1,
  "src/features/dashboard/admin/IdleUsersSection.tsx": 1,
  "src/features/dashboard/admin/StakeholderCoverageSection.tsx": 4,
  "src/features/dashboard/admin/StakeholderDirectorySection.tsx": 2,
  "src/features/dashboard/admin/SystemActivitySection.tsx": 1,
  "src/features/dashboard/admin/TopContributorsSection.tsx": 1,
  "src/features/dashboard/admin/UnassignedTodosSection.tsx": 2,
  "src/features/dashboard/formatActivityEvent.ts": 8,
  "src/features/dashboard/workspace/CardTypePill.tsx": 1,
  "src/features/dashboard/workspace/MyCreatedSection.tsx": 1,
  "src/features/dashboard/workspace/MyFavoritesSection.tsx": 2,
  "src/features/dashboard/workspace/MyPendingSurveysSection.tsx": 1,
  "src/features/dashboard/workspace/MyRolesSection.tsx": 1,
  "src/features/dashboard/workspace/MySavedReportsSection.tsx": 3,
  "src/features/dashboard/workspace/MyTodosSection.tsx": 2,
  "src/features/dashboard/workspace/RecentActivityOnMyCardsSection.tsx": 1,
  "src/features/dashboard/workspace/SectionPaper.tsx": 1,
  "src/features/diagrams/CreateOnDiagramDialog.tsx": 1,
  "src/features/diagrams/DiagramEditor.tsx": 16,
  "src/features/diagrams/DiagramSyncPanel.tsx": 9,
  "src/features/diagrams/DiagramViewLegend.tsx": 1,
  "src/features/diagrams/DiagramViewer.tsx": 1,
  "src/features/diagrams/DiagramsPage.tsx": 9,
  "src/features/diagrams/ExpandMenu.tsx": 2,
  "src/features/diagrams/ManageGroupsDialog.tsx": 1,
  "src/features/diagrams/PublicDiagramPage.tsx": 1,
  "src/features/diagrams/RelationPickerDialog.tsx": 2,
  "src/features/diagrams/cardLogoImage.ts": 1,
  "src/features/diagrams/viewSource.ts": 1,
  "src/features/ea-delivery/ADREditor.tsx": 2,
  "src/features/ea-delivery/ADRPreview.tsx": 5,
  "src/features/ea-delivery/AdrFilterSidebar.tsx": 3,
  "src/features/ea-delivery/AdrGrid.tsx": 6,
  "src/features/ea-delivery/LinkDiagramsDialog.tsx": 1,
  "src/features/ea-delivery/SoAWEditor.tsx": 6,
  "src/features/ea-delivery/SoAWPreview.tsx": 5,
  "src/features/ea-delivery/initiatives/DeliverableSection.tsx": 1,
  "src/features/ea-delivery/initiatives/InitiativeTreeSidebar.tsx": 6,
  "src/features/ea-delivery/initiatives/InitiativeWorkspace.tsx": 3,
  "src/features/ea-delivery/initiatives/NewArtefactSplitButton.tsx": 1,
  "src/features/ea-delivery/initiatives/constants.ts": 5,
  "src/features/ea-delivery/soawExport.ts": 30,
  "src/features/grc/compliance/ComplianceHeatmap.tsx": 2,
  "src/features/grc/compliance/ComplianceScanner.tsx": 3,
  "src/features/grc/governance/DecisionsPanel.tsx": 2,
  "src/features/grc/governance/PrinciplesPanel.tsx": 1,
  "src/features/grc/risk/RiskRegisterPage.tsx": 12,
  "src/features/grc/risk/affectedCards.ts": 1,
  "src/features/grc/risk/riskMatrixColors.ts": 9,
  "src/features/inventory/ImportDialog.tsx": 2,
  "src/features/inventory/InventoryFilterSidebar.tsx": 16,
  "src/features/inventory/InventoryPage.tsx": 10,
  "src/features/inventory/LogoCell.tsx": 2,
  "src/features/ppm/PpmGanttTab.tsx": 12,
  "src/features/ppm/PpmPortfolioView.tsx": 4,
  "src/features/ppm/PpmTaskBoard.tsx": 9,
  "src/features/ppm/PpmTaskCard.tsx": 5,
  "src/features/ppm/ppmGanttModel.ts": 16,
  "src/features/ppm/ppmPortfolioFormat.ts": 6,
  "src/features/principles-catalogue/PrinciplesCataloguePage.tsx": 4,
  "src/features/process-catalogue/ProcessCataloguePage.tsx": 2,
  "src/features/reference-catalogue/CatalogueBrowser.tsx": 2,
  "src/features/reports/CapabilityMapReport.tsx": 11,
  "src/features/reports/CostReport.tsx": 6,
  "src/features/reports/DataQualityReport.tsx": 6,
  "src/features/reports/DependencyReport.tsx": 17,
  "src/features/reports/EaDeliveryReport.tsx": 2,
  "src/features/reports/EditReportDialog.tsx": 1,
  "src/features/reports/EolReport.tsx": 30,
  "src/features/reports/LayeredDependencyView.tsx": 16,
  "src/features/reports/LdvCluster.tsx": 4,
  "src/features/reports/LifecycleReport.tsx": 14,
  "src/features/reports/MatrixReport.tsx": 18,
  "src/features/reports/MetricCard.tsx": 1,
  "src/features/reports/PortfolioReport.tsx": 7,
  "src/features/reports/ProcessMapReport.tsx": 29,
  "src/features/reports/ReportFilterSection.tsx": 2,
  "src/features/reports/ReportShell.tsx": 1,
  "src/features/reports/SaveReportDialog.tsx": 1,
  "src/features/reports/SavedReportsPage.tsx": 6,
  "src/features/reports/ldvLayoutShared.ts": 3,
  "src/features/reports/ldvViewModel.ts": 17,
  "src/features/reports/matrixState.ts": 20,
  "src/features/reports/portfolioHelpers.ts": 2,
  "src/features/reports/reportExport.ts": 2,
  "src/features/reports/savedReportStyles.ts": 12,
  "src/features/surveys/MySurveys.tsx": 3,
  "src/features/surveys/SurveyRespond.tsx": 3,
  "src/features/todos/TodosPage.tsx": 5,
  "src/features/turbolens/ArchitectureDiagram.tsx": 34,
  "src/features/turbolens/AssessmentViewer.tsx": 7,
  "src/features/turbolens/CommitInitiativeDialog.tsx": 3,
  "src/features/turbolens/TurboLensArchitect.tsx": 10,
  "src/features/turbolens/TurboLensDashboard.tsx": 12,
  "src/features/turbolens/TurboLensDuplicates.tsx": 6,
  "src/features/turbolens/TurboLensResolution.tsx": 7,
  "src/features/turbolens/TurboLensVendors.tsx": 6,
  "src/features/turbolens/utils.ts": 6,
  "src/features/value-stream-catalogue/ValueStreamCataloguePage.tsx": 2,
  "src/features/web-portals/PortalViewer.tsx": 39,
  "src/hooks/useThumbnailCapture.ts": 1,
  "src/layouts/AppLayout.tsx": 7,
  "src/lib/dataQualityBands.ts": 3,
  "src/lib/printDocument.ts": 1,
};

/** Anti-rot floor: a walker or exclusion bug that empties the scan must not pass vacuously. */
const MIN_FILES_SCANNED = 300;

const TOKEN_HINT =
  "Raw colours are not allowed (CLAUDE.md, Design tokens). Use a token from src/theme/tokens.ts " +
  "(add a named one if none fits) or a MUI theme value (\"text.secondary\", " +
  "theme.palette.action.disabled, alpha(theme.palette.common.white, 0.2)).";

function excluded(relPath: string): boolean {
  return relPath.startsWith("src/theme/") || relPath in EXEMPT;
}

let scanned: Map<string, string[]> | undefined;

/** Every scanned file with its hits (`line: match`), keyed by `src/…` path. Read once, on first use. */
function scan(): Map<string, string[]> {
  if (!scanned) {
    scanned = new Map();
    for (const file of walkSources(SRC, { exclude: excluded })) {
      scanned.set(rel(file), rawColours(file, fs.readFileSync(file, "utf8")));
    }
  }
  return scanned;
}

/** The ratchet's verdicts for one scan against one baseline — empty when the two agree. */
function ratchet(
  hits: Map<string, string[]>,
  baseline: Record<string, number>,
): { over: string[]; under: string[]; zero: string[] } {
  const over: string[] = [];
  const under: string[] = [];
  const zero: string[] = [];
  for (const [file, found] of hits) {
    const allowed = baseline[file] ?? 0;
    if (found.length > allowed) {
      over.push(...found.map((hit) => `${file}:${hit}`));
    } else if (file in baseline && found.length === 0) {
      zero.push(`${file}: no raw colour left — delete the entry from RAW_COLOUR_BASELINE`);
    } else if (found.length < allowed) {
      under.push(`lower RAW_COLOUR_BASELINE["${file}"] to ${found.length} (was ${allowed})`);
    }
  }
  return { over, under, zero };
}

describe("ratchet", () => {
  const baseline = { "src/a.ts": 2, "src/b.ts": 1 };

  it("passes when every count matches exactly", () => {
    const hits = new Map([
      ["src/a.ts", ["1: #fff", "2: #000"]],
      ["src/b.ts", ["3: rgba("]],
      ["src/c.ts", []],
    ]);
    expect(ratchet(hits, baseline)).toEqual({ over: [], under: [], zero: [] });
  });

  it("fails a file above its count, or an unlisted file with any hit, listing every hit", () => {
    const hits = new Map([
      ["src/a.ts", ["1: #fff", "2: #000", "9: #abc"]],
      ["src/b.ts", ["3: rgba("]],
      ["src/c.ts", ["4: #123"]],
    ]);
    expect(ratchet(hits, baseline).over).toEqual([
      "src/a.ts:1: #fff",
      "src/a.ts:2: #000",
      "src/a.ts:9: #abc",
      "src/c.ts:4: #123",
    ]);
  });

  it("fails a file below its count, and a listed file at zero", () => {
    const hits = new Map([
      ["src/a.ts", ["1: #fff"]],
      ["src/b.ts", []],
    ]);
    const { over, under, zero } = ratchet(hits, baseline);
    expect(over).toEqual([]);
    expect(under).toEqual(['lower RAW_COLOUR_BASELINE["src/a.ts"] to 1 (was 2)']);
    expect(zero).toEqual(["src/b.ts: no raw colour left — delete the entry from RAW_COLOUR_BASELINE"]);
  });

  it("with an empty baseline demands zero hits everywhere", () => {
    const hits = new Map([["src/a.ts", ["1: #fff"]]]);
    expect(ratchet(hits, {}).over).toEqual(["src/a.ts:1: #fff"]);
    expect(ratchet(new Map([["src/a.ts", []]]), {})).toEqual({ over: [], under: [], zero: [] });
  });

  it("counts a colour in a template literal, never one in a comment", () => {
    const src = ["// was #fff before the token", "/* rgba(0,0,0,.5) */", "const b = `1px solid #ccc`;"];
    expect(rawColours("x.ts", src.join("\n"))).toEqual(["3: #ccc"]);
  });
});

describeSourceScan("raw colours ratchet against RAW_COLOUR_BASELINE", () => {
  itSourceScan("scans the whole of src/", () => {
    expect(scan().size).toBeGreaterThan(MIN_FILES_SCANNED);
  });

  itSourceScan("adds no raw colour to any file", () => {
    expect(ratchet(scan(), RAW_COLOUR_BASELINE).over, TOKEN_HINT).toEqual([]);
  });

  itSourceScan("keeps every baseline entry exact (lower it as colours go)", () => {
    expect(ratchet(scan(), RAW_COLOUR_BASELINE).under).toEqual([]);
  });

  itSourceScan("lists no file that has reached zero", () => {
    expect(ratchet(scan(), RAW_COLOUR_BASELINE).zero).toEqual([]);
  });

  itSourceScan("lists only files that are still scanned (stale baseline entries)", () => {
    const stale = Object.keys(RAW_COLOUR_BASELINE).filter((file) => !scan().has(file));
    expect(stale, "the file was moved, deleted or excluded — remove its entry").toEqual([]);
  });

  itSourceScan("exempts only files that exist", () => {
    const stale = Object.keys(EXEMPT).filter((file) => !fs.existsSync(path.join(SRC, "..", file)));
    expect(stale, "remove the EXEMPT entry").toEqual([]);
  });
});

describe("RAW_COLOUR_BASELINE", () => {
  it("is sorted by path and holds only positive counts", () => {
    const keys = Object.keys(RAW_COLOUR_BASELINE);
    expect(keys).toEqual([...keys].sort());
    expect(Object.values(RAW_COLOUR_BASELINE).filter((n) => !(n > 0))).toEqual([]);
  });
});
