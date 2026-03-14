/**
 * ArchLens connection management — embedded as a tab in SettingsAdmin.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { ArchLensConnection } from "@/types";

// ---------------------------------------------------------------------------
// Connection Dialog
// ---------------------------------------------------------------------------

interface ConnDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  existing?: ArchLensConnection | null;
}

function ConnectionDialog({ open, onClose, onSaved, existing }: ConnDialogProps) {
  const { t } = useTranslation("admin");
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.instance_url ?? "");
  const [turboUrl, setTurboUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setUrl(existing?.instance_url ?? "");
      setTurboUrl("");
      setEmail("");
      setPassword("");
    }
  }, [open, existing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name,
        instance_url: url,
        credentials: {
          turbo_ea_url: turboUrl || undefined,
          email: email || undefined,
          password: password || undefined,
        },
      };
      if (existing) {
        await api.patch(`/archlens/connections/${existing.id}`, payload);
      } else {
        await api.post("/archlens/connections", payload);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {existing ? t("archlens_edit_connection") : t("archlens_new_connection")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t("archlens_connection_name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t("archlens_instance_url")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="http://archlens:3000"
          />
          <Divider />
          <Typography variant="subtitle2" color="text.secondary">
            {t("archlens_turbo_credentials")}
          </Typography>
          <TextField
            label={t("archlens_turbo_url")}
            value={turboUrl}
            onChange={(e) => setTurboUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="http://backend:8000"
          />
          <TextField
            label={t("archlens_email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t("archlens_password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:cancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name || !url}>
          {saving ? <CircularProgress size={20} /> : t("common:save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component — connection management only
// ---------------------------------------------------------------------------

export default function ArchLensAdmin() {
  const { t } = useTranslation("admin");
  const [connections, setConnections] = useState<ArchLensConnection[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editConn, setEditConn] = useState<ArchLensConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(
    null,
  );

  const loadConnections = useCallback(async () => {
    try {
      const data = await api.get<ArchLensConnection[]>("/archlens/connections");
      setConnections(data);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleTest = async (conn: ArchLensConnection) => {
    setLoading(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/archlens/connections/${conn.id}/test`,
      );
      setFeedback({ type: res.ok ? "success" : "error", msg: res.message });
      loadConnections();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (conn: ArchLensConnection) => {
    setLoading(true);
    setFeedback(null);
    try {
      await api.post(`/archlens/connections/${conn.id}/sync`);
      setFeedback({ type: "success", msg: t("archlens_sync_success") });
      loadConnections();
    } catch (err: unknown) {
      setFeedback({ type: "error", msg: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (conn: ArchLensConnection) => {
    await api.delete(`/archlens/connections/${conn.id}`);
    loadConnections();
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("archlens_settings_description")}
      </Typography>

      {feedback && (
        <Alert severity={feedback.type} onClose={() => setFeedback(null)} sx={{ mb: 2 }}>
          {feedback.msg}
        </Alert>
      )}

      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" />}
          onClick={() => {
            setEditConn(null);
            setDialogOpen(true);
          }}
        >
          {t("archlens_add_connection")}
        </Button>
      </Stack>

      {connections.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">{t("archlens_no_connections")}</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {connections.map((conn) => (
            <Card key={conn.id} variant="outlined">
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                      {conn.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {conn.instance_url}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Chip
                        size="small"
                        label={
                          conn.test_status === "ok"
                            ? t("archlens_connected")
                            : t("archlens_not_tested")
                        }
                        color={conn.test_status === "ok" ? "success" : "default"}
                      />
                      {conn.sync_status && (
                        <Chip
                          size="small"
                          label={conn.sync_status}
                          color={conn.sync_status === "completed" ? "info" : "default"}
                        />
                      )}
                      {conn.last_synced_at && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ alignSelf: "center" }}
                        >
                          {t("archlens_last_synced")}:{" "}
                          {new Date(conn.last_synced_at).toLocaleString()}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Switch checked={conn.is_active} size="small" readOnly />
                    <Button size="small" onClick={() => handleTest(conn)} disabled={loading}>
                      {t("archlens_test")}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleSync(conn)}
                      disabled={loading}
                    >
                      {t("archlens_sync")}
                    </Button>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditConn(conn);
                        setDialogOpen(true);
                      }}
                    >
                      <MaterialSymbol icon="edit" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleDelete(conn)}
                    >
                      <MaterialSymbol icon="delete" />
                    </IconButton>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <ConnectionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={loadConnections}
        existing={editConn}
      />
    </Box>
  );
}
