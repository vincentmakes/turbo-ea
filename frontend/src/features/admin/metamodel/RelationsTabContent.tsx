import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
  /** Raised after a hierarchy link-type save so the host can confirm. */
  onSaved?: () => void;
}

/**
 * The Relations tab, rendered identically by the landscape-wide Metamodel →
 * Relation Types tab and by a card type's own Relations tab.
 *
 * Order matters here: **Manage translations** sits at the very top because it
 * covers everything below it — the relation verbs *and* the hierarchy link
 * types — so it must not look like a control belonging to the relation list
 * alone, which is where it used to live.
 */
export default function RelationsTabContent({
  types,
  relationTypes,
  onRefresh,
  scopeTypeKey,
  loading,
  onSaved,
}: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const [translateOpen, setTranslateOpen] = useState(false);

  const successorKeys = useMemo(() => successorRelationKeys(relationTypes), [relationTypes]);

  /**
   * What the translation dialog covers. Lineage relations are excluded (they
   * are managed by the card type's "Supports Lineage" toggle, not here), and in
   * card-type mode the list narrows to that type — translating from a card
   * type's own tab should not silently edit the whole landscape.
   *
   * Hidden relation types ARE included: a hidden type can be restored, and its
   * verbs should already be translated when it is.
   */
  const translatableRelations = useMemo(() => {
    const live = relationTypes.filter((r) => !successorKeys.has(r.key));
    if (!scopeTypeKey) return live;
    return live.filter(
      (r) => r.source_type_key === scopeTypeKey || r.target_type_key === scopeTypeKey,
    );
  }, [relationTypes, successorKeys, scopeTypeKey]);

  /** Hierarchical types with something to translate, scoped the same way. */
  const translatableHierarchyTypes = useMemo(
    () =>
      types.filter(
        (ct) =>
          ct.has_hierarchy &&
          (ct.hierarchy_labels?.length ?? 0) > 0 &&
          (!scopeTypeKey || ct.key === scopeTypeKey),
      ),
    [types, scopeTypeKey],
  );

  const hasAnythingToTranslate =
    translatableRelations.length > 0 || translatableHierarchyTypes.length > 0;

  return (
    <Box>
      {hasAnythingToTranslate && (
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

      <HierarchyLinkTypesSection
        types={types}
        scopeTypeKey={scopeTypeKey}
        onRefresh={onRefresh}
        onSaved={onSaved}
      />

      <RelationTypesPanel
        types={types}
        relationTypes={relationTypes}
        onRefresh={onRefresh}
        scopeTypeKey={scopeTypeKey}
        loading={loading}
      />

      <RelationTranslationDialog
        open={translateOpen}
        relationTypes={translatableRelations}
        types={types}
        hierarchyTypes={translatableHierarchyTypes}
        onClose={() => setTranslateOpen(false)}
        onSaved={onRefresh}
      />
    </Box>
  );
}
