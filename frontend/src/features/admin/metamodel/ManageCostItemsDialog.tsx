/**
 * Admin → Metamodel → **Cost items**: the catalogue of cost lines a card can
 * carry per fiscal year. Items have a stable key (read-only after creation),
 * a label with the same translations as a field, and an `archived` flag.
 * Removing an item means archiving it — never deleting — so amounts already
 * entered keep counting in the TCO.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useFieldLabel } from "@/hooks/useResolveLabel";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/i18n";
import type { CostItemType, TranslationMap } from "@/types";

const COST_PATH = "/metamodel/cost-item-types";

/** Which `admin:metamodel.<key>.*` texts the edit dialog reads: the cost items and the license catalogue share it. */
export type CatalogueTextKey = "costItems" | "licenseTypes" | "licenseMetrics";

/** The `metamodel.costItems.*` keys of `en/admin.json` the list dialog reads. */
export const TEXT_SUFFIXES = [
  "dialogTitle",
  "description",
  "archivedHelp",
  "newItem",
  "createTitle",
  "editTitle",
  "keyLabel",
  "keyHelp",
  "labelLabel",
  "translationsLabel",
  "translationsHelp",
  "archived",
  "archive",
  "restore",
  "errors.duplicate_key",
  "errors.invalid_key",
  "errors.generic",
] as const;

function costItemErrorMessage(
  err: unknown,
  t: (k: string) => string,
  textKey: CatalogueTextKey,
): string {
  const status = (err as { status?: number })?.status;
  if (status === 409) return t(`admin:metamodel.${textKey}.errors.duplicate_key`);
  if (status === 422) return t(`admin:metamodel.${textKey}.errors.invalid_key`);
  if (err instanceof Error && err.message) return err.message;
  return t(`admin:metamodel.${textKey}.errors.generic`);
}

function cleanTranslations(map: TranslationMap): TranslationMap {
  const out: TranslationMap = {};
  for (const [locale, label] of Object.entries(map)) {
    if (label.trim()) out[locale] = label.trim();
  }
  return out;
}

interface EditProps {
  open: boolean;
  path: string;
  textKey: CatalogueTextKey;
  /** The item to edit; `null` creates a new one. */
  item: CostItemType | null;
  onClose: () => void;
  onSaved: () => void;
}

export function CostItemEditDialog({ open, path, textKey, item, onClose, onSaved }: EditProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [translations, setTranslations] = useState<TranslationMap>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey(item?.key ?? "");
    setLabel(item?.label ?? "");
    setTranslations({ ...(item?.translations ?? {}) });
    setError(null);
    setSaving(false);
  }, [open, item]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = { label: label.trim(), translations: cleanTranslations(translations) };
    try {
      if (item) await api.patch(`${path}/${encodeURIComponent(item.key)}`, body);
      else await api.post(path, { key: key.trim(), ...body });
      onSaved();
    } catch (err) {
      setError(costItemErrorMessage(err, t, textKey));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>
        {item ? t(`metamodel.${textKey}.editTitle`) : t(`metamodel.${textKey}.createTitle`)}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            fullWidth
            label={t(`metamodel.${textKey}.keyLabel`)}
            helperText={t(`metamodel.${textKey}.keyHelp`)}
            value={key}
            disabled={Boolean(item)}
            onChange={(e) => setKey(e.target.value)}
            inputProps={{ maxLength: 64 }}
          />
          <TextField
            autoFocus
            fullWidth
            label={t(`metamodel.${textKey}.labelLabel`)}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            inputProps={{ maxLength: 100 }}
          />
          <Divider />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t(`metamodel.${textKey}.translationsLabel`)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t(`metamodel.${textKey}.translationsHelp`)}
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 1,
                mt: 1,
              }}
            >
              {SUPPORTED_LOCALES.filter((l) => l !== "en").map((locale) => (
                <TextField
                  key={locale}
                  size="small"
                  label={LOCALE_LABELS[locale] ?? locale}
                  value={translations[locale] ?? ""}
                  onChange={(e) => setTranslations({ ...translations, [locale]: e.target.value })}
                />
              ))}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || !label.trim() || !key.trim()}
        >
          {item ? t("common:actions.save") : t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export interface ManageCostItemsDialogProps {
  open: boolean;
  onClose: () => void;
}

const path = COST_PATH;
const textKey = "costItems";

export default function ManageCostItemsDialog({ open, onClose }: ManageCostItemsDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const fieldLabel = useFieldLabel();
  const { data, refetch } = useApiQuery<CostItemType[]>(open ? path : null);
  const [editing, setEditing] = useState<CostItemType | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setArchived = async (item: CostItemType, archived: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`${path}/${encodeURIComponent(item.key)}`, { archived });
      refetch();
    } catch (err) {
      setError(costItemErrorMessage(err, t, textKey));
    } finally {
      setBusy(false);
    }
  };

  const closeEdit = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t(`metamodel.${textKey}.dialogTitle`)}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(`metamodel.${textKey}.description`)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t(`metamodel.${textKey}.archivedHelp`)}
          </Typography>
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <List dense disablePadding>
            {(data ?? []).map((c) => {
              const name = fieldLabel(c);
              return (
                <ListItem
                  key={c.key}
                  data-testid={`cost-item-row-${c.key}`}
                  disableGutters
                  sx={{
                    gap: 1.5,
                    py: 0.75,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    opacity: c.archived ? 0.6 : 1,
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {c.key}
                    </Typography>
                  </Box>
                  {c.archived && (
                    <Chip size="small" variant="outlined" label={t(`metamodel.${textKey}.archived`)} />
                  )}
                  <Tooltip title={t("common:actions.edit")}>
                    <IconButton
                      size="small"
                      aria-label={`${t("common:actions.edit")}: ${name}`}
                      disabled={busy}
                      onClick={() => setEditing(c)}
                    >
                      <MaterialSymbol icon="edit" size={18} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip
                    title={c.archived ? t(`metamodel.${textKey}.restore`) : t(`metamodel.${textKey}.archive`)}
                  >
                    <IconButton
                      size="small"
                      aria-label={`${
                        c.archived ? t(`metamodel.${textKey}.restore`) : t(`metamodel.${textKey}.archive`)
                      }: ${name}`}
                      disabled={busy}
                      onClick={() => setArchived(c, !c.archived)}
                    >
                      <MaterialSymbol icon={c.archived ? "unarchive" : "archive"} size={18} />
                    </IconButton>
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
            {t(`metamodel.${textKey}.newItem`)}
          </Button>
          <Button onClick={onClose}>{t("common:actions.close")}</Button>
        </DialogActions>
      </Dialog>
      <CostItemEditDialog
        path={path}
        textKey={textKey}
        open={creating || editing !== null}
        item={editing}
        onClose={closeEdit}
        onSaved={() => {
          closeEdit();
          refetch();
        }}
      />
    </>
  );
}
