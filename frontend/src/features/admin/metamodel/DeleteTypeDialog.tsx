/**
 * Permanent deletion of a custom card type.
 *
 * Only a custom type (`built_in === false`) can be deleted for good — a
 * built-in one is hidden instead, and the drawer never opens this dialog for
 * it. The dialog first loads `GET /metamodel/types/:key/delete-impact` and
 * lists everything the deletion takes with the type — the cards (every
 * relation, stakeholder, comment and attachment on them goes with them), the
 * relation types that connect the type to any other, the calculations that
 * target it and its stakeholder roles — then asks the admin to type the type's
 * key before the **Delete permanently** button is live. The DELETE carries
 * `delete_cards=true` whenever cards exist, which is what the backend
 * requires before it removes any card.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { STATUS_COLORS } from "@/theme/tokens";
import type { CardType, RelationType } from "@/types";

export interface TypeDeleteImpact {
  key: string;
  label: string;
  built_in: boolean;
  card_count: number;
  active_card_count: number;
  archived_card_count: number;
  relation_count: number;
  relation_types: { key: string; label: string; relation_count: number }[];
  calculation_count: number;
  stakeholder_role_count: number;
}

export interface DeleteTypeDialogProps {
  open: boolean;
  cardType: CardType | null;
  /** The metamodel's relation types, so the chips carry the translated verb. */
  relationTypes: RelationType[];
  onClose: () => void;
  /** Called once the DELETE succeeded; the caller closes the drawer and refreshes. */
  onDeleted: () => void;
}

/** One line of the impact list, with its icon; `count` 0 renders nothing. */
function ImpactLine({
  icon,
  count,
  text,
  children,
}: {
  icon: string;
  count: number;
  text: string;
  children?: React.ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <ListItem disableGutters alignItems="flex-start" sx={{ py: 0.5 }}>
      <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
        <MaterialSymbol icon={icon} size={20} />
      </ListItemIcon>
      <ListItemText primary={text} secondary={children} secondaryTypographyProps={{ component: "div" }} />
    </ListItem>
  );
}

export default function DeleteTypeDialog({
  open,
  cardType,
  relationTypes,
  onClose,
  onDeleted,
}: DeleteTypeDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const typeLabel = useTypeLabel();
  const relationLabel = useRelationLabel();
  const key = cardType?.key ?? null;
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh dialog per opening: the typed key is single-use.
  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
      setDeleting(false);
    }
  }, [open, key]);

  const {
    data: impact,
    loading,
    error: loadError,
  } = useApiQuery<TypeDeleteImpact>(open && key ? `/metamodel/types/${key}/delete-impact` : null);

  if (!cardType) return null;
  const label = typeLabel(cardType);
  const confirmed = typed.trim() === cardType.key;
  const canDelete = confirmed && !!impact && !loading && !deleting;

  const handleDelete = async () => {
    if (!impact || !canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const query = impact.card_count > 0 ? "?delete_cards=true" : "";
      await api.delete(`/metamodel/types/${cardType.key}${query}`);
      onDeleted();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.deleteType.failed"));
      setDeleting(false);
    }
  };

  const verbFor = (rtKey: string, fallback: string) => {
    const rt = relationTypes.find((r) => r.key === rtKey);
    return rt ? relationLabel(rt) : fallback;
  };

  return (
    <Dialog open={open} onClose={deleting ? undefined : onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="delete_forever" size={24} color={STATUS_COLORS.error} />
        {t("metamodel.deleteType.title", { label })}
      </DialogTitle>
      <DialogContent>
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("metamodel.deleteType.warning")}
        </Alert>

        {loading && !impact && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {loadError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t("metamodel.deleteType.loadFailed")}
          </Alert>
        )}

        {impact && (
          <>
            {impact.card_count === 0 &&
            impact.relation_types.length === 0 &&
            impact.calculation_count === 0 &&
            impact.stakeholder_role_count === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("metamodel.deleteType.noImpact")}
              </Typography>
            ) : (
              <List dense disablePadding sx={{ mb: 1 }} data-testid="delete-type-impact">
                <ImpactLine
                  icon="style"
                  count={impact.card_count}
                  text={t("metamodel.deleteType.cards", { count: impact.card_count })}
                >
                  {impact.archived_card_count > 0 &&
                    t("metamodel.deleteType.archivedCards", { count: impact.archived_card_count })}
                </ImpactLine>
                <ImpactLine
                  icon="hub"
                  count={impact.relation_types.length}
                  text={t("metamodel.deleteType.relationTypes", {
                    count: impact.relation_types.length,
                  })}
                >
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                    {impact.relation_types.map((rt) => (
                      <Chip
                        key={rt.key}
                        size="small"
                        variant="outlined"
                        label={`${verbFor(rt.key, rt.label)} · ${rt.relation_count}`}
                      />
                    ))}
                  </Box>
                  {impact.relation_count > 0 && (
                    <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                      {t("metamodel.deleteType.relations", { count: impact.relation_count })}
                    </Typography>
                  )}
                </ImpactLine>
                <ImpactLine
                  icon="calculate"
                  count={impact.calculation_count}
                  text={t("metamodel.deleteType.calculations", { count: impact.calculation_count })}
                />
                <ImpactLine
                  icon="group"
                  count={impact.stakeholder_role_count}
                  text={t("metamodel.deleteType.stakeholderRoles", {
                    count: impact.stakeholder_role_count,
                  })}
                />
              </List>
            )}
          </>
        )}

        <TextField
          fullWidth
          size="small"
          autoFocus
          label={t("metamodel.deleteType.confirmLabel", { key: cardType.key })}
          placeholder={cardType.key}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canDelete) void handleDelete();
          }}
          helperText={t("metamodel.deleteType.confirmHelp")}
          disabled={deleting}
          slotProps={{ htmlInput: { autoComplete: "off", spellCheck: false } }}
          sx={{ mt: 1 }}
        />

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void handleDelete()}
          disabled={!canDelete}
          startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t("metamodel.deleteType.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
