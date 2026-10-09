import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { Card, DiagramSummary } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  diagrams: DiagramSummary[];
  initiatives: Card[];
  linkInitiativeId: string;
  linkSelected: string[];
  linking: boolean;
  onToggle: (diagramId: string) => void;
  onSave: () => void;
}

export default function LinkDiagramsDialog({
  open,
  onClose,
  diagrams,
  initiatives,
  linkInitiativeId,
  linkSelected,
  linking,
  onToggle,
  onSave,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const [search, setSearch] = useState("");

  const initiativeName =
    initiatives.find((i) => i.id === linkInitiativeId)?.name ?? "";

  // Build a map of card id → name from initiatives for resolving linked card names
  const cardNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const init of initiatives) {
      map.set(init.id, init.name);
    }
    return map;
  }, [initiatives]);

  const filteredDiagrams = useMemo(() => {
    if (!search.trim()) return diagrams;
    const q = search.toLowerCase();
    return diagrams.filter((d) => d.name.toLowerCase().includes(q));
  }, [diagrams, search]);

  // Reset search when dialog closes
  const handleClose = () => {
    setSearch("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("linkDialog.title")}</DialogTitle>
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          minHeight: 400,
          overflow: "hidden",
          pb: 0,
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1.5, flexShrink: 0 }}
          dangerouslySetInnerHTML={{
            __html: t("linkDialog.description", {
              name: initiativeName,
              interpolation: { escapeValue: true },
            }),
          }}
        />

        <TextField
          size="small"
          fullWidth
          placeholder={t("linkDialog.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1, flexShrink: 0 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={20} />
                </InputAdornment>
              ),
            },
          }}
        />

        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {diagrams.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ py: 2, textAlign: "center" }}
            >
              {t("linkDialog.noDiagrams")}
            </Typography>
          ) : filteredDiagrams.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ py: 2, textAlign: "center" }}
            >
              {t("linkDialog.noSearchResults")}
            </Typography>
          ) : (
            <List dense disablePadding>
              {filteredDiagrams.map((d) => {
                const isChecked = linkSelected.includes(d.id);
                const linkedNames = d.card_ids
                  .filter((id) => id !== linkInitiativeId)
                  .map((id) => cardNameMap.get(id))
                  .filter(Boolean) as string[];

                return (
                  <ListItem key={d.id} disablePadding>
                    <ListItemButton onClick={() => onToggle(d.id)} dense>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          edge="start"
                          checked={isChecked}
                          tabIndex={-1}
                          disableRipple
                          size="small"
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <MaterialSymbol icon="schema" size={18} color="#1976d2" />
                      </ListItemIcon>
                      <ListItemText
                        primary={d.name}
                        // The chips are <div>s, which a <p> may not contain.
                        slotProps={{ secondary: { component: "div" } }}
                        secondary={
                          linkedNames.length > 0 ? (
                            <Box
                              component="span"
                              sx={{
                                display: "flex",
                                gap: 0.5,
                                flexWrap: "wrap",
                                mt: 0.5,
                              }}
                            >
                              {linkedNames.map((name) => (
                                <Chip
                                  key={name}
                                  label={name}
                                  size="small"
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: "0.7rem" }}
                                />
                              ))}
                            </Box>
                          ) : (
                            t("linkDialog.notLinked")
                          )
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" disabled={linking} onClick={onSave}>
          {linking ? t("linkDialog.saving") : t("linkDialog.saveLinks")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
