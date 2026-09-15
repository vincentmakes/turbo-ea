import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import OptionChip from "@/components/OptionChip";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";
import CardTypeEndpoint from "./CardTypeEndpoint";
import HierarchyLabelsDialog from "./HierarchyLabelsDialog";

interface Props {
  /** All card types; the hierarchical ones are picked out here. */
  types: CardType[];
  /** Restrict to one card type (the drawer). Omit for the landscape-wide list. */
  scopeTypeKey?: string;
  onRefresh: () => void;
}

/**
 * The hierarchy link-type vocabularies, as a section of the Relations tab.
 *
 * A parent→child link IS a relationship, so its vocabulary belongs beside the
 * relation types rather than next to Subtypes on the type drawer's main tab,
 * where it first landed (#1100). One component serves both hosts: the general
 * Metamodel → Relations tab lists every hierarchical card type, so the feature
 * is discoverable without opening each drawer; the card-type drawer passes
 * `scopeTypeKey` and gets just that type.
 *
 * Types with an empty vocabulary are listed too — hiding them would make the
 * feature reachable only by someone who already knew it existed.
 *
 * The save confirmation lives HERE rather than on an `onSaved` the host raises:
 * the drawer had one and the landscape tab did not, because that tab owns no
 * snackbar of its own. Owning it here makes the two hosts behave alike by
 * construction instead of by each remembering to.
 */
export default function HierarchyLinkTypesSection({ types, scopeTypeKey, onRefresh }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const optLabel = useOptionLabel();
  const [editing, setEditing] = useState<CardType | null>(null);
  const [saved, setSaved] = useState(false);

  const hierarchical = types.filter(
    (ct) => ct.has_hierarchy && (!scopeTypeKey || ct.key === scopeTypeKey),
  );

  // Nothing hierarchical in view ⇒ the section does not exist. In the drawer
  // that is any non-hierarchical type; on the general tab, an instance where
  // hierarchy is switched off everywhere.
  if (hierarchical.length === 0) return null;

  return (
    <Box sx={{ mb: 2 }}>
      {/* Heading but no help paragraph: the explanation belongs to the dialog
          that does the editing (`HierarchyLabelsDialog`), exactly where
          `RelationTypeValuesDialog` keeps the relation-values one, and printing
          it here as well simply said the same thing twice. The heading stays
          because this tab stacks two lists and the rows below would otherwise
          be unidentifiable. */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        {t("metamodel.hierarchyLabels.title")}
      </Typography>

      {hierarchical.map((ct) => (
        <Card key={ct.key} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {/* On the general tab each row has to say which type it belongs
                  to; in the drawer that is already the context. */}
              {!scopeTypeKey && <CardTypeEndpoint type={ct} typeKey={ct.key} />}

              {/* The panel's own right-alignment mechanism — an explicit
                  spacer, so the chips and the action land on the same edge as
                  the relation cards below. */}
              <Box sx={{ flex: 1 }} />

              {/* Per row, not panel-level: a row IS a card type, and its
                  vocabulary can be empty while the list is not — unlike a
                  relation type, which always has content. Italic secondary,
                  matching the dialog's own empty state. */}
              {(ct.hierarchy_labels || []).length > 0 ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {(ct.hierarchy_labels || []).map((o) => (
                    <OptionChip key={o.key} option={o} label={optLabel(o)} />
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" fontStyle="italic">
                  {t("metamodel.hierarchyLabels.none")}
                </Typography>
              )}

              <Tooltip title={t("metamodel.hierarchyLabels.edit")}>
                <IconButton size="small" onClick={() => setEditing(ct)}>
                  <MaterialSymbol icon="label" size={18} />
                </IconButton>
              </Tooltip>
            </Box>
          </CardContent>
        </Card>
      ))}

      <HierarchyLabelsDialog
        open={!!editing}
        cardType={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          onRefresh();
          setSaved(true);
        }}
      />

      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        message={t("metamodel.hierarchyLabels.saved")}
      />
    </Box>
  );
}
