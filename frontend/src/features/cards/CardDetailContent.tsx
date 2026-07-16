import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Badge from "@mui/material/Badge";
import { useTranslation } from "react-i18next";
import ErrorBoundary from "@/components/ErrorBoundary";
import EolLinkSection from "@/components/EolLinkSection";
import ProcessFlowTab from "@/features/bpm/ProcessFlowTab";
import ProcessAssessmentPanel from "@/features/bpm/ProcessAssessmentPanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCalculatedFields } from "@/hooks/useCalculatedFields";
import { useCurrency } from "@/hooks/useCurrency";
import { usePpmEnabled } from "@/hooks/usePpmEnabled";
import { useGrcEnabled } from "@/hooks/useGrcEnabled";
import { useCardTabActivity } from "@/hooks/useCardTabActivity";
import { api } from "@/api/client";
import {
  DescriptionSection,
  LifecycleSection,
  AttributeSection,
  HierarchySection,
  SuccessorsSection,
  RelationsSection,
  LayeredDependencySection,
  CommentsTab,
  TodosTab,
  StakeholdersTab,
  ResourcesTab,
  HistoryTab,
  RisksTab,
  ComplianceTab,
  TagsSection,
} from "@/features/cards/sections";
import { useAuthContext } from "@/hooks/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { hasPermission } from "@/components/RequirePermission";
import {
  ExtensionBoundary,
  ExtensionSlot,
  useExtensionUI,
  useExtensionFieldVisibilityProviders,
} from "@/lib/extensionHost";
import SoAWTab from "@/features/cards/sections/SoAWTab";
import type {
  Card,
  CardEffectivePermissions,
  Risk,
  TurboLensComplianceFinding,
} from "@/types";

interface Props {
  card: Card;
  perms: CardEffectivePermissions["effective"];
  onCardUpdate: (card: Card) => void;
  /** Show BPM tabs (Process Flow, Assessments) for BusinessProcess cards (default true) */
  showBpmTabs?: boolean;
  /** Show PPM tab for Initiative cards (default true) */
  showPpmTab?: boolean;
  /** Initial tab index (default 0) */
  initialTab?: number;
  /** Initial sub-tab for Process Flow tab */
  initialSubTab?: number;
  /** Extra content rendered before tabs (e.g. archive banner, action buttons) */
  beforeTabs?: ReactNode;
  /** Field keys auto-computed by PPM (treated as readonly with "auto" badge) */
  autoFieldKeys?: string[];
  /** Show Layered Dependency View section at bottom of Card tab (default true, disabled in side panel) */
  showLdvSection?: boolean;
  /** Optional AI-suggest trigger rendered in the Description section header */
  onAiSuggest?: () => void;
  /** Whether an AI suggestion is currently in flight (disables the button) */
  aiBusy?: boolean;
  /** Notified when any editable section has unsaved changes (for a leave guard) */
  onDirtyChange?: (dirty: boolean) => void;
}

