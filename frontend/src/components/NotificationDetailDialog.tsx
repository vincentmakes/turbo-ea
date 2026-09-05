import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";
import { formatDateTimeWith, getCachedDateFormat } from "@/hooks/useDateFormat";
import {
  ExtensionSlot,
  canOpenExtensionPath,
  getExtensionDisplayName,
} from "@/lib/extensionHost";
import { canAccessPath } from "@/lib/routePermissions";
import type { Notification } from "@/types";

/** The bell's details view for a notification that asked to be opened
 *  in-app (`data.open === "detail"`, stamped by the backend notify bridge)
 *  rather than followed to its link.
 *
 *  Why a dialog: a notification's `link` may point somewhere only some
 *  recipients can go — an extension page behind its own permission — while
 *  the message itself is for everyone it was sent to. The full text always
 *  renders; the link and the related card are offered as buttons only when
 *  the viewer may open them (an unreachable link is hidden, never disabled
 *  or dead). The sending extension may add its own rendering through the
 *  `notification.detail` slot, scoped to the extension named in `data.ext`. */
export default function NotificationDetailDialog({
  notification,
  onClose,
  onNavigate,
}: {
  notification: Notification;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation("notifications");
  const { user } = useAuthContext();
  const perms = user?.permissions;
  const data = notification.data ?? {};
  const ext = typeof data.ext === "string" ? data.ext : undefined;
  const link = notification.link;
  const cardPath = notification.card_id ? `/cards/${notification.card_id}` : undefined;

  const canOpenCard = !!cardPath && canAccessPath(perms, cardPath);
  const linkIsExternal = !!link && /^https?:\/\//i.test(link);
  const canOpenLink =
    !!link &&
    link !== cardPath &&
    (linkIsExternal ||
      (link.startsWith("/ext/")
        ? canOpenExtensionPath(link, perms)
        : canAccessPath(perms, link.split(/[?#]/, 1)[0] ?? link)));

  const go = (path: string) => {
    onClose();
    onNavigate(path);
  };
  const openLink = () => {
    if (!link) return;
    if (linkIsExternal) {
      window.open(link, "_blank", "noopener,noreferrer");
      onClose();
      return;
    }
    go(link);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" disableRestoreFocus>
      <DialogTitle sx={{ pb: 0.5 }}>{notification.title}</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {ext ? t("detail.sentBy", { extension: getExtensionDisplayName(ext) }) : null}
          {ext && notification.created_at ? " · " : null}
          {notification.created_at
            ? formatDateTimeWith(getCachedDateFormat(), notification.created_at)
            : null}
        </Typography>
        {notification.message ? (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {notification.message}
          </Typography>
        ) : null}
        {ext ? (
          <Box sx={{ mt: notification.message ? 2 : 0 }}>
            <Divider sx={{ mb: 1.5 }} />
            <ExtensionSlot
              name="notification.detail"
              ownerExtKey={ext}
              context={{
                id: notification.id,
                type: notification.type,
                title: notification.title,
                message: notification.message,
                link: notification.link,
                data,
                cardId: notification.card_id,
                createdAt: notification.created_at,
              }}
            />
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
        {canOpenCard && cardPath ? (
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="article" size={18} />}
            onClick={() => go(cardPath)}
          >
            {t("detail.openCard")}
          </Button>
        ) : null}
        {canOpenLink ? (
          <Button
            variant="contained"
            startIcon={
              <MaterialSymbol icon={linkIsExternal ? "open_in_new" : "arrow_forward"} size={18} />
            }
            onClick={openLink}
          >
            {t("detail.open")}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
