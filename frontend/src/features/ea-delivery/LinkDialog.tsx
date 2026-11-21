/**
 * The rich-text editor's link dialog: the address to link to, and, when
 * nothing was selected, the text to show. Opened from the toolbar's link
 * button or Ctrl/Cmd+K. It holds no editor: the editor saves the selection
 * when it opens the dialog and puts it (and the focus) back when it closes,
 * as for the mention dialog.
 *
 * The address goes through `normaliseLinkHref`: `example.com` becomes
 * `https://example.com`, `ann@example.com` becomes `mailto:…`, and anything
 * the app would not keep as a link (another scheme, a relative address) is
 * refused with an inline message instead of being applied.
 */
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";

import { normaliseLinkHref } from "@/lib/linkify";

export interface LinkDialogResult {
  href: string;
  /** Only when the dialog asked for it: the text to insert as the link. */
  text?: string;
}

interface Props {
  open: boolean;
  /** The address the field starts with: the link being edited, or "". */
  href: string;
  /** An existing link is being edited: offers "Remove link" and "Open in new tab". */
  editing: boolean;
  /** Nothing was selected outside a link: also ask for the text to show. */
  askText: boolean;
  onCancel: () => void;
  onApply: (result: LinkDialogResult) => void;
  onRemove: () => void;
}

export default function LinkDialog({ open, href, editing, askText, onCancel, onApply, onRemove }: Props) {
  // A fresh form on each opening, so the fields start from the props; the
  // last one stays on screen while the dialog fades out.
  const [opening, setOpening] = useState({ open, count: 0 });
  if (opening.open !== open) setOpening({ open, count: opening.count + (open ? 1 : 0) });
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth disableRestoreFocus>
      <LinkForm
        key={opening.count}
        href={href}
        editing={editing}
        askText={askText}
        onCancel={onCancel}
        onApply={onApply}
        onRemove={onRemove}
      />
    </Dialog>
  );
}

function LinkForm({
  href,
  editing,
  askText,
  onCancel,
  onApply,
  onRemove,
}: Omit<Props, "open">) {
  const { t } = useTranslation(["delivery", "common"]);
  const [url, setUrl] = useState(href);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const empty = url.trim() === "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (empty) return;
    const normalised = normaliseLinkHref(url);
    if (normalised === null) {
      setInvalid(true);
      return;
    }
    if (!askText) {
      onApply({ href: normalised });
      return;
    }
    // Left empty, the address itself is the text.
    onApply({ href: normalised, text: text.trim() ? text : normalised });
  };

  const openInNewTab = () => {
    const normalised = normaliseLinkHref(url);
    if (normalised === null) {
      setInvalid(true);
      return;
    }
    window.open(normalised, "_blank", "noopener,noreferrer");
  };

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <DialogTitle>{t("richText.link")}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          sx={{ mt: 1 }}
          label={t("richText.linkUrl")}
          placeholder="https://"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setInvalid(false);
          }}
          error={invalid}
          helperText={invalid ? t("richText.linkInvalid") : undefined}
          slotProps={{ htmlInput: { "data-testid": "link-url" } }}
        />
        {askText && (
          <TextField
            fullWidth
            size="small"
            label={t("richText.linkText")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { "data-testid": "link-text" } }}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap" }}>
        {editing && (
          <>
            <Button color="error" onClick={onRemove}>
              {t("richText.linkRemove")}
            </Button>
            <Button onClick={openInNewTab} disabled={empty}>
              {t("common:actions.openInNewTab")}
            </Button>
            <Box sx={{ flex: 1 }} />
          </>
        )}
        <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
        <Button type="submit" variant="contained" disabled={empty}>
          {t("common:actions.apply")}
        </Button>
      </DialogActions>
    </Box>
  );
}
