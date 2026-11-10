/**
 * The files attached to a decision. Anyone who can read the decision can
 * download them; a draft's editors can upload and delete. Files are content:
 * they lock with the decision when it is sent for review, and a revision
 * carries them over.
 *
 * Upload checks mirror the card Resources tab (the same accepted formats, size
 * cap and messages); the backend still proves the bytes match the extension.
 */
import { useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MIME_ICONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_MB,
  hasAcceptedExtension,
} from "@/lib/attachmentFormats";
import { formatBytes } from "@/lib/formatBytes";
import type { DecisionFile } from "@/types";

/** Why a picked file is refused before upload (`null` = send it). */
export function uploadRefusal(file: Pick<File, "name" | "size">): "type" | "size" | null {
  if (!hasAcceptedExtension(file.name)) return "type";
  if (file.size > MAX_ATTACHMENT_BYTES) return "size";
  return null;
}

export const filesPath = (adrId: string) => `/adr/${adrId}/files`;
export const fileDownloadPath = (adrId: string, fileId: string) =>
  `/adr/${adrId}/files/${fileId}/download`;

export interface DecisionFilesSectionProps {
  adrId: string;
  /** The files the decision detail already carried, shown until the list loads. */
  files?: DecisionFile[];
  /** Upload and delete are offered (a draft, to its editors). */
  editable: boolean;
  /** The decision is locked: say why the list cannot change. */
  locked?: boolean;
  /** Fetch the list (`false` on a page that shows `files` as given). */
  live?: boolean;
}

export default function DecisionFilesSection({
  adrId,
  files,
  editable,
  locked = false,
  live = true,
}: DecisionFilesSectionProps) {
  const { t } = useTranslation(["delivery", "cards", "admin", "common"]);
  const { formatDate } = useDateFormat();
  const { fileUploadsEnabled } = useFileUploadsEnabled();
  const { data, refetch } = useApiQuery<DecisionFile[]>(live ? filesPath(adrId) : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<DecisionFile | null>(null);

  const list = Array.isArray(data) ? data : (files ?? []);
  const canUpload = editable && fileUploadsEnabled;
  const unit = (u: string) => t(`admin:resources.units.${u}`);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    const refusal = uploadRefusal(file);
    if (refusal === "type") {
      setError(t("cards:resources.invalidType"));
      return;
    }
    if (refusal === "size") {
      setError(t("cards:resources.fileTooLarge", { size: MAX_ATTACHMENT_MB }));
      return;
    }
    setBusy(true);
    try {
      await api.upload(filesPath(adrId), file, "file");
      setError("");
      refetch();
    } catch (err) {
      // The detail names the real reason (wrong bytes, uploads switched off).
      const detail = err instanceof Error ? err.message : "";
      setError(detail || t("adr.files.uploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const target = confirming;
    setConfirming(null);
    if (!target) return;
    try {
      await api.delete(`${filesPath(adrId)}/${target.id}`);
      setError("");
      refetch();
    } catch {
      setError(t("adr.files.deleteFailed"));
    }
  };

  const handleDownload = (f: DecisionFile) => {
    api
      .getRaw(fileDownloadPath(adrId, f.id))
      .then(async (res) => {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError(t("adr.files.downloadFailed")));
  };

  return (
    <Box data-testid="decision-files">
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {locked && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("adr.files.lockedHint")}
        </Typography>
      )}
      {list.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("adr.files.empty")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {list.map((f) => (
            <ListItem
              key={f.id}
              disableGutters
              secondaryAction={
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  <Tooltip title={t("cards:resources.downloadFile")}>
                    <IconButton
                      size="small"
                      aria-label={t("cards:resources.downloadFile")}
                      onClick={() => handleDownload(f)}
                    >
                      <MaterialSymbol icon="download" size={18} />
                    </IconButton>
                  </Tooltip>
                  {editable && (
                    <Tooltip title={t("cards:resources.deleteFile")}>
                      <IconButton
                        size="small"
                        aria-label={t("cards:resources.deleteFile")}
                        onClick={() => setConfirming(f)}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              }
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <MaterialSymbol icon={ATTACHMENT_MIME_ICONS[f.mime_type] ?? "description"} size={20} />
              </ListItemIcon>
              <ListItemText
                primary={f.name}
                secondary={[
                  formatBytes(f.size, unit),
                  f.created_by?.display_name
                    ? t("adr.files.uploadedBy", {
                        name: f.created_by.display_name,
                        date: formatDate(f.created_at),
                      })
                    : t("adr.files.uploadedOn", { date: formatDate(f.created_at) }),
                ].join(" · ")}
              />
            </ListItem>
          ))}
        </List>
      )}
      {canUpload && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={ATTACHMENT_ACCEPT}
            data-testid="decision-file-input"
            onChange={handleSelect}
          />
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="upload" size={18} />}
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            sx={{ textTransform: "none" }}
          >
            {t("cards:resources.uploadFile")}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t("cards:resources.maxSize", { size: MAX_ATTACHMENT_MB })}
          </Typography>
        </Box>
      )}

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        disableRestoreFocus
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("adr.files.deleteTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t("adr.files.deleteConfirm", { name: confirming?.name ?? "" })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>{t("common:actions.cancel")}</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
