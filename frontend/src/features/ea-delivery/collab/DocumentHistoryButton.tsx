/**
 * The History button at the top of a saved decision's or SoAW's page (its
 * editor and its preview), beside the revision strip where one is shown.
 * It opens the document's History (`DocumentHistoryDialog`), mounted only
 * while open so the timeline is read each time it opens; after a restore it
 * says so here, since the view has closed.
 *
 * `compact` matches the icon-only header buttons a page shows on a phone.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DocumentOwner } from "@/types";
import DocumentHistoryDialog from "./DocumentHistoryDialog";

interface Props<D> {
  owner: DocumentOwner;
  /** What the document is called, under the view's title. */
  label: string;
  /** The document's status: restore is offered on a draft only. */
  status: string;
  /** Re-read the timeline when this changes while the view is open. */
  refreshKey?: string | number;
  /** Whether the page holds edits it has not saved (a restore discards them). */
  isDirty?: () => boolean;
  /** The document as a restore left it: the page applies it as it applies a save. */
  onRestored?: (detail: D) => void;
  compact?: boolean;
}

export default function DocumentHistoryButton<D>({
  owner,
  label,
  status,
  refreshKey,
  isDirty,
  onRestored,
  compact = false,
}: Props<D>) {
  const { t } = useTranslation("delivery");
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);

  return (
    <>
      {compact ? (
        <Tooltip title={t("collab.history.open")}>
          <IconButton className="no-print" aria-label={t("collab.panel.history")} onClick={() => setOpen(true)}>
            <MaterialSymbol icon="history" size={20} />
          </IconButton>
        </Tooltip>
      ) : (
        <Button
          size="small"
          className="no-print"
          startIcon={<MaterialSymbol icon="history" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => setOpen(true)}
        >
          {t("collab.panel.history")}
        </Button>
      )}
      {open && (
        <DocumentHistoryDialog<D>
          owner={owner}
          label={label}
          status={status}
          refreshKey={refreshKey}
          isDirty={isDirty}
          onRestored={(detail) => {
            onRestored?.(detail);
            setRestored(true);
          }}
          onClose={() => setOpen(false)}
        />
      )}
      <Snackbar
        open={restored}
        autoHideDuration={4000}
        onClose={() => setRestored(false)}
        message={t("collab.history.restored")}
      />
    </>
  );
}
