import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useEventStream } from "@/hooks/useEventStream";
import { formatDateWith, getCachedDateFormat } from "@/hooks/useDateFormat";
import { NOTIFICATION_TYPE_COLORS } from "@/theme/tokens";
import type { Notification, NotificationListResponse } from "@/types";

import type { ReleaseNotesVariant } from "@/components/ReleaseNotesDialog";

const ReleaseNotesDialog = lazy(() => import("@/components/ReleaseNotesDialog"));

const NOTIFICATION_ICONS: Record<string, { icon: string; color: string }> = {
  todo_assigned: { icon: "assignment_ind", color: NOTIFICATION_TYPE_COLORS.todo_assigned },
  task_assigned: { icon: "task", color: NOTIFICATION_TYPE_COLORS.task_assigned },
  card_updated: { icon: "edit_note", color: NOTIFICATION_TYPE_COLORS.card_updated },
  comment_added: { icon: "comment", color: NOTIFICATION_TYPE_COLORS.comment_added },
  approval_status_changed: {
    icon: "verified",
    color: NOTIFICATION_TYPE_COLORS.approval_status_changed,
  },
  soaw_sign_requested: { icon: "draw", color: NOTIFICATION_TYPE_COLORS.soaw_sign_requested },
  soaw_signed: { icon: "task_alt", color: NOTIFICATION_TYPE_COLORS.soaw_signed },
  survey_request: { icon: "assignment", color: NOTIFICATION_TYPE_COLORS.survey_request },
  app_update_available: {
    icon: "system_update_alt",
    color: NOTIFICATION_TYPE_COLORS.app_update_available,
  },
  app_updated: { icon: "auto_awesome", color: NOTIFICATION_TYPE_COLORS.app_updated },
  // Both carry a relative link to the Store tab, so they follow the default
  // navigate path — no DIALOG_TYPES entry, no external-link glyph.
  extension_available: {
    icon: "extension",
    color: NOTIFICATION_TYPE_COLORS.extension_available,
  },
  extension_update_available: {
    icon: "extension",
    color: NOTIFICATION_TYPE_COLORS.extension_update_available,
  },
};

/** Notification links are usually in-app routes, but some are absolute URLs.
 *  Feeding one of those to react-router's `navigate` would treat it as a
 *  relative path and land on a broken route, so they open in a new tab. */
