import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface EmailSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
  smtp_tls: boolean;
  app_base_url: string;
  configured: boolean;
}

export default function SettingsAdmin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("noreply@turboea.local");
  const [smtpTls, setSmtpTls] = useState(true);
  const [appBaseUrl, setAppBaseUrl] = useState("");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    api
      .get<EmailSettings>("/settings/email")
      .then((data) => {
        setSmtpHost(data.smtp_host);
        setSmtpPort(data.smtp_port);
        setSmtpUser(data.smtp_user);
        setSmtpPassword(data.smtp_password);
        setSmtpFrom(data.smtp_from);
        setSmtpTls(data.smtp_tls);
        setAppBaseUrl(data.app_base_url);
        setConfigured(data.configured);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await api.patch("/settings/email", {
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_password: smtpPassword,
        smtp_from: smtpFrom,
        smtp_tls: smtpTls,
        app_base_url: appBaseUrl,
      });
      setConfigured(!!smtpHost);
      setSnack("Email settings saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError("");
    try {
      const res = await api.post<{ ok: boolean; sent_to: string }>(
        "/settings/email/test"
      );
      setSnack(`Test email sent to ${res.sent_to}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send test email");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 1 }}>
        <MaterialSymbol icon="settings" size={28} color="#1976d2" />
        <Typography variant="h5" fontWeight={700}>
          Settings
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Email / SMTP Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="mail" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            Email / SMTP Configuration
          </Typography>
          <Chip
            label={configured ? "Configured" : "Not configured"}
            size="small"
            color={configured ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Configure SMTP settings to enable email notifications. If left empty,
          only in-app notifications will be delivered.
        </Typography>

        <Box
          sx={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 2, mb: 2 }}
        >
          <TextField
            label="SMTP Host"
            fullWidth
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            placeholder="e.g. smtp.gmail.com"
          />
          <TextField
            label="SMTP Port"
            fullWidth
            type="number"
            value={smtpPort}
            onChange={(e) => setSmtpPort(Number(e.target.value))}
          />
        </Box>

        <Box
          sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}
        >
          <TextField
            label="SMTP Username"
            fullWidth
            value={smtpUser}
            onChange={(e) => setSmtpUser(e.target.value)}
            placeholder="e.g. user@gmail.com"
          />
          <TextField
            label="SMTP Password"
            fullWidth
            type="password"
            value={smtpPassword}
            onChange={(e) => setSmtpPassword(e.target.value)}
          />
        </Box>

        <Box
          sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}
        >
          <TextField
            label="From Address"
            fullWidth
            value={smtpFrom}
            onChange={(e) => setSmtpFrom(e.target.value)}
            placeholder="noreply@turboea.local"
          />
          <FormControlLabel
            control={
              <Switch
                checked={smtpTls}
                onChange={(e) => setSmtpTls(e.target.checked)}
              />
            }
            label="Use TLS"
            sx={{ ml: 1, mt: 1 }}
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <TextField
          label="Application Base URL"
          fullWidth
          value={appBaseUrl}
          onChange={(e) => setAppBaseUrl(e.target.value)}
          placeholder="e.g. https://turboea.yourcompany.com"
          helperText="Used in email notification links. Leave empty for localhost."
          sx={{ mb: 3 }}
        />

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button
            variant="outlined"
            startIcon={
              testing ? (
                <CircularProgress size={16} />
              ) : (
                <MaterialSymbol icon="send" size={18} />
              )
            }
            sx={{ textTransform: "none" }}
            onClick={handleTest}
            disabled={saving || testing || !smtpHost}
          >
            {testing ? "Sending..." : "Send Test Email"}
          </Button>
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </Box>
      </Paper>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
