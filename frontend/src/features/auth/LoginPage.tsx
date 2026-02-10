import { useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";

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
            Turbo EA
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Enterprise Architecture Management
          </Typography>
        </Box>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} centered sx={{ mb: 2 }}>
          <Tab label="Login" />
          <Tab label="Register" />
        </Tabs>

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
          {tab === 1 && (
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
            {loading ? "..." : tab === 0 ? "Login" : "Register"}
          </Button>
        </form>
      </Card>
    </Box>
  );
}
