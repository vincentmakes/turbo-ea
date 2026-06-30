import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useRelationLabel } from "@/hooks/useResolveLabel";
import RelationAttributesEditor, {
  hasRelationSubtypes,
  type RelationAttributes,
} from "@/features/cards/sections/RelationAttributesEditor";
import type { RelationType } from "@/types";

export interface EdgeEndpoints {
  edgeCellId: string;
  sourceType: string;
  targetType: string;
  sourceName: string;
  targetName: string;
  sourceColor: string;
  targetColor: string;
}

interface Props {
  open: boolean;
  endpoints: EdgeEndpoints | null;
  relationTypes: RelationType[];
  onClose: () => void;
  onSelect: (
    relationType: RelationType,
    direction: "as-is" | "reversed",
    attributes?: RelationAttributes,
  ) => void;
}

/**
 * Dialog shown when the user draws an edge between two card cells.
 * Lists the valid relation types from the metamodel and lets the user pick one.
 * Supports both directions: source→target and target→source.
 *
 * If the picked relation type declares an `attributes_schema`, an optional
 * second step is shown so the user can set those attributes (e.g.
 * flow direction) at creation time. Both steps are optional — the
 * user can always skip and create without attributes.
 */
export default function RelationPickerDialog({
  open,
  endpoints,
  relationTypes,
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation(["diagrams", "cards", "common"]);
  const relLabel = useRelationLabel();
  const [picked, setPicked] = useState<{
    rt: RelationType;
    direction: "as-is" | "reversed";
  } | null>(null);
  const [attrs, setAttrs] = useState<RelationAttributes>({});

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setAttrs({});
    }
  }, [open]);

  if (!endpoints) return null;

  // Find relation types valid for this pair (in either direction)
  const matches: Array<{ rt: RelationType; direction: "as-is" | "reversed" }> = [];
  for (const rt of relationTypes) {
    if (rt.is_hidden) continue;
    if (rt.source_type_key === endpoints.sourceType && rt.target_type_key === endpoints.targetType) {
      matches.push({ rt, direction: "as-is" });
    }
    if (rt.source_type_key === endpoints.targetType && rt.target_type_key === endpoints.sourceType) {
      matches.push({ rt, direction: "reversed" });
    }
  }

  const handlePickType = (rt: RelationType, direction: "as-is" | "reversed") => {
    if (hasRelationSubtypes(rt)) {
      setPicked({ rt, direction });
      setAttrs({});
    } else {
      onSelect(rt, direction);
    }
  };

  const handleConfirm = () => {
    if (!picked) return;
    onSelect(picked.rt, picked.direction, Object.keys(attrs).length > 0 ? attrs : undefined);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="link" size={22} color="#1976d2" />
        {picked
          ? relLabel(picked.rt)
          : t("relationPicker.title")}
      </DialogTitle>
      <DialogContent sx={{ px: 1, pt: "0 !important" }}>
        {/* Show source → target labels */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.5 }}>
          <Chip
            size="small"
            label={endpoints.sourceName}
            sx={{ bgcolor: endpoints.sourceColor + "22", fontWeight: 600, maxWidth: 140 }}
          />
          <MaterialSymbol icon="arrow_forward" size={16} color="#999" />
          <Chip
            size="small"
            label={endpoints.targetName}
            sx={{ bgcolor: endpoints.targetColor + "22", fontWeight: 600, maxWidth: 140 }}
          />
        </Box>

        {picked ? (
          <Box sx={{ px: 2, pb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {t("cards:relations.optionalDetails")}
            </Typography>
            <RelationAttributesEditor
              relationType={picked.rt}
              value={attrs}
              onChange={setAttrs}
              compact
            />
          </Box>
        ) : matches.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ px: 2, py: 2 }}>
            {t("relationPicker.noValidTypes")}
          </Typography>
        ) : (
          <List dense disablePadding>
            {matches.map(({ rt, direction }) => {
              const srcName = direction === "as-is" ? endpoints.sourceName : endpoints.targetName;
              const tgtName = direction === "as-is" ? endpoints.targetName : endpoints.sourceName;
              return (
                <ListItemButton
                  key={`${rt.key}-${direction}`}
                  onClick={() => handlePickType(rt, direction)}
                  sx={{ borderRadius: 1, mx: 1, my: 0.25 }}
                >
                  <ListItemText
                    primary={relLabel(rt)}
                    secondary={
                      <>
                        {srcName} → {tgtName}
                        {rt.description && (
                          <>
                            {" · "}
                            {rt.description}
                          </>
                        )}
                      </>
                    }
                    primaryTypographyProps={{ fontWeight: 600 }}
                    secondaryTypographyProps={{ fontSize: "0.75rem" }}
                  />
                  <Chip
                    size="small"
                    label={rt.cardinality}
                    variant="outlined"
                    sx={{ ml: 1, height: 20, fontSize: "0.65rem", color: "text.disabled" }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        {picked ? (
          <>
            <Button onClick={() => setPicked(null)}>{t("common:actions.back")}</Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
            <Button variant="contained" onClick={handleConfirm}>
              {t("common:actions.create")}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
