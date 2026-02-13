import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
import type { Notification, NotificationListResponse } from "@/types";

const NOTIFICATION_ICONS: Record<string, { icon: string; color: string }> = {
  todo_assigned: { icon: "assignment_ind", color: "#1976d2" },
  fact_sheet_updated: { icon: "edit_note", color: "#ed6c02" },
  comment_added: { icon: "comment", color: "#2e7d32" },
  quality_seal_changed: { icon: "verified", color: "#9c27b0" },
  soaw_sign_requested: { icon: "draw", color: "#d32f2f" },
  soaw_signed: { icon: "task_alt", color: "#2e7d32" },
  survey_request: { icon: "assignment", color: "#0288d1" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function NotificationBell({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
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
                type: (String(data.type ?? "fact_sheet_updated")) as Notification["type"],
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
    if (notif.link) {
      navigate(notif.link);
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
      <Tooltip title="Notifications">
        <IconButton
          sx={{ color: "#fff", ml: 0.5 }}
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
            Notifications
          </Typography>
          {unreadCount > 0 && (
            <Button
              size="small"
              sx={{ textTransform: "none", fontSize: "0.8rem" }}
              onClick={handleMarkAllRead}
            >
              Mark all read
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
              No notifications
            </Typography>
          </Box>
        ) : (
          <List dense sx={{ maxHeight: 420, overflow: "auto", py: 0 }}>
            {notifications.map((notif: Notification) => {
              const iconDef = NOTIFICATION_ICONS[notif.type] ?? {
                icon: "notifications",
                color: "#666",
              };
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
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          sx={{ fontSize: "0.7rem" }}
                        >
                          {notif.created_at ? timeAgo(notif.created_at) : ""}
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
    </>
  );
}
