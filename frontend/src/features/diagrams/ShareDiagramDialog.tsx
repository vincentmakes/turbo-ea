import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DialogContentText from "@mui/material/DialogContentText";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface PublishState {
  is_published: boolean;
  public_slug: string | null;
  access_mode: "public" | "sso";
  allowed_email_domains: string[];
}

interface Props {
  open: boolean;
  diagramId: string;
  diagramName: string;
  initial: PublishState;
  onClose: () => void;
  onChange?: (state: PublishState) => void;
}

/**
 * Publish a diagram as a read-only link that renders without an app session,
 * so it can be embedded in a wiki page (discussion #905).
 *
 * The dialog exposes the two things the publisher genuinely decides — whether
 * it is shared at all, and who can open it — plus the two strings they actually
 * need to paste. Everything else about the diagram is edited where diagrams are
 * edited; this is only about exposure.
 */
export default function ShareDiagramDialog({
  open,
  diagramId,
  diagramName,
  initial,
  onClose,
  onChange,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const [state, setState] = useState<PublishState>(initial);
  const [mode, setMode] = useState<"public" | "sso">(initial.access_mode);
  const [domains, setDomains] = useState(initial.allowed_email_domains.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"url" | "iframe" | null>(null);

  useEffect(() => {
    if (open) {
      setState(initial);
      setMode(initial.access_mode);
      setDomains(initial.allowed_email_domains.join(", "));
      setError("");
      setCopied(null);
    }
  }, [open, initial]);

  const embedUrl = state.public_slug
    ? `${window.location.origin}/embed/diagram/${state.public_slug}`
    : "";
  const iframeSnippet = embedUrl
    ? `<iframe src="${embedUrl}" width="100%" height="600" style="border:none" ` +
      `title="${diagramName.replace(/"/g, "&quot;")}"></iframe>`
    : "";

  const apply = useCallback(
    async (publish: boolean) => {
      setSaving(true);
      setError("");
      try {
        const next = publish
          ? await api.post<PublishState>(`/diagrams/${diagramId}/publish`, {
              access_mode: mode,
              allowed_email_domains: domains
                .split(",")
                .map((d) => d.trim())
                .filter(Boolean),
            })
          : await api.delete<PublishState>(`/diagrams/${diagramId}/publish`);
        setState(next);
        setMode(next.access_mode);
        setDomains(next.allowed_email_domains.join(", "));
        onChange?.(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common:errors.generic"));
      } finally {
        setSaving(false);
      }
    },
    [diagramId, mode, domains, onChange, t],
  );

  const copy = useCallback((text: string, which: "url" | "iframe") => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(which),
      () => setCopied(null),
    );
  }, []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("share.title")}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{t("share.description")}</DialogContentText>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <FormControlLabel
          control={
            <Switch
              checked={state.is_published}
              disabled={saving}
              onChange={(e) => apply(e.target.checked)}
            />
          }
          label={t("share.publishToggle")}
        />

        {state.is_published && (
          <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              select
              size="small"
              label={t("share.accessMode")}
              value={mode}
              disabled={saving}
              onChange={(e) => setMode(e.target.value as "public" | "sso")}
              helperText={
                mode === "public" ? t("share.mode.publicHelp") : t("share.mode.ssoHelp")
              }
            >
              <MenuItem value="public">{t("share.mode.public")}</MenuItem>
              <MenuItem value="sso">{t("share.mode.sso")}</MenuItem>
            </TextField>

            {mode === "sso" && (
              <TextField
                size="small"
                label={t("share.domains")}
                placeholder="company.com, partner.com"
                value={domains}
                disabled={saving}
                onChange={(e) => setDomains(e.target.value)}
                helperText={t("share.domainsHelp")}
              />
            )}

            {(mode !== state.access_mode ||
              domains !== state.allowed_email_domains.join(", ")) && (
              <Box>
                <Button
                  size="small"
                  variant="contained"
                  disabled={saving}
                  onClick={() => apply(true)}
                >
                  {t("share.applyAccess")}
                </Button>
              </Box>
            )}

            <CopyRow
              label={t("share.linkLabel")}
              value={embedUrl}
              copied={copied === "url"}
              onCopy={() => copy(embedUrl, "url")}
              copyTitle={t("share.copy")}
            />
            <CopyRow
              label={t("share.iframeLabel")}
              value={iframeSnippet}
              copied={copied === "iframe"}
              onCopy={() => copy(iframeSnippet, "iframe")}
              copyTitle={t("share.copy")}
            />

            <Alert severity="info" icon={<MaterialSymbol icon="info" size={18} />}>
              {t("share.embedNote")}
            </Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
      {saving && (
        <Box sx={{ position: "absolute", top: 12, right: 12 }}>
          <CircularProgress size={18} />
        </Box>
      )}
    </Dialog>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
  copyTitle,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  copyTitle: string;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
      <TextField
        size="small"
        label={label}
        value={value}
        fullWidth
        slotProps={{ input: { readOnly: true } }}
      />
      <Tooltip title={copyTitle}>
        <IconButton onClick={onCopy} sx={{ mt: 0.5 }}>
          <MaterialSymbol icon={copied ? "check" : "content_copy"} size={18} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
