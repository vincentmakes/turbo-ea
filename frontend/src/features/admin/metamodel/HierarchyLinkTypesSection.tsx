import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
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

  /**
   * The vocabulary as a COUNT, not as its values — the relation cards collapse
   * theirs the same way, and only the editor shows them. A chip per value is
   * unbounded: fifty link types made a fifty-chip row. Note this counts one
   * level deeper than the relation row's chip, which counts `single_select`
   * *fields*; a link-type vocabulary is a flat option list, so this is its
   * length.
   *
   * The tooltip is deliberately uncapped: no tooltip in this app truncates,
   * and capping one would invent a convention.
   */
  const valueSummary = (ct: CardType) => {
    const labels = ct.hierarchy_labels || [];
    if (labels.length === 0) {
      // A card type's vocabulary can be empty while the list is not — unlike a
      // relation type, which always has content. Italic secondary, §3.11.
      return (
        <Typography variant="body2" color="text.secondary" fontStyle="italic">
          {t("metamodel.hierarchyLabels.none")}
        </Typography>
      );
    }
    return (
      <Tooltip title={labels.map((o) => optLabel(o)).join(", ")}>
        <Chip
          size="small"
          color="secondary"
          icon={<MaterialSymbol icon="sell" size={13} color="inherit" />}
          label={labels.length}
          sx={{ height: 22, fontSize: 11 }}
        />
      </Tooltip>
    );
  };

  const editButton = (ct: CardType) => (
    <Tooltip title={t("metamodel.hierarchyLabels.edit")}>
      <IconButton size="small" onClick={() => setEditing(ct)}>
        <MaterialSymbol icon="label" size={18} />
      </IconButton>
    </Tooltip>
  );

  /**
   * In the drawer the whole block is ONE card type, so a per-type card has an
   * empty left half — the type identity is the drawer itself — and its count
   * and button end up floating at the right edge of a full-width empty box.
   * Everything goes on the heading line instead, tight and left-aligned, the
   * shape `AttributeSection` uses for heading + count + action. Deliberately no
   * `ml: "auto"`: pushing the button to the far right of a wide drawer is the
   * floating-in-space problem again.
   *
   * No leading glyph either — §3.11's "every section header carries a glyph"
   * is scoped to the grid filter sidebar, and the drawer's own headings (Type
   * Properties, Subtypes) are bare text.
   */
  if (scopeTypeKey) {
    const ct = hierarchical[0];
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {t("metamodel.hierarchyLabels.title")}
        </Typography>
        {valueSummary(ct)}
        {editButton(ct)}
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

  /* Landscape: one card per hierarchical type, and NO heading — the sub-tab
     that holds this panel is the heading, so repeating it inside is the
     duplication `RelationTypesPanel` avoids by carrying no title of its own. */
  return (
    <Box>
      {hierarchical.map((ct) => (
        <Card key={ct.key} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <CardTypeEndpoint type={ct} typeKey={ct.key} />
              {/* The panel's own right-alignment mechanism — an explicit
                  spacer, matching the relation cards. */}
              <Box sx={{ flex: 1 }} />
              {valueSummary(ct)}
              {editButton(ct)}
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
