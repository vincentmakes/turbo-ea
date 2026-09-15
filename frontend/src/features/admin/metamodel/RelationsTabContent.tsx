import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CardType, RelationType } from "@/types";
import HierarchyLinkTypesSection from "./HierarchyLinkTypesSection";
import RelationTypesPanel from "./RelationTypesPanel";
import RelationTranslationDialog from "./RelationTranslationDialog";
import { successorRelationKeys } from "@/lib/successorRelation";

interface Props {
  types: CardType[];
  relationTypes: RelationType[];
  onRefresh: () => void;
  /** Card-type mode: everything below is scoped to this type. */
  scopeTypeKey?: string;
  loading?: boolean;
}

/**
 * The Relations tab, rendered by the landscape-wide Metamodel → Relation Types
 * tab and by a card type's own Relations tab.
 *
 * **Manage translations is landscape-only.** It sits at the very top there,
 * because it covers everything below it — the relation verbs *and* the
 * hierarchy link types — rather than belonging to the relation list alone. In
 * card-type mode it is deliberately absent: the drawer header already carries a
 * Translate button, reachable from every tab, and `TranslationDialog` behind it
 * covers this type's link types *plus* its label, subtypes, sections, fields
 * and stakeholder roles. Two buttons with the same name writing the same
 * `hierarchy_labels` column is how this shipped once; the narrower one loses.
 */
export default function RelationsTabContent({
  types,
  relationTypes,
  onRefresh,
  scopeTypeKey,
  loading,
}: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const [translateOpen, setTranslateOpen] = useState(false);
  // Plain index state, no `?sub=` and no localStorage: `MetamodelAdmin` keeps
  // none for its own tabs either, so a refresh already lands on Card Types and
  // a restored sub-tab would sit under a parent nobody returned to.
  const [sub, setSub] = useState(0);

  const successorKeys = useMemo(() => successorRelationKeys(relationTypes), [relationTypes]);

  /**
   * What the translation dialog covers. Lineage relations are excluded — they
   * are managed by the card type's "Supports Lineage" toggle, not here.
   *
   * Hidden relation types ARE included: a hidden type can be restored, and its
   * verbs should already be translated when it is.
   */
  const translatableRelations = useMemo(
    () => relationTypes.filter((r) => !successorKeys.has(r.key)),
    [relationTypes, successorKeys],
  );

  /** Hierarchical types with a vocabulary to translate. */
  const translatableHierarchyTypes = useMemo(
    () => types.filter((ct) => ct.has_hierarchy && (ct.hierarchy_labels?.length ?? 0) > 0),
    [types],
  );

  // Landscape-only, per the note above — and the button disappears entirely
  // when neither kind of label exists yet.
  const showTranslations =
    !scopeTypeKey &&
    (translatableRelations.length > 0 || translatableHierarchyTypes.length > 0);

  return (
    <Box>
      {showTranslations && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="translate" size={18} />}
            onClick={() => setTranslateOpen(true)}
          >
            {t("metamodel.translationDialog.manage")}
          </Button>
        </Box>
      )}

      {/* Landscape splits the two lists: hierarchy link types are a niche most
          installs never configure, so they get their own sub-tab and the
          relation types everyone uses come first. In the drawer the hierarchy
          block is a single heading row — a whole tab would weigh more than the
          thing it holds — so the two just stack, as before. */}
      {scopeTypeKey ? (
        <>
          <HierarchyLinkTypesSection
            types={types}
            scopeTypeKey={scopeTypeKey}
            onRefresh={onRefresh}
          />
          <RelationTypesPanel
            types={types}
            relationTypes={relationTypes}
            onRefresh={onRefresh}
            scopeTypeKey={scopeTypeKey}
            loading={loading}
          />
        </>
      ) : (
        <>
          <Tabs
            value={sub}
            onChange={(_, v) => setSub(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
          >
            <Tab
              label={t("metamodel.tabs.relationsSub.relationTypes")}
              icon={<MaterialSymbol icon="link" size={16} />}
              iconPosition="start"
              sx={{ minHeight: 40, textTransform: "none", fontSize: "0.875rem" }}
            />
            <Tab
              label={t("metamodel.hierarchyLabels.title")}
              icon={<MaterialSymbol icon="account_tree" size={16} />}
              iconPosition="start"
              sx={{ minHeight: 40, textTransform: "none", fontSize: "0.875rem" }}
            />
          </Tabs>

          {sub === 0 ? (
            <RelationTypesPanel
              types={types}
              relationTypes={relationTypes}
              onRefresh={onRefresh}
              loading={loading}
            />
          ) : (
            <HierarchyLinkTypesSection types={types} onRefresh={onRefresh} />
          )}
        </>
      )}

      <RelationTranslationDialog
        open={translateOpen && showTranslations}
        relationTypes={translatableRelations}
        types={types}
        hierarchyTypes={translatableHierarchyTypes}
        onClose={() => setTranslateOpen(false)}
        onSaved={onRefresh}
      />
    </Box>
  );
}
