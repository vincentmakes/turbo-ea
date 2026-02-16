import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import { auth } from "@/api/client";
import type { SsoConfig } from "@/types";

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, displayName: string, password: string) => Promise<void>;
}

export default function LoginPage({ onLogin, onRegister }: Props) {
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(null);

  useEffect(() => {
    auth.ssoConfig().then(setSsoConfig).catch(() => {});
  }, []);

  const ssoEnabled = ssoConfig?.enabled === true;
  const registrationAllowed =
    !ssoEnabled && ssoConfig?.registration_enabled !== false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === 0) {
        await onLogin(email, password);
      } else {
        await onRegister(email, displayName, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = () => {
    if (!ssoConfig?.client_id || !ssoConfig.authorization_endpoint) return;

    const redirectUri = `${window.location.origin}/auth/callback`;
    const params = new URLSearchParams({
      client_id: ssoConfig.client_id,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "openid email profile",
      response_mode: "query",
    });

    window.location.href = `${ssoConfig.authorization_endpoint}?${params.toString()}`;
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#1a1a2e",
      }}
    >
      <Card sx={{ p: 4, width: 400, maxWidth: "90vw" }}>
        <Box sx={{ textAlign: "center", mb: 3 }}>
          <img
            src="/logo.png"
            alt="Turbo EA"
            style={{ height: 64, objectFit: "contain" }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Enterprise Architecture Management
          </Typography>
        </Box>

        {/* SSO Login Button */}
        {ssoEnabled && (
          <>
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleSsoLogin}
              startIcon={
                <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
              }
              sx={{
                mb: 2,
                bgcolor: "#fff",
                color: "#333",
                textTransform: "none",
                fontWeight: 600,
                "&:hover": { bgcolor: "#f5f5f5" },
              }}
            >
              Sign in with Microsoft
            </Button>
            <Divider sx={{ my: 2, color: "text.secondary", fontSize: 13 }}>
              or sign in with email
            </Divider>
          </>
        )}

        {/* Only show Login/Register tabs when registration is allowed */}
        {registrationAllowed && (
          <Tabs value={tab} onChange={(_, v) => setTab(v)} centered sx={{ mb: 2 }}>
            <Tab label="Login" />
            <Tab label="Register" />
          </Tabs>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            sx={{ mb: 2 }}
          />
          {tab === 1 && registrationAllowed && (
            <TextField
              fullWidth
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              sx={{ mb: 2 }}
            />
          )}
          <TextField
            fullWidth
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            sx={{ mb: 3 }}
          />
          <Button
            fullWidth
            variant="contained"
            type="submit"
            disabled={loading}
            size="large"
          >
            {loading ? "..." : tab === 0 || !registrationAllowed ? "Login" : "Register"}
          </Button>
        </form>
      </Card>
    </Box>
  );
}
