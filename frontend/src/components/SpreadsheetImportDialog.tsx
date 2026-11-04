/**
 * SpreadsheetImportDialog — the upload → server dry-run preview → apply flow
 * shared by the EA principles and decision-record importers.
 *
 * Parsing is client-side (the caller's `parse`); every check and every match
 * runs on the server, first with `dry_run: true` so the preview is exactly
 * what applying will do, then for real with the same rows. Modelled on the
 * Risk Register's `RiskImportDialog`, generalised over the endpoint and over
 * an optional `updated` outcome (principles upsert; decisions are create-only).
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import type { SpreadsheetImportResponse, SpreadsheetImportRowResult } from "@/types";

export interface SpreadsheetImportDialogProps<TItem> {
  open: boolean;
  onClose: () => void;
  /** Called when the dialog closes after a real import, so the page can refetch. */
  onComplete: () => void;
  title: string;
  /** What the importer does with each row, shown above the file picker. */
  intro: string;
  /** What a skipped row means for this importer, shown in the preview. */
  skippedHint: string;
  /** `POST` endpoint taking `{ items, dry_run }`. */
  endpoint: string;
  parse: (buffer: ArrayBuffer) => TItem[];
  downloadTemplate: () => void;
}

type Step = "upload" | "preview" | "done";

function RowList({
  open,
  rows,
}: {
  open: boolean;
  rows: { key: string; row: number; text: string }[];
}) {
  const { t } = useTranslation("common");
  return (
    <Collapse in={open}>
      <List dense disablePadding>
        {rows.map((r) => (
          <ListItem key={r.key} disableGutters>
            <ListItemText
              primary={t("spreadsheetImport.rowLabel", { row: r.row + 1 })}
              secondary={r.text}
            />
          </ListItem>
        ))}
      </List>
    </Collapse>
  );
}

function ToggleLink({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation("common");
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={onToggle}
      sx={{ display: "block", mt: 0.5 }}
    >
      {open ? t("actions.showLess") : t("actions.showMore")}
    </Link>
  );
}

function skippedText(r: SpreadsheetImportRowResult): string {
  return r.reference_number ?? "";
}

