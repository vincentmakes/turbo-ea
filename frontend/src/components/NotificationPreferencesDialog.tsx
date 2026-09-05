import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import { api } from "@/api/client";
import { ExtensionSlot, useExtensionSlots } from "@/lib/extensionHost";
import { useAuthContext } from "@/hooks/AuthContext";
import type { NotificationPreferences, NotificationTypeSpec } from "@/types";

/**
 * `todo_assigned` -> `preferences.todoAssigned`.
 *
 * The row list comes from the server so the two can no longer drift, but the
 * labels stay in the frontend bundle where the translations live. A type with
 * no label yet falls back to its key rather than rendering blank, which makes
 * a missing translation obvious instead of invisible.
 */
function labelKeyFor(typeKey: string): string {
  const camel = typeKey.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return `preferences.${camel}`;
}

/** A column an extension delivers notifications on, ready to render. */
interface ChannelColumn {
  key: string;
  label: string;
  order: number;
}

/** What a `notification.preferences.channels` data slot may return. */
interface ChannelSlotMeta {
  label?: string;
  order?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NotificationPreferencesDialog({ open, onClose }: Props) {
  const { t } = useTranslation(["notifications", "common"]);
  const { user } = useAuthContext();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    api
      .get<NotificationPreferences>("/users/me/notification-preferences")
      .then(setPrefs)
      .catch(() => setError(t("preferences.loadFailed")))
      .finally(() => setLoading(false));
  }, [open]);

  const types: NotificationTypeSpec[] = prefs?.types ?? [];
  const slotColumns = useExtensionSlots("notification.preferences.channels");

  /**
   * A channel column needs BOTH halves: the backend must report the channel
   * as live (it decides whether a PATCH for it is honoured) and a slot
   * supplies the localized label. Backend-only still renders, under the raw
   * key, so a channel that is genuinely delivering is never unswitchable.
   * Slot-only renders nothing — a UI bundle installs live while a backend
   * channel needs a restart, and a column the backend would ignore is worse
   * than no column at all.
   */
  const channels: ChannelColumn[] = (prefs?.available_channels ?? [])
    .map((c) => {
      const hit = slotColumns.find((s) => s.contribution.id === c.key);
      let meta: ChannelSlotMeta = {};
      try {
        meta = (hit?.contribution.build?.({ channelKey: c.key }) ?? {}) as ChannelSlotMeta;
      } catch {
        // Same posture as extension ADR grid columns: a throwing build()
        // costs its label, never the column or the dialog.
        meta = {};
      }
      return { key: c.key, label: meta.label || c.key, order: meta.order ?? 0 };
    })
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

  const toggle = (channel: "in_app" | "email", type: string) => {
    if (!prefs) return;
    setPrefs({
      ...prefs,
      [channel]: {
        ...prefs[channel],
        [type]: !prefs[channel][type],
      },
    });
  };

  const toggleChannel = (channelKey: string, type: string) => {
    if (!prefs) return;
    const current = prefs.channels ?? {};
    const forChannel = current[channelKey] ?? {};
    setPrefs({
      ...prefs,
      channels: {
        ...current,
        [channelKey]: { ...forChannel, [type]: !forChannel[type] },
      },
    });
  };

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    setError("");
    try {
      // Send the opt-ins only. `types` and `available_channels` are
      // server-owned render metadata that came down on the GET; echoing them
      // back would be noise on the wire.
      await api.patch("/users/me/notification-preferences", {
        in_app: prefs.in_app,
        email: prefs.email,
        ...(prefs.channels ? { channels: prefs.channels } : {}),
      });
      onClose();
    } catch {
      setError(t("preferences.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth={channels.length ? "md" : "sm"} fullWidth>
      <DialogTitle>{t("preferences.title")}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : prefs ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("preferences.description")}
            </Typography>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t("preferences.notification")}</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    {t("preferences.inApp")}
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>
                    {t("preferences.email")}
                  </TableCell>
                  {channels.map((ch) => (
                    <TableCell key={ch.key} align="center" sx={{ fontWeight: 600 }}>
                      {ch.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {types.map((nt) => (
                  <TableRow key={nt.key}>
                    <TableCell>{nt.label ?? t(labelKeyFor(nt.key), nt.key)}</TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={prefs.in_app[nt.key] ?? nt.in_app_default}
                        onChange={() => toggle("in_app", nt.key)}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={
                          !nt.in_app_only &&
                          (nt.email_locked || (prefs.email[nt.key] ?? nt.email_default))
                        }
                        onChange={() => toggle("email", nt.key)}
                        disabled={nt.email_locked || nt.in_app_only}
                      />
                    </TableCell>
                    {channels.map((ch) => (
                      <TableCell key={ch.key} align="center">
                        <Switch
                          size="small"
                          // Extension channels are always opt-in-off: no
                          // per-type default can raise them, so an install
                          // never starts delivering on its own.
                          checked={!nt.in_app_only && (prefs.channels?.[ch.key]?.[nt.key] ?? false)}
                          onChange={() => toggleChannel(ch.key, nt.key)}
                          disabled={nt.in_app_only}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <ExtensionSlot
              name="notification.preferences.footer"
              context={{ userId: user?.id }}
            />
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !prefs}
        >
          {saving ? t("preferences.saving") : t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
