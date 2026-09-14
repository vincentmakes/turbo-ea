import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import OptionChip from "@/components/OptionChip";
import { useOptionLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";
import HierarchyLabelsDialog from "./HierarchyLabelsDialog";

interface Props {
  /** All card types; the hierarchical ones are picked out here. */
  types: CardType[];
  /** Restrict to one card type (the drawer). Omit for the landscape-wide list. */
  scopeTypeKey?: string;
  onRefresh: () => void;
  /** Raised after a successful save so the host can show its own confirmation. */
  onSaved?: () => void;
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
 */
export default function HierarchyLinkTypesSection({
  types,
  scopeTypeKey,
  onRefresh,
  onSaved,
}: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const optLabel = useOptionLabel();
  const typeLabel = useTypeLabel();
  const [editing, setEditing] = useState<CardType | null>(null);

  const hierarchical = types.filter(
    (ct) => ct.has_hierarchy && (!scopeTypeKey || ct.key === scopeTypeKey),
  );

  // Nothing hierarchical in view ⇒ the section does not exist. In the drawer
  // that is any non-hierarchical type; on the general tab, an instance where
  // hierarchy is switched off everywhere.
  if (hierarchical.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        {t("metamodel.hierarchyLabels.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("metamodel.hierarchyLabels.help")}
      </Typography>

      {hierarchical.map((ct) => (
        <Box
          key={ct.key}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            py: 1,
            ...(scopeTypeKey ? {} : { borderTop: "1px solid", borderColor: "divider" }),
          }}
        >
          {/* On the general tab each row has to say which type it belongs to;
              in the drawer that is already the context. */}
          {!scopeTypeKey && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 180 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  bgcolor: ct.color,
                  flexShrink: 0,
                }}
              />
              <MaterialSymbol icon={ct.icon} size={16} color={ct.color} />
              <Typography variant="body2" fontWeight={500}>
                {typeLabel(ct) || ct.key}
              </Typography>
            </Box>
          )}

          {(ct.hierarchy_labels || []).length > 0 ? (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, flex: 1 }}>
              {(ct.hierarchy_labels || []).map((o) => (
                <OptionChip key={o.key} option={o} label={optLabel(o)} />
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {t("metamodel.hierarchyLabels.none")}
            </Typography>
          )}

          <Button
            size="small"
            startIcon={<MaterialSymbol icon="edit" size={16} />}
            onClick={() => setEditing(ct)}
          >
            {t("metamodel.hierarchyLabels.edit")}
          </Button>
        </Box>
      ))}

      <Divider sx={{ mt: 2 }} />

      <HierarchyLabelsDialog
        open={!!editing}
        cardType={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          onRefresh();
          onSaved?.();
        }}
      />
    </Box>
  );
}
