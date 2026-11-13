/**
 * PpmRiskImportDialog — spreadsheet importer for an initiative's risks.
 *
 * upload → client-side parse and preview → write. The workbook is parsed and
 * every row classified in the browser (`ppmRiskSpreadsheet.ts`): created,
 * updated (a Risk ID from an export), unchanged or rejected with the reasons.
 * Nothing is written before the user confirms; then each row goes through the
 * ordinary endpoints (`POST /ppm/initiatives/{id}/risks`,
 * `PATCH /ppm/risks/{id}`) one at a time, a failed row does not stop the
 * rest, and the result names every row that failed. Risks absent from the
 * file are never touched.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
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
import { useTheme, type SxProps, type Theme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import LinkifiedText from "@/components/LinkifiedText";
import { api, ApiError } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import type { PpmRisk } from "@/types";
import {
  downloadPpmRiskTemplate,
  parsePpmRiskWorkbook,
  planPpmRiskImport,
  type ImportUser,
  type PpmRiskImportRow,
  type PpmRiskSheetRow,
  type Translate,
} from "./ppmRiskSpreadsheet";

interface Props {
  open: boolean;
  initiativeId: string;
  existingRisks: PpmRisk[];
  onClose: () => void;
  /** Called once after at least one row was written, so the tab reloads. */
  onImported: () => void;
}

type Step = "upload" | "preview" | "done";

interface FailedRow {
  sheetRow: number;
  title: string;
  message: string;
}

interface ImportResult {
  created: number;
  updated: number;
  failed: FailedRow[];
}

const KIND_CHIP: Record<
  PpmRiskImportRow["kind"],
  { key: string; color: "success" | "info" | "default" | "error" }
> = {
  create: { key: "ppm:riskImportKindCreate", color: "success" },
  update: { key: "ppm:riskImportKindUpdate", color: "info" },
  unchanged: { key: "ppm:riskImportKindUnchanged", color: "default" },
  rejected: { key: "ppm:riskImportKindRejected", color: "error" },
};

// Stryker disable all: spacing, alignment and text case are presentation; jsdom lays nothing out
const SX = {
  alert: { mb: 2 },
  templateLink: { display: "inline-flex", alignItems: "center", gap: 0.5 },
  chooseFile: { textTransform: "none", py: 2 },
  rowChip: { mr: 1, mt: 0.5, minWidth: 88 },
  done: { py: 2 },
  failedList: { alignSelf: "stretch" },
  action: { textTransform: "none" },
  spacer: { flex: 1 },
} satisfies Record<string, SxProps<Theme>>;
// Stryker restore all

/** The detail line under a preview row: its reasons, changes and warnings. */
function rowDetail(row: PpmRiskImportRow, t: Translate): string {
  const parts: string[] = [];
  if (row.kind === "rejected") parts.push(...row.errors);
  if (row.kind === "update") parts.push(t("ppm:riskImportChanged", { fields: row.changed.join(", ") }));
  parts.push(...row.warnings);
  return parts.join(" · ");
}