export default function CardDetailContent({
  card,
  perms,
  onCardUpdate,
  showBpmTabs = true,
  showPpmTab = true,
  initialTab = 0,
  initialSubTab,
  beforeTabs,
  autoFieldKeys = [],
  showLdvSection = true,
  onAiSuggest,
  aiBusy = false,
  onDirtyChange,
}: Props) {
  const { t } = useTranslation("cards");
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const { isCalculated } = useCalculatedFields();
  const { fmt: currencyFmt } = useCurrency();
  const { ppmEnabled } = usePpmEnabled();
  const { grcEnabled } = useGrcEnabled();
  const { user } = useAuthContext();
  const { can } = usePermissions(user);

  // Card-scoped Risks / Compliance counts. `null` = still loading → render the
  // tab optimistically so we don't flash it on for cards that DO have items.
  // After the fetch settles, a 0 count removes the tab so empty surfaces don't
  // take up tab-strip space.
  const [risksCount, setRisksCount] = useState<number | null>(null);
  const [complianceCount, setComplianceCount] = useState<number | null>(null);
  const canViewCompliance = can("compliance.view");
  const canViewRisks = can("risks.view");

  useEffect(() => {
    if (!grcEnabled) {
      setRisksCount(0);
      setComplianceCount(0);
      return;
    }
    let cancelled = false;
    if (canViewRisks) {
      setRisksCount(null);
      api
        .get<Risk[]>(`/cards/${card.id}/risks`)
        .then((rows) => {
          if (!cancelled) setRisksCount(rows.length);
        })
        .catch(() => {
          if (!cancelled) setRisksCount(0);
        });
    } else {
      setRisksCount(0);
    }
    if (canViewCompliance) {
      setComplianceCount(null);
      api
        .get<TurboLensComplianceFinding[]>(`/cards/${card.id}/compliance-findings`)
        .then((rows) => {
          if (!cancelled) setComplianceCount(rows.length);
        })
        .catch(() => {
          if (!cancelled) setComplianceCount(0);
        });
    } else {
      setComplianceCount(0);
    }
    return () => {
      cancelled = true;
    };
  }, [card.id, grcEnabled, canViewRisks, canViewCompliance]);

  const showRisksTab = grcEnabled && canViewRisks && (risksCount === null || risksCount > 0);
  const showComplianceTab =
    grcEnabled && canViewCompliance && (complianceCount === null || complianceCount > 0);

  const [tab, setTab] = useState(initialTab);
  const [relRefresh, setRelRefresh] = useState(0);

  // Reset tab when card changes
  useEffect(() => {
    setTab(initialTab);
  }, [card.id, initialTab]);

  const typeConfig = getType(card.type);

  // Calculated field keys (includes auto-computed PPM fields)
  let calcFieldKeys: string[] = [];
  try {
    for (const section of typeConfig?.fields_schema || []) {
      for (const field of section.fields || []) {
        if (isCalculated(card.type, field.key)) calcFieldKeys.push(field.key);
      }
    }
  } catch (err) {
    console.error("[CardDetailContent] calcFieldKeys error", err);
    calcFieldKeys = [];
  }
  if (autoFieldKeys.length > 0) {
    calcFieldKeys = [...new Set([...calcFieldKeys, ...autoFieldKeys])];
  }

  // Section config
  const sc = typeConfig?.section_config || {};
  const secExpanded = (key: string, fallback = true) =>
    sc[key]?.defaultExpanded !== false ? fallback : false;
  const secHidden = (key: string) => !!sc[key]?.hidden;

  // Extensions may hide specific card fields at render time (display-only,
  // ungated, never deletes stored values). Each registered provider renders as
  // a headless slot below and reports its own hidden-key set, keyed by its
  // extension. Stable provider list → each provider's own hooks keep a fixed
  // order across re-renders.
  const fieldVisibilityProviders = useExtensionFieldVisibilityProviders();
  const [extHiddenByKey, setExtHiddenByKey] = useState<Record<string, string[]>>({});
  const reportHiddenFields = useCallback((extKey: string, keys: string[]) => {
    setExtHiddenByKey((prev) => {
      const cur = prev[extKey];
      if (cur && cur.length === keys.length && cur.every((k, i) => k === keys[i])) {
        return prev; // no change — avoid needless re-render
      }
      return { ...prev, [extKey]: keys };
    });
  }, []);

  // Determine hidden fields: subtype hidden_fields ∪ every currently-registered
  // extension provider's reported keys. Reports from an extension that is no
  // longer registered are ignored (its slot is gone).
  const hiddenFieldKeys: Set<string> = (() => {
    const set = new Set<string>();
    if (card.subtype && typeConfig?.subtypes) {
      const st = typeConfig.subtypes.find((s) => s.key === card.subtype);
      for (const k of st?.hidden_fields ?? []) set.add(k);
    }
    const active = new Set(fieldVisibilityProviders.map((p) => p.extKey));
    for (const [extKey, keys] of Object.entries(extHiddenByKey)) {
      if (!active.has(extKey)) continue;
      for (const k of keys) set.add(k);
    }
    return set;
  })();

  const customSections = (typeConfig?.fields_schema || []).filter(
    (s) => s.section !== "__description",
  );
  const descExtraSection = (typeConfig?.fields_schema || []).find(
    (s) => s.section === "__description",
  );
  const descExtraFields = (descExtraSection?.fields || []).filter(
    (f) => !hiddenFieldKeys.has(f.key),
  );

  // Build section order from config or default
  const sectionOrder = (() => {
    const raw = (sc as Record<string, unknown>).__order as string[] | undefined;
    if (raw && Array.isArray(raw) && raw.length > 0) {
      const customKeys = customSections.map((_, i) => `custom:${i}`);
      const existing = new Set(raw);
      const result = [...raw];
      for (const k of customKeys) {
        if (!existing.has(k)) result.push(k);
      }
      // Inject "successors" before "relations" if not already present
      if (!existing.has("successors") && typeConfig?.has_successors) {
        const relIdx = result.indexOf("relations");
        if (relIdx >= 0) result.splice(relIdx, 0, "successors");
        else result.push("successors");
      }
      // Inject "tags" before "relations" if not already present
      if (!existing.has("tags")) {
        const relIdx = result.indexOf("relations");
        if (relIdx >= 0) result.splice(relIdx, 0, "tags");
        else result.push("tags");
      }
      return result.filter((k) => {
        if (k === "hierarchy" && !typeConfig?.has_hierarchy) return false;
        if (k === "successors" && !typeConfig?.has_successors) return false;
        return true;
      });
    }
    const order: string[] = ["description", "eol", "lifecycle"];
    customSections.forEach((_, i) => order.push(`custom:${i}`));
    if (typeConfig?.has_hierarchy) order.push("hierarchy");
    if (typeConfig?.has_successors) order.push("successors");
    order.push("tags");
    order.push("relations");
    return order;
  })();

  const handleUpdate = useCallback(
    async (updates: Record<string, unknown>) => {
      const updated = await api.patch<Card>(`/cards/${card.id}`, updates);
      onCardUpdate(updated);
    },
    [card.id, onCardUpdate],
  );

  // Track which sections have unsaved edits so the page can warn on navigation
  // (#843). Each editable section reports its dirty state under a stable key;
  // we bubble a single boolean up whenever the "any dirty" state flips.
  // `onDirtyChange` is read through a ref so `registerDirty` (and the per-key
  // callbacks derived from it) keep a stable identity and don't re-trigger each
  // section's dirty-reporting effect on every render.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  const dirtySectionsRef = useRef<Set<string>>(new Set());
  const dirtyCbCacheRef = useRef<Map<string, (dirty: boolean) => void>>(
    new Map(),
  );
  const registerDirty = useCallback((key: string, dirty: boolean) => {
    const set = dirtySectionsRef.current;
    const wasEmpty = set.size === 0;
    if (dirty) set.add(key);
    else set.delete(key);
    const isEmpty = set.size === 0;
    if (wasEmpty !== isEmpty) onDirtyChangeRef.current?.(!isEmpty);
  }, []);
  const dirtyCb = useCallback(
    (key: string) => {
      let cb = dirtyCbCacheRef.current.get(key);
      if (!cb) {
        cb = (dirty: boolean) => registerDirty(key, dirty);
        dirtyCbCacheRef.current.set(key, cb);
      }
      return cb;
    },
    [registerDirty],
  );

  const renderSection = (key: string) => {
    if (secHidden(key)) return null;
    const exp = secExpanded(key, key === "relations" ? false : true);

    if (key === "description") {
      return (
        <ErrorBoundary key={key} label="Description" inline>
          <DescriptionSection
            card={card}
            onSave={handleUpdate}
            canEdit={perms.can_edit}
            initialExpanded={exp}
            extraFields={
              descExtraFields.length > 0 ? descExtraFields : undefined
            }
            currencyFmt={currencyFmt}
            onAiSuggest={onAiSuggest}
            aiBusy={aiBusy}
            onDirtyChange={dirtyCb("description")}
          />
        </ErrorBoundary>
      );
    }
    if (key === "eol") {
      return (
        <ErrorBoundary key={key} label="End of Life" inline>
          <EolLinkSection
            card={card}
            onSave={handleUpdate}
            initialExpanded={exp ? undefined : false}
          />
        </ErrorBoundary>
      );
    }
    if (key === "lifecycle") {
      return (
        <ErrorBoundary key={key} label="Lifecycle" inline>
          <LifecycleSection
            card={card}
            onSave={handleUpdate}
            canEdit={perms.can_edit}
            initialExpanded={exp}
            onDirtyChange={dirtyCb("lifecycle")}
          />
        </ErrorBoundary>
      );
    }
    if (key === "hierarchy") {
      return (
        <ErrorBoundary key={key} label="Hierarchy" inline>
          <HierarchySection
            card={card}
            onUpdate={() =>
              api.get<Card>(`/cards/${card.id}`).then(onCardUpdate)
            }
            canEdit={perms.can_edit}
            initialExpanded={exp}
          />
        </ErrorBoundary>
      );
    }
    if (key === "successors") {
      return (
        <ErrorBoundary key={key} label="Successors" inline>
          <SuccessorsSection
            card={card}
            canEdit={perms.can_manage_relations}
            initialExpanded={exp}
          />
        </ErrorBoundary>
      );
    }
    if (key === "tags") {
      return (
        <ErrorBoundary key={key} label="Tags" inline>
          <TagsSection
            card={card}
            onUpdate={() => api.get<Card>(`/cards/${card.id}`).then(onCardUpdate)}
            canEdit={perms.can_edit}
            initialExpanded={exp}
          />
        </ErrorBoundary>
      );
    }
    if (key === "relations") {
      return (
        <ErrorBoundary key={key} label="Relations" inline>
          <RelationsSection
            fsId={card.id}
            cardTypeKey={card.type}
            refreshKey={relRefresh}
            canManageRelations={perms.can_manage_relations}
            initialExpanded={exp}
          />
        </ErrorBoundary>
      );
    }
    if (key.startsWith("custom:")) {
      const idx = parseInt(key.split(":")[1], 10);
      const section = customSections[idx];
      if (!section) return null;
      // Skip section if all its fields are hidden for the active subtype
      if (
        hiddenFieldKeys.size > 0 &&
        section.fields.length > 0 &&
        section.fields.every((f) => hiddenFieldKeys.has(f.key))
      ) {
        return null;
      }
      return (
        <ErrorBoundary key={key} label={section.section}>
          <AttributeSection
            section={section}
            card={card}
            onSave={handleUpdate}
            onRelationChange={() => setRelRefresh((n) => n + 1)}
            canEdit={perms.can_edit}
            calculatedFieldKeys={calcFieldKeys}
            initialExpanded={exp}
            hiddenFieldKeys={hiddenFieldKeys}
            canViewCosts={perms.can_view_costs}
            onDirtyChange={dirtyCb(key)}
          />
        </ErrorBoundary>
      );
    }
    return null;
  };

  const isBpm = showBpmTabs && card.type === "BusinessProcess";
  const isPpm = showPpmTab && ppmEnabled && card.type === "Initiative";
  const isSoaw = card.type === "Initiative";

  // BPM adds 2 tabs after Card; SoAW adds 1 tab after Card (only one of these
  // ever fires — a card has exactly one type). PPM tab goes at the very end.
  const bpmOffset = isBpm ? 2 : 0;
  const soawOffset = isSoaw ? 1 : 0;
  const extraOffset = bpmOffset + soawOffset;
  const commentsIdx = 1 + extraOffset;
  const todosIdx = 2 + extraOffset;
  const stakeholdersIdx = 3 + extraOffset;
  const resourcesIdx = 4 + extraOffset;
  const risksTabOffset = showRisksTab ? 1 : 0;
  const risksIdx = showRisksTab ? 5 + extraOffset : -1;
  const complianceTabOffset = showComplianceTab ? 1 : 0;
  const complianceIdx = showComplianceTab ? 5 + extraOffset + risksTabOffset : -1;
  const historyIdx = 5 + extraOffset + risksTabOffset + complianceTabOffset;
  const ppmTabIdx = isPpm ? historyIdx + 1 : -1;
  // SoAW tab index = 1 when Initiative (no BPM); slots in right after Card.
  const soawTabIdx = isSoaw ? 1 + bpmOffset : -1;

  // Extension-contributed tabs render at the very end of the strip,
  // filtered by card type (appliesTo) and app-level permission.
  const uiExtensions = useExtensionUI();
  const extensionTabs = uiExtensions.flatMap(({ key, plugin }) =>
    (plugin.cardTabs ?? [])
      .filter((def) => !def.appliesTo || def.appliesTo.includes(card.type))
      .filter((def) => !def.permission || hasPermission(user?.permissions, def.permission))
      .map((def) => ({ extKey: key, def })),
  );
  const extensionTabBase = historyIdx + 1 + (isPpm ? 1 : 0);

  const { hasUpdates, noteVisit } = useCardTabActivity(card.id, user?.id);

  const tabKeyForIndex = (idx: number): string | null => {
    if (idx === 0) return "card";
    if (isBpm && idx === 1) return "processFlow";
    if (isBpm && idx === 2) return "assessments";
    if (isSoaw && idx === soawTabIdx) return "soaw";
    if (idx === commentsIdx) return "comments";
    if (idx === todosIdx) return "todos";
    if (idx === stakeholdersIdx) return "stakeholders";
    if (idx === resourcesIdx) return "resources";
    if (showRisksTab && idx === risksIdx) return "risks";
    if (showComplianceTab && idx === complianceIdx) return "compliance";
    if (idx === historyIdx) return "history";
    if (isPpm && idx === ppmTabIdx) return "ppm";
    return null;
  };

  // Note which tabs the user has opened during this visit. The dots stay
  // visible for the whole visit — noteVisit buffers the timestamps and the
  // hook flushes them to localStorage on unmount / beforeunload so the
  // *next* visit starts fresh. PPM tab is excluded — clicking it navigates
  // away rather than rendering inline.
  useEffect(() => {
    const key = tabKeyForIndex(tab);
    if (key && key !== "ppm") noteVisit(key);
    // tabKeyForIndex captures index offsets; re-running when any of them shift
    // keeps the active key in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, card.id, isBpm, isSoaw, showRisksTab, showComplianceTab, noteVisit]);

  const renderTabLabel = (key: string, label: string) => {
    if (!hasUpdates(key)) return label;
    return (
      <Badge
        variant="dot"
        color="primary"
        title={t("tabs.newActivity")}
        slotProps={{ badge: { "aria-hidden": "true" } }}
        sx={{ "& .MuiBadge-dot": { right: -6, top: 6 } }}
      >
        {label}
      </Badge>
    );
  };

  return (
    <>
      {/* Headless extension field-visibility providers (render null). Stable
          list + stable key per extension so each provider's hooks keep order.
          Each runs inside ExtensionBoundary so a crash can't blank the card. */}
      {fieldVisibilityProviders.map(({ extKey, provider: Provider }) => (
        <ExtensionBoundary key={`fv-${extKey}`} extensionKey={extKey}>
          <Provider card={card} report={reportHiddenFields} />
        </ExtensionBoundary>
      ))}

      {/* Generic extension slot (SDK 1.12): any extension can render header
          content on any card without a dedicated SDK extension point. */}
      <ExtensionSlot
        name="card.detail.header"
        context={{ cardId: card.id, cardType: card.type }}
      />

      {beforeTabs}

      <Tabs
        value={tab}
        onChange={(_, v) => {
          if (isPpm && v === ppmTabIdx) {
            navigate(`/ppm/${card.id}`);
            return;
          }
          setTab(v);
        }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab label={renderTabLabel("card", t("tabs.card"))} />
        {isBpm && <Tab label={renderTabLabel("processFlow", t("tabs.processFlow"))} />}
        {isBpm && <Tab label={renderTabLabel("assessments", t("tabs.assessments"))} />}
        {isSoaw && <Tab label={renderTabLabel("soaw", t("tabs.soaw"))} />}
        <Tab label={renderTabLabel("comments", t("tabs.comments"))} />
        <Tab label={renderTabLabel("todos", t("tabs.todos"))} />
        <Tab label={renderTabLabel("stakeholders", t("tabs.stakeholders"))} />
        <Tab label={renderTabLabel("resources", t("tabs.resources"))} />
        {showRisksTab && <Tab label={renderTabLabel("risks", t("tabs.risks"))} />}
        {showComplianceTab && (
          <Tab label={renderTabLabel("compliance", t("tabs.compliance"))} />
        )}
        <Tab label={renderTabLabel("history", t("tabs.history"))} />
        {isPpm && <Tab label={renderTabLabel("ppm", t("tabs.ppm"))} />}
        {extensionTabs.map(({ extKey, def }) => (
          <Tab key={`ext:${extKey}:${def.id}`} label={def.label} />
        ))}
      </Tabs>

      {tab === 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {sectionOrder.map(renderSection)}
          {showLdvSection && (
            <ErrorBoundary label="Dependencies" inline>
              <LayeredDependencySection cardId={card.id} />
            </ErrorBoundary>
          )}
        </Box>
      )}
      {isBpm && tab === 1 && (
        <ErrorBoundary label="Process Flow">
          <MuiCard>
            <CardContent>
              <ProcessFlowTab
                processId={card.id}
                processName={card.name}
                initialSubTab={initialSubTab}
              />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {isSoaw && tab === soawTabIdx && (
        <ErrorBoundary label="SoAW">
          <MuiCard>
            <CardContent>
              <SoAWTab initiativeId={card.id} canManage={perms.can_edit} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {isBpm && tab === 2 && (
        <ErrorBoundary label="Assessments">
          <MuiCard>
            <CardContent>
              <ProcessAssessmentPanel processId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === commentsIdx && (
        <ErrorBoundary label="Comments">
          <MuiCard>
            <CardContent>
              <CommentsTab
                fsId={card.id}
                canCreateComments={perms.can_create_comments}
                canManageComments={perms.can_manage_comments}
              />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === todosIdx && (
        <ErrorBoundary label="Todos">
          <MuiCard>
            <CardContent>
              <TodosTab fsId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === stakeholdersIdx && (
        <ErrorBoundary label="Stakeholders">
          <MuiCard>
            <CardContent>
              <StakeholdersTab
                card={card}
                onRefresh={() =>
                  api.get<Card>(`/cards/${card.id}`).then(onCardUpdate)
                }
                canManageStakeholders={perms.can_manage_stakeholders}
              />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === resourcesIdx && (
        <ErrorBoundary label="Resources">
          <MuiCard>
            <CardContent>
              <ResourcesTab
                fsId={card.id}
                cardName={card.name}
                cardType={card.type}
                canManageDocuments={perms.can_manage_documents}
                canManageAdrLinks={perms.can_manage_adr_links}
                canManageDiagramLinks={perms.can_manage_diagram_links}
              />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {showRisksTab && tab === risksIdx && (
        <ErrorBoundary label="Risks">
          <MuiCard>
            <CardContent>
              <RisksTab cardId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {showComplianceTab && tab === complianceIdx && (
        <ErrorBoundary label="Compliance">
          <MuiCard>
            <CardContent>
              <ComplianceTab cardId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === historyIdx && (
        <ErrorBoundary label="History">
          <MuiCard>
            <CardContent>
              <HistoryTab fsId={card.id} cardType={card.type} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {extensionTabs.map(({ extKey, def }, i) =>
        tab === extensionTabBase + i ? (
          <ExtensionBoundary key={`ext:${extKey}:${def.id}`} extensionKey={extKey}>
            <MuiCard>
              <CardContent>
                <def.component cardId={card.id} cardType={card.type} />
              </CardContent>
            </MuiCard>
          </ExtensionBoundary>
        ) : null,
      )}
    </>
  );
}
