/**
 * Admin → Metamodel → Card Types → **Manage categories**: the category
 * registry (the EA layers) as a list.
 *
 * Each row shows the layer's colour, its resolved name and how many card types
 * use it. The order is the layer order everywhere layers are drawn, and every
 * row can move — a custom layer may sit between two built-in ones — through
 * `PUT /metamodel/categories/order`, which takes every key. Built-in rows are
 * locked (no edit, no delete; a lock chip says why); a category in use cannot
 * be deleted until its types are moved. Every write re-primes the category
 * singleton.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import {
  invalidateCardTypeCategories,
  useCardTypeCategories,
} from "@/hooks/useCardTypeCategories";
import { useCategoryLabel } from "@/hooks/useResolveLabel";
import { usageByCategory } from "@/lib/cardTypeOrder";
import type { CardType, CardTypeCategory } from "@/types";
import CategoryEditDialog from "./CategoryEditDialog";
import { categoryErrorMessage } from "./categoryErrors";

export interface ManageCategoriesDialogProps {
  open: boolean;
  onClose: () => void;
  /** Every card type, hidden ones included — the usage counts read them. */
  types: CardType[];
}

export default function ManageCategoriesDialog({
  open,
  onClose,
  types,
}: ManageCategoriesDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const { categories, refresh } = useCardTypeCategories();
  const resolve = useCategoryLabel();
  const usage = useMemo(() => usageByCategory(types), [types]);
  const [editing, setEditing] = useState<CardTypeCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    const keys = categories.map((c) => c.key);
    [keys[index], keys[target]] = [keys[target], keys[index]];
    setBusy(true);
    setError(null);
    try {
      const list = await api.put<CardTypeCategory[]>("/metamodel/categories/order", { keys });
      invalidateCardTypeCategories(list);
    } catch (err) {
      setError(categoryErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category: CardTypeCategory) => {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/metamodel/categories/${encodeURIComponent(category.key)}`);
      // Re-read the registry rather than filtering the list held here, which
      // can be stale.
      await refresh();
    } catch (err) {
      setError(categoryErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t("metamodel.categories.dialogTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("metamodel.categories.description")}
          </Typography>
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <List dense disablePadding>
            {categories.map((c, index) => {
              const count = usage[c.key] ?? 0;
              const name = resolve(c);
              return (
                <ListItem
                  key={c.key}
                  data-testid={`category-row-${c.key}`}
                  disableGutters
                  sx={{
                    gap: 1.5,
                    py: 0.75,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Box
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      bgcolor: c.color,
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("metamodel.categories.usage", { count })}
                    </Typography>
                  </Box>
                  {c.built_in && (
                    <Tooltip title={t("metamodel.categories.lockedTooltip")}>
                      <Chip
                        size="small"
                        icon={<MaterialSymbol icon="lock" size={14} />}
                        label={t("metamodel.categories.builtIn")}
                        variant="outlined"
                      />
                    </Tooltip>
                  )}
                  <Tooltip title={t("metamodel.categories.moveUp")}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`${t("metamodel.categories.moveUp")}: ${name}`}
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <MaterialSymbol icon="arrow_upward" size={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("metamodel.categories.moveDown")}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`${t("metamodel.categories.moveDown")}: ${name}`}
                        disabled={busy || index === categories.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <MaterialSymbol icon="arrow_downward" size={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip
                    title={
                      c.built_in
                        ? t("metamodel.categories.lockedTooltip")
                        : t("common:actions.edit")
                    }
                  >
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`${t("common:actions.edit")}: ${name}`}
                        disabled={busy || c.built_in}
                        onClick={() => setEditing(c)}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip
                    title={
                      c.built_in
                        ? t("metamodel.categories.lockedTooltip")
                        : count > 0
                          ? t("metamodel.categories.inUseTooltip")
                          : t("common:actions.delete")
                    }
                  >
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`${t("common:actions.delete")}: ${name}`}
                        disabled={busy || c.built_in || count > 0}
                        onClick={() => remove(c)}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </ListItem>
              );
            })}
          </List>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Button
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setCreating(true)}
          >
            {t("metamodel.categories.newCategory")}
          </Button>
          <Button onClick={onClose}>{t("common:actions.close")}</Button>
        </DialogActions>
      </Dialog>
      <CategoryEditDialog
        open={creating || editing !== null}
        category={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}
