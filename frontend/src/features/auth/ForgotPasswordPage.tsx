import { useState } from "react";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { auth } from "@/api/client";

export default function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Anti-enumeration: always show the same success state regardless of
    // backend response (which is itself anti-enumeration). Swallow errors so
    // network failures don't reveal whether the email is registered.
    try {
      await auth.forgotPassword(email.trim());
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
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
          <MaterialSymbol icon="lock_reset" size={48} color="#1976d2" />
          <Typography variant="h5" fontWeight={700} sx={{ mt: 1 }}>
            {t("forgotPassword.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("forgotPassword.description")}
          </Typography>
        </Box>

        {submitted ? (
          <>
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                {t("forgotPassword.successTitle")}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {t("forgotPassword.successDescription")}
              </Typography>
            </Alert>
            <Button
              fullWidth
              variant="contained"
              onClick={() => navigate("/", { replace: true })}
            >
              {t("forgotPassword.backToLogin")}
            </Button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label={t("forgotPassword.email")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              sx={{ mb: 3 }}
            />
            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={loading}
              size="large"
              sx={{ mb: 1 }}
            >
              {loading ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
            </Button>
            <Button
              fullWidth
              variant="text"
              onClick={() => navigate("/", { replace: true })}
              size="small"
            >
              {t("forgotPassword.backToLogin")}
            </Button>
          </form>
        )}
      </Card>
    </Box>
  );
}