function isExternalLink(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

/** Types the bell handles itself instead of following `link`, and which
 *  flavour of the release-notes dialog each one opens.
 *
 *  An update-available notice carries the GitHub release URL — that is what an
 *  email copy of the notification needs — but in the app the notes open in a
 *  dialog rather than sending an administrator off-site. The post-upgrade
 *  notice has no link at all: its notes come from the changelog bundled in the
 *  image. */
const DIALOG_TYPES: Record<string, ReleaseNotesVariant> = {
  app_update_available: "available",
  app_updated: "installed",
};

function opensInApp(notif: Notification): boolean {
  return notif.type in DIALOG_TYPES;
}

/** What the dialog needs to show *this* notification rather than the newest one. */
type OpenReleaseNotes = {
  variant: ReleaseNotesVariant;
  version?: string;
  fromVersion?: string;
};

/** `data` is JSONB coming back as `Record<string, unknown>`, so narrow it. */
function readVersion(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value ? value : undefined;
}

/** The versions a notification is *about*.
 *
 *  Without these the dialog can only ask "what is newest?", which is right for
 *  the notification that just arrived and wrong for every one it joins in the
 *  bell — a notice about 2.55.0 would open 2.61.0's notes. Older rows predating
 *  the `data` payload yield `undefined` and fall back to that old behaviour. */
function releaseNotesTarget(notif: Notification): OpenReleaseNotes {
  const variant = DIALOG_TYPES[notif.type];
  return variant === "installed"
    ? {
        variant,
        version: readVersion(notif.data, "to_version"),
        fromVersion: readVersion(notif.data, "from_version"),
      }
    : { variant, version: readVersion(notif.data, "latest_version") };
}

/** Whether clicking this row leaves Turbo EA, which is what the trailing
 *  open-in-new glyph announces. */
function leavesTheApp(notif: Notification): boolean {
  return !!notif.link && isExternalLink(notif.link) && !opensInApp(notif);
}

function timeAgo(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("common:time.justNow");
  if (mins < 60) return t("common:time.minutesAgo", { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("common:time.hoursAgo", { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 7) return t("common:time.daysAgo", { count: days });
  return formatDateWith(getCachedDateFormat(), dateStr);
}

export default function NotificationBell({
  userId,
  color,
}: {
  userId: string;
  /** Icon color — pass the navbar's configured text color (#852). Defaults to
   *  white, the color of the built-in navy navbar. */
  color?: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation(["notifications", "common"]);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<OpenReleaseNotes | null>(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.get<{ count: number }>("/notifications/unread-count");
      setUnreadCount(res.count);
    } catch {
      // ignore
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<NotificationListResponse>(
        "/notifications?page_size=20"
      );
      setNotifications(res.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Listen for real-time notification events
  useEventStream(
    useCallback(
      (event: Record<string, unknown>) => {
        if (event.event === "notification.created") {
          const data = event.data as Record<string, unknown> | undefined;
          if (data && data.user_id === userIdRef.current) {
            setUnreadCount((c: number) => c + 1);
            setNotifications((prev: Notification[]) => {
              const newNotif: Notification = {
                id: String(data.id ?? ""),
                user_id: String(data.user_id ?? ""),
                type: (String(data.type ?? "card_updated")) as Notification["type"],
                title: String(data.title ?? ""),
                message: String(data.message ?? ""),
                link: data.link ? String(data.link) : undefined,
                is_read: false,
                created_at: new Date().toISOString(),
              };
              return [newNotif, ...prev.slice(0, 19)];
            });
          }
        }
      },
      []
    )
  );

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
    fetchNotifications();
  };

  const handleClose = () => setAnchorEl(null);

  const handleClick = async (notif: Notification) => {
    if (!notif.is_read) {
      try {
        await api.patch(`/notifications/${notif.id}/read`);
        setNotifications((prev: Notification[]) =>
          prev.map((n: Notification) => (n.id === notif.id ? { ...n, is_read: true } : n))
        );
        setUnreadCount((c: number) => Math.max(0, c - 1));
      } catch {
        // ignore
      }
    }
    handleClose();
    if (opensInApp(notif)) {
      setReleaseNotes(releaseNotesTarget(notif));
      return;
    }
    if (notif.link) {
      if (isExternalLink(notif.link)) {
        window.open(notif.link, "_blank", "noopener,noreferrer");
      } else {
        navigate(notif.link);
      }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.post("/notifications/mark-all-read");
      setNotifications((prev: Notification[]) => prev.map((n: Notification) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const open = Boolean(anchorEl);

  return (
    <>
      <Tooltip title={t("title")}>
        <IconButton
          sx={{ color: color ?? "#fff", ml: 0.5 }}
          onClick={handleOpen}
        >
          <Badge
            badgeContent={unreadCount}
            color="error"
            max={99}
            invisible={unreadCount === 0}
          >
            <MaterialSymbol icon="notifications" size={24} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: { width: 400, maxHeight: 520 },
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            px: 2,
            py: 1.5,
          }}
        >
          <Typography sx={{ fontWeight: 700, flex: 1 }}>
            {t("title")}
          </Typography>
          {unreadCount > 0 && (
            <Button
              size="small"
              sx={{ textTransform: "none", fontSize: "0.8rem" }}
              onClick={handleMarkAllRead}
            >
              {t("markAllRead")}
            </Button>
          )}
        </Box>
        <Divider />

        {/* Notification list */}
        {loading && notifications.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : notifications.length === 0 ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <MaterialSymbol icon="notifications_off" size={32} color="#999" />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("noNotifications")}
            </Typography>
          </Box>
        ) : (
          <List dense sx={{ maxHeight: 420, overflow: "auto", py: 0 }}>
            {notifications.map((notif: Notification) => {
              const iconDef = NOTIFICATION_ICONS[notif.type] ?? {
                icon: "notifications",
                color: "text.secondary",
              };
              // Trailing marker for rows that do more than mark themselves
              // read. `open_in_new` is reserved for rows that genuinely leave
              // the app; one that opens a dialog gets the expand glyph.
              const trailing = leavesTheApp(notif)
                ? { icon: "open_in_new", label: t("opensExternally") }
                : opensInApp(notif)
                  ? { icon: "open_in_full", label: t("opensReleaseNotes") }
                  : null;
              return (
                <ListItemButton
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  sx={{
                    bgcolor: notif.is_read ? "transparent" : "rgba(25, 118, 210, 0.04)",
                    borderLeft: notif.is_read
                      ? "3px solid transparent"
                      : "3px solid #1976d2",
                    py: 1.5,
                    alignItems: "flex-start",
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                    <MaterialSymbol
                      icon={iconDef.icon}
                      size={20}
                      color={iconDef.color}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: notif.is_read ? 400 : 600,
                          lineHeight: 1.3,
                        }}
                      >
                        {notif.title}
                      </Typography>
                    }
                    secondary={
                      <>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", lineHeight: 1.4, mt: 0.25 }}
                        >
                          {notif.message.length > 100
                            ? notif.message.slice(0, 100) + "..."
                            : notif.message}
                          {trailing && (
                            <Box
                              component="span"
                              role="img"
                              aria-label={trailing.label}
                              title={trailing.label}
                              sx={{
                                display: "inline-flex",
                                verticalAlign: "text-bottom",
                                ml: 0.5,
                              }}
                            >
                              <MaterialSymbol icon={trailing.icon} size={14} />
                            </Box>
                          )}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          sx={{ fontSize: "0.7rem" }}
                        >
                          {notif.created_at ? timeAgo(notif.created_at, t) : ""}
                        </Typography>
                      </>
                    }
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </Popover>

      {/* Lazy: the bell renders on every page, the dialog opens on a handful
          of clicks a year. */}
      {releaseNotes && (
        <Suspense fallback={null}>
          <ReleaseNotesDialog
            open
            variant={releaseNotes.variant}
            version={releaseNotes.version}
            fromVersion={releaseNotes.fromVersion}
            onClose={() => setReleaseNotes(null)}
          />
        </Suspense>
      )}
    </>
  );
}
