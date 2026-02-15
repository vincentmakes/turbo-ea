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
import type { User, SsoInvitation } from "@/types";
import MaterialSymbol from "@/components/MaterialSymbol";

type Role = "admin" | "bpm_admin" | "member" | "viewer";

interface UserFormState {
  email: string;
  display_name: string;
  password: string;
  role: Role;
}

const EMPTY_FORM: UserFormState = {
  email: "",
  display_name: "",
  password: "",
  role: "member",
};

interface InviteFormState {
  email: string;
  role: Role;
  send_email: boolean;
}

const EMPTY_INVITE: InviteFormState = {
  email: "",
  role: "viewer",
  send_email: false,
};

export default function UsersAdmin() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // SSO invitation state
  const [invitations, setInvitations] = useState<SsoInvitation[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteFormState>(EMPTY_INVITE);
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

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
    fetchUsers();
    fetchInvitations();
    fetchSsoStatus();
  }, [fetchUsers, fetchInvitations, fetchSsoStatus]);

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

  // --- Create dialog ---
  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!form.email.trim() || !form.display_name.trim() || !form.password) {
      setFormError("Email, display name, and password are required.");
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const created = await api.post<User>("/users", {
        email: form.email.trim(),
        display_name: form.display_name.trim(),
        password: form.password,
        role: form.role,
      });
      setUsers((prev) => [...prev, created]);
      setCreateOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Edit dialog ---
  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      display_name: user.display_name,
      password: "",
      role: user.role as Role,
    });
    setFormError(null);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    if (!form.email.trim() || !form.display_name.trim()) {
      setFormError("Email and display name are required.");
      return;
    }
    const payload: Record<string, string> = {
      email: form.email.trim(),
      display_name: form.display_name.trim(),
      role: form.role,
    };
    if (form.password) {
      payload.password = form.password;
    }
    try {
      setSubmitting(true);
      setFormError(null);
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
      setFormError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Form field handler ---
  const updateField = (field: keyof UserFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // --- SSO Invitation handlers ---
  const openInvite = () => {
    setInviteForm(EMPTY_INVITE);
    setInviteFormError(null);
    setInviteOpen(true);
  };

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) {
      setInviteFormError("Email is required.");
      return;
    }
    try {
      setInviteSubmitting(true);
      setInviteFormError(null);
      const created = await api.post<SsoInvitation>("/users/invitations", {
        email: inviteForm.email.trim(),
        role: inviteForm.role,
        send_email: inviteForm.send_email,
      });
      setInvitations((prev) => [...prev, created]);
      setInviteOpen(false);
    } catch (err) {
      setInviteFormError(
        err instanceof Error ? err.message : "Failed to create invitation"
      );
    } finally {
      setInviteSubmitting(false);
    }
  };

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

  // --- Shared dialog form ---
  const isEditingSsoUser = editingUser?.auth_provider === "sso";

  const renderFormFields = (isEdit: boolean) => (
    <Stack spacing={2.5} sx={{ mt: 1 }}>
      <TextField
        label="Display Name"
        value={form.display_name}
        onChange={(e) => updateField("display_name", e.target.value)}
        fullWidth
        required
        autoFocus={!isEdit}
        size="small"
      />
      <TextField
        label="Email"
        type="email"
        value={form.email}
        onChange={(e) => updateField("email", e.target.value)}
        fullWidth
        required
        size="small"
      />
      {!isEditingSsoUser && (
        <TextField
          label={isEdit ? "Password (leave blank to keep current)" : "Password"}
          type="password"
          value={form.password}
          onChange={(e) => updateField("password", e.target.value)}
          fullWidth
          required={!isEdit}
          size="small"
        />
      )}
      {isEditingSsoUser && (
        <Alert severity="info" variant="outlined">
          This user authenticates via SSO. Password cannot be set.
        </Alert>
      )}
      <FormControl fullWidth size="small">
        <InputLabel>Role</InputLabel>
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => updateField("role", e.target.value)}
        >
          <MenuItem value="admin">Admin</MenuItem>
          <MenuItem value="bpm_admin">BPM Admin</MenuItem>
          <MenuItem value="member">Member</MenuItem>
          <MenuItem value="viewer">Viewer</MenuItem>
        </Select>
      </FormControl>
      {formError && <Alert severity="error">{formError}</Alert>}
    </Stack>
  );

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
        <Box sx={{ display: "flex", gap: 1 }}>
          {ssoEnabled && (
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="mail" size={20} />}
              onClick={openInvite}
            >
              Invite via SSO
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="person_add" size={20} />}
            onClick={openCreate}
          >
            Create User
          </Button>
        </Box>
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
                    <Select
                      size="small"
                      value={u.role}
                      onChange={(e) => updateRole(u.id, e.target.value)}
                      sx={{ minWidth: 110 }}
                    >
                      <MenuItem value="admin">Admin</MenuItem>
                      <MenuItem value="member">Member</MenuItem>
                      <MenuItem value="viewer">Viewer</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={u.auth_provider === "sso" ? "SSO" : "Local"}
                      color={u.auth_provider === "sso" ? "info" : "default"}
                      variant="outlined"
                    />
                  </TableCell>
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

      {/* Pending SSO Invitations */}
      {ssoEnabled && invitations.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
            Pending SSO Invitations
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
                      <Chip
                        size="small"
                        label={inv.role}
                        variant="outlined"
                      />
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

      {/* Create User Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create User</DialogTitle>
        <DialogContent>{renderFormFields(false)}</DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={submitting}
          >
            {submitting ? "Creating..." : "Create"}
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
        <DialogContent>{renderFormFields(true)}</DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleEdit}
            disabled={submitting}
          >
            {submitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* SSO Invite Dialog */}
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Invite User via SSO</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Alert severity="info" variant="outlined">
              Invite a user by their email address. When they sign in with
              Microsoft for the first time, they will be assigned the role
              you select below instead of the default Viewer role.
            </Alert>
            <TextField
              label="Email"
              type="email"
              value={inviteForm.email}
              onChange={(e) =>
                setInviteForm((p) => ({ ...p, email: e.target.value }))
              }
              fullWidth
              required
              autoFocus
              size="small"
            />
            <FormControl fullWidth size="small">
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
                value={inviteForm.role}
                onChange={(e) =>
                  setInviteForm((p) => ({
                    ...p,
                    role: e.target.value as Role,
                  }))
                }
              >
                <MenuItem value="admin">Admin</MenuItem>
                <MenuItem value="bpm_admin">BPM Admin</MenuItem>
                <MenuItem value="member">Member</MenuItem>
                <MenuItem value="viewer">Viewer</MenuItem>
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
            {inviteFormError && (
              <Alert severity="error">{inviteFormError}</Alert>
            )}
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
            {inviteSubmitting ? "Inviting..." : "Send Invitation"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
