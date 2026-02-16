import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
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
}

export default function UsersAdmin() {
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
      setError(err instanceof Error ? err.message : "Failed to load users");
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
      setError(err instanceof Error ? err.message : "Failed to update role");
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
        err instanceof Error ? err.message : "Failed to toggle user status"
      );
    }
  };

  // --- Delete (soft-delete) ---
  const handleDelete = async (user: User) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${user.display_name || user.email}"? This action cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.delete(`/users/${user.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
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
      setInviteError("Email and display name are required.");
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
        err instanceof Error ? err.message : "Failed to invite user"
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
    });
    setEditError(null);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    if (!editForm.email.trim() || !editForm.display_name.trim()) {
      setEditError("Email and display name are required.");
      return;
    }
    const payload: Record<string, string> = {
      email: editForm.email.trim(),
      display_name: editForm.display_name.trim(),
      role: editForm.role,
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
        err instanceof Error ? err.message : "Failed to update user"
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
        err instanceof Error ? err.message : "Failed to delete invitation"
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
            <Tooltip title="Archived role">
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                <MaterialSymbol icon="warning" size={16} sx={{ color: "warning.main" }} />
              </span>
            </Tooltip>
          )}
        </Stack>
      );
    }
    // Fallback when role is not found in the list (e.g., roles not loaded yet)
    return <Chip size="small" label={roleKey} variant="outlined" />;
  };

  const isEditingSsoUser = editingUser?.auth_provider === "sso";

  // Helper to get auth status chip
  const getAuthChip = (u: User) => {
    if (u.auth_provider === "sso") {
      if (u.has_password) {
        return (
          <Chip size="small" label="SSO + Password" color="info" variant="outlined" />
        );
      }
      return <Chip size="small" label="SSO" color="info" variant="outlined" />;
    }
    if (u.pending_setup) {
      return (
        <Chip size="small" label="Pending Setup" color="warning" variant="outlined" />
      );
    }
    return <Chip size="small" label="Local" color="default" variant="outlined" />;
  };

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
          User Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="person_add" size={20} />}
          onClick={openInvite}
        >
          Invite User
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
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Auth</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    Loading users...
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!loading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    No users found.
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
                          <Tooltip title="This user has an archived role. Consider reassigning.">
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              <MaterialSymbol icon="warning" size={18} sx={{ color: "warning.main" }} />
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
                      label={u.is_active ? "Active" : "Disabled"}
                      color={u.is_active ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit user">
                      <IconButton size="small" onClick={() => openEdit(u)}>
                        <MaterialSymbol icon="edit" size={20} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip
                      title={u.is_active ? "Deactivate user" : "Activate user"}
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
                      <Tooltip title="Delete user">
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
            Pending Invitations
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Pre-assigned Role</TableCell>
                  <TableCell>Invited</TableCell>
                  <TableCell align="right">Actions</TableCell>
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
                      <Tooltip title="Revoke invitation">
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
        <DialogTitle>Invite User</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {ssoEnabled && (
              <Alert severity="info" variant="outlined">
                SSO is enabled. If no password is defined, the user will need to
                sign in with Microsoft.
              </Alert>
            )}
            {!ssoEnabled && (
              <Alert severity="info" variant="outlined">
                If no password is defined, the user will receive an email with a
                link to set their password.
              </Alert>
            )}
            <TextField
              label="Display Name"
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
              label="Email"
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
              label="Password (optional)"
              type="password"
              value={inviteForm.password}
              onChange={(e) =>
                setInviteForm((p) => ({ ...p, password: e.target.value }))
              }
              fullWidth
              size="small"
              helperText={
                ssoEnabled
                  ? "If set, the user can also sign in with this password instead of SSO."
                  : "Leave blank to send a password setup link via email."
              }
            />
            <FormControl fullWidth size="small">
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
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
              label="Send invitation email"
            />
            {inviteError && <Alert severity="error">{inviteError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setInviteOpen(false)}
            disabled={inviteSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleInvite}
            disabled={inviteSubmitting}
          >
            {inviteSubmitting ? "Inviting..." : "Invite User"}
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
        <DialogTitle>Edit User</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              label="Display Name"
              value={editForm.display_name}
              onChange={(e) =>
                setEditForm((p) => ({ ...p, display_name: e.target.value }))
              }
              fullWidth
              required
              size="small"
            />
            <TextField
              label="Email"
              type="email"
              value={editForm.email}
              onChange={(e) =>
                setEditForm((p) => ({ ...p, email: e.target.value }))
              }
              fullWidth
              required
              size="small"
            />
            {!isEditingSsoUser && (
              <TextField
                label="Password (leave blank to keep current)"
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
                This user authenticates via SSO. Password cannot be changed.
              </Alert>
            )}
            <FormControl fullWidth size="small">
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
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
                This user has an archived role. Consider assigning a new active role.
              </Alert>
            )}
            {editError && <Alert severity="error">{editError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)} disabled={editSubmitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleEdit}
            disabled={editSubmitting}
          >
            {editSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
