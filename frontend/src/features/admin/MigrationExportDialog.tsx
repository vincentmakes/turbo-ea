import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";

// The reverse of the platform-migration importer: download the current
// workspace as an import bundle for a source platform
// (GET /migration/export?source_key=…) — for LeanIX a zip holding the LDIF
// data and the processor configuration its Integration API runs. Registry-driven like the upload
// dialog — every source reporting ``supports_export`` is offered — and
// the download follows the same blob/anchor pattern as the workspace
// bundle export in WorkspaceTransferAdmin.

export interface ExportableSource {
  key: string;
  label: string;
}

interface MigrationExportDialogProps {
  open: boolean;
  sources: ExportableSource[];
  onClose: () => void;
}

async function downloadMigrationExport(
  sourceKey: string,
  includeArchived: boolean,
): Promise<void> {
  const params = new URLSearchParams({
    source_key: sourceKey,
    include_archived: includeArchived ? "true" : "false",
  });
  const res = await api.getRaw(`/migration/export?${params.toString()}`);
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `${sourceKey}_export.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MigrationExportDialog({
  open,
  sources,
  onClose,
}: MigrationExportDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [sourceKey, setSourceKey] = useState<string>(sources[0]?.key ?? "");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the picker on a source that still exists (the list is loaded
  // asynchronously and can arrive after the first render).
  useEffect(() => {
    if (!sources.some((s) => s.key === sourceKey)) {
      setSourceKey(sources[0]?.key ?? "");
    }
  }, [sources, sourceKey]);

  const handleExport = async () => {
    if (!sourceKey) return;
    setBusy(true);
    setError(null);
    try {
      await downloadMigrationExport(sourceKey, includeArchived);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("migration.export.title", "Export the workspace")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t(
              "migration.export.help",
              "Download the current workspace — cards, relations, tags, stakeholders and document links — as an import bundle for the selected platform. For SAP LeanIX this is a .zip with the data (LDIF) and the processor configuration to run in Administration → Integration API; the README inside explains the steps.",
            )}
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel id="migration-export-source-label">
              {t("migration.export.source", "Target platform")}
            </InputLabel>
            <Select
              labelId="migration-export-source-label"
              label={t("migration.export.source", "Target platform")}
              value={sourceKey}
              onChange={(e) => setSourceKey(String(e.target.value))}
              disabled={busy || sources.length === 0}
            >
              {sources.map((s) => (
                <MenuItem key={s.key} value={s.key}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Checkbox
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                disabled={busy}
              />
            }
            label={t("migration.export.includeArchived", "Include archived cards")}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("common:actions.cancel", "Cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={handleExport}
          disabled={busy || !sourceKey}
          startIcon={
            busy ? <CircularProgress size={16} color="inherit" /> : <MaterialSymbol icon="download" />
          }
        >
          {t("migration.export.submit", "Download")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