export default function SpreadsheetImportDialog<TItem>({
  open,
  onClose,
  onComplete,
  title,
  intro,
  skippedHint,
  endpoint,
  parse,
  downloadTemplate,
}: SpreadsheetImportDialogProps<TItem>) {
  const { t } = useTranslation("common");
  const theme = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<TItem[]>([]);
  const [preview, setPreview] = useState<SpreadsheetImportResponse | null>(null);
  const [result, setResult] = useState<SpreadsheetImportResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setItems([]);
    setPreview(null);
    setResult(null);
    setError("");
    setBusy(false);
    setExpanded({});
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleClose = () => {
    if (busy) return;
    if (step === "done") onComplete();
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setError("");
    setFileName(file.name);
    let parsed: TItem[];
    try {
      parsed = parse(await file.arrayBuffer());
    } catch {
      setError(t("spreadsheetImport.parseError"));
      return;
    }
    if (parsed.length === 0) {
      setError(t("spreadsheetImport.emptyFile"));
      return;
    }
    setItems(parsed);
    setBusy(true);
    try {
      const resp = await api.post<SpreadsheetImportResponse>(endpoint, {
        items: parsed,
        dry_run: true,
      });
      setPreview(resp);
      setStep("preview");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const handleApply = async () => {
    setError("");
    setBusy(true);
    try {
      const resp = await api.post<SpreadsheetImportResponse>(endpoint, {
        items,
        dry_run: false,
      });
      setResult(resp);
      setStep("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const results = preview?.results ?? [];
  const warnings = results.flatMap((r) =>
    r.warnings.map((w, i) => ({ key: `${r.row_index}-${i}`, row: r.row_index, text: w })),
  );
  const failures = results
    .filter((r) => r.status === "failed")
    .map((r) => ({ key: String(r.row_index), row: r.row_index, text: r.error ?? "" }));
  const updates = results
    .filter((r) => r.status === "updated")
    .map((r) => ({
      key: String(r.row_index),
      row: r.row_index,
      text: [r.reference_number, (r.changed_fields ?? []).join(", ")].filter(Boolean).join(": "),
    }));
  const skipped = results
    .filter((r) => r.status === "skipped")
    .map((r) => ({ key: String(r.row_index), row: r.row_index, text: skippedText(r) }));
  const updated = preview?.updated ?? 0;
  const changes = (preview?.created ?? 0) + updated;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === "upload" && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {intro}
            </Typography>
            <Box>
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => downloadTemplate()}
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
              >
                <MaterialSymbol icon="download" size={18} />
                {t("spreadsheetImport.downloadTemplate")}
              </Link>
            </Box>
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="upload_file" size={18} />}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              sx={{ textTransform: "none", py: 2 }}
            >
              {busy ? t("spreadsheetImport.reading") : t("spreadsheetImport.chooseFile")}
            </Button>
            {fileName && (
              <Typography variant="caption" color="text.secondary">
                {fileName}
              </Typography>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              hidden
              data-testid="spreadsheet-import-file"
              onChange={onPickFile}
            />
          </Stack>
        )}

        {step === "preview" && preview && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {fileName}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                color="success"
                variant="outlined"
                icon={<MaterialSymbol icon="add_circle" size={16} />}
                label={t("spreadsheetImport.willCreate", { count: preview.created })}
              />
              {updated > 0 && (
                <Chip
                  color="info"
                  variant="outlined"
                  icon={<MaterialSymbol icon="edit" size={16} />}
                  label={t("spreadsheetImport.willUpdate", { count: updated })}
                />
              )}
              {preview.skipped > 0 && (
                <Chip
                  variant="outlined"
                  icon={<MaterialSymbol icon="skip_next" size={16} />}
                  label={t("spreadsheetImport.willSkip", { count: preview.skipped })}
                />
              )}
              {preview.failed > 0 && (
                <Chip
                  color="error"
                  variant="outlined"
                  icon={<MaterialSymbol icon="error" size={16} />}
                  label={t("spreadsheetImport.willFail", { count: preview.failed })}
                />
              )}
              {warnings.length > 0 && (
                <Chip
                  color="warning"
                  variant="outlined"
                  icon={<MaterialSymbol icon="warning" size={16} />}
                  label={t("spreadsheetImport.warningCount", { count: warnings.length })}
                />
              )}
            </Stack>

            {failures.length > 0 && (
              <Alert severity="error">
                {t("spreadsheetImport.errorsBlock")}
                <ToggleLink open={!!expanded.errors} onToggle={() => toggle("errors")} />
                <RowList open={!!expanded.errors} rows={failures} />
              </Alert>
            )}
            {warnings.length > 0 && (
              <Alert severity="warning">
                {t("spreadsheetImport.warningsBlock")}
                <ToggleLink open={!!expanded.warnings} onToggle={() => toggle("warnings")} />
                <RowList open={!!expanded.warnings} rows={warnings} />
              </Alert>
            )}
            {updates.length > 0 && (
              <Alert severity="info">
                {t("spreadsheetImport.updatedBlock")}
                <ToggleLink open={!!expanded.updates} onToggle={() => toggle("updates")} />
                <RowList open={!!expanded.updates} rows={updates} />
              </Alert>
            )}
            {skipped.length > 0 && (
              <Alert severity="info">
                {skippedHint}
                <ToggleLink open={!!expanded.skipped} onToggle={() => toggle("skipped")} />
                <RowList open={!!expanded.skipped} rows={skipped} />
              </Alert>
            )}
          </Stack>
        )}

        {step === "done" && result && (
          <Stack spacing={1} alignItems="center" sx={{ py: 2 }}>
            <MaterialSymbol
              icon={result.failed > 0 ? "warning" : "check_circle"}
              size={48}
              color={result.failed > 0 ? theme.palette.warning.main : theme.palette.success.main}
            />
            <Typography variant="h6">
              {t("spreadsheetImport.doneCreated", { count: result.created })}
            </Typography>
            {(result.updated ?? 0) > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("spreadsheetImport.doneUpdated", { count: result.updated })}
              </Typography>
            )}
            {result.skipped > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("spreadsheetImport.doneSkipped", { count: result.skipped })}
              </Typography>
            )}
            {result.failed > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("spreadsheetImport.doneFailed", { count: result.failed })}
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {step === "preview" && (
          <Button onClick={() => reset()} disabled={busy} sx={{ textTransform: "none" }}>
            {t("actions.back")}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleClose} disabled={busy} sx={{ textTransform: "none" }}>
          {step === "done" ? t("actions.close") : t("actions.cancel")}
        </Button>
        {step === "preview" && (
          <Button
            variant="contained"
            onClick={handleApply}
            disabled={busy || changes === 0}
            startIcon={<MaterialSymbol icon="upload" size={18} />}
            sx={{ textTransform: "none" }}
          >
            {t("spreadsheetImport.apply", { count: changes })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
