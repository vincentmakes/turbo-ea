import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import { useResolveMetaLabel, useResolveLabel } from "@/hooks/useResolveLabel";
import type { SnowConnection, SnowMapping, SnowSyncRun, SnowStagedRecord, CardType } from "@/types";

// ---------------------------------------------------------------------------
// Helpers — derive Turbo EA field path options from a card type
// ---------------------------------------------------------------------------

interface TurboFieldOption {
  path: string;
  label: string;
  group: string;
}

function getTurboFieldOptions(
  cardType: CardType | undefined,
  rl?: (label: string, translations?: Record<string, string>) => string,
): TurboFieldOption[] {
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
          label: rl ? rl(field.label, field.translations) : field.label,
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
  const { t } = useTranslation(["admin", "common"]);
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={t("servicenow.tabs.connections")} />
        <Tab label={t("servicenow.tabs.mappings")} />
        <Tab label={t("servicenow.tabs.syncDashboard")} />
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
  const { t } = useTranslation(["admin", "common"]);
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
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
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
      setTestResult({ id, success: false, message: e instanceof Error ? e.message : t("common:errors.generic") });
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("servicenow.connections.deleteConfirm"))) return;
    try {
      await api.delete(`/servicenow/connections/${id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
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
          {t("servicenow.connections.addConnection")}
        </Button>
      </Box>

      {connections.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="cloud_off" size={48} color="#ccc" />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {t("servicenow.connections.noConnections")}
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
                      label={conn.test_status === "success" ? t("servicenow.connections.connected") : t("servicenow.connections.failed")}
                      size="small"
                      color={conn.test_status === "success" ? "success" : "error"}
                      sx={{ fontWeight: 600, fontSize: "0.7rem" }}
                    />
                  )}
                  {!conn.is_active && (
                    <Chip label={t("servicenow.connections.inactive")} size="small" color="default" />
                  )}
                  <Chip
                    label={t("servicenow.connections.mappingCount", { count: conn.mapping_count })}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: "0.7rem" }}
                  />
                  <Tooltip title={t("servicenow.connections.testTooltip")}>
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
                  <Tooltip title={t("common:actions.edit")}>
                    <IconButton
                      size="small"
                      onClick={() => { setEditing(conn); setDialogOpen(true); }}
                    >
                      <MaterialSymbol icon="edit" size={18} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("common:actions.delete")}>
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
  const { t } = useTranslation(["admin", "common"]);
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
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{connection ? t("servicenow.connections.dialog.editConnection") : t("servicenow.connections.dialog.newConnection")}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t("common:labels.name")}
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("servicenow.connections.dialog.namePlaceholder")}
          />
          <TextField
            label={t("servicenow.connections.dialog.instanceUrl")}
            fullWidth
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            placeholder={t("servicenow.connections.dialog.instanceUrlPlaceholder")}
            helperText={t("servicenow.connections.dialog.instanceUrlHelper")}
          />
          <FormControl fullWidth>
            <InputLabel>{t("servicenow.connections.dialog.authType")}</InputLabel>
            <Select value={authType} label={t("servicenow.connections.dialog.authType")} onChange={(e) => setAuthType(e.target.value)}>
              <MenuItem value="basic">{t("servicenow.connections.dialog.basicAuth")}</MenuItem>
              <MenuItem value="oauth2">{t("servicenow.connections.dialog.oauth2")}</MenuItem>
            </Select>
          </FormControl>
          {authType === "basic" ? (
            <>
              <TextField
                label={t("servicenow.connections.dialog.username")}
                fullWidth
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <TextField
                label={t("servicenow.connections.dialog.password")}
                type="password"
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={connection ? t("servicenow.connections.dialog.keepExisting") : ""}
              />
            </>
          ) : (
            <>
              <TextField
                label={t("servicenow.connections.dialog.clientId")}
                fullWidth
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <TextField
                label={t("servicenow.connections.dialog.clientSecret")}
                type="password"
                fullWidth
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={connection ? t("servicenow.connections.dialog.keepExisting") : ""}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name || !instanceUrl}
        >
          {saving ? <CircularProgress size={20} /> : connection ? t("common:actions.save") : t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Mappings
// ---------------------------------------------------------------------------

function MappingsTab() {
  const { t } = useTranslation(["admin", "common"]);
  const [connections, setConnections] = useState<SnowConnection[]>([]);
  const [mappings, setMappings] = useState<SnowMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SnowMapping | null>(null);
  const { types } = useMetamodel();
  const rml = useResolveMetaLabel();

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
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm(t("common:actions.delete") + "?")) return;
    try {
      await api.delete(`/servicenow/mappings/${id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    }
  };

  const handleToggleActive = async (mapping: SnowMapping) => {
    try {
      await api.patch(`/servicenow/mappings/${mapping.id}`, { is_active: !mapping.is_active });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    }
  };

  if (loading) return <LinearProgress />;

  if (connections.length === 0) {
    return (
      <Alert severity="info">
        {t("servicenow.mappings.noConnectionsHint")}
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
          {t("servicenow.mappings.addMapping")}
        </Button>
      </Box>

      {mappings.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="swap_horiz" size={48} color="#ccc" />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {t("servicenow.mappings.noMappings")}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {mappings.map((mapping) => {
            const conn = connections.find((c) => c.id === mapping.connection_id);
            const ct = types.find((tp) => tp.key === mapping.card_type_key);
            return (
              <Card key={mapping.id} variant="outlined" sx={{ opacity: mapping.is_active ? 1 : 0.6 }}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    <MaterialSymbol
                      icon={ct?.icon || "swap_horiz"}
                      size={24}
                      color={ct?.color || "#999"}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={600}>
                        {rml(ct?.label ?? "", ct?.translations, "label") || mapping.card_type_key}
                        {" "}
                        <Typography component="span" color="text.secondary" fontSize="0.85rem">
                          <MaterialSymbol icon="sync_alt" size={14} /> {mapping.snow_table}
                        </Typography>
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {conn?.name || t("servicenow.mappings.unknownConnection")} &middot;{" "}
                        {mapping.sync_direction.replace(/_/g, " ")} &middot;{" "}
                        {t("servicenow.mappings.mode", { mode: mapping.sync_mode })} &middot;{" "}
                        {t("servicenow.mappings.fieldCount", { count: mapping.field_mappings.length })}
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
                      label={t("common:status.active")}
                      sx={{ mr: 1 }}
                    />
                    <Tooltip title={t("common:actions.edit")}>
                      <IconButton
                        size="small"
                        onClick={() => { setEditing(mapping); setDialogOpen(true); }}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("common:actions.delete")}>
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
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>{t("servicenow.mappings.columns.turboField")}</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>{t("servicenow.mappings.columns.snowField")}</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>{t("servicenow.mappings.columns.direction")}</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>{t("servicenow.mappings.columns.transform")}</TableCell>
                            <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem" }}>{t("servicenow.mappings.columns.identity")}</TableCell>
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
                                  label={fm.direction === "snow_leads" ? t("servicenow.mappings.direction.snowLeads") : t("servicenow.mappings.direction.turboLeads")}
                                  size="small"
                                  sx={{ fontSize: "0.65rem", height: 20 }}
                                  color={fm.direction === "snow_leads" ? "info" : "warning"}
                                />
                              </TableCell>
                              <TableCell sx={{ fontSize: "0.8rem" }}>
                                {fm.transform_type || t("servicenow.mappings.dialog.direct")}
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
  const { t } = useTranslation(["admin", "common"]);
  const { types } = useMetamodel();
  const rml = useResolveMetaLabel();
  const rl = useResolveLabel();
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
    () => types.find((ct) => ct.key === cardTypeKey),
    [types, cardTypeKey],
  );
  const turboFieldOptions = useMemo(
    () => getTurboFieldOptions(selectedCardType, rl),
    [selectedCardType, rl],
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
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{mapping ? t("servicenow.mappings.dialog.editMapping") : t("servicenow.mappings.dialog.newMapping")}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth>
            <InputLabel>{t("servicenow.mappings.dialog.connection")}</InputLabel>
            <Select
              value={connectionId}
              label={t("servicenow.mappings.dialog.connection")}
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
              <InputLabel>{t("common:labels.type")}</InputLabel>
              <Select
                value={cardTypeKey}
                label={t("common:labels.type")}
                onChange={(e) => setCardTypeKey(e.target.value)}
              >
                {types.filter((ct) => !ct.is_hidden).map((ct) => (
                  <MenuItem key={ct.key} value={ct.key}>{rml(ct.label, ct.translations, "label")}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label={t("servicenow.mappings.dialog.snowTable")}
              fullWidth
              value={snowTable}
              onChange={(e) => setSnowTable(e.target.value)}
              placeholder={t("servicenow.mappings.dialog.snowTablePlaceholder")}
            />
          </Box>

          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>{t("servicenow.mappings.dialog.syncDirection")}</InputLabel>
              <Select
                value={syncDirection}
                label={t("servicenow.mappings.dialog.syncDirection")}
                onChange={(e) => setSyncDirection(e.target.value)}
              >
                <MenuItem value="snow_to_turbo">{t("servicenow.mappings.dialog.snowToTurbo")}</MenuItem>
                <MenuItem value="turbo_to_snow">{t("servicenow.mappings.dialog.turboToSnow")}</MenuItem>
                <MenuItem value="bidirectional">{t("servicenow.mappings.dialog.bidirectional")}</MenuItem>
              </Select>
              <FormHelperText>
                {t("servicenow.mappings.dialog.syncDirectionHelper")}
              </FormHelperText>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>{t("servicenow.mappings.dialog.syncMode")}</InputLabel>
              <Select
                value={syncMode}
                label={t("servicenow.mappings.dialog.syncMode")}
                onChange={(e) => setSyncMode(e.target.value)}
              >
                <MenuItem value="additive">{t("servicenow.mappings.dialog.additive")}</MenuItem>
                <MenuItem value="conservative">{t("servicenow.mappings.dialog.conservative")}</MenuItem>
                <MenuItem value="strict">{t("servicenow.mappings.dialog.strict")}</MenuItem>
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
            label={t("servicenow.mappings.dialog.skipStaging")}
          />
          {skipStaging && (
            <Alert severity="warning" sx={{ mt: -1 }}>
              {t("servicenow.mappings.dialog.skipStagingWarning")}
            </Alert>
          )}

          <Box>
            <Typography variant="body2" gutterBottom>
              {t("servicenow.mappings.dialog.maxDeletionRatio", { value: Math.round(maxDeletionRatio * 100) })}
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
            label={t("servicenow.mappings.dialog.filterQuery")}
            fullWidth
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t("servicenow.mappings.dialog.filterQueryPlaceholder")}
            helperText={t("servicenow.mappings.dialog.filterQueryHelper")}
          />

          <Divider />

          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography fontWeight={600}>{t("servicenow.mappings.dialog.fieldMappings")}</Typography>
            <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={addFieldMapping}>
              {t("servicenow.mappings.dialog.addField")}
            </Button>
          </Box>

          {!cardTypeKey && fieldMappings.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("servicenow.mappings.dialog.selectCardTypeHint")}
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
                  <TextField {...params} label={t("servicenow.mappings.dialog.turboEaField")} placeholder="name" />
                )}
                sx={{ flex: 1 }}
              />
              <MaterialSymbol icon="sync_alt" size={16} color="#999" />
              <TextField
                label={t("servicenow.mappings.dialog.snowFieldLabel")}
                size="small"
                value={fm.snow_field}
                onChange={(e) => updateFieldMapping(idx, "snow_field", e.target.value)}
                placeholder="name"
                sx={{ flex: 1 }}
              />
              <Tooltip title={t("servicenow.mappings.dialog.fieldDirectionTooltip")}>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <Select
                    value={fm.direction}
                    onChange={(e) => updateFieldMapping(idx, "direction", e.target.value)}
                  >
                    <MenuItem value="snow_leads">{t("servicenow.mappings.direction.snowLeads")}</MenuItem>
                    <MenuItem value="turbo_leads">{t("servicenow.mappings.direction.turboLeads")}</MenuItem>
                  </Select>
                </FormControl>
              </Tooltip>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                  value={fm.transform_type}
                  onChange={(e) => updateFieldMapping(idx, "transform_type", e.target.value)}
                >
                  <MenuItem value="direct">{t("servicenow.mappings.dialog.direct")}</MenuItem>
                  <MenuItem value="value_map">{t("servicenow.mappings.dialog.valueMap")}</MenuItem>
                  <MenuItem value="date_format">{t("servicenow.mappings.dialog.dateFormat")}</MenuItem>
                  <MenuItem value="boolean">{t("servicenow.mappings.dialog.boolean")}</MenuItem>
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
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !connectionId || !cardTypeKey || !snowTable}
        >
          {saving ? <CircularProgress size={20} /> : mapping ? t("common:actions.save") : t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Sync Dashboard
// ---------------------------------------------------------------------------

function SyncDashboardTab() {
  const { t } = useTranslation(["admin", "common"]);
  const [mappings, setMappings] = useState<SnowMapping[]>([]);
  const [runs, setRuns] = useState<SnowSyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<SnowSyncRun | null>(null);
  const [stagedRecords, setStagedRecords] = useState<SnowStagedRecord[]>([]);
  const [stagedLoading, setStagedLoading] = useState(false);
  const { types } = useMetamodel();
  const rml = useResolveMetaLabel();

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
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
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
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
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
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setStagedLoading(false);
    }
  };

  if (loading) return <LinearProgress />;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      {/* Active mappings with sync triggers */}
      <Typography fontWeight={600} sx={{ mb: 1.5 }}>{t("servicenow.sync.activeMappings")}</Typography>
      {mappings.filter((m) => m.is_active).length === 0 ? (
        <Alert severity="info" sx={{ mb: 3 }}>{t("servicenow.sync.noActiveMappings")}</Alert>
      ) : (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {mappings.filter((m) => m.is_active).map((mapping) => {
            const ct = types.find((tp) => tp.key === mapping.card_type_key);
            return (
              <Card key={mapping.id} variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    <MaterialSymbol
                      icon={ct?.icon || "swap_horiz"}
                      size={20}
                      color={ct?.color || "#999"}
                    />
                    <Typography fontWeight={500} sx={{ flex: 1 }}>
                      {rml(ct?.label ?? "", ct?.translations, "label") || mapping.card_type_key} <MaterialSymbol icon="sync_alt" size={14} /> {mapping.snow_table}
                    </Typography>
                    {(mapping.sync_direction === "snow_to_turbo" || mapping.sync_direction === "bidirectional") && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={syncing === mapping.id ? <CircularProgress size={14} /> : <MaterialSymbol icon="cloud_download" size={16} />}
                        disabled={syncing === mapping.id}
                        onClick={() => triggerSync(mapping.id, "pull")}
                      >
                        {t("servicenow.sync.pull")}
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
                        {t("servicenow.sync.push")}
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
      <Typography fontWeight={600} sx={{ mb: 1.5 }}>{t("servicenow.sync.history")}</Typography>
      {runs.length === 0 ? (
        <Typography color="text.secondary" variant="body2">{t("servicenow.sync.noRuns")}</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.started")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.direction")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.status")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.fetched")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.created")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.updated")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.deleted")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.errors")}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.columns.duration")}</TableCell>
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
                      <Tooltip title={t("servicenow.sync.viewStaged")}>
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
          {t("servicenow.sync.stagedRecords")} — {selectedRun?.direction} sync
          {selectedRun?.started_at && ` (${new Date(selectedRun.started_at).toLocaleString()})`}
        </DialogTitle>
        <DialogContent>
          {stagedLoading ? (
            <LinearProgress />
          ) : stagedRecords.length === 0 ? (
            <Typography color="text.secondary">{t("servicenow.sync.noStagedRecords")}</Typography>
          ) : (
            <TableContainer sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.staged.sysId")}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.staged.action")}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.staged.status")}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.staged.cardId")}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.staged.changes")}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{t("servicenow.sync.staged.error")}</TableCell>
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
          <Button onClick={() => setSelectedRun(null)}>{t("common:actions.close")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
