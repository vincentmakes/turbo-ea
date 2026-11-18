/**
 * Admin → Metamodel → **License types**: the catalogue of license metrics and,
 * under each, its types. Keys are fixed at creation, a type belongs to one
 * metric for good, and nothing is deleted: an archived metric or type cannot be
 * chosen for a new cell but keeps counting where a year already holds data.
 */
import { useState } from "react";
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
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { invalidateLicenseCatalogue, useLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import { useFieldLabel } from "@/hooks/useResolveLabel";
import type { LicenseMetricItem, LicenseTypeItem } from "@/types";
import { CostItemEditDialog, type CatalogueTextKey } from "./ManageCostItemsDialog";

const METRICS_PATH = "/metamodel/license-metrics";

/** What the edit dialog is open on: a new/existing metric, or a new/existing type of `metric`. */
type Editing =
  | { kind: "metric"; item: LicenseMetricItem | null }
  | { kind: "type"; metric: LicenseMetricItem; item: LicenseTypeItem | null };

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ManageLicenseTypesDialog({ open, onClose }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const fieldLabel = useFieldLabel();
  const { metrics } = useLicenseCatalogue(open);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setArchived = async (path: string, archived: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(path, { archived });
      await invalidateLicenseCatalogue();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("metamodel.licenseCatalogue.errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const rowSx = (archived: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: 1,
    py: 0.5,
    opacity: archived ? 0.6 : 1,
  });
  const nameSx = (archived: boolean) => ({ textDecoration: archived ? "line-through" : "none" });

  /** Edit + archive/restore buttons, shared by a metric row and a type row. */
  const actions = (name: string, archived: boolean, onEdit: () => void, archivePath: string) => {
    const toggle = t(`metamodel.licenseCatalogue.${archived ? "restore" : "archive"}`);
    return (
      <>
        <Tooltip title={t("common:actions.edit")}>
          <IconButton
            size="small"
            aria-label={`${t("common:actions.edit")}: ${name}`}
            disabled={busy}
            onClick={onEdit}
          >
            <MaterialSymbol icon="edit" size={18} />
          </IconButton>
        </Tooltip>
        <Tooltip title={toggle}>
          <IconButton
            size="small"
            aria-label={`${toggle}: ${name}`}
            disabled={busy}
            onClick={() => setArchived(archivePath, !archived)}
          >
            <MaterialSymbol icon={archived ? "unarchive" : "archive"} size={18} />
          </IconButton>
        </Tooltip>
      </>
    );
  };

  const archivedChip = (archived: boolean) =>
    archived && (
      <Chip size="small" variant="outlined" label={t("metamodel.licenseCatalogue.archived")} />
    );

  const editTextKey: CatalogueTextKey = editing?.kind === "type" ? "licenseTypes" : "licenseMetrics";
  const editPath =
    editing?.kind === "type" ? `${METRICS_PATH}/${encodeURIComponent(editing.metric.key)}/types` : METRICS_PATH;

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t("metamodel.licenseCatalogue.dialogTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("metamodel.licenseCatalogue.description")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("metamodel.licenseCatalogue.archivedHelp")}
          </Typography>
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {metrics.map((m) => {
            const mName = fieldLabel(m);
            return (
              <Box
                key={m.key}
                data-testid={`license-metric-${m.key}`}
                sx={{ mb: 1.5, pb: 1, borderBottom: "1px solid", borderColor: "divider" }}
              >
                <Box sx={rowSx(m.archived)}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap sx={nameSx(m.archived)}>
                      {mName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {m.key}
                    </Typography>
                  </Box>
                  {archivedChip(m.archived)}
                  <Button
                    size="small"
                    disabled={busy}
                    startIcon={<MaterialSymbol icon="add" size={16} />}
                    onClick={() => setEditing({ kind: "type", metric: m, item: null })}
                  >
                    {t("metamodel.licenseCatalogue.addType")}
                  </Button>
                  {actions(
                    mName,
                    m.archived,
                    () => setEditing({ kind: "metric", item: m }),
                    `${METRICS_PATH}/${encodeURIComponent(m.key)}`,
                  )}
                </Box>
                {m.types.map((ty) => {
                  const tName = fieldLabel(ty);
                  return (
                    <Box
                      key={ty.key}
                      data-testid={`license-type-${m.key}-${ty.key}`}
                      sx={{ ...rowSx(ty.archived), pl: 2 }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={nameSx(ty.archived)}>
                          {tName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {ty.key}
                        </Typography>
                      </Box>
                      {archivedChip(ty.archived)}
                      {actions(
                        tName,
                        ty.archived,
                        () => setEditing({ kind: "type", metric: m, item: ty }),
                        `${METRICS_PATH}/${encodeURIComponent(m.key)}/types/${encodeURIComponent(ty.key)}`,
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Button
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setEditing({ kind: "metric", item: null })}
          >
            {t("metamodel.licenseCatalogue.addMetric")}
          </Button>
          <Button onClick={onClose}>{t("common:actions.close")}</Button>
        </DialogActions>
      </Dialog>
      <CostItemEditDialog
        open={editing !== null}
        path={editPath}
        textKey={editTextKey}
        item={editing?.item ?? null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void invalidateLicenseCatalogue();
        }}
      />
    </>
  );
}
