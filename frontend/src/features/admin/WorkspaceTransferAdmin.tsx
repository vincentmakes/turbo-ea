import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { primeBootstrap, resetBootstrap } from "@/api/bootstrap";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { invalidateCalculatedFields } from "@/hooks/useCalculatedFields";
import { invalidateCache as invalidateMetamodel } from "@/hooks/useMetamodel";

interface SectionResult {
  sheet: string;
  created: number;
  updated: number;
  skipped: number;
  conflict: number;
  failed: number;
  errors: string[];
  errors_total?: number;
  skip_reasons?: Record<string, number>;
}

interface TransferReport {
  dry_run: boolean;
  sections: SectionResult[];
  totals: {
    created: number;
    updated: number;
    skipped: number;
    conflict: number;
    failed: number;
  };
}

interface WorkspaceTransfer {
  id: string;
  filename: string;
  status: string;
  format_version?: string | null;
  source_app_version?: string | null;
  source_url?: string | null;
  diff?: TransferReport | null;
  result?: TransferReport | null;
  error_message?: string | null;
}

/**
 * An import can flip feature toggles (PPM/BPM/GRC), metamodel, currency,
 * locales, compliance regulations, calculations, … — all held in boot-time
 * singleton caches. Re-prime them so the app reflects the imported workspace
 * without a manual browser refresh.
 */
function refreshAppCaches() {
  resetBootstrap(); // primeBootstrap is guarded — must reset before re-priming
  void primeBootstrap();
  void invalidateMetamodel();
  invalidateCalculatedFields();
}

const POLL_MS = 2000;
const TERMINAL = new Set(["previewed", "applied", "failed"]);

