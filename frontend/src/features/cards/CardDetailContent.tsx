import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import { useTranslation } from "react-i18next";
import ErrorBoundary from "@/components/ErrorBoundary";
import EolLinkSection from "@/components/EolLinkSection";
import ProcessFlowTab from "@/features/bpm/ProcessFlowTab";
import ProcessAssessmentPanel from "@/features/bpm/ProcessAssessmentPanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCalculatedFields } from "@/hooks/useCalculatedFields";
import { useCurrency } from "@/hooks/useCurrency";
import { usePpmEnabled } from "@/hooks/usePpmEnabled";
import { api } from "@/api/client";
import {
  DescriptionSection,
  LifecycleSection,
  AttributeSection,
  HierarchySection,
  SuccessorsSection,
  RelationsSection,
  CommentsTab,
  TodosTab,
  StakeholdersTab,
  ResourcesTab,
  HistoryTab,
} from "@/features/cards/sections";
import type { Card, CardEffectivePermissions } from "@/types";

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
}: Props) {
  const { t } = useTranslation("cards");
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const { isCalculated } = useCalculatedFields();
  const { fmt: currencyFmt } = useCurrency();
  const { ppmEnabled } = usePpmEnabled();

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

  // Determine hidden fields based on card subtype
  const hiddenFieldKeys: Set<string> = (() => {
    if (!card.subtype || !typeConfig?.subtypes) return new Set<string>();
    const st = typeConfig.subtypes.find((s) => s.key === card.subtype);
    return new Set(st?.hidden_fields ?? []);
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
          />
        </ErrorBoundary>
      );
    }
    return null;
  };

  const isBpm = showBpmTabs && card.type === "BusinessProcess";
  const isPpm = showPpmTab && ppmEnabled && card.type === "Initiative";

  // BPM adds 2 tabs after Card; PPM tab goes at the very end
  const bpmOffset = isBpm ? 2 : 0;
  const commentsIdx = 1 + bpmOffset;
  const todosIdx = 2 + bpmOffset;
  const stakeholdersIdx = 3 + bpmOffset;
  const resourcesIdx = 4 + bpmOffset;
  const historyIdx = 5 + bpmOffset;
  const ppmTabIdx = isPpm ? historyIdx + 1 : -1;

  return (
    <>
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
        <Tab label={t("tabs.card")} />
        {isBpm && <Tab label={t("tabs.processFlow")} />}
        {isBpm && <Tab label={t("tabs.assessments")} />}
        <Tab label={t("tabs.comments")} />
        <Tab label={t("tabs.todos")} />
        <Tab label={t("tabs.stakeholders")} />
        <Tab label={t("tabs.resources")} />
        <Tab label={t("tabs.history")} />
        {isPpm && <Tab label={t("tabs.ppm")} />}
      </Tabs>

      {tab === 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {sectionOrder.map(renderSection)}
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
      {tab === historyIdx && (
        <ErrorBoundary label="History">
          <MuiCard>
            <CardContent>
              <HistoryTab fsId={card.id} />
            </CardContent>
          </MuiCard>
        </ErrorBoundary>
      )}
    </>
  );
}
