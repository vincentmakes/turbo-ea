import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Switch from "@mui/material/Switch";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Slider from "@mui/material/Slider";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Autocomplete from "@mui/material/Autocomplete";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { SnowConnection, SnowMapping, SnowSyncRun, SnowStagedRecord, CardType } from "@/types";

// ---------------------------------------------------------------------------
// Helpers — derive Turbo EA field path options from a card type
// ---------------------------------------------------------------------------

interface TurboFieldOption {
  path: string;
  label: string;
  group: string;
}

function getTurboFieldOptions(cardType: CardType | undefined): TurboFieldOption[] {
  const options: TurboFieldOption[] = [
    { path: "name", label: "Name", group: "Core" },
    { path: "description", label: "Description", group: "Core" },
    { path: "lifecycle.plan", label: "Plan", group: "Lifecycle" },
    { path: "lifecycle.phaseIn", label: "Phase In", group: "Lifecycle" },
    { path: "lifecycle.active", label: "Active", group: "Lifecycle" },
    { path: "lifecycle.phaseOut", label: "Phase Out", group: "Lifecycle" },
    { path: "lifecycle.endOfLife", label: "End of Life", group: "Lifecycle" },
  ];

  if (cardType?.fields_schema) {
    for (const section of cardType.fields_schema) {
      for (const field of section.fields) {
        options.push({
          path: `attributes.${field.key}`,
          label: field.label,
          group: section.section,
        });
      }
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ServiceNowAdmin() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Connections" />
        <Tab label="Mappings" />
        <Tab label="Sync Dashboard" />
      </Tabs>

      {tab === 0 && <ConnectionsTab />}
      {tab === 1 && <MappingsTab />}
      {tab === 2 && <SyncDashboardTab />}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Connections
// ---------------------------------------------------------------------------

function ConnectionsTab() {
  const [connections, setConnections] = useState<SnowConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SnowConnection | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<SnowConnection[]>("/servicenow/connections");
      setConnections(res);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTest = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const res = await api.post<{ success: boolean; message: string }>(`/servicenow/connections/${id}/test`);
      setTestResult({ id, ...res });
      load();
    } catch (e) {
      setTestResult({ id, success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this connection and all its mappings?")) return;
    try {
      await api.delete(`/servicenow/connections/${id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  if (loading) return <LinearProgress />;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => { setEditing(null); setDialogOpen(true); }}
        >
          Add Connection
        </Button>
      </Box>

      {connections.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="cloud_off" size={48} color="#ccc" />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              No ServiceNow connections configured yet
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {connections.map((conn) => (
            <Card key={conn.id} variant="outlined">
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <MaterialSymbol icon="cloud" size={24} color={conn.is_active ? "#1976d2" : "#999"} />
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight={600}>{conn.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {conn.instance_url}
                    </Typography>
                  </Box>
                  <Chip
                    label={conn.auth_type.toUpperCase()}
                    size="small"
                    sx={{ fontWeight: 600, fontSize: "0.7rem" }}
                  />
                  {conn.test_status && (
                    <Chip
                      label={conn.test_status === "success" ? "Connected" : "Failed"}
                      size="small"
                      color={conn.test_status === "success" ? "success" : "error"}
                      sx={{ fontWeight: 600, fontSize: "0.7rem" }}
                    />
                  )}
                  {!conn.is_active && (
                    <Chip label="Inactive" size="small" color="default" />
                  )}
                  <Chip
                    label={`${conn.mapping_count} mapping${conn.mapping_count !== 1 ? "s" : ""}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: "0.7rem" }}
                  />
                  <Tooltip title="Test Connection">
                    <IconButton
                      size="small"
                      onClick={() => handleTest(conn.id)}
                      disabled={testing === conn.id}
                    >
                      {testing === conn.id ? (
                        <CircularProgress size={18} />
                      ) : (
                        <MaterialSymbol icon="wifi_tethering" size={18} />
                      )}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      onClick={() => { setEditing(conn); setDialogOpen(true); }}
                    >
                      <MaterialSymbol icon="edit" size={18} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={() => handleDelete(conn.id)}>
                      <MaterialSymbol icon="delete" size={18} color="#f44336" />
                    </IconButton>
                  </Tooltip>
                </Box>
                {testResult && testResult.id === conn.id && (
                  <Alert
                    severity={testResult.success ? "success" : "error"}
                    sx={{ mt: 1.5 }}
                    onClose={() => setTestResult(null)}
                  >
                    {testResult.message}
                  </Alert>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <ConnectionDialog
        open={dialogOpen}
        connection={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Connection Dialog
// ---------------------------------------------------------------------------

interface ConnectionDialogProps {
  open: boolean;
  connection: SnowConnection | null;
  onClose: () => void;
  onSaved: () => void;
}

function ConnectionDialog({ open, connection, onClose, onSaved }: ConnectionDialogProps) {
  const [name, setName] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [authType, setAuthType] = useState("basic");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(connection?.name || "");
      setInstanceUrl(connection?.instance_url || "https://");
      setAuthType(connection?.auth_type || "basic");
      setUsername("");
      setPassword("");
      setClientId("");
      setClientSecret("");
      setError("");
    }
  }, [open, connection]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name,
        instance_url: instanceUrl,
        auth_type: authType,
        username,
        password,
        client_id: clientId,
        client_secret: clientSecret,
      };
      if (connection) {
        await api.patch(`/servicenow/connections/${connection.id}`, body);
      } else {
        await api.post("/servicenow/connections", body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{connection ? "Edit Connection" : "New Connection"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production ServiceNow"
          />
          <TextField
            label="Instance URL"
            fullWidth
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            placeholder="https://company.service-now.com"
            helperText="Must use HTTPS"
          />
          <FormControl fullWidth>
            <InputLabel>Auth Type</InputLabel>
            <Select value={authType} label="Auth Type" onChange={(e) => setAuthType(e.target.value)}>
              <MenuItem value="basic">Basic Auth</MenuItem>
              <MenuItem value="oauth2">OAuth 2.0</MenuItem>
            </Select>
          </FormControl>
          {authType === "basic" ? (
            <>
              <TextField
                label="Username"
                fullWidth
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <TextField
                label="Password"
                type="password"
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={connection ? "Leave blank to keep existing" : ""}
              />
            </>
          ) : (
            <>
              <TextField
                label="Client ID"
                fullWidth
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <TextField
                label="Client Secret"
                type="password"
                fullWidth
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={connection ? "Leave blank to keep existing" : ""}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name || !instanceUrl}
        >
          {saving ? <CircularProgress size={20} /> : connection ? "Update" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Mappings
// ---------------------------------------------------------------------------

function MappingsTab() {
  const [connections, setConnections] = useState<SnowConnection[]>([]);
  const [mappings, setMappings] = useState<SnowMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SnowMapping | null>(null);
  const { types } = useMetamodel();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [conns, maps] = await Promise.all([
        api.get<SnowConnection[]>("/servicenow/connections"),
        api.get<SnowMapping[]>("/servicenow/mappings"),
      ]);
      setConnections(conns);
      setMappings(maps);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this mapping and all its field mappings?")) return;
    try {
      await api.delete(`/servicenow/mappings/${id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleToggleActive = async (mapping: SnowMapping) => {
    try {
      await api.patch(`/servicenow/mappings/${mapping.id}`, { is_active: !mapping.is_active });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    }
  };

  if (loading) return <LinearProgress />;

  if (connections.length === 0) {
    return (
      <Alert severity="info">
        Create a ServiceNow connection first before configuring mappings.
      </Alert>
    );
  }

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => { setEditing(null); setDialogOpen(true); }}
        >
          Add Mapping
        </Button>
      </Box>

      {mappings.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="swap_horiz" size={48} color="#ccc" />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              No mappings configured yet
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {mappings.map((mapping) => {
            const conn = connections.find((c) => c.id === mapping.connection_id);
            const cardType = types.find((t) => t.key === mapping.card_type_key);
            return (
              <Card key={mapping.id} variant="outlined" sx={{ opacity: mapping.is_active ? 1 : 0.6 }}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    <MaterialSymbol
                      icon={cardType?.icon || "swap_horiz"}
                      size={24}
                      color={cardType?.color || "#999"}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={600}>
                        {cardType?.label || mapping.card_type_key}
                        {" "}
                        <Typography component="span" color="text.secondary" fontSize="0.85rem">
                          <MaterialSymbol icon="sync_alt" size={14} /> {mapping.snow_table}
                        </Typography>
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {conn?.name || "Unknown connection"} &middot;{" "}
                        {mapping.sync_direction.replace(/_/g, " ")} &middot;{" "}
                        {mapping.sync_mode} mode &middot;{" "}
                        {mapping.field_mappings.length} field{mapping.field_mappings.length !== 1 ? "s" : ""}
                      </Typography>
                    </Box>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={mapping.is_active}
                          onChange={() => handleToggleActive(mapping)}
                        />
                      }
                      label="Active"
                      sx={{ mr: 1 }}
                    />
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => { setEditing(mapping); setDialogOpen(true); }}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => handleDelete(mapping.id)}>
                        <MaterialSymbol icon="delete" size={18} color="#f44336" />
                      </IconButton>
                    </Tooltip>
                  </Box>

                  {mapping.field_mappings.length > 0 && (
                    <TableContainer sx={{ mt: 1.5 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>Turbo EA Field</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>SNOW Field</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>Direction</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>Transform</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>Identity</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {mapping.field_mappings.map((fm) => (
                            <TableRow key={fm.id}>
                              <TableCell sx={{ fontSize: "0.8rem", fontFamily: "monospace" }}>
                                {fm.turbo_field}
                              </TableCell>
                              <TableCell sx={{ fontSize: "0.8rem", fontFamily: "monospace" }}>
                                {fm.snow_field}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={fm.direction === "snow_leads" ? "SNOW leads" : "Turbo leads"}
                                  size="small"
                                  sx={{ fontSize: "0.65rem", height: 20 }}
                                  color={fm.direction === "snow_leads" ? "info" : "warning"}
                                />
                              </TableCell>
                              <TableCell sx={{ fontSize: "0.8rem" }}>
                                {fm.transform_type || "direct"}
                              </TableCell>
                              <TableCell>
                                {fm.is_identity && (
                                  <MaterialSymbol icon="key" size={16} color="#ff9800" />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      <MappingDialog
        open={dialogOpen}
        mapping={editing}
        connections={connections}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Mapping Dialog
// ---------------------------------------------------------------------------

interface FieldMappingRow {
  turbo_field: string;
  snow_field: string;
  direction: string;
  transform_type: string;
  transform_config: Record<string, unknown> | null;
  is_identity: boolean;
}

interface MappingDialogProps {
  open: boolean;
  mapping: SnowMapping | null;
  connections: SnowConnection[];
  onClose: () => void;
  onSaved: () => void;
}

function MappingDialog({ open, mapping, connections, onClose, onSaved }: MappingDialogProps) {
  const { types } = useMetamodel();
  const [connectionId, setConnectionId] = useState("");
  const [cardTypeKey, setCardTypeKey] = useState("");
  const [snowTable, setSnowTable] = useState("");
  const [syncDirection, setSyncDirection] = useState("snow_to_turbo");
  const [syncMode, setSyncMode] = useState("conservative");
  const [maxDeletionRatio, setMaxDeletionRatio] = useState(0.5);
  const [filterQuery, setFilterQuery] = useState("");
  const [skipStaging, setSkipStaging] = useState(false);
  const [fieldMappings, setFieldMappings] = useState<FieldMappingRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedCardType = useMemo(
    () => types.find((t) => t.key === cardTypeKey),
    [types, cardTypeKey],
  );
  const turboFieldOptions = useMemo(
    () => getTurboFieldOptions(selectedCardType),
    [selectedCardType],
  );

  useEffect(() => {
    if (open) {
      setConnectionId(mapping?.connection_id || connections[0]?.id || "");
      setCardTypeKey(mapping?.card_type_key || "");
      setSnowTable(mapping?.snow_table || "");
      setSyncDirection(mapping?.sync_direction || "snow_to_turbo");
      setSyncMode(mapping?.sync_mode || "conservative");
      setMaxDeletionRatio(mapping?.max_deletion_ratio ?? 0.5);
      setFilterQuery(mapping?.filter_query || "");
      setSkipStaging(mapping?.skip_staging ?? false);
      setFieldMappings(
        mapping?.field_mappings.map((fm) => ({
          turbo_field: fm.turbo_field,
          snow_field: fm.snow_field,
          direction: fm.direction,
          transform_type: fm.transform_type || "direct",
          transform_config: (fm.transform_config as Record<string, unknown>) || null,
          is_identity: fm.is_identity,
        })) || []
      );
      setError("");
    }
  }, [open, mapping, connections]);

  const addFieldMapping = () => {
    setFieldMappings([
      ...fieldMappings,
      { turbo_field: "", snow_field: "", direction: "snow_leads", transform_type: "direct", transform_config: null, is_identity: false },
    ]);
  };

  const removeFieldMapping = (idx: number) => {
    setFieldMappings(fieldMappings.filter((_, i) => i !== idx));
  };

  const updateFieldMapping = (idx: number, field: string, value: unknown) => {
    setFieldMappings(fieldMappings.map((fm, i) => (i === idx ? { ...fm, [field]: value } : fm)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const body = {
        connection_id: connectionId,
        card_type_key: cardTypeKey,
        snow_table: snowTable,
        sync_direction: syncDirection,
        sync_mode: syncMode,
        max_deletion_ratio: maxDeletionRatio,
        filter_query: filterQuery || null,
        skip_staging: skipStaging,
        field_mappings: fieldMappings.filter((fm) => fm.turbo_field && fm.snow_field),
      };
      if (mapping) {
        await api.patch(`/servicenow/mappings/${mapping.id}`, body);
      } else {
        await api.post("/servicenow/mappings", body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{mapping ? "Edit Mapping" : "New Mapping"}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth>
            <InputLabel>Connection</InputLabel>
            <Select
              value={connectionId}
              label="Connection"
              onChange={(e) => setConnectionId(e.target.value)}
              disabled={!!mapping}
            >
              {connections.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Card Type</InputLabel>
              <Select
                value={cardTypeKey}
                label="Card Type"
                onChange={(e) => setCardTypeKey(e.target.value)}
              >
                {types.filter((t) => !t.is_hidden).map((t) => (
                  <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="ServiceNow Table"
              fullWidth
              value={snowTable}
              onChange={(e) => setSnowTable(e.target.value)}
              placeholder="e.g. cmdb_ci_business_app"
            />
          </Box>

          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Sync Direction</InputLabel>
              <Select
                value={syncDirection}
                label="Sync Direction"
                onChange={(e) => setSyncDirection(e.target.value)}
              >
                <MenuItem value="snow_to_turbo">ServiceNow → Turbo EA</MenuItem>
                <MenuItem value="turbo_to_snow">Turbo EA → ServiceNow</MenuItem>
                <MenuItem value="bidirectional">Bidirectional</MenuItem>
              </Select>
              <FormHelperText>
                Controls which Pull/Push operations are available on the Sync Dashboard
              </FormHelperText>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Sync Mode</InputLabel>
              <Select
                value={syncMode}
                label="Sync Mode"
                onChange={(e) => setSyncMode(e.target.value)}
              >
                <MenuItem value="additive">Additive (no deletes)</MenuItem>
                <MenuItem value="conservative">Conservative (delete orphans)</MenuItem>
                <MenuItem value="strict">Strict (delete unlinked)</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={skipStaging}
                onChange={(e) => setSkipStaging(e.target.checked)}
              />
            }
            label="Skip staging (apply changes directly)"
          />
          {skipStaging && (
            <Alert severity="warning" sx={{ mt: -1 }}>
              Changes will be applied immediately without review. Staged records will not be created.
            </Alert>
          )}

          <Box>
            <Typography variant="body2" gutterBottom>
              Max Deletion Ratio: {Math.round(maxDeletionRatio * 100)}%
            </Typography>
            <Slider
              value={maxDeletionRatio}
              onChange={(_, v) => setMaxDeletionRatio(v as number)}
              min={0}
              max={1}
              step={0.05}
              marks={[
                { value: 0.25, label: "25%" },
                { value: 0.5, label: "50%" },
                { value: 0.75, label: "75%" },
                { value: 1, label: "100%" },
              ]}
              sx={{ maxWidth: 400 }}
            />
          </Box>

          <TextField
            label="Filter Query (optional)"
            fullWidth
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="e.g. active=true^install_status=1"
            helperText="ServiceNow encoded query syntax"
          />

          <Divider />

          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography fontWeight={600}>Field Mappings</Typography>
            <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={addFieldMapping}>
              Add Field
            </Button>
          </Box>

          {!cardTypeKey && fieldMappings.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Select a Card Type above to get field suggestions.
            </Typography>
          )}

          {fieldMappings.map((fm, idx) => (
            <Box key={idx} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Autocomplete
                freeSolo
                size="small"
                value={fm.turbo_field}
                onChange={(_, v) => updateFieldMapping(idx, "turbo_field", v || "")}
                onInputChange={(_, v) => updateFieldMapping(idx, "turbo_field", v)}
                options={turboFieldOptions.map((o) => o.path)}
                groupBy={(option) => {
                  const found = turboFieldOptions.find((o) => o.path === option);
                  return found?.group || "";
                }}
                getOptionLabel={(option) => {
                  const found = turboFieldOptions.find((o) => o.path === option);
                  return found ? `${option} — ${found.label}` : option;
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Turbo EA Field" placeholder="name" />
                )}
                sx={{ flex: 1 }}
              />
              <MaterialSymbol icon="sync_alt" size={16} color="#999" />
              <TextField
                label="SNOW Field"
                size="small"
                value={fm.snow_field}
                onChange={(e) => updateFieldMapping(idx, "snow_field", e.target.value)}
                placeholder="name"
                sx={{ flex: 1 }}
              />
              <Tooltip title="Per-field source of truth: which system's value wins during sync">
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <Select
                    value={fm.direction}
                    onChange={(e) => updateFieldMapping(idx, "direction", e.target.value)}
                  >
                    <MenuItem value="snow_leads">SNOW leads</MenuItem>
                    <MenuItem value="turbo_leads">Turbo leads</MenuItem>
                  </Select>
                </FormControl>
              </Tooltip>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                  value={fm.transform_type}
                  onChange={(e) => updateFieldMapping(idx, "transform_type", e.target.value)}
                >
                  <MenuItem value="direct">Direct</MenuItem>
                  <MenuItem value="value_map">Value Map</MenuItem>
                  <MenuItem value="date_format">Date</MenuItem>
                  <MenuItem value="boolean">Boolean</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={fm.is_identity}
                    onChange={(e) => updateFieldMapping(idx, "is_identity", e.target.checked)}
                  />
                }
                label={<Typography variant="caption">ID</Typography>}
              />
              <IconButton size="small" onClick={() => removeFieldMapping(idx)}>
                <MaterialSymbol icon="close" size={16} />
              </IconButton>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !connectionId || !cardTypeKey || !snowTable}
        >
          {saving ? <CircularProgress size={20} /> : mapping ? "Update" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Sync Dashboard
// ---------------------------------------------------------------------------

function SyncDashboardTab() {
  const [mappings, setMappings] = useState<SnowMapping[]>([]);
  const [runs, setRuns] = useState<SnowSyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<SnowSyncRun | null>(null);
  const [stagedRecords, setStagedRecords] = useState<SnowStagedRecord[]>([]);
  const [stagedLoading, setStagedLoading] = useState(false);
  const { types } = useMetamodel();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [maps, syncRuns] = await Promise.all([
        api.get<SnowMapping[]>("/servicenow/mappings"),
        api.get<SnowSyncRun[]>("/servicenow/sync/runs?limit=50"),
      ]);
      setMappings(maps);
      setRuns(syncRuns);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerSync = async (mappingId: string, direction: "pull" | "push") => {
    setSyncing(mappingId);
    try {
      const endpoint = direction === "pull"
        ? `/servicenow/sync/pull/${mappingId}`
        : `/servicenow/sync/push/${mappingId}`;
      await api.post(endpoint);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  const loadStaged = async (run: SnowSyncRun) => {
    setSelectedRun(run);
    setStagedLoading(true);
    try {
      const res = await api.get<SnowStagedRecord[]>(`/servicenow/sync/runs/${run.id}/staged`);
      setStagedRecords(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staged records");
    } finally {
      setStagedLoading(false);
    }
  };

  if (loading) return <LinearProgress />;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      {/* Active mappings with sync triggers */}
      <Typography fontWeight={600} sx={{ mb: 1.5 }}>Active Mappings</Typography>
      {mappings.filter((m) => m.is_active).length === 0 ? (
        <Alert severity="info" sx={{ mb: 3 }}>No active mappings. Configure mappings first.</Alert>
      ) : (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {mappings.filter((m) => m.is_active).map((mapping) => {
            const cardType = types.find((t) => t.key === mapping.card_type_key);
            return (
              <Card key={mapping.id} variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    <MaterialSymbol
                      icon={cardType?.icon || "swap_horiz"}
                      size={20}
                      color={cardType?.color || "#999"}
                    />
                    <Typography fontWeight={500} sx={{ flex: 1 }}>
                      {cardType?.label || mapping.card_type_key} <MaterialSymbol icon="sync_alt" size={14} /> {mapping.snow_table}
                    </Typography>
                    {(mapping.sync_direction === "snow_to_turbo" || mapping.sync_direction === "bidirectional") && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={syncing === mapping.id ? <CircularProgress size={14} /> : <MaterialSymbol icon="cloud_download" size={16} />}
                        disabled={syncing === mapping.id}
                        onClick={() => triggerSync(mapping.id, "pull")}
                      >
                        Pull
                      </Button>
                    )}
                    {(mapping.sync_direction === "turbo_to_snow" || mapping.sync_direction === "bidirectional") && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={syncing === mapping.id ? <CircularProgress size={14} /> : <MaterialSymbol icon="cloud_upload" size={16} />}
                        disabled={syncing === mapping.id}
                        onClick={() => triggerSync(mapping.id, "push")}
                      >
                        Push
                      </Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* Sync Run History */}
      <Typography fontWeight={600} sx={{ mb: 1.5 }}>Sync History</Typography>
      {runs.length === 0 ? (
        <Typography color="text.secondary" variant="body2">No sync runs yet.</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Started</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Direction</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Fetched</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Updated</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Deleted</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Errors</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Duration</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => {
                const stats = run.stats || {};
                const duration = run.started_at && run.completed_at
                  ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
                  : "-";
                return (
                  <TableRow key={run.id} hover>
                    <TableCell sx={{ fontSize: "0.8rem" }}>
                      {run.started_at ? new Date(run.started_at).toLocaleString() : "-"}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={run.direction}
                        size="small"
                        icon={<MaterialSymbol icon={run.direction === "pull" ? "cloud_download" : "cloud_upload"} size={14} />}
                        sx={{ fontSize: "0.7rem", height: 22 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={run.status}
                        size="small"
                        color={
                          run.status === "completed" ? "success" :
                          run.status === "failed" ? "error" :
                          run.status === "running" ? "info" : "default"
                        }
                        sx={{ fontSize: "0.7rem", height: 22 }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.8rem" }}>{stats.fetched ?? stats.processed ?? "-"}</TableCell>
                    <TableCell sx={{ fontSize: "0.8rem", color: (stats.created || 0) > 0 ? "#4caf50" : undefined }}>
                      {stats.created ?? 0}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.8rem", color: (stats.updated || 0) > 0 ? "#1976d2" : undefined }}>
                      {stats.updated ?? 0}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.8rem", color: (stats.deleted || 0) > 0 ? "#f44336" : undefined }}>
                      {stats.deleted ?? 0}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.8rem", color: (stats.errors || 0) > 0 ? "#f44336" : undefined }}>
                      {stats.errors ?? 0}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.8rem" }}>{duration}</TableCell>
                    <TableCell>
                      <Tooltip title="View staged records">
                        <IconButton size="small" onClick={() => loadStaged(run)}>
                          <MaterialSymbol icon="list_alt" size={16} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Staged Records Dialog */}
      <Dialog
        open={!!selectedRun}
        onClose={() => setSelectedRun(null)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          Staged Records — {selectedRun?.direction} sync
          {selectedRun?.started_at && ` (${new Date(selectedRun.started_at).toLocaleString()})`}
        </DialogTitle>
        <DialogContent>
          {stagedLoading ? (
            <LinearProgress />
          ) : stagedRecords.length === 0 ? (
            <Typography color="text.secondary">No staged records for this run.</Typography>
          ) : (
            <TableContainer sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>SNOW sys_id</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Card ID</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Changes</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Error</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stagedRecords.map((sr) => (
                    <TableRow key={sr.id}>
                      <TableCell sx={{ fontSize: "0.75rem", fontFamily: "monospace" }}>
                        {sr.snow_sys_id}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={sr.action}
                          size="small"
                          color={
                            sr.action === "create" ? "success" :
                            sr.action === "update" ? "info" :
                            sr.action === "delete" ? "error" : "default"
                          }
                          sx={{ fontSize: "0.65rem", height: 20 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={sr.status}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: "0.65rem", height: 20 }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontSize: "0.75rem", fontFamily: "monospace" }}>
                        {sr.card_id ? sr.card_id.substring(0, 8) + "..." : "-"}
                      </TableCell>
                      <TableCell sx={{ fontSize: "0.75rem" }}>
                        {sr.diff ? Object.keys(sr.diff).join(", ") : "-"}
                      </TableCell>
                      <TableCell sx={{ fontSize: "0.75rem", color: "#f44336" }}>
                        {sr.error_message || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedRun(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
