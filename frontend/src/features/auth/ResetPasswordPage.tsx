import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { auth } from "@/api/client";

export default function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [validating, setValidating] = useState(true);
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [success, setSuccess] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setValidating(false);
      return;
    }
    auth
      .validateResetToken(token)
      .then((data) => {
        setEmail(data.email);
        setValidating(false);
      })
      .catch(() => {
        setInvalid(true);
        setValidating(false);
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 10) {
      setError(t("resetPassword.minLength"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("resetPassword.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resetPassword.failedToReset"));
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
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
        <CircularProgress sx={{ color: "#64b5f6" }} />
      </Box>
    );
  }

  if (invalid) {
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
        <Card sx={{ p: 4, width: 400, maxWidth: "90vw", textAlign: "center" }}>
          <MaterialSymbol icon="error" size={48} color="#d32f2f" />
          <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
            {t("resetPassword.invalidLink.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t("resetPassword.invalidLink.description")}
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate("/", { replace: true })}
          >
            {t("resetPassword.goToLogin")}
          </Button>
        </Card>
      </Box>
    );
  }

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
          <MaterialSymbol icon="lock_reset" size={48} color="#1976d2" />
          <Typography variant="h5" fontWeight={700} sx={{ mt: 1 }}>
            {t("resetPassword.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("resetPassword.welcomeUser", { email })}
          </Typography>
        </Box>

        {success ? (
          <>
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                {t("resetPassword.successTitle")}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {t("resetPassword.successDescription")}
              </Typography>
            </Alert>
            <Button
              fullWidth
              variant="contained"
              onClick={() => navigate("/", { replace: true })}
            >
              {t("resetPassword.goToLogin")}
            </Button>
          </>
        ) : (
          <>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label={t("resetPassword.newPassword")}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                sx={{ mb: 2 }}
                autoFocus
              />
              <TextField
                fullWidth
                label={t("resetPassword.confirmPassword")}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                {loading ? t("resetPassword.submitting") : t("resetPassword.button")}
              </Button>
            </form>
          </>
        )}
      </Card>
    </Box>
  );
}