export default function WorkspaceTransferAdmin() {
  const { t } = useTranslation("admin");

  // Export state
  const [includeArchived, setIncludeArchived] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Import state
  const [transfer, setTransfer] = useState<WorkspaceTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPoll(), [clearPoll]);

  const poll = useCallback(
    (id: string) => {
      clearPoll();
      pollRef.current = setTimeout(async () => {
        try {
          const next = await api.get<WorkspaceTransfer>(`/admin/workspace/import/${id}`);
          setTransfer(next);
          if (!TERMINAL.has(next.status)) {
            poll(id);
          } else if (next.status === "applied") {
            refreshAppCaches();
          }
        } catch (e) {
          setImportError(e instanceof Error ? e.message : String(e));
        }
      }, POLL_MS);
    },
    [clearPoll],
  );

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await api.getRaw(
        `/admin/workspace/export?include_archived=${includeArchived ? "true" : "false"}`,
      );
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "workspace_export.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setImportError(null);
    setTransfer(null);
    try {
      const created = await api.upload<WorkspaceTransfer>("/admin/workspace/import", file);
      setTransfer(created);
      poll(created.id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleApply = async () => {
    if (!transfer) return;
    setBusy(true);
    setImportError(null);
    try {
      const updated = await api.post<WorkspaceTransfer>(
        `/admin/workspace/import/${transfer.id}/apply`,
      );
      setTransfer(updated);
      poll(updated.id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!transfer) return;
    clearPoll();
    try {
      await api.delete(`/admin/workspace/import/${transfer.id}`);
    } catch {
      /* best-effort cleanup */
    }
    setTransfer(null);
    setImportError(null);
  };

  const report = transfer?.result || transfer?.diff || null;
  const isApplied = transfer?.status === "applied";
  const isPreviewing = transfer?.status === "parsing";
  const isApplying = transfer?.status === "applying";

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary">
        {t(
          "workspaceTransfer.intro",
          "Move an entire workspace — metamodel, configuration, settings, users, and inventory — between instances as a single bundle. Secrets (SMTP, SSO, and AI credentials) are never included and must be re-entered on the target.",
        )}
      </Typography>

      {/* Export */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("workspaceTransfer.export.title", "Export workspace")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t(
              "workspaceTransfer.export.help",
              "Download the current workspace as a .zip bundle you can import into another instance.",
            )}
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
            }
            label={t("workspaceTransfer.export.includeArchived", "Include archived cards")}
          />
          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              onClick={handleExport}
              disabled={exporting}
              startIcon={
                exporting ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <MaterialSymbol icon="download" />
                )
              }
            >
              {t("workspaceTransfer.export.button", "Export bundle")}
            </Button>
          </Box>
          {exportError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {exportError}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Import */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("workspaceTransfer.import.title", "Import workspace")}
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t(
              "workspaceTransfer.import.warning",
              "Importing upserts metamodel, configuration, and settings by key, and creates any missing cards and relations. Review the preview before applying.",
            )}
          </Alert>

          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            hidden
            onChange={handleFile}
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              onClick={() => fileRef.current?.click()}
              disabled={busy || isPreviewing || isApplying}
              startIcon={
                busy ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <MaterialSymbol icon="upload" />
                )
              }
            >
              {busy
                ? t("workspaceTransfer.import.uploading", "Uploading…")
                : t("workspaceTransfer.import.choose", "Choose bundle…")}
            </Button>
            {transfer && (
              <Button color="inherit" onClick={handleDiscard} disabled={isApplying}>
                {t("workspaceTransfer.import.discard", "Discard")}
              </Button>
            )}
          </Stack>

          {busy && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t(
                "workspaceTransfer.import.uploadingHelp",
                "Uploading the bundle — large workspaces may take a moment.",
              )}
            </Typography>
          )}

          {importError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {importError}
            </Alert>
          )}

          {transfer && (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">{transfer.filename}</Typography>
                <Chip size="small" label={transfer.status} />
                {transfer.source_url && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("workspaceTransfer.import.from", "from {{url}}", {
                      url: transfer.source_url,
                    })}
                  />
                )}
              </Stack>

              {(isPreviewing || isApplying) && <LinearProgress sx={{ mb: 2 }} />}

              {transfer.source_app_version &&
                transfer.source_app_version !== __APP_VERSION__ && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t(
                      "workspaceTransfer.import.versionMismatch",
                      "This bundle was exported from Turbo EA {{source}}, but this instance runs {{current}}. The import can proceed — review the preview carefully, and prefer matching versions when possible.",
                      {
                        source: transfer.source_app_version,
                        current: __APP_VERSION__,
                      },
                    )}
                  </Alert>
                )}

              {transfer.error_message && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {transfer.error_message}
                </Alert>
              )}

              {report && <ReportTable report={report} t={t} />}

              {transfer.status === "previewed" && (
                <Button
                  variant="contained"
                  color="warning"
                  onClick={handleApply}
                  disabled={busy}
                  sx={{ mt: 2 }}
                  startIcon={<MaterialSymbol icon="play_arrow" />}
                >
                  {t("workspaceTransfer.import.apply", "Apply import")}
                </Button>
              )}

              {isApplied && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  {t("workspaceTransfer.import.done", "Import applied successfully.")}
                </Alert>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function ReportTable({ report, t }: { report: TransferReport; t: Translate }) {
  const rows = report.sections.filter(
    (s) => s.created || s.updated || s.skipped || s.conflict || s.failed,
  );
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {t("workspaceTransfer.report.heading", "Preview")} — {t("workspaceTransfer.report.created", "Created")}: {report.totals.created},{" "}
        {t("workspaceTransfer.report.updated", "Updated")}: {report.totals.updated},{" "}
        {t("workspaceTransfer.report.skipped", "Skipped")}: {report.totals.skipped},{" "}
        {t("workspaceTransfer.report.conflict", "Conflicts")}: {report.totals.conflict},{" "}
        {t("workspaceTransfer.report.failed", "Failed")}: {report.totals.failed}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {t(
          "workspaceTransfer.report.skippedHint",
          "Skipped means the item already exists on this instance — no action was needed.",
        )}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 40 }} />
            <TableCell>{t("workspaceTransfer.report.section", "Section")}</TableCell>
            <TableCell align="right">{t("workspaceTransfer.report.created", "Created")}</TableCell>
            <TableCell align="right">{t("workspaceTransfer.report.updated", "Updated")}</TableCell>
            <TableCell align="right">
              <Tooltip
                title={t(
                  "workspaceTransfer.report.skippedHint",
                  "Skipped means the item already exists on this instance — no action was needed.",
                )}
              >
                <span>{t("workspaceTransfer.report.skipped", "Skipped")}</span>
              </Tooltip>
            </TableCell>
            <TableCell align="right">{t("workspaceTransfer.report.conflict", "Conflicts")}</TableCell>
            <TableCell align="right">{t("workspaceTransfer.report.failed", "Failed")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((s) => (
            <SectionRow key={s.sheet} section={s} t={t} />
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function SectionRow({ section: s, t }: { section: SectionResult; t: Translate }) {
  const [open, setOpen] = useState(false);
  const reasons = Object.entries(s.skip_reasons ?? {});
  const hasDetails = reasons.length > 0 || s.errors.length > 0;
  const errorsTotal = s.errors_total ?? s.errors.length;
  return (
    <Fragment>
      <TableRow>
        <TableCell sx={{ width: 40 }}>
          {hasDetails && (
            <IconButton
              size="small"
              onClick={() => setOpen((v) => !v)}
              aria-label={t("workspaceTransfer.report.toggleDetails", "Toggle details")}
            >
              <MaterialSymbol icon={open ? "expand_less" : "expand_more"} size={18} />
            </IconButton>
          )}
        </TableCell>
        <TableCell>{s.sheet}</TableCell>
        <TableCell align="right">{s.created || ""}</TableCell>
        <TableCell align="right">{s.updated || ""}</TableCell>
        <TableCell align="right">{s.skipped || ""}</TableCell>
        <TableCell align="right">
          {s.conflict ? <Chip size="small" color="warning" label={s.conflict} /> : ""}
        </TableCell>
        <TableCell align="right">
          {s.failed ? <Chip size="small" color="error" label={s.failed} /> : ""}
        </TableCell>
      </TableRow>
      {hasDetails && (
        <TableRow>
          <TableCell colSpan={7} sx={{ py: 0, border: 0 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ py: 1, pl: 5 }}>
                {reasons.length > 0 && (
                  <Box sx={{ mb: s.errors.length ? 1 : 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t("workspaceTransfer.report.skipReasons", "Skip reasons")}
                    </Typography>
                    {reasons.map(([key, count]) => (
                      <Typography key={key} variant="body2">
                        {t(`workspaceTransfer.report.reason.${key}`, key)} × {count}
                      </Typography>
                    ))}
                  </Box>
                )}
                {s.errors.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t("workspaceTransfer.report.messages", "Messages")}
                    </Typography>
                    {s.errors.map((msg, i) => (
                      <Typography
                        key={i}
                        variant="body2"
                        sx={{ fontFamily: "monospace", fontSize: 12 }}
                      >
                        {msg}
                      </Typography>
                    ))}
                    {errorsTotal > s.errors.length && (
                      <Typography variant="caption" color="text.secondary">
                        {t(
                          "workspaceTransfer.report.messagesTruncated",
                          "Showing the first {{shown}} of {{total}} messages",
                          { shown: s.errors.length, total: errorsTotal },
                        )}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
