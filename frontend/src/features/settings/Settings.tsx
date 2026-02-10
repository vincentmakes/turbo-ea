import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";

interface WebhookItem {
  id: string;
  name: string;
  url: string;
  status: string;
  event_types: string[] | null;
  last_delivery_at: string | null;
  last_status_code: number | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export default function Settings() {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newSecret, setNewSecret] = useState("");

  const loadWebhooks = useCallback(async () => {
    try {
      const data = await api.get<{ items: WebhookItem[] }>("/webhooks");
      setWebhooks(data.items);
    } catch {
      // handle
    }
  }, []);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  async function handleCreate() {
    try {
      await api.post("/webhooks", {
        name: newName,
        url: newUrl,
        secret: newSecret || undefined,
      });
      setCreateOpen(false);
      setNewName("");
      setNewUrl("");
      setNewSecret("");
      loadWebhooks();
    } catch {
      // handle
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/webhooks/${id}`);
      loadWebhooks();
    } catch {
      // handle
    }
  }

  async function handleToggle(webhook: WebhookItem) {
    const newStatus = webhook.status === "active" ? "paused" : "active";
    try {
      await api.patch(`/webhooks/${webhook.id}`, { status: newStatus });
      loadWebhooks();
    } catch {
      // handle
    }
  }

  async function handleTest(id: string) {
    try {
      await api.post(`/webhooks/${id}/test`, {});
    } catch {
      // handle
    }
  }

  function handleExport(type: string) {
    const path = type === "relations" ? "/reports/export/relations" : `/reports/export/fact-sheets`;
    window.open(`/api/v1${path}`, "_blank");
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Settings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage exports, webhooks, and system configuration.
      </Typography>

      {/* Export Section */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
            Data Export
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Download your enterprise architecture data as CSV files.
          </Typography>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="download" size={20} />}
              onClick={() => handleExport("all")}
            >
              Export All Fact Sheets
            </Button>
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="download" size={20} />}
              onClick={() => handleExport("relations")}
            >
              Export Relations
            </Button>
            {["application", "business_capability", "it_component", "provider"].map((type) => (
              <Button
                key={type}
                variant="text"
                size="small"
                onClick={() => window.open(`/api/v1/reports/export/fact-sheets?fs_type=${type}`, "_blank")}
              >
                {type.replace(/_/g, " ")}s
              </Button>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Divider sx={{ my: 3 }} />

      {/* Webhooks Section */}
      <Card>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Webhooks
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Receive HTTP notifications when events occur in your EA repository.
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={20} />}
              onClick={() => setCreateOpen(true)}
            >
              Add Webhook
            </Button>
          </Box>

          {webhooks.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <MaterialSymbol icon="webhook" size={48} />
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                No webhooks configured. Add one to receive event notifications.
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>URL</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Failures</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Last Delivery</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {webhooks.map((wh) => (
                    <TableRow key={wh.id}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {wh.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="caption"
                          sx={{
                            fontFamily: "monospace",
                            maxWidth: 250,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                          }}
                        >
                          {wh.url}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={wh.status}
                          size="small"
                          color={
                            wh.status === "active"
                              ? "success"
                              : wh.status === "paused"
                                ? "default"
                                : "error"
                          }
                          sx={{ height: 22, fontSize: "0.7rem" }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={wh.failure_count > 0 ? "error" : "text.secondary"}
                        >
                          {wh.failure_count}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {wh.last_delivery_at || "Never"}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => handleToggle(wh)}
                          title={wh.status === "active" ? "Pause" : "Resume"}
                        >
                          <MaterialSymbol
                            icon={wh.status === "active" ? "pause" : "play_arrow"}
                            size={18}
                          />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleTest(wh.id)}
                          title="Test"
                        >
                          <MaterialSymbol icon="send" size={18} />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(wh.id)}
                          title="Delete"
                          color="error"
                        >
                          <MaterialSymbol icon="delete" size={18} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Webhook</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            fullWidth
            autoFocus
            margin="dense"
          />
          <TextField
            label="URL"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            fullWidth
            margin="dense"
            placeholder="https://example.com/webhook"
          />
          <TextField
            label="Secret (optional)"
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            fullWidth
            margin="dense"
            helperText="Used to sign payloads with HMAC-SHA256"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!newName.trim() || !newUrl.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
