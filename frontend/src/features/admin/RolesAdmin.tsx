import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { AppRole } from "@/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PermissionGroup {
  label: string;
  permissions: Record<string, string>;
}

type PermissionsSchema = Record<string, PermissionGroup>;

interface CreateFormState {
  key: string;
  label: string;
  description: string;
  color: string;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  key: "",
  label: "",
  description: "",
  color: "#1976d2",
};

const PRESET_COLORS = [
  "#1976d2",
  "#388e3c",
  "#d32f2f",
  "#f57c00",
  "#7b1fa2",
  "#0097a7",
  "#c2185b",
  "#5d4037",
  "#455a64",
  "#303f9f",
  "#00796b",
  "#afb42b",
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RolesAdmin() {
  /* ---- Data state ---- */
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [schema, setSchema] = useState<PermissionsSchema>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- Selection ---- */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  /* ---- Detail editing state ---- */
  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState("#1976d2");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [editPermissions, setEditPermissions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);

  /* ---- Create dialog ---- */
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  /* ---- Archive confirm dialog ---- */
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AppRole | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Fetch helpers                                                    */
  /* ---------------------------------------------------------------- */

  const fetchRoles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<AppRole[]>(
        `/roles?include_archived=${showArchived}`
      );
      setRoles(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  const fetchSchema = useCallback(async () => {
    try {
      const data = await api.get<PermissionsSchema>("/roles/permissions-schema");
      setSchema(data);
    } catch {
      // Schema fetch failure is not critical for list display
    }
  }, []);

  const fetchRoleDetail = useCallback(async (key: string) => {
    try {
      const role = await api.get<AppRole>(`/roles/${key}`);
      // Update in roles list too (for user_count etc.)
      setRoles((prev) => prev.map((r) => (r.key === key ? role : r)));
      // Populate edit state
      setEditLabel(role.label);
      setEditDescription(role.description || "");
      setEditColor(role.color);
      setEditIsDefault(role.is_default);
      setEditPermissions({ ...role.permissions });
      setDetailError(null);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "Failed to load role details"
      );
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchSchema();
  }, [fetchRoles, fetchSchema]);

  // When selection changes, fetch detail
  useEffect(() => {
    if (selectedKey) {
      fetchRoleDetail(selectedKey);
    }
  }, [selectedKey, fetchRoleDetail]);

  /* ---------------------------------------------------------------- */
  /*  Derived data                                                     */
  /* ---------------------------------------------------------------- */

  const selectedRole = roles.find((r) => r.key === selectedKey) || null;
  const isAdminRole = selectedRole?.key === "admin";
  const isSystemRole = selectedRole?.is_system ?? false;
  const isArchived = selectedRole?.is_archived ?? false;

  const sortedRoles = [...roles].sort((a, b) => a.sort_order - b.sort_order);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleSave = async () => {
    if (!selectedKey || !selectedRole) return;
    if (!editLabel.trim()) {
      setDetailError("Label is required.");
      return;
    }
    try {
      setSaving(true);
      setDetailError(null);
      await api.patch(`/roles/${selectedKey}`, {
        label: editLabel.trim(),
        description: editDescription.trim() || null,
        color: editColor,
        is_default: editIsDefault,
        permissions: editPermissions,
      });
      setSnack("Role saved successfully");
      // Refresh list and detail
      await fetchRoles();
      await fetchRoleDetail(selectedKey);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "Failed to save role"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!createForm.key.trim() || !createForm.label.trim()) {
      setCreateError("Key and label are required.");
      return;
    }
    try {
      setCreateSubmitting(true);
      setCreateError(null);
      const created = await api.post<AppRole>("/roles", {
        key: createForm.key.trim(),
        label: createForm.label.trim(),
        description: createForm.description.trim() || null,
        color: createForm.color,
        permissions: {},
        is_default: false,
      });
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
      await fetchRoles();
      setSelectedKey(created.key);
      setSnack("Role created successfully");
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create role"
      );
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openArchiveConfirm = (role: AppRole) => {
    setArchiveTarget(role);
    setArchiveConfirmOpen(true);
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      await api.post(`/roles/${archiveTarget.key}/archive`);
      setArchiveConfirmOpen(false);
      setArchiveTarget(null);
      if (selectedKey === archiveTarget.key) {
        setSelectedKey(null);
      }
      await fetchRoles();
      setSnack("Role archived");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to archive role"
      );
      setArchiveConfirmOpen(false);
      setArchiveTarget(null);
    }
  };

  const handleRestore = async (key: string) => {
    try {
      await api.post(`/roles/${key}/restore`);
      await fetchRoles();
      if (selectedKey === key) {
        await fetchRoleDetail(key);
      }
      setSnack("Role restored");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to restore role"
      );
    }
  };

  /* ---- Permission helpers ---- */

  const togglePermission = (permKey: string) => {
    if (isAdminRole) return; // Admin has locked wildcard
    setEditPermissions((prev) => ({
      ...prev,
      [permKey]: !prev[permKey],
    }));
  };

  const toggleGroupAll = (group: PermissionGroup) => {
    if (isAdminRole) return;
    const permKeys = Object.keys(group.permissions);
    const allChecked = permKeys.every((k) => editPermissions[k]);
    const updated = { ...editPermissions };
    permKeys.forEach((k) => {
      updated[k] = !allChecked;
    });
    setEditPermissions(updated);
  };

  const getGroupCheckedState = (group: PermissionGroup) => {
    const permKeys = Object.keys(group.permissions);
    if (permKeys.length === 0) return { all: false, some: false };
    const checkedCount = permKeys.filter((k) => editPermissions[k]).length;
    return {
      all: checkedCount === permKeys.length,
      some: checkedCount > 0 && checkedCount < permKeys.length,
    };
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h5" fontWeight={600}>
          Role Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={20} />}
          onClick={() => {
            setCreateForm(EMPTY_CREATE_FORM);
            setCreateError(null);
            setCreateOpen(true);
          }}
        >
          Add Role
        </Button>
      </Box>

      {/* Global error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Two-panel layout */}
      <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
        {/* ============ Left Panel: Role List ============ */}
        <Card
          variant="outlined"
          sx={{ width: 320, minWidth: 280, flexShrink: 0 }}
        >
          <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
            {/* Show archived toggle */}
            <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showArchived}
                    onChange={(e) => {
                      setShowArchived(e.target.checked);
                    }}
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary">
                    Show archived
                  </Typography>
                }
              />
            </Box>
            <Divider />

            {loading && (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography color="text.secondary">Loading roles...</Typography>
              </Box>
            )}

            {!loading && sortedRoles.length === 0 && (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography color="text.secondary">No roles found.</Typography>
              </Box>
            )}

            <List disablePadding>
              {sortedRoles.map((role) => (
                <ListItemButton
                  key={role.key}
                  selected={selectedKey === role.key}
                  onClick={() => setSelectedKey(role.key)}
                  sx={{
                    opacity: role.is_archived ? 0.5 : 1,
                  }}
                >
                  {/* Color dot */}
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      bgcolor: role.color,
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography
                          variant="body2"
                          fontWeight={selectedKey === role.key ? 600 : 400}
                          sx={{
                            textDecoration: role.is_archived
                              ? "line-through"
                              : "none",
                          }}
                        >
                          {role.label}
                        </Typography>
                        {role.is_system && (
                          <Chip
                            size="small"
                            label="System"
                            variant="outlined"
                            sx={{ height: 20, fontSize: "0.7rem" }}
                          />
                        )}
                        {role.is_default && (
                          <Chip
                            size="small"
                            label="Default"
                            color="primary"
                            variant="outlined"
                            sx={{ height: 20, fontSize: "0.7rem" }}
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {role.user_count !== undefined
                          ? `${role.user_count} user${role.user_count !== 1 ? "s" : ""}`
                          : role.key}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          </CardContent>
        </Card>

        {/* ============ Right Panel: Role Detail ============ */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!selectedKey && (
            <Card variant="outlined">
              <CardContent
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  py: 8,
                }}
              >
                <MaterialSymbol
                  icon="shield_person"
                  size={48}
                  color="#bdbdbd"
                />
                <Typography
                  color="text.secondary"
                  sx={{ mt: 1 }}
                  variant="body1"
                >
                  Select a role to view and edit its permissions
                </Typography>
              </CardContent>
            </Card>
          )}

          {selectedKey && selectedRole && (
            <Card variant="outlined">
              <CardContent>
                {/* Detail error */}
                {detailError && (
                  <Alert
                    severity="error"
                    sx={{ mb: 2 }}
                    onClose={() => setDetailError(null)}
                  >
                    {detailError}
                  </Alert>
                )}

                {/* Archived banner */}
                {isArchived && (
                  <Alert
                    severity="warning"
                    sx={{ mb: 2 }}
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        onClick={() => handleRestore(selectedRole.key)}
                      >
                        Restore
                      </Button>
                    }
                  >
                    This role is archived. Users assigned to it retain their
                    current permissions but the role cannot be assigned to new
                    users.
                  </Alert>
                )}

                {/* Role header */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 3,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        bgcolor: selectedRole.color,
                      }}
                    />
                    <Typography variant="h6" fontWeight={600}>
                      {selectedRole.label}
                    </Typography>
                    {isSystemRole && (
                      <Chip size="small" label="System" variant="outlined" />
                    )}
                  </Box>
                  <Box sx={{ display: "flex", gap: 1 }}>
                    {!isArchived && !isAdminRole && (
                      <Tooltip title="Archive role">
                        <IconButton
                          size="small"
                          color="warning"
                          onClick={() => openArchiveConfirm(selectedRole)}
                          disabled={isSystemRole && isAdminRole}
                        >
                          <MaterialSymbol icon="archive" size={20} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* ---- Basic fields ---- */}
                <Stack spacing={2.5} sx={{ mb: 3 }}>
                  {/* Key (read-only) */}
                  <TextField
                    label="Key"
                    value={selectedRole.key}
                    fullWidth
                    size="small"
                    disabled
                    helperText="The role key cannot be changed after creation."
                  />

                  {/* Label */}
                  <TextField
                    label="Label"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    fullWidth
                    size="small"
                    required
                    disabled={isArchived}
                  />

                  {/* Description */}
                  <TextField
                    label="Description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                    maxRows={4}
                    disabled={isArchived}
                  />

                  {/* Color */}
                  <Box>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 1 }}
                    >
                      Color
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        flexWrap: "wrap",
                      }}
                    >
                      {PRESET_COLORS.map((c) => (
                        <Box
                          key={c}
                          onClick={() => {
                            if (!isArchived) setEditColor(c);
                          }}
                          sx={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            bgcolor: c,
                            cursor: isArchived ? "default" : "pointer",
                            border:
                              editColor === c
                                ? "3px solid"
                                : "2px solid transparent",
                            borderColor:
                              editColor === c ? "primary.main" : "transparent",
                            transition: "border-color 0.15s",
                            "&:hover": !isArchived
                              ? { borderColor: "primary.light" }
                              : {},
                          }}
                        />
                      ))}
                      <TextField
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        disabled={isArchived}
                        sx={{
                          width: 56,
                          ml: 1,
                          "& input": { p: 0.5, height: 28, cursor: "pointer" },
                        }}
                        size="small"
                      />
                    </Box>
                  </Box>

                  {/* Is Default toggle */}
                  <FormControlLabel
                    control={
                      <Switch
                        checked={editIsDefault}
                        onChange={(e) => setEditIsDefault(e.target.checked)}
                        disabled={isArchived}
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2">Default role</Typography>
                        <Typography variant="caption" color="text.secondary">
                          New users will be assigned this role automatically.
                        </Typography>
                      </Box>
                    }
                  />

                  {/* User count info */}
                  {selectedRole.user_count !== undefined && (
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        p: 1.5,
                        bgcolor: "action.hover",
                        borderRadius: 1,
                      }}
                    >
                      <MaterialSymbol icon="group" size={20} color="#757575" />
                      <Typography variant="body2" color="text.secondary">
                        {selectedRole.user_count} user
                        {selectedRole.user_count !== 1 ? "s" : ""} assigned to
                        this role
                      </Typography>
                    </Box>
                  )}
                </Stack>

                <Divider sx={{ mb: 3 }} />

                {/* ---- Permissions Editor ---- */}
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                  Permissions
                </Typography>

                {isAdminRole && (
                  <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                    The admin role has full access to all features. Permissions
                    cannot be modified.
                  </Alert>
                )}

                {Object.keys(schema).length === 0 && (
                  <Typography color="text.secondary" variant="body2">
                    Loading permissions schema...
                  </Typography>
                )}

                {Object.entries(schema).map(([groupKey, group]) => {
                  const { all } = getGroupCheckedState(group);
                  const permKeys = Object.keys(group.permissions);

                  return (
                    <Accordion
                      key={groupKey}
                      variant="outlined"
                      disableGutters
                      sx={{
                        mb: 1,
                        "&:before": { display: "none" },
                        borderRadius: 1,
                      }}
                    >
                      <AccordionSummary
                        expandIcon={
                          <MaterialSymbol icon="expand_more" size={20} />
                        }
                        sx={{ minHeight: 48 }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            width: "100%",
                            mr: 1,
                          }}
                        >
                          <Typography variant="body2" fontWeight={600}>
                            {group.label}
                          </Typography>
                          <Chip
                            size="small"
                            label={
                              isAdminRole
                                ? `${permKeys.length}/${permKeys.length}`
                                : `${permKeys.filter((k) => editPermissions[k]).length}/${permKeys.length}`
                            }
                            variant="outlined"
                            sx={{ height: 22, fontSize: "0.75rem" }}
                          />
                          <Box sx={{ flex: 1 }} />
                          {!isAdminRole && !isArchived && (
                            <Button
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroupAll(group);
                              }}
                              sx={{ textTransform: "none", minWidth: "auto" }}
                            >
                              {all ? "Deselect All" : "Select All"}
                            </Button>
                          )}
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails sx={{ pt: 0 }}>
                        {permKeys.map((permKey) => (
                          <FormControlLabel
                            key={permKey}
                            sx={{
                              display: "flex",
                              alignItems: "flex-start",
                              ml: 0,
                              mb: 0.5,
                              "& .MuiFormControlLabel-label": {
                                pt: 0.8,
                              },
                            }}
                            control={
                              <Checkbox
                                size="small"
                                checked={
                                  isAdminRole ? true : !!editPermissions[permKey]
                                }
                                indeterminate={false}
                                onChange={() => togglePermission(permKey)}
                                disabled={isAdminRole || isArchived}
                              />
                            }
                            label={
                              <Box>
                                <Typography variant="body2">
                                  {permKey}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {group.permissions[permKey]}
                                </Typography>
                              </Box>
                            }
                          />
                        ))}
                        {permKeys.length === 0 && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ py: 1 }}
                          >
                            No permissions in this group.
                          </Typography>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  );
                })}

                {/* ---- Action Buttons ---- */}
                {!isArchived && (
                  <>
                    <Divider sx={{ mt: 3, mb: 2 }} />
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 1.5,
                      }}
                    >
                      <Button
                        variant="outlined"
                        onClick={() => {
                          if (selectedKey) fetchRoleDetail(selectedKey);
                        }}
                        disabled={saving}
                      >
                        Reset
                      </Button>
                      <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={saving || isAdminRole}
                        startIcon={
                          <MaterialSymbol icon="save" size={18} />
                        }
                      >
                        {saving ? "Saving..." : "Save Changes"}
                      </Button>
                    </Box>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </Box>
      </Box>

      {/* ============ Create Role Dialog ============ */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Role</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              label="Key"
              value={createForm.key}
              onChange={(e) =>
                setCreateForm((p) => ({
                  ...p,
                  key: e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "_"),
                }))
              }
              fullWidth
              required
              size="small"
              helperText="Unique identifier (lowercase, underscores only). Cannot be changed later."
              autoFocus
            />
            <TextField
              label="Label"
              value={createForm.label}
              onChange={(e) =>
                setCreateForm((p) => ({ ...p, label: e.target.value }))
              }
              fullWidth
              required
              size="small"
            />
            <TextField
              label="Description"
              value={createForm.description}
              onChange={(e) =>
                setCreateForm((p) => ({ ...p, description: e.target.value }))
              }
              fullWidth
              size="small"
              multiline
              minRows={2}
              maxRows={4}
            />
            <Box>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1 }}
              >
                Color
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  flexWrap: "wrap",
                }}
              >
                {PRESET_COLORS.map((c) => (
                  <Box
                    key={c}
                    onClick={() => setCreateForm((p) => ({ ...p, color: c }))}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      bgcolor: c,
                      cursor: "pointer",
                      border:
                        createForm.color === c
                          ? "3px solid"
                          : "2px solid transparent",
                      borderColor:
                        createForm.color === c
                          ? "primary.main"
                          : "transparent",
                      transition: "border-color 0.15s",
                      "&:hover": { borderColor: "primary.light" },
                    }}
                  />
                ))}
                <TextField
                  type="color"
                  value={createForm.color}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, color: e.target.value }))
                  }
                  sx={{
                    width: 56,
                    ml: 1,
                    "& input": { p: 0.5, height: 28, cursor: "pointer" },
                  }}
                  size="small"
                />
              </Box>
            </Box>
            {createError && <Alert severity="error">{createError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setCreateOpen(false)}
            disabled={createSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={
              createSubmitting ||
              !createForm.key.trim() ||
              !createForm.label.trim()
            }
          >
            {createSubmitting ? "Creating..." : "Create Role"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ============ Archive Confirmation Dialog ============ */}
      <Dialog
        open={archiveConfirmOpen}
        onClose={() => setArchiveConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Archive Role</DialogTitle>
        <DialogContent>
          {archiveTarget && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography>
                Are you sure you want to archive the role{" "}
                <strong>{archiveTarget.label}</strong>?
              </Typography>
              {archiveTarget.user_count !== undefined &&
                archiveTarget.user_count > 0 && (
                  <Alert severity="warning" variant="outlined">
                    This role is currently assigned to{" "}
                    <strong>
                      {archiveTarget.user_count} user
                      {archiveTarget.user_count !== 1 ? "s" : ""}
                    </strong>
                    . Affected users will retain their current permissions but
                    the role will no longer be available for new assignments.
                  </Alert>
                )}
              <Typography variant="body2" color="text.secondary">
                You can restore an archived role at any time.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setArchiveConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={handleArchive}>
            Archive
          </Button>
        </DialogActions>
      </Dialog>

      {/* ============ Success Snackbar ============ */}
      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