export default function PpmRiskImportDialog({
  open,
  initiativeId,
  existingRisks,
  onClose,
  onImported,
}: Props) {
  // Stryker disable next-line ArrayDeclaration,StringLiteral: equivalent, every key below carries its namespace prefix and every namespace is bundled at init
  const { t } = useTranslation(["ppm", "common", "grc"]);
  const theme = useTheme();
  const fullScreen = useFullScreenDialog();
  const submit = useSubmitOnce();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheetRows, setSheetRows] = useState<PpmRiskSheetRow[] | null>(null);
  const [errorKey, setErrorKey] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const users = useApiQuery<ImportUser[]>(open ? "/users" : null);

  const plan = useMemo(
    () =>
      sheetRows && users.data
        ? planPpmRiskImport(sheetRows, existingRisks, users.data, t as Translate)
        : null,
    [sheetRows, existingRisks, users.data, t],
  );

  const reset = () => {
    setStep("upload");
    setFileName("");
    // Stryker disable next-line CallExpression: equivalent, the preview only shows after handleFile has set fresh rows, so stale rows are never read
    setSheetRows(null);
    setErrorKey("");
    // Stryker disable next-line CallExpression: equivalent, the result only shows on the done step, which handleApply enters with a fresh result
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    if (submit.isBusy()) return;
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setErrorKey("");
    setFileName(file.name);
    let rows: PpmRiskSheetRow[];
    try {
      rows = parsePpmRiskWorkbook(await file.arrayBuffer(), t as Translate);
    } catch {
      setErrorKey("grc:risks.import.parseError");
      return;
    }
    if (rows.length === 0) {
      setErrorKey("grc:risks.import.emptyFile");
      return;
    }
    setSheetRows(rows);
    setStep("preview");
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Stryker disable next-line OptionalChaining: equivalent, a file input's files is a FileList, never null
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const handleApply = () =>
    submit.run(async () => {
      // Stryker disable next-line ConditionalExpression: equivalent, Apply is disabled whenever plan is null (writable is 0), so handleApply never runs without a plan
      if (!plan) return;
      const outcome: ImportResult = { created: 0, updated: 0, failed: [] };
      for (const row of plan.rows) {
        if (row.kind !== "create" && row.kind !== "update") continue;
        try {
          if (row.kind === "create") {
            await api.post(`/ppm/initiatives/${initiativeId}/risks`, row.body);
            outcome.created += 1;
          } else {
            await api.patch(`/ppm/risks/${row.riskId}`, row.body);
            outcome.updated += 1;
          }
        } catch (e) {
          outcome.failed.push({
            sheetRow: row.sheetRow,
            title: row.title,
            message: e instanceof ApiError ? e.message : t("common:errors.generic"),
          });
        }
      }
      setResult(outcome);
      setStep("done");
      if (outcome.created + outcome.updated > 0) onImported();
    });

  const writable = plan ? plan.create + plan.update : 0;
  const busy = submit.busy;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{t("ppm:riskImportTitle")}</DialogTitle>
      <DialogContent dividers>
        {errorKey && (
          <Alert severity="error" sx={SX.alert}>
            {t(errorKey)}
          </Alert>
        )}
        {users.error && step !== "done" && (
          <Alert severity="error" sx={SX.alert}>
            {t("ppm:riskImportUsersError")}
          </Alert>
        )}

        {step === "upload" && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t("ppm:riskImportIntro")}
            </Typography>
            <Box>
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => downloadPpmRiskTemplate(t as Translate)}
                sx={SX.templateLink}
              >
                <MaterialSymbol icon="download" size={18} />
                {t("grc:risks.import.downloadTemplate")}
              </Link>
            </Box>
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="upload_file" size={18} />}
              // Stryker disable next-line OptionalChaining: equivalent, the input renders with this button, so the ref is set whenever it can be clicked
              onClick={() => fileRef.current?.click()}
              sx={SX.chooseFile}
            >
              {t("grc:risks.import.chooseFile")}
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
              data-testid="ppm-risk-import-file"
              onChange={onPickFile}
            />
          </Stack>
        )}

        {step === "preview" && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {fileName}
            </Typography>
            {!plan && !users.error && (
              <Typography variant="body2" color="text.secondary">
                {t("grc:risks.import.parsing")}
              </Typography>
            )}
            {plan && (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    color="success"
                    variant="outlined"
                    icon={<MaterialSymbol icon="add_circle" size={16} />}
                    label={t("grc:risks.import.willCreate", { count: plan.create })}
                  />
                  <Chip
                    color="info"
                    variant="outlined"
                    icon={<MaterialSymbol icon="edit" size={16} />}
                    label={t("ppm:riskImportWillUpdate", { count: plan.update })}
                  />
                  {plan.unchanged > 0 && (
                    <Chip
                      variant="outlined"
                      icon={<MaterialSymbol icon="check" size={16} />}
                      label={t("ppm:riskImportUnchanged", { count: plan.unchanged })}
                    />
                  )}
                  {plan.rejected > 0 && (
                    <Chip
                      color="error"
                      variant="outlined"
                      icon={<MaterialSymbol icon="error" size={16} />}
                      label={t("grc:risks.import.willFail", { count: plan.rejected })}
                    />
                  )}
                  {plan.warnings > 0 && (
                    <Chip
                      color="warning"
                      variant="outlined"
                      icon={<MaterialSymbol icon="warning" size={16} />}
                      label={t("grc:risks.import.warningCount", { count: plan.warnings })}
                    />
                  )}
                </Stack>
                {plan.rejected > 0 && (
                  <Alert severity="error">{t("grc:risks.import.errorsBlock")}</Alert>
                )}
                {writable === 0 && (
                  <Alert severity="info">{t("ppm:riskImportNothingToWrite")}</Alert>
                )}
                <List dense disablePadding aria-label={t("ppm:riskImportTitle")}>
                  {plan.rows.map((row) => {
                    const chip = KIND_CHIP[row.kind];
                    const detail = rowDetail(row, t as Translate);
                    return (
                      <ListItem
                        key={row.sheetRow}
                        disableGutters
                        data-kind={row.kind}
                        alignItems="flex-start"
                      >
                        <Chip
                          size="small"
                          color={chip.color}
                          label={t(chip.key)}
                          sx={SX.rowChip}
                        />
                        <ListItemText
                          primary={
                            <>
                              {t("grc:risks.import.rowLabel", { row: row.sheetRow + 1 })}
                              {row.title && " · "}
                              {row.title && <LinkifiedText text={row.title} />}
                            </>
                          }
                          secondary={detail || null}
                        />
                      </ListItem>
                    );
                  })}
                </List>
              </>
            )}
          </Stack>
        )}

        {
          // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent, result is non-null only on the done step (handleApply sets both, reset clears both)
          step === "done" && result && (
            <Stack spacing={2} alignItems="center" sx={SX.done}>
              <MaterialSymbol
                icon={result.failed.length > 0 ? "warning" : "check_circle"}
                size={48}
                color={
                  result.failed.length > 0 ? theme.palette.warning.main : theme.palette.success.main
                }
              />
              <Typography variant="h6">{t("ppm:riskImportDoneTitle")}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t("ppm:riskImportDoneSummary", {
                  created: result.created,
                  updated: result.updated,
                  failed: result.failed.length,
                })}
              </Typography>
              {result.failed.length > 0 && (
                <List dense disablePadding sx={SX.failedList}>
                  {result.failed.map((f) => (
                    <ListItem key={f.sheetRow} disableGutters>
                      <ListItemText
                        primary={
                          <>
                            {t("grc:risks.import.rowLabel", { row: f.sheetRow + 1 })}
                            {f.title && " · "}
                            {f.title && <LinkifiedText text={f.title} />}
                          </>
                        }
                        secondary={f.message}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          )
        }
      </DialogContent>
      <DialogActions>
        {step === "preview" && (
          <Button onClick={() => reset()} disabled={busy} sx={SX.action}>
            {t("common:actions.back")}
          </Button>
        )}
        <Box sx={SX.spacer} />
        <Button onClick={handleClose} disabled={busy} sx={SX.action}>
          {step === "done" ? t("common:actions.close") : t("common:actions.cancel")}
        </Button>
        {step === "preview" && (
          <Button
            variant="contained"
            onClick={() => void handleApply()}
            disabled={busy || writable === 0}
            startIcon={<MaterialSymbol icon="upload" size={18} />}
            sx={SX.action}
          >
            {busy ? t("ppm:riskImportWriting") : t("ppm:riskImportApply", { count: writable })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
