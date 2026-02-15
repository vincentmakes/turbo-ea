import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface Props {
  onSetPassword: (token: string, password: string) => Promise<void>;
}

export default function SetPasswordPage({ onSetPassword }: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [validating, setValidating] = useState(true);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [invalid, setInvalid] = useState(false);

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
    api
      .get<{ email: string; display_name: string }>(
        `/auth/validate-setup-token?token=${encodeURIComponent(token)}`
      )
      .then((data) => {
        setEmail(data.email);
        setDisplayName(data.display_name);
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

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await onSetPassword(token, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
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
            Invalid Setup Link
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            This password setup link is invalid or has already been used.
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate("/", { replace: true })}
          >
            Go to Login
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
          <MaterialSymbol icon="hub" size={48} color="#1976d2" />
          <Typography variant="h5" fontWeight={700} sx={{ mt: 1 }}>
            Set Your Password
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Welcome{displayName ? `, ${displayName}` : ""}! Set a password for{" "}
            <strong>{email}</strong>.
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="New Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            sx={{ mb: 2 }}
            autoFocus
          />
          <TextField
            fullWidth
            label="Confirm Password"
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
            {loading ? "Setting password..." : "Set Password & Sign In"}
          </Button>
        </form>
      </Card>
    </Box>
  );
}
