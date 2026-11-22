import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/api/client";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB } from "@/lib/attachmentFormats";
import type { CostImportResult } from "@/types";

export default function CostImportDialog({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { t } = useTranslation(["reports", "common"]);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CostImportResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    setFile(null);
    setResult(null);
    setApplied(false);
    setError("");
    onClose();
  };
  const pick = async (f: File) => {
    setFile(null);
    setResult(null);
    setApplied(false);
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      setError(t("cost.import.notXlsx"));
      return;
    }
    if (f.size > MAX_ATTACHMENT_BYTES) {
      setError(t("cost.import.tooBig", { mb: MAX_ATTACHMENT_MB }));
      return;
    }
    setError("");
    setBusy(true);
    try {
      setResult(await api.upload<CostImportResult>("/costs/import?dry_run=true", f));
      setFile(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const showApplyError = (e: unknown) => {
    if (
      e instanceof ApiError &&
      typeof e.detail === "object" &&
      e.detail !== null &&
      "code" in e.detail &&
      e.detail.code === "cost_import_write_failed"
    ) {
      setError(t("cost.import.writeFailed"));
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
  };
  const apply = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.upload<CostImportResult>("/costs/import?dry_run=false", file);
      setResult(response);
      setApplied(true);
      if (response.applied > 0) onApplied();
    } catch (e) {
      showApplyError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : close} maxWidth="md" fullWidth>
      <DialogTitle>{t("cost.import.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t("cost.import.hint")}
        </Typography>
        <Button component="a" href="/api/v1/costs/import/template" target="_blank" rel="noopener" sx={{ mb: 2 }}>
          {t("cost.import.template")}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = "";
            if (selected) void pick(selected);
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Button variant="outlined" onClick={() => input.current?.click()} disabled={busy}>
            {t("cost.import.choose")}
          </Button>
          {file && <Typography variant="body2">{file.name}</Typography>}
          {busy && <CircularProgress size={20} />}
        </Box>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {result && (
          <>
            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <Chip
                label={
                  applied
                    ? t("cost.import.applied", { count: result.applied })
                    : t("cost.import.matched", { count: result.matched })
                }
              />
              <Chip label={t("cost.import.skipped", { count: result.skipped.length })} />
            </Box>
            {!applied && result.clears_renewal_count > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t("cost.import.clearsRenewal", { count: result.clears_renewal_count })}
              </Alert>
            )}
            {result.skipped.length > 0 && (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("cost.import.row")}</TableCell>
                    <TableCell>{t("cost.import.reason")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.skipped.map((issue, i) => (
                    <TableRow key={`${issue.row}-${i}`}>
                      <TableCell>{issue.row}</TableCell>
                      <TableCell>
                        {t(`cost.import.reasons.${issue.reason}`, { defaultValue: issue.reason })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {t("common:actions.close")}
        </Button>
        {result && !applied && (
          <Button
            variant="contained"
            onClick={() => void apply()}
            disabled={busy || result.matched === 0}
          >
            {t("cost.import.apply", { count: result.matched })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
