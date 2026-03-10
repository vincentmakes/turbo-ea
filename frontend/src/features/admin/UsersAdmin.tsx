import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import { api } from "@/api/client";
import type { User, SsoInvitation, AppRole } from "@/types";
import MaterialSymbol from "@/components/MaterialSymbol";
import RolesAdmin from "@/features/admin/RolesAdmin";

interface InviteFormState {
  email: string;
  display_name: string;
  password: string;
  role: string;
  send_email: boolean;
}

const EMPTY_INVITE: InviteFormState = {
  email: "",
  display_name: "",
  password: "",
  role: "member",
  send_email: true,
};

interface EditFormState {
  email: string;
  display_name: string;
  password: string;
  role: string;
  auth_provider: string;
}

export default function UsersAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteFormState>(EMPTY_INVITE);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    email: "",
    display_name: "",
    password: "",
    role: "member",
    auth_provider: "local",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Roles
  const [roles, setRoles] = useState<AppRole[]>([]);

  // Pending invitations
  const [invitations, setInvitations] = useState<SsoInvitation[]>([]);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  const fetchRoles = useCallback(async () => {
    try {
      const data = await api.get<AppRole[]>("/roles");
      setRoles(data);
    } catch {
      // Silently fail — roles are supplementary; table still works
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<User[]>("/users");
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const data = await api.get<SsoInvitation[]>("/users/invitations");
      setInvitations(data);
    } catch {
      // Silently fail — invitations are supplementary
    }
  }, []);

  const fetchSsoStatus = useCallback(async () => {
    try {
      const data = await api.get<{ enabled: boolean }>("/settings/sso/status");
      setSsoEnabled(data.enabled);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchUsers();
    fetchInvitations();
    fetchSsoStatus();
  }, [fetchRoles, fetchUsers, fetchInvitations, fetchSsoStatus]);

  // --- Inline role update ---
  const updateRole = async (userId: string, role: string) => {
    try {
      await api.patch(`/users/${userId}`, { role });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  };

  // --- Toggle active/inactive ---
  const toggleActive = async (user: User) => {
    try {
      const updated = await api.patch<User>(`/users/${user.id}`, {
        is_active: !user.is_active,
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("common:errors.generic")
      );
    }
  };

  // --- Delete (soft-delete) ---
  const handleDelete = async (user: User) => {
    const confirmed = window.confirm(
      t("users.deleteConfirm", { name: user.display_name || user.email })
    );
    if (!confirmed) return;
    try {
      await api.delete(`/users/${user.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  };

  // --- Invite dialog ---
  const openInvite = () => {
    setInviteForm(EMPTY_INVITE);
    setInviteError(null);
    setInviteOpen(true);
  };

  const handleInvite = async () => {
    if (!inviteForm.email.trim() || !inviteForm.display_name.trim()) {
      setInviteError(t("users.invite.requiredFields"));
      return;
    }
    try {
      setInviteSubmitting(true);
      setInviteError(null);
      const created = await api.post<User>("/users", {
        email: inviteForm.email.trim(),
        display_name: inviteForm.display_name.trim(),
        password: inviteForm.password || null,
        role: inviteForm.role,
        send_email: inviteForm.send_email,
      });
      setUsers((prev) => [...prev, created]);
      setInviteOpen(false);
      // Refresh invitations since one was created alongside the user
      fetchInvitations();
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : t("common:errors.generic")
      );
    } finally {
      setInviteSubmitting(false);
    }
  };

  // --- Edit dialog ---
  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      email: user.email,
      display_name: user.display_name,
      password: "",
      role: user.role,
      auth_provider: user.auth_provider || "local",
    });
    setEditError(null);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    if (!editForm.email.trim() || !editForm.display_name.trim()) {
      setEditError(t("users.edit.requiredFields"));
      return;
    }
    const payload: Record<string, string> = {
      email: editForm.email.trim(),
      display_name: editForm.display_name.trim(),
      role: editForm.role,
      auth_provider: editForm.auth_provider,
    };
    if (editForm.password) {
      payload.password = editForm.password;
    }
    try {
      setEditSubmitting(true);
      setEditError(null);
      const updated = await api.patch<User>(
        `/users/${editingUser.id}`,
        payload
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u))
      );
      setEditOpen(false);
      setEditingUser(null);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : t("common:errors.generic")
      );
    } finally {
      setEditSubmitting(false);
    }
  };

  // --- Delete invitation ---
  const handleDeleteInvitation = async (inv: SsoInvitation) => {
    try {
      await api.delete(`/users/invitations/${inv.id}`);
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("common:errors.generic")
      );
    }
  };

  // Build a map from role key to AppRole for quick lookups
  const roleMap = new Map(roles.map((r) => [r.key, r]));
  const activeRoles = roles.filter((r) => !r.is_archived);

  // Helper: get role chip for a user's role
  const getRoleChip = (roleKey: string) => {
    const role = roleMap.get(roleKey);
    if (role) {
      return (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Chip
            size="small"
            label={role.label}
            sx={{
              bgcolor: role.color + "22",
              color: role.color,
              fontWeight: 600,
              border: `1px solid ${role.color}44`,
            }}
          />
          {role.is_archived && (
            <Tooltip title={t("users.archivedRoleTooltip")}>
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                <MaterialSymbol icon="warning" size={16} color="#ed6c02" />
              </span>
            </Tooltip>
          )}
        </Stack>
      );
    }
    // Fallback when role is not found in the list (e.g., roles not loaded yet)
    return <Chip size="small" label={roleKey} variant="outlined" />;
  };

  const isEditingSsoUser = editForm.auth_provider === "sso";

  // Helper to get auth status chip
  const getAuthChip = (u: User) => {
    if (u.auth_provider === "sso") {
      if (u.has_password) {
        return (
          <Chip size="small" label={t("users.auth.ssoPassword")} color="info" variant="outlined" />
        );
      }
      return <Chip size="small" label={t("users.auth.sso")} color="info" variant="outlined" />;
    }
    if (u.pending_setup) {
      return (
        <Chip size="small" label={t("users.auth.pendingSetup")} color="warning" variant="outlined" />
      );
    }
    return <Chip size="small" label={t("users.auth.local")} color="default" variant="outlined" />;
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        {t("users.title")}
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={t("users.tabs.users")} />
        <Tab label={t("users.tabs.roles")} />
      </Tabs>

      {/* ============================================================ */}
      {/*  TAB 0 -- Users                                              */}
      {/* ============================================================ */}
      {tab === 0 && (<Box>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="person_add" size={20} />}
          onClick={openInvite}
        >
          {t("users.inviteUser")}
        </Button>
      </Box>

      {/* Error banner */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Users table */}
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t("users.columns.name")}</TableCell>
              <TableCell>{t("users.columns.email")}</TableCell>
              <TableCell>{t("users.columns.role")}</TableCell>
              <TableCell>{t("users.columns.auth")}</TableCell>
              <TableCell>{t("users.columns.status")}</TableCell>
              <TableCell>{t("users.columns.lastLogin")}</TableCell>
              <TableCell align="right">{t("users.columns.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {t("users.loadingUsers")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!loading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {t("users.noUsers")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              users.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>{u.display_name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    {roles.length > 0 ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Select
                          size="small"
                          value={u.role}
                          onChange={(e) => updateRole(u.id, e.target.value)}
                          sx={{ minWidth: 130 }}
                          renderValue={(val) => {
                            const r = roleMap.get(val);
                            return r ? (
                              <Chip
                                size="small"
                                label={r.label}
                                sx={{
                                  bgcolor: r.color + "22",
                                  color: r.color,
                                  fontWeight: 600,
                                  border: `1px solid ${r.color}44`,
                                }}
                              />
                            ) : val;
                          }}
                        >
                          {activeRoles.map((r) => (
                            <MenuItem key={r.key} value={r.key}>
                              <Chip
                                size="small"
                                label={r.label}
                                sx={{
                                  bgcolor: r.color + "22",
                                  color: r.color,
                                  fontWeight: 600,
                                  border: `1px solid ${r.color}44`,
                                  pointerEvents: "none",
                                }}
                              />
                            </MenuItem>
                          ))}
                          {/* Keep current role as option if it is archived */}
                          {roleMap.get(u.role)?.is_archived && (
                            <MenuItem value={u.role} disabled>
                              <Chip
                                size="small"
                                label={roleMap.get(u.role)!.label}
                                sx={{
                                  bgcolor: roleMap.get(u.role)!.color + "22",
                                  color: roleMap.get(u.role)!.color,
                                  fontWeight: 600,
                                  border: `1px solid ${roleMap.get(u.role)!.color}44`,
                                  pointerEvents: "none",
                                }}
                              />
                            </MenuItem>
                          )}
                        </Select>
                        {roleMap.get(u.role)?.is_archived && (
                          <Tooltip title={t("users.archivedRoleWarning")}>
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              <MaterialSymbol icon="warning" size={18} color="#ed6c02" />
                            </span>
                          </Tooltip>
                        )}
                      </Stack>
                    ) : (
                      getRoleChip(u.role)
                    )}
                  </TableCell>
                  <TableCell>{getAuthChip(u)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={u.is_active ? t("users.status.active") : t("users.status.disabled")}
                      color={u.is_active ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {u.last_login
                        ? new Date(u.last_login).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t("users.editTooltip")}>
                      <IconButton size="small" onClick={() => openEdit(u)}>
                        <MaterialSymbol icon="edit" size={20} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip
                      title={u.is_active ? t("users.deactivateTooltip") : t("users.activateTooltip")}
                    >
                      <IconButton
                        size="small"
                        onClick={() => toggleActive(u)}
                        color={u.is_active ? "warning" : "success"}
                      >
                        <MaterialSymbol
                          icon={u.is_active ? "person_off" : "person"}
                          size={20}
                        />
                      </IconButton>
                    </Tooltip>
                    {!u.is_active && (
                      <Tooltip title={t("users.deleteTooltip")}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(u)}
                        >
                          <MaterialSymbol icon="delete" size={20} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
            {t("users.pendingInvitations")}
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("users.invitations.email")}</TableCell>
                  <TableCell>{t("users.invitations.role")}</TableCell>
                  <TableCell>{t("users.invitations.invited")}</TableCell>
                  <TableCell align="right">{t("users.columns.actions")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id} hover>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>
                      {getRoleChip(inv.role)}
                    </TableCell>
                    <TableCell>
                      {inv.created_at
                        ? new Date(inv.created_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t("users.invitations.revokeTooltip")}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteInvitation(inv)}
                        >
                          <MaterialSymbol icon="delete" size={20} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Invite User Dialog */}
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("users.invite.title")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {ssoEnabled && (
              <Alert severity="info" variant="outlined">
                {t("users.invite.ssoHint")}
              </Alert>
            )}
            {!ssoEnabled && (
              <Alert severity="info" variant="outlined">
                {t("users.invite.emailHint")}
              </Alert>
            )}
            <TextField
              label={t("users.invite.displayName")}
              value={inviteForm.display_name}
              onChange={(e) =>
                setInviteForm((p) => ({ ...p, display_name: e.target.value }))
              }
              fullWidth
              required
              autoFocus
              size="small"
            />
            <TextField
              label={t("users.columns.email")}
              type="email"
              value={inviteForm.email}
              onChange={(e) =>
                setInviteForm((p) => ({ ...p, email: e.target.value }))
              }
              fullWidth
              required
              size="small"
            />
            <TextField
              label={t("users.invite.passwordOptional")}
              type="password"
              value={inviteForm.password}
              onChange={(e) =>
                setInviteForm((p) => ({ ...p, password: e.target.value }))
              }
              fullWidth
              size="small"
              helperText={
                ssoEnabled
                  ? t("users.invite.passwordSsoHelperText")
                  : t("users.invite.passwordHelperText")
              }
            />
            <FormControl fullWidth size="small">
              <InputLabel>{t("users.columns.role")}</InputLabel>
              <Select
                label={t("users.columns.role")}
                value={inviteForm.role}
                onChange={(e) =>
                  setInviteForm((p) => ({
                    ...p,
                    role: e.target.value as string,
                  }))
                }
              >
                {activeRoles.map((r) => (
                  <MenuItem key={r.key} value={r.key}>
                    <Chip
                      size="small"
                      label={r.label}
                      sx={{
                        bgcolor: r.color + "22",
                        color: r.color,
                        fontWeight: 600,
                        border: `1px solid ${r.color}44`,
                        pointerEvents: "none",
                      }}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Checkbox
                  checked={inviteForm.send_email}
                  onChange={(e) =>
                    setInviteForm((p) => ({
                      ...p,
                      send_email: e.target.checked,
                    }))
                  }
                />
              }
              label={t("users.invite.sendEmail")}
            />
            {inviteError && <Alert severity="error">{inviteError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setInviteOpen(false)}
            disabled={inviteSubmitting}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={handleInvite}
            disabled={inviteSubmitting}
          >
            {inviteSubmitting ? t("users.invite.inviting") : t("users.inviteUser")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("users.edit.title")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              label={t("users.invite.displayName")}
              value={editForm.display_name}
              onChange={(e) =>
                setEditForm((p) => ({ ...p, display_name: e.target.value }))
              }
              fullWidth
              required
              size="small"
            />
            <TextField
              label={t("users.columns.email")}
              type="email"
              value={editForm.email}
              onChange={(e) =>
                setEditForm((p) => ({ ...p, email: e.target.value }))
              }
              fullWidth
              required
              size="small"
            />
            {ssoEnabled && (
              <FormControl fullWidth size="small">
                <InputLabel>{t("users.edit.authMethod")}</InputLabel>
                <Select
                  label={t("users.edit.authMethod")}
                  value={editForm.auth_provider}
                  onChange={(e) =>
                    setEditForm((p) => ({
                      ...p,
                      auth_provider: e.target.value as string,
                      password: "",
                    }))
                  }
                >
                  <MenuItem value="local">{t("users.auth.local")}</MenuItem>
                  <MenuItem value="sso">{t("users.auth.sso")}</MenuItem>
                </Select>
              </FormControl>
            )}
            {!isEditingSsoUser && (
              <TextField
                label={t("users.edit.passwordKeep")}
                type="password"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, password: e.target.value }))
                }
                fullWidth
                size="small"
              />
            )}
            {isEditingSsoUser && (
              <Alert severity="info" variant="outlined">
                {t("users.edit.ssoPasswordHint")}
              </Alert>
            )}
            <FormControl fullWidth size="small">
              <InputLabel>{t("users.columns.role")}</InputLabel>
              <Select
                label={t("users.columns.role")}
                value={editForm.role}
                onChange={(e) =>
                  setEditForm((p) => ({
                    ...p,
                    role: e.target.value as string,
                  }))
                }
              >
                {activeRoles.map((r) => (
                  <MenuItem key={r.key} value={r.key}>
                    <Chip
                      size="small"
                      label={r.label}
                      sx={{
                        bgcolor: r.color + "22",
                        color: r.color,
                        fontWeight: 600,
                        border: `1px solid ${r.color}44`,
                        pointerEvents: "none",
                      }}
                    />
                  </MenuItem>
                ))}
                {/* Keep current role as option if it is archived */}
                {editForm.role && roleMap.get(editForm.role)?.is_archived && (
                  <MenuItem value={editForm.role} disabled>
                    <Chip
                      size="small"
                      label={roleMap.get(editForm.role)!.label}
                      sx={{
                        bgcolor: roleMap.get(editForm.role)!.color + "22",
                        color: roleMap.get(editForm.role)!.color,
                        fontWeight: 600,
                        border: `1px solid ${roleMap.get(editForm.role)!.color}44`,
                        pointerEvents: "none",
                      }}
                    />
                  </MenuItem>
                )}
              </Select>
            </FormControl>
            {editForm.role && roleMap.get(editForm.role)?.is_archived && (
              <Alert severity="warning" variant="outlined">
                {t("users.edit.archivedRoleWarning")}
              </Alert>
            )}
            {editError && <Alert severity="error">{editError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)} disabled={editSubmitting}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={handleEdit}
            disabled={editSubmitting}
          >
            {editSubmitting ? t("users.edit.saving") : t("users.edit.saveChanges")}
          </Button>
        </DialogActions>
      </Dialog>
      </Box>)}

      {/* ============================================================ */}
      {/*  TAB 1 -- Roles                                              */}
      {/* ============================================================ */}
      {tab === 1 && <RolesAdmin />}
    </Box>
  );
}
