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
  onSelect: (relationType: RelationType, direction: "as-is" | "reversed") => void;
}

/**
 * Dialog shown when the user draws an edge between two fact-sheet cells.
 * Lists the valid relation types from the metamodel and lets the user pick one.
 * Supports both directions: source→target and target→source.
 */
export default function RelationPickerDialog({
  open,
  endpoints,
  relationTypes,
  onClose,
  onSelect,
}: Props) {
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

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="link" size={22} color="#1976d2" />
        Pick Relation Type
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

        {matches.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ px: 2, py: 2 }}>
            No valid relation types exist between these two fact sheet types in the metamodel.
          </Typography>
        ) : (
          <List dense disablePadding>
            {matches.map(({ rt, direction }) => {
              const srcName = direction === "as-is" ? endpoints.sourceName : endpoints.targetName;
              const tgtName = direction === "as-is" ? endpoints.targetName : endpoints.sourceName;
              return (
                <ListItemButton
                  key={`${rt.key}-${direction}`}
                  onClick={() => onSelect(rt, direction)}
                  sx={{ borderRadius: 1, mx: 1, my: 0.25 }}
                >
                  <ListItemText
                    primary={rt.label}
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
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
