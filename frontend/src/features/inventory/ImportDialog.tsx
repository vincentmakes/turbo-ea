import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Collapse from "@mui/material/Collapse";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { Card, CardType } from "@/types";
import {
  parseWorkbook,
  validateImport,
  executeImport,
  type ImportReport,
  type ImportResult,
} from "./excelImport";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  existingCards: Card[];
  allTypes: CardType[];
  preSelectedType?: string;
}

type Step = "upload" | "report" | "progress" | "done";

export default function ImportDialog({
  open,
  onClose,
  onComplete,
  existingCards,
  allTypes,
  preSelectedType,
}: ImportDialogProps) {
  const { t } = useTranslation(["inventory", "common"]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState("");
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [updatesExpanded, setUpdatesExpanded] = useState(false);
  const [failedExpanded, setFailedExpanded] = useState(false);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setReport(null);
    setProgress(0);
    setProgressTotal(0);
    setResult(null);
    setParseError("");
    setWarningsExpanded(false);
    setUpdatesExpanded(false);
    setFailedExpanded(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleClose = () => {
    if (step === "progress") return; // don't close during import
    if (step === "done") onComplete();
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setParseError("");
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseWorkbook(buffer);
      const rpt = validateImport(rows, existingCards, allTypes, preSelectedType);
      setReport(rpt);
      setStep("report");
    } catch {
      setParseError(t("import.parseError"));
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!report) return;
    setStep("progress");
    setProgressTotal(report.creates.length + report.updates.length);
    setProgress(0);

    const res = await executeImport(report, (done, total) => {
      setProgress(done);
      setProgressTotal(total);
    });
    setResult(res);
    setStep("done");
  };

  const pct = progressTotal > 0 ? Math.round((progress / progressTotal) * 100) : 0;

  const fmtVal = (v: unknown): string => {
    if (v == null) return t("import.empty");
    if (Array.isArray(v)) return v.join(", ") || t("import.empty");
    const s = String(v);
    return s || t("import.empty");
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth={step === "report" && report && report.updates.length > 0 ? "md" : "sm"} fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="upload_file" size={22} />
        {t("import.title")}
      </DialogTitle>

      <DialogContent dividers sx={{ minHeight: 250 }}>
        {/* -------- Step: Upload -------- */}
        {step === "upload" && (
          <>
            <Box
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              sx={{
                border: "2px dashed",
                borderColor: "divider",
                borderRadius: 2,
                p: 4,
                textAlign: "center",
                cursor: "pointer",
                "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                transition: "all 0.15s",
              }}
            >
              <MaterialSymbol icon="cloud_upload" size={48} />
              <Typography variant="body1" sx={{ mt: 1 }}>
                {t("import.dropOrBrowse")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("import.fileTypes")}
              </Typography>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={handleFilePick}
              />
            </Box>
            {fileName && (
              <Typography variant="body2" sx={{ mt: 1.5 }}>
                {t("import.selected")}: <strong>{fileName}</strong>
              </Typography>
            )}
            {parseError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {parseError}
              </Alert>
            )}
            <Alert severity="info" sx={{ mt: 2 }} icon={<MaterialSymbol icon="info" size={20} />}>
              <Typography variant="body2">
                <strong>{t("import.tip")}:</strong> {t("import.tipDescription")}
              </Typography>
            </Alert>
          </>
        )}

        {/* -------- Step: Report -------- */}
        {step === "report" && report && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("import.fileInfo", { fileName, totalRows: report.totalRows })}
              {report.skipped > 0 && `, ${t("import.skippedRows", { count: report.skipped })}`}
            </Typography>

            {/* Summary chips */}
            <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
              <Chip
                icon={<MaterialSymbol icon="add_circle" size={16} />}
                label={t("import.toCreate", { count: report.creates.length })}
                color="success"
                variant="outlined"
                size="small"
              />
              <Chip
                icon={<MaterialSymbol icon="edit" size={16} />}
                label={t("import.toUpdate", { count: report.updates.length })}
                color="info"
                variant="outlined"
                size="small"
              />
              {report.errors.length > 0 && (
                <Chip
                  icon={<MaterialSymbol icon="error" size={16} />}
                  label={t("import.errorCount", { count: report.errors.length })}
                  color="error"
                  variant="outlined"
                  size="small"
                />
              )}
              {report.warnings.length > 0 && (
                <Chip
                  icon={<MaterialSymbol icon="warning" size={16} />}
                  label={t("import.warningCount", { count: report.warnings.length })}
                  color="warning"
                  variant="outlined"
                  size="small"
                />
              )}
            </Box>

            {/* Errors */}
            {report.errors.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {t("import.errorsTitle", { count: report.errors.length })}
                </Typography>
                <Box
                  component="ul"
                  sx={{
                    m: 0,
                    pl: 2,
                    maxHeight: 200,
                    overflow: "auto",
                    fontSize: 13,
                  }}
                >
                  {report.errors.map((err, i) => (
                    <li key={i}>{err.message}</li>
                  ))}
                </Box>
              </Alert>
            )}

            {/* Warnings */}
            {report.warnings.length > 0 && (
              <Alert
                severity="warning"
                sx={{ mb: 2, cursor: "pointer" }}
                onClick={() => setWarningsExpanded((v) => !v)}
              >
                <Typography variant="subtitle2">
                  {t("import.warningsTitle", { count: report.warnings.length })}
                  <MaterialSymbol
                    icon={warningsExpanded ? "expand_less" : "expand_more"}
                    size={16}
                  />
                </Typography>
                <Collapse in={warningsExpanded}>
                  <Box
                    component="ul"
                    sx={{ m: 0, pl: 2, mt: 0.5, fontSize: 13 }}
                  >
                    {report.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </Box>
                </Collapse>
              </Alert>
            )}

            {/* Updates preview */}
            {report.updates.length > 0 && (
              <Alert
                severity="info"
                sx={{ mb: 2, cursor: "pointer", "& .MuiAlert-message": { width: "100%" } }}
                onClick={() => setUpdatesExpanded((v) => !v)}
              >
                <Typography variant="subtitle2">
                  {t("import.changesToReview", { count: report.updates.length })}
                  <MaterialSymbol
                    icon={updatesExpanded ? "expand_less" : "expand_more"}
                    size={16}
                  />
                </Typography>
                <Collapse in={updatesExpanded}>
                  <Box sx={{ mt: 1, maxHeight: 400, overflow: "auto" }}>
                    <Table size="small" sx={{ "& td, & th": { fontSize: 13, py: 0.5, px: 1 } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>{t("import.card")}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t("import.field")}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t("import.current")}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{t("import.new")}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {report.updates.flatMap((row) => {
                          const entries = row.changes ? Object.entries(row.changes) : [];
                          const cardName = row.existing?.name ?? row.data.name as string;
                          return entries.map(([field, { old: o, new: n }], i) => (
                            <TableRow key={`${row.id}-${field}`}>
                              {i === 0 ? (
                                <TableCell
                                  rowSpan={entries.length}
                                  sx={{ fontWeight: 600, verticalAlign: "top", whiteSpace: "nowrap" }}
                                >
                                  {cardName}
                                </TableCell>
                              ) : null}
                              <TableCell sx={{ whiteSpace: "nowrap", color: "text.secondary" }}>
                                {field.replace(/^attr_/, "").replace(/^lifecycle_/, "lifecycle: ")}
                              </TableCell>
                              <TableCell sx={{ color: "text.secondary", wordBreak: "break-word", maxWidth: 200 }}>
                                <span style={{ textDecoration: "line-through", opacity: 0.6 }}>
                                  {fmtVal(o)}
                                </span>
                              </TableCell>
                              <TableCell sx={{ wordBreak: "break-word", maxWidth: 200 }}>
                                {fmtVal(n)}
                              </TableCell>
                            </TableRow>
                          ));
                        })}
                      </TableBody>
                    </Table>
                  </Box>
                </Collapse>
              </Alert>
            )}

            {/* No errors — ready */}
            {report.errors.length === 0 &&
              (report.creates.length > 0 || report.updates.length > 0) && (
                <Alert severity="success">
                  {t("import.validationPassed")}
                </Alert>
              )}

            {/* No data */}
            {report.errors.length === 0 &&
              report.creates.length === 0 &&
              report.updates.length === 0 && (
                <Alert severity="info">{t("import.noRows")}</Alert>
              )}
          </>
        )}

        {/* -------- Step: Progress -------- */}
        {step === "progress" && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t("import.importing")}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={pct}
              sx={{ height: 8, borderRadius: 4, mb: 1 }}
            />
            <Typography variant="body2" color="text.secondary">
              {progress} / {progressTotal} ({pct}%)
            </Typography>
          </Box>
        )}

        {/* -------- Step: Done -------- */}
        {step === "done" && result && (
          <>
            <Box sx={{ textAlign: "center", py: 2 }}>
              <MaterialSymbol
                icon={result.failed > 0 ? "warning" : "check_circle"}
                size={48}
                color={result.failed > 0 ? "#ff9800" : "#4caf50"}
              />
              <Typography variant="h6" sx={{ mt: 1 }}>
                {t("import.complete")}
              </Typography>
            </Box>

            <Box sx={{ display: "flex", gap: 1, justifyContent: "center", mb: 2 }}>
              {result.created > 0 && (
                <Chip label={t("import.createdCount", { count: result.created })} color="success" size="small" />
              )}
              {result.updated > 0 && (
                <Chip label={t("import.updatedCount", { count: result.updated })} color="info" size="small" />
              )}
              {result.failed > 0 && (
                <Chip label={t("import.failedCount", { count: result.failed })} color="error" size="small" />
              )}
            </Box>

            {result.failedDetails.length > 0 && (
              <Alert
                severity="error"
                sx={{ cursor: "pointer" }}
                onClick={() => setFailedExpanded((v) => !v)}
              >
                <Typography variant="subtitle2">
                  {t("import.failedRows", { count: result.failedDetails.length })}
                  <MaterialSymbol
                    icon={failedExpanded ? "expand_less" : "expand_more"}
                    size={16}
                  />
                </Typography>
                <Collapse in={failedExpanded}>
                  <Box
                    component="ul"
                    sx={{ m: 0, pl: 2, mt: 0.5, fontSize: 13 }}
                  >
                    {result.failedDetails.map((d, i) => (
                      <li key={i}>
                        {t("import.rowError", { row: d.row, message: d.message })}
                      </li>
                    ))}
                  </Box>
                </Collapse>
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        {step === "upload" && <Button onClick={handleClose}>{t("common:actions.cancel")}</Button>}

        {step === "report" && (
          <>
            <Button onClick={reset}>{t("common:actions.back")}</Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={handleClose}>{t("common:actions.cancel")}</Button>
            <Button
              variant="contained"
              onClick={handleImport}
              disabled={
                !report ||
                report.errors.length > 0 ||
                (report.creates.length === 0 && report.updates.length === 0)
              }
              startIcon={<MaterialSymbol icon="upload" size={18} />}
            >
              {t("import.importRows", { count: report ? report.creates.length + report.updates.length : 0 })}
            </Button>
          </>
        )}

        {step === "done" && (
          <Button variant="contained" onClick={handleClose}>
            {t("common:actions.done")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
