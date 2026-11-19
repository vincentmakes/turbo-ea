import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { metricName, pairName } from "@/components/licensing/licensePairs";
import { useLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB } from "@/lib/attachmentFormats";
import type { LicenseImportIssue, LicenseImportResult } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

const TYPE_REASONS = [
  "type_not_in_metric",
  "unknown_license_type",
  "ambiguous_license_type",
  "archived_license_type",
];

/** Preview (`dry_run=true`), then apply (`dry_run=false`, the same file: the server revalidates). */
export default function LicensingImportDialog({ open, onClose, onApplied }: Props) {
  const { t, i18n } = useTranslation(["reports", "common", "cards"]);
  const { metrics: catalogue } = useLicenseCatalogue(open);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LicenseImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setFile(null);
    setPreview(null);
    setError("");
    onClose();
  };

  const pick = async (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    setPreview(null);
    setFile(null);
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      setError(t("licensing.import.notXlsx"));
      return;
    }
    if (f.size > MAX_ATTACHMENT_BYTES) {
      setError(t("licensing.import.tooBig", { mb: MAX_ATTACHMENT_MB }));
      return;
    }
    setError("");
    setBusy(true);
    try {
      setPreview(await api.upload<LicenseImportResult>("/licenses/import?dry_run=true", f));
      setFile(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await api.upload<LicenseImportResult>("/licenses/import?dry_run=false", file);
      onApplied();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // The row's pair as `Metric: Type`: labels from the catalogue for what it knows, the file's own
  // text for what it does not. Only the refusals about a license type name a pair.
  const detailOf = (i: LicenseImportIssue): string => {
    const suffix = ` (${t("cards:licensing.archived")})`;
    const locale = i18n.language;
    if (i.reason === "archived_license_metric")
      return i.metric ? metricName(catalogue, i.metric, locale, suffix) : i.detail;
    if (!TYPE_REASONS.includes(i.reason) || !i.metric) return i.detail;
    if (!i.detail) return metricName(catalogue, i.metric, locale, suffix);
    const owner = catalogue.find((m) => m.key === i.metric);
    return owner?.types.some((x) => x.key === i.detail)
      ? pairName(catalogue, i.metric, i.detail, locale, suffix)
      : `${metricName(catalogue, i.metric, locale, suffix)}: ${i.detail}`;
  };

  const issues = (list: LicenseImportIssue[]) => (
    <Table size="small" sx={{ mb: 2 }}>
      <TableHead>
        <TableRow>
          <TableCell>{t("licensing.import.colRow")}</TableCell>
          <TableCell>{t("licensing.import.colComponent")}</TableCell>
          <TableCell>{t("licensing.import.colReason")}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {list.map((i, n) => {
          const detail = detailOf(i);
          return (
            <TableRow key={`${i.row}-${n}`}>
              <TableCell>{i.row}</TableCell>
              <TableCell>{i.component}</TableCell>
              <TableCell>
                {t(`licensing.import.reasons.${i.reason}`, { defaultValue: i.reason })}
                {detail ? ` (${detail})` : ""}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>{t("licensing.import.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("licensing.import.hint")}
        </Typography>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Button variant="outlined" onClick={() => fileRef.current?.click()} disabled={busy}>
            {t("licensing.import.choose")}
          </Button>
          {file && <Typography variant="body2">{file.name}</Typography>}
          {busy && <CircularProgress size={20} />}
        </Box>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {preview && (
          <>
            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <Chip
                color="success"
                label={t("licensing.import.matched", { count: preview.matched })}
              />
              <Chip
                color={preview.skipped.length ? "warning" : "default"}
                label={t("licensing.import.skippedCount", { count: preview.skipped.length })}
              />
            </Box>
            {preview.skipped.length > 0 && issues(preview.skipped)}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t("common:actions.cancel")}</Button>
        {preview && (
          <Button
            variant="contained"
            onClick={() => void apply()}
            disabled={busy || preview.matched === 0}
          >
            {t("licensing.import.apply", { count: preview.matched })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
