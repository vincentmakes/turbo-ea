/**
 * RiskImportDialog — spreadsheet importer for the Risk Register.
 *
 * Mirrors the Inventory ImportDialog flow, trimmed to the risk shape:
 * upload → server dry-run preview → apply. Parsing is client-side
 * (``riskImport.ts``); all validation + owner/card resolution happen
 * server-side via ``POST /risks/bulk-import`` so the preview is exactly
 * what the real import will produce.
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import type { RiskImportItem, RiskImportResponse } from "@/types";
import { downloadRiskTemplate, parseRiskWorkbook } from "./riskImport";

interface RiskImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful real import so the register can refetch. */
  onComplete: () => void;
}

type Step = "upload" | "preview" | "done";

export default function RiskImportDialog({ open, onClose, onComplete }: RiskImportDialogProps) {
  const { t } = useTranslation(["grc", "common"]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<RiskImportItem[]>([]);
  const [preview, setPreview] = useState<RiskImportResponse | null>(null);
  const [result, setResult] = useState<RiskImportResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [skippedExpanded, setSkippedExpanded] = useState(false);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setItems([]);
    setPreview(null);
    setResult(null);
    setError("");
    setBusy(false);
    setWarningsExpanded(false);
    setErrorsExpanded(false);
    setSkippedExpanded(false);
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
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseRiskWorkbook(buffer);
      if (parsed.length === 0) {
        setError(t("grc:risks.import.emptyFile", { defaultValue: "No rows found in the file." }));
        return;
      }
      setItems(parsed);
      setBusy(true);
      const resp = await api.post<RiskImportResponse>("/risks/bulk-import", {
        items: parsed,
        dry_run: true,
      });
      setPreview(resp);
      setStep("preview");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : t("grc:risks.import.parseError", {
              defaultValue: "Could not read the spreadsheet. Make sure it is a valid .xlsx file.",
            }),
      );
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
      const resp = await api.post<RiskImportResponse>("/risks/bulk-import", {
        items,
        dry_run: false,
      });
      setResult(resp);
      setStep("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common:errors.generic", { defaultValue: "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  };

  const previewWarnings =
    preview?.results.flatMap((r) =>
      r.warnings.map((w) => ({ row: r.row_index, message: w })),
    ) ?? [];
  const previewErrors =
    preview?.results.filter((r) => r.status === "failed") ?? [];
  const previewSkipped =
    preview?.results.filter((r) => r.status === "skipped") ?? [];
  const canImport = (preview?.created ?? 0) > 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t("grc:risks.import.title", { defaultValue: "Import risks" })}
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === "upload" && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t("grc:risks.import.intro", {
                defaultValue:
                  "Upload an .xlsx file to create risks in bulk. Each row becomes a new risk; rows whose reference already matches an existing risk are skipped. Owners are matched by email and cards by exact name — anything that can't be matched is skipped with a warning.",
              })}
            </Typography>
            <Box>
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => downloadRiskTemplate()}
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
              >
                <MaterialSymbol icon="download" size={18} />
                {t("grc:risks.import.downloadTemplate", {
                  defaultValue: "Download template",
                })}
              </Link>
            </Box>
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="upload_file" size={18} />}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              sx={{ textTransform: "none", py: 2 }}
            >
              {busy
                ? t("grc:risks.import.parsing", { defaultValue: "Reading file…" })
                : t("grc:risks.import.chooseFile", { defaultValue: "Choose .xlsx file" })}
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
                label={t("grc:risks.import.willCreate", {
                  count: preview.created,
                  defaultValue: "{{count}} to create",
                })}
              />
              {preview.failed > 0 && (
                <Chip
                  color="error"
                  variant="outlined"
                  icon={<MaterialSymbol icon="error" size={16} />}
                  label={t("grc:risks.import.willFail", {
                    count: preview.failed,
                    defaultValue: "{{count}} with errors",
                  })}
                />
              )}
              {preview.skipped > 0 && (
                <Chip
                  color="default"
                  variant="outlined"
                  icon={<MaterialSymbol icon="skip_next" size={16} />}
                  label={t("grc:risks.import.willSkip", {
                    count: preview.skipped,
                    defaultValue: "{{count}} already exist (skipped)",
                  })}
                />
              )}
              {previewWarnings.length > 0 && (
                <Chip
                  color="warning"
                  variant="outlined"
                  icon={<MaterialSymbol icon="warning" size={16} />}
                  label={t("grc:risks.import.warningCount", {
                    count: previewWarnings.length,
                    defaultValue: "{{count}} warnings",
                  })}
                />
              )}
            </Stack>

            {preview.failed > 0 && (
              <Alert severity="error">
                {t("grc:risks.import.errorsBlock", {
                  defaultValue:
                    "Some rows have errors and will be skipped. Fix them and re-upload, or import the valid rows only.",
                })}
                <Link
                  component="button"
                  type="button"
                  underline="hover"
                  onClick={() => setErrorsExpanded((v) => !v)}
                  sx={{ display: "block", mt: 0.5 }}
                >
                  {errorsExpanded
                    ? t("common:actions.showLess", { defaultValue: "Show less" })
                    : t("common:actions.showMore", { defaultValue: "Show details" })}
                </Link>
                <Collapse in={errorsExpanded}>
                  <List dense disablePadding>
                    {previewErrors.map((r) => (
                      <ListItem key={r.row_index} disableGutters>
                        <ListItemText
                          primary={t("grc:risks.import.rowLabel", {
                            row: r.row_index + 1,
                            defaultValue: "Row {{row}}",
                          })}
                          secondary={r.error ?? ""}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              </Alert>
            )}

            {previewWarnings.length > 0 && (
              <Alert severity="warning">
                {t("grc:risks.import.warningsBlock", {
                  defaultValue:
                    "Some owners or cards couldn't be matched. The risks will still import without them.",
                })}
                <Link
                  component="button"
                  type="button"
                  underline="hover"
                  onClick={() => setWarningsExpanded((v) => !v)}
                  sx={{ display: "block", mt: 0.5 }}
                >
                  {warningsExpanded
                    ? t("common:actions.showLess", { defaultValue: "Show less" })
                    : t("common:actions.showMore", { defaultValue: "Show details" })}
                </Link>
                <Collapse in={warningsExpanded}>
                  <List dense disablePadding>
                    {previewWarnings.map((w, i) => (
                      <ListItem key={`${w.row}-${i}`} disableGutters>
                        <ListItemText
                          primary={t("grc:risks.import.rowLabel", {
                            row: w.row + 1,
                            defaultValue: "Row {{row}}",
                          })}
                          secondary={w.message}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              </Alert>
            )}

            {previewSkipped.length > 0 && (
              <Alert severity="info">
                {t("grc:risks.import.skippedBlock", {
                  defaultValue:
                    "Rows whose reference already matches an existing risk are skipped — the importer never updates existing risks.",
                })}
                <Link
                  component="button"
                  type="button"
                  underline="hover"
                  onClick={() => setSkippedExpanded((v) => !v)}
                  sx={{ display: "block", mt: 0.5 }}
                >
                  {skippedExpanded
                    ? t("common:actions.showLess", { defaultValue: "Show less" })
                    : t("common:actions.showMore", { defaultValue: "Show details" })}
                </Link>
                <Collapse in={skippedExpanded}>
                  <List dense disablePadding>
                    {previewSkipped.map((r) => (
                      <ListItem key={r.row_index} disableGutters>
                        <ListItemText
                          primary={t("grc:risks.import.rowLabel", {
                            row: r.row_index + 1,
                            defaultValue: "Row {{row}}",
                          })}
                          secondary={r.reference ?? ""}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              </Alert>
            )}
          </Stack>
        )}

        {step === "done" && result && (
          <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
            <MaterialSymbol
              icon={result.failed > 0 ? "warning" : "check_circle"}
              size={48}
              color={result.failed > 0 ? "warning.main" : "success.main"}
            />
            <Typography variant="h6">
              {t("grc:risks.import.doneTitle", {
                count: result.created,
                defaultValue: "Imported {{count}} risks",
              })}
            </Typography>
            {result.skipped > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("grc:risks.import.doneSkipped", {
                  count: result.skipped,
                  defaultValue: "{{count}} rows were skipped (already exist).",
                })}
              </Typography>
            )}
            {result.failed > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("grc:risks.import.doneFailed", {
                  count: result.failed,
                  defaultValue: "{{count}} rows were skipped due to errors.",
                })}
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {step === "preview" && (
          <Button onClick={() => reset()} disabled={busy} sx={{ textTransform: "none" }}>
            {t("common:actions.back", { defaultValue: "Back" })}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleClose} disabled={busy} sx={{ textTransform: "none" }}>
          {step === "done"
            ? t("common:actions.close", { defaultValue: "Close" })
            : t("common:actions.cancel", { defaultValue: "Cancel" })}
        </Button>
        {step === "preview" && (
          <Button
            variant="contained"
            onClick={handleApply}
            disabled={busy || !canImport}
            startIcon={<MaterialSymbol icon="upload" size={18} />}
            sx={{ textTransform: "none" }}
          >
            {t("grc:risks.import.apply", {
              count: preview?.created ?? 0,
              defaultValue: "Import {{count}} risks",
            })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
