import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { McpConnection } from "@/types";

/** Every person's live AI tool connection, for a holder of `admin.mcp`. */
export const MCP_CONNECTIONS_PATH = "/auth/mcp/sessions?everyone=true";

interface Props {
  /** Called after a connection was revoked, with the message to show. */
  onNotice?: (message: string) => void;
}

/**
 * The **Active connections** table of the MCP settings: who has an AI tool
 * signed in, when it connected, when it was last used, when it ends if left
 * unused, and a Revoke action. Mounted only for a holder of `admin.mcp`.
 */
export default function McpConnections({ onNotice }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const { formatDateTime } = useDateFormat();
  const { data, loading, error, refetch } = useApiQuery<McpConnection[]>(MCP_CONNECTIONS_PATH);
  const [pending, setPending] = useState<McpConnection | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  const personOf = (c: McpConnection) =>
    c.user?.display_name || t("settings.mcp.connections.unknownPerson");

  const close = () => {
    setPending(null);
    setRevokeError("");
  };

  const confirmRevoke = async () => {
    if (!pending) return;
    setRevoking(true);
    setRevokeError("");
    try {
      await api.delete(`/auth/mcp/sessions/${encodeURIComponent(pending.id)}`);
      setPending(null);
      refetch();
      onNotice?.(t("settings.mcp.connections.revoked"));
    } catch {
      setRevokeError(t("settings.mcp.connections.revokeError"));
    } finally {
      setRevoking(false);
    }
  };

  const rows = data ?? [];

  return (
    <Box sx={{ mt: 3 }} data-testid="mcp-connections">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <MaterialSymbol icon="link" size={20} />
        <Typography variant="subtitle1" fontWeight={600}>
          {t("settings.mcp.connections.title")}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("settings.mcp.connections.description")}
      </Typography>

      {error ? (
        <Alert severity="error">{t("settings.mcp.connections.loadError")}</Alert>
      ) : loading && !data ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("settings.mcp.connections.empty")}
        </Typography>
      ) : (
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("settings.mcp.connections.person")}</TableCell>
                <TableCell>{t("settings.mcp.connections.client")}</TableCell>
                <TableCell>{t("settings.mcp.connections.connected")}</TableCell>
                <TableCell>{t("settings.mcp.connections.lastUsed")}</TableCell>
                <TableCell>{t("settings.mcp.connections.ends")}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{personOf(c)}</TableCell>
                  <TableCell>{c.client_name}</TableCell>
                  <TableCell>{formatDateTime(c.created_at)}</TableCell>
                  <TableCell>{formatDateTime(c.last_used_at)}</TableCell>
                  <TableCell>{formatDateTime(c.expires_at)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={t("settings.mcp.connections.revoke")}>
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={t("settings.mcp.connections.revokeAria", {
                          client: c.client_name,
                          person: personOf(c),
                        })}
                        onClick={() => setPending(c)}
                      >
                        <MaterialSymbol icon="link_off" size={18} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={pending !== null} onClose={revoking ? undefined : close} disableRestoreFocus>
        <DialogTitle>{t("settings.mcp.connections.revokeTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pending &&
              t("settings.mcp.connections.revokeBody", {
                client: pending.client_name,
                person: personOf(pending),
              })}
          </DialogContentText>
          {revokeError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {revokeError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={revoking} sx={{ textTransform: "none" }}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmRevoke}
            disabled={revoking}
            sx={{ textTransform: "none" }}
          >
            {t("settings.mcp.connections.revoke")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
