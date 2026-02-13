import { useState, useEffect, useRef } from "react";
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

interface LogoInfo {
  has_custom_logo: boolean;
  mime_type: string;
}

export default function SettingsAdmin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  // Logo state
  const [hasCustomLogo, setHasCustomLogo] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("noreply@turboea.local");
  const [smtpTls, setSmtpTls] = useState(true);
  const [appBaseUrl, setAppBaseUrl] = useState("");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<EmailSettings>("/settings/email"),
      api.get<LogoInfo>("/settings/logo/info"),
    ])
      .then(([emailData, logoData]) => {
        setSmtpHost(emailData.smtp_host);
        setSmtpPort(emailData.smtp_port);
        setSmtpUser(emailData.smtp_user);
        setSmtpPassword(emailData.smtp_password);
        setSmtpFrom(emailData.smtp_from);
        setSmtpTls(emailData.smtp_tls);
        setAppBaseUrl(emailData.app_base_url);
        setConfigured(emailData.configured);
        setHasCustomLogo(logoData.has_custom_logo);
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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setError("");
    try {
      await api.upload("/settings/logo", file);
      setHasCustomLogo(true);
      setLogoVersion((v) => v + 1);
      // Update favicon
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) link.href = `/api/v1/settings/logo?v=${Date.now()}`;
      const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      if (apple) apple.href = `/api/v1/settings/logo?v=${Date.now()}`;
      setSnack("Logo updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLogoReset = async () => {
    setUploadingLogo(true);
    setError("");
    try {
      await api.delete("/settings/logo");
      setHasCustomLogo(false);
      setLogoVersion((v) => v + 1);
      // Update favicon
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) link.href = `/api/v1/settings/logo?v=${Date.now()}`;
      const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      if (apple) apple.href = `/api/v1/settings/logo?v=${Date.now()}`;
      setSnack("Logo reset to default");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset logo");
    } finally {
      setUploadingLogo(false);
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

      {/* Logo Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="image" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            Logo
          </Typography>
          <Chip
            label={hasCustomLogo ? "Custom" : "Default"}
            size="small"
            color={hasCustomLogo ? "info" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Upload a custom logo to replace the default Turbo EA logo in the
          navigation bar, favicon, and Apple touch icon. Recommended: PNG or SVG
          with a transparent background. Max 2 MB.
        </Typography>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            mb: 2,
          }}
        >
          <Box
            sx={{
              width: 200,
              height: 80,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "#1a1a2e",
              p: 1,
            }}
          >
            <img
              src={`/api/v1/settings/logo?v=${logoVersion}`}
              alt="Current logo"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={handleLogoUpload}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={
                uploadingLogo ? (
                  <CircularProgress size={16} />
                ) : (
                  <MaterialSymbol icon="upload" size={18} />
                )
              }
              sx={{ textTransform: "none" }}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
            >
              Upload Logo
            </Button>
            {hasCustomLogo && (
              <Button
                variant="outlined"
                size="small"
                color="warning"
                startIcon={<MaterialSymbol icon="restart_alt" size={18} />}
                sx={{ textTransform: "none" }}
                onClick={handleLogoReset}
                disabled={uploadingLogo}
              >
                Reset to Default
              </Button>
            )}
          </Box>
        </Box>
      </Paper>

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
