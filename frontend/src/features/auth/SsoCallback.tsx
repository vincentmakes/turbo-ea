import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";

interface Props {
  onSsoCallback: (code: string, redirectUri: string) => Promise<void>;
}

export default function SsoCallback({ onSsoCallback }: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");

    if (errorParam) {
      setError(errorDesc || errorParam);
      return;
    }

    if (!code) {
      setError("No authorization code received from Microsoft.");
      return;
    }

    // Build the redirect_uri that matches what was sent in the authorization request
    const redirectUri = `${window.location.origin}/auth/callback`;

    onSsoCallback(code, redirectUri)
      .then(() => {
        navigate("/", { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "SSO authentication failed");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#1a1a2e",
        gap: 2,
      }}
    >
      {error ? (
        <>
          <Alert severity="error" sx={{ maxWidth: 500 }}>
            {error}
          </Alert>
          <Button
            variant="contained"
            onClick={() => navigate("/", { replace: true })}
            sx={{ mt: 2 }}
          >
            Back to Login
          </Button>
        </>
      ) : (
        <>
          <CircularProgress sx={{ color: "#64b5f6" }} />
          <Typography color="#fff">Completing sign-in...</Typography>
        </>
      )}
    </Box>
  );
}
