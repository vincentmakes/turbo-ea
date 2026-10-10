import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Badge from "@mui/material/Badge";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import { missingRequiredFields } from "@/features/cards/sections/cardDetailUtils";
import { useFieldLabel } from "@/hooks/useResolveLabel";
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
  AdrsTab,
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
import {
  allFieldsHidden,
  buildSectionOrder,
  calculatedFieldKeys,
  customSectionsOf,
  hiddenFieldKeys as hiddenFieldKeysOf,
  makeSectionConfigReader,
  sectionDefaultExpanded,
} from "@/features/cards/sectionConfig";
import {
  CARD_TAB_LABEL_KEYS,
  cardTabKeys,
  notesVisit,
  resolveCardTab,
  visibleExtensionTabs,
  type CardTabKey,
} from "@/features/cards/cardTabs";
import type {
  ArchitectureDecision,
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
  /** Tab to open: its key (`"resources"`), or an index for older links (`1`). */
  initialTab?: number | string;
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

  // Card-scoped ADR count. Same `null = loading` convention as above, but ADRs
  // are not GRC-gated so this lives in its own effect. Unlike Risks the tab
  // also stays visible on an empty card for users who may link/create ADRs —
  // otherwise there'd be no way to attach the first decision to a card.
  const [adrCount, setAdrCount] = useState<number | null>(null);
  const canViewAdr = can("adr.view");

  useEffect(() => {
    if (!canViewAdr) {
      setAdrCount(0);
      return;
    }
    let cancelled = false;
    setAdrCount(null);
    api
      .get<ArchitectureDecision[]>(`/adr/by-card/${card.id}`)
      .then((rows) => {
        if (!cancelled) setAdrCount(rows.length);
      })
      .catch(() => {
        if (!cancelled) setAdrCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, canViewAdr]);

  // The tab the user asked for: a key, or an index from an older deep link.
  const [requestedTab, setRequestedTab] = useState<number | string>(initialTab);
  const [relRefresh, setRelRefresh] = useState(0);

  // Reset tab when card changes
  useEffect(() => {
    setRequestedTab(initialTab);
  }, [card.id, initialTab]);

  const typeConfig = getType(card.type);
  const fieldLabel = useFieldLabel();

  // Mandatory fields still empty on this card (respecting the subtype's hidden
  // fields; boolean/readonly exempt) — while any exist, data quality is pinned
  // to 0 server-side and a warning banner above the sections says what to fill.
  // Calculated fields are excluded: the user cannot type those in by hand.
  const missingMandatory = missingRequiredFields(
    typeConfig,
    card.subtype,
    card.attributes,
  ).filter((f) => !isCalculated(card.type, f.key) && !autoFieldKeys.includes(f.key));

  // Calculated field keys (includes auto-computed PPM fields)
  const calcFieldKeys = calculatedFieldKeys(
    typeConfig?.fields_schema,
    (key) => isCalculated(card.type, key),
    autoFieldKeys,
  );

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
  const hiddenFieldKeys = hiddenFieldKeysOf(
    typeConfig?.subtypes,
    card.subtype,
    extHiddenByKey,
    fieldVisibilityProviders.map((p) => p.extKey),
  );

  const customSections = customSectionsOf(typeConfig?.fields_schema);
  const descExtraSection = (typeConfig?.fields_schema || []).find(
    (s) => s.section === "__description",
  );
  const descExtraFields = (descExtraSection?.fields || []).filter(
    (f) => !hiddenFieldKeys.has(f.key),
  );

  // Section config — see `sectionConfig.ts` for the explicit-boolean and
  // legacy-key semantics this reader encapsulates.
  const sc = typeConfig?.section_config || {};
  const sectionCfg = makeSectionConfigReader(sc, customSections);
  const secRaw = sectionCfg.raw;
  const secExpanded = sectionCfg.expanded;
  const secHidden = sectionCfg.hidden;

  const sectionOrder = buildSectionOrder(sc as Record<string, unknown>, customSections.length, {
    hierarchy: !!typeConfig?.has_hierarchy,
    successors: !!typeConfig?.has_successors,
  });

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
    const exp = secExpanded(key, sectionDefaultExpanded(key));

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
            calculatedFieldKeys={calcFieldKeys}
          />
        </ErrorBoundary>
      );
    }
    if (key === "eol") {
      return (
        <ErrorBoundary key={key} label="End of Life" inline>
          {/* `undefined` keeps EolLinkSection's own default (expand only when a
              product is linked); an explicit setting overrides it. */}
          <EolLinkSection
            card={card}
            onSave={handleUpdate}
            initialExpanded={secRaw("eol")}
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
            onCardUpdate={() => api.get<Card>(`/cards/${card.id}`).then(onCardUpdate)}
          />
        </ErrorBoundary>
      );
    }
    if (key.startsWith("custom:")) {
      const idx = parseInt(key.split(":")[1], 10);
      const section = customSections[idx];
      if (!section) return null;
      // Skip section if all its fields are hidden for the active subtype
      if (allFieldsHidden(section, hiddenFieldKeys)) return null;
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

  const tabKeys = cardTabKeys({
    cardType: card.type,
    showBpmTabs,
    showPpmTab,
    ppmEnabled,
    grcEnabled,
    canViewRisks,
    risksCount,
    canViewCompliance,
    complianceCount,
    canViewAdr,
    adrCount,
    canManageAdrLinks: perms.can_manage_adr_links,
  });

  // Extension-contributed tabs render at the very end of the strip,
  // filtered by card type (appliesTo) and app-level permission.
  const uiExtensions = useExtensionUI();
  const extensionTabs = visibleExtensionTabs(uiExtensions, card.type, (permission) =>
    hasPermission(user?.permissions, permission),
  );
  // A tab that vanished (a count settled at 0) or never existed opens the
  // Card tab rather than leaving the strip with no selection.
  const tab = resolveCardTab(requestedTab, [
    ...tabKeys,
    ...extensionTabs.map((x) => x.value),
  ]);

  const { hasUpdates, noteVisit } = useCardTabActivity(card.id, user?.id);

  // Note which tabs the user has opened during this visit. The dots stay
  // visible for the whole visit — noteVisit buffers the timestamps and the
  // hook flushes them to localStorage on unmount / beforeunload so the
  // *next* visit starts fresh.
  useEffect(() => {
    if (notesVisit(tab)) noteVisit(tab);
  }, [tab, card.id, noteVisit]);

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
          content on any card without a dedicated SDK extension point. Core owns
          the layout — one wrapping row, so several extensions' chips line up
          instead of each inventing its own full-width band. `&:empty` keeps the
          margin off a card nobody decorates (a contribution that has nothing to
          say renders null, and ExtensionBoundary adds no wrapper of its own). */}
      <Box
        data-testid="card-header-slot"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1,
          mb: 1.5,
          "&:empty": { display: "none" },
          // `align-items: center` centres a flex item's MARGIN box, not its
          // border box — so a contribution carrying its own bottom margin, as
          // every extension built before this row does to space a band it no
          // longer needs, renders visibly higher than a margin-less sibling.
          // The row owns the spacing (its gap and its own bottom margin), so
          // children contribute none, and core enforces that rather than
          // waiting for every installed bundle to be rebuilt.
          // Doubled parent selector for specificity: a single `& > *` ties with
          // the child's own emotion class at (0,1,0) and loses on source order.
          "&& > *": { margin: 0 },
        }}
      >
        <ExtensionSlot
          name="card.detail.header"
          context={{ cardId: card.id, cardType: card.type }}
        />
      </Box>

      {beforeTabs}

      <Tabs
        value={tab}
        onChange={(_, v: string) => {
          if (v === "ppm") {
            navigate(`/ppm/${card.id}`);
            return;
          }
          setRequestedTab(v);
        }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        {tabKeys.map((key: CardTabKey) => (
          <Tab key={key} value={key} label={renderTabLabel(key, t(CARD_TAB_LABEL_KEYS[key]))} />
        ))}
        {extensionTabs.map(({ def, value }) => (
          <Tab key={value} value={value} label={def.label} />
        ))}
      </Tabs>

      {tab === "card" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {missingMandatory.length > 0 && (
            <Alert severity="warning">
              {t("requiredBanner", {
                fields: missingMandatory.map((f) => fieldLabel(f)).join(", "),
              })}
            </Alert>
          )}
          {sectionOrder.map(renderSection)}
          {showLdvSection && (
            <ErrorBoundary label="Dependencies" inline>
              <LayeredDependencySection cardId={card.id} />
            </ErrorBoundary>
          )}
        </Box>
      )}
      {tab === "processFlow" && (
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
      {tab === "soaw" && (
        <ErrorBoundary label="SoAW">
          <MuiCard>
            <CardContent>
              <SoAWTab initiativeId={card.id} canManage={perms.can_edit} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === "assessments" && (
        <ErrorBoundary label="Assessments">
          <MuiCard>
            <CardContent>
              <ProcessAssessmentPanel processId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === "comments" && (
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
      {tab === "todos" && (
        <ErrorBoundary label="Todos">
          <MuiCard>
            <CardContent>
              <TodosTab fsId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === "stakeholders" && (
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
      {tab === "resources" && (
        <ErrorBoundary label="Resources">
          <MuiCard>
            <CardContent>
              <ResourcesTab
                fsId={card.id}
                canManageDocuments={perms.can_manage_documents}
                canManageDiagramLinks={perms.can_manage_diagram_links}
              />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === "adrs" && (
        <ErrorBoundary label="ADRs">
          <MuiCard>
            <CardContent>
              <AdrsTab
                cardId={card.id}
                cardName={card.name}
                cardType={card.type}
                canManageAdrLinks={perms.can_manage_adr_links}
              />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === "risks" && (
        <ErrorBoundary label="Risks">
          <MuiCard>
            <CardContent>
              <RisksTab cardId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === "compliance" && (
        <ErrorBoundary label="Compliance">
          <MuiCard>
            <CardContent>
              <ComplianceTab cardId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {tab === "history" && (
        <ErrorBoundary label="History">
          <MuiCard>
            <CardContent>
              <HistoryTab fsId={card.id} cardType={card.type} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
      {extensionTabs.map(({ extKey, def, value }) =>
        tab === value ? (
          <ExtensionBoundary key={value} extensionKey={extKey}>
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
