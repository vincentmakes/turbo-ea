import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi } from "ag-grid-community";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
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
import Drawer from "@mui/material/Drawer";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useThemeMode } from "@/hooks/useThemeMode";
import { useIsRtl } from "@/hooks/useIsRtl";
import type { User, SsoInvitation, AppRole } from "@/types";
import MaterialSymbol from "@/components/MaterialSymbol";
import RolesAdmin from "@/features/admin/RolesAdmin";
import UsersFilterSidebar, {
  EMPTY_USER_FILTERS,
  DEFAULT_USER_COLUMNS,
  type UserFilters,
} from "./UsersFilterSidebar";
import UserImportDialog from "./users/UserImportDialog";
import BulkActionsToolbar from "./users/BulkActionsToolbar";
import BulkRoleDialog from "./users/BulkRoleDialog";
import { exportUsersToXlsx } from "./users/userExcelExport";

interface CreateUserFormState {
  email: string;
  display_name: string;
  password: string;
  role: string;
  send_email: boolean;
}

const EMPTY_CREATE_USER: CreateUserFormState = {
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

/* ---- localStorage persistence helpers ---- */
const LS_KEY = "turboea_usersAdmin";
const DEFAULT_SIDEBAR_WIDTH = 280;

interface UsersAdminPrefs {
  filters?: UserFilters;
  columns?: string[];
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
}

function loadPrefs(): UsersAdminPrefs | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as UsersAdminPrefs) : null;
  } catch {
    return null;
  }
}

function savePrefs(prefs: UsersAdminPrefs) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

export default function UsersAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const { formatDate, formatDateTime } = useDateFormat();
  const { mode } = useThemeMode();
  const isRtl = useIsRtl();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create-user dialog state
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(EMPTY_CREATE_USER);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);

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

  // Bulk selection + import/export
  const gridApiRef = useRef<GridApi<User> | null>(null);
  const filteredUsersRef = useRef<User[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRoleOpen, setBulkRoleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Roles
  const [roles, setRoles] = useState<AppRole[]>([]);

  // Pending invitations
  const [invitations, setInvitations] = useState<SsoInvitation[]>([]);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  // Sidebar + filters + columns
  const savedPrefsRef = useRef(loadPrefs());
  const [filters, setFilters] = useState<UserFilters>(
    () => savedPrefsRef.current?.filters ?? EMPTY_USER_FILTERS,
  );
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    () =>
      savedPrefsRef.current?.columns
        ? new Set(savedPrefsRef.current.columns)
        : new Set(DEFAULT_USER_COLUMNS),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => savedPrefsRef.current?.sidebarCollapsed ?? false,
  );
  const [sidebarWidth, setSidebarWidth] = useState(
    () => savedPrefsRef.current?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
  );
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Persist prefs whenever they change
  useEffect(() => {
    savePrefs({
      filters,
      columns: Array.from(selectedColumns),
      sidebarWidth,
      sidebarCollapsed,
    });
  }, [filters, selectedColumns, sidebarWidth, sidebarCollapsed]);

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
      const data = await api.get<User[]>("/users?include_inactive=true");
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
  const updateRole = useCallback(async (userId: string, role: string) => {
    try {
      await api.patch(`/users/${userId}`, { role });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    }
  }, [t]);

  // --- Toggle active/inactive ---
  const toggleActive = useCallback(async (user: User) => {
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
  }, [t]);

  // --- Delete (soft-delete) ---
  const handleDelete = useCallback(async (user: User) => {
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
  }, [t]);

  // --- Bulk actions ---
  const clearSelection = useCallback(() => {
    gridApiRef.current?.deselectAll();
    setSelectedIds([]);
  }, []);

  const handleBulkRoleConfirm = useCallback(
    async (roleKey: string) => {
      setBulkBusy(true);
      try {
        const updated = await api.patch<User[]>("/users/bulk", {
          ids: selectedIds,
          updates: { role: roleKey },
        });
        const byId = new Map(updated.map((u) => [u.id, u]));
        setUsers((prev) => prev.map((u) => byId.get(u.id) ?? u));
        setSuccess(t("users.bulk.changeRoleSuccess", { count: updated.length }));
        clearSelection();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common:errors.generic"));
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, clearSelection, t],
  );

  const handleBulkSetActive = useCallback(
    async (isActive: boolean) => {
      if (selectedIds.length === 0) return;
      setBulkBusy(true);
      try {
        const updated = await api.patch<User[]>("/users/bulk", {
          ids: selectedIds,
          updates: { is_active: isActive },
        });
        const byId = new Map(updated.map((u) => [u.id, u]));
        setUsers((prev) => prev.map((u) => byId.get(u.id) ?? u));
        setSuccess(
          isActive
            ? t("users.bulk.activateSuccess", { count: updated.length })
            : t("users.bulk.deactivateSuccess", { count: updated.length }),
        );
        clearSelection();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common:errors.generic"));
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, clearSelection, t],
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(
      t("users.bulk.confirmDelete", { count: selectedIds.length }),
    );
    if (!confirmed) return;
    setBulkBusy(true);
    try {
      const res = await api.post<{
        deleted: number;
        skipped: { id: string; reason: string }[];
      }>("/users/bulk-delete", { ids: selectedIds });
      const skippedIds = new Set(res.skipped.map((s) => s.id));
      setUsers((prev) => prev.filter((u) => skippedIds.has(u.id) || !selectedIds.includes(u.id)));
      if (res.skipped.length > 0) {
        setWarning(
          t("users.bulk.deleteSkipped", {
            deleted: res.deleted,
            skipped: res.skipped.length,
          }),
        );
      } else {
        setSuccess(t("users.bulk.deleteSuccess", { count: res.deleted }));
      }
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, clearSelection, t]);

  const handleExport = useCallback(() => {
    const list = filteredUsersRef.current;
    exportUsersToXlsx(list);
    setSuccess(t("users.exportSuccess", { count: list.length }));
  }, [t]);

  // --- Create-user dialog ---
  const openCreateUser = () => {
    setCreateUserForm(EMPTY_CREATE_USER);
    setCreateUserError(null);
    setCreateUserOpen(true);
  };

  const handleCreateUser = async () => {
    if (!createUserForm.email.trim() || !createUserForm.display_name.trim()) {
      setCreateUserError(t("users.create.requiredFields"));
      return;
    }
    if (!ssoEnabled && !createUserForm.password) {
      setCreateUserError(t("users.create.passwordRequiredLocal"));
      return;
    }
    try {
      setCreateUserSubmitting(true);
      setCreateUserError(null);
      const created = await api.post<User & { email_error?: string; email_sent?: boolean }>(
        "/users",
        {
          email: createUserForm.email.trim(),
          display_name: createUserForm.display_name.trim(),
          password: createUserForm.password || null,
          role: createUserForm.role,
          send_email: createUserForm.send_email,
        }
      );
      setUsers((prev) => [...prev, created]);
      setCreateUserOpen(false);
      if (createUserForm.send_email && created.email_error) {
        setWarning(created.email_error);
      } else {
        setWarning(null);
      }
      fetchInvitations();
    } catch (err) {
      setCreateUserError(
        err instanceof Error ? err.message : t("common:errors.generic")
      );
    } finally {
      setCreateUserSubmitting(false);
    }
  };

  // --- Edit dialog ---
  const openEdit = useCallback((user: User) => {
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
  }, []);

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

  // --- Resend invitation ---
  const handleResendInvitationRow = useCallback(
    async (inv: SsoInvitation) => {
      setSuccess(null);
      setError(null);
      setWarning(null);
      try {
        await api.post(`/users/invitations/${inv.id}/resend`, {});
        setSuccess(t("users.resendInviteSuccess", { email: inv.email }));
      } catch (err) {
        setError(
          t("users.resendInviteFailed", {
            error: err instanceof Error ? err.message : t("common:errors.generic"),
          }),
        );
      }
    },
    [t],
  );

  // --- Delete invitation ---
  const handleDeleteInvitation = useCallback(
    async (inv: SsoInvitation) => {
      try {
        await api.delete(`/users/invitations/${inv.id}`);
        setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("common:errors.generic"),
        );
      }
    },
    [t],
  );

  // Build a map from role key to AppRole for quick lookups
  const roleMap = useMemo(() => new Map(roles.map((r) => [r.key, r])), [roles]);
  const activeRoles = useMemo(() => roles.filter((r) => !r.is_archived), [roles]);

  // Helper: render a role chip
  const renderRoleChip = useCallback(
    (roleKey: string) => {
      const role = roleMap.get(roleKey);
      if (role) {
        return (
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
        );
      }
      return <Chip size="small" label={roleKey} variant="outlined" />;
    },
    [roleMap],
  );

  // Map invitations by email so we can flag invited users in the main grid.
  // Email is the natural key — invitations and users carry the same address
  // and the backend builds the invitations list as the subset of users that
  // never logged in.
  const invitationByEmail = useMemo(() => {
    const m = new Map<string, SsoInvitation>();
    for (const inv of invitations) m.set(inv.email.toLowerCase(), inv);
    return m;
  }, [invitations]);

  const getInvitation = useCallback(
    (u: User) => invitationByEmail.get(u.email.toLowerCase()),
    [invitationByEmail],
  );

  const userStatus = useCallback(
    (u: User): "active" | "invited" | "inactive" => {
      if (!u.is_active) return "inactive";
      if (getInvitation(u)) return "invited";
      return "active";
    },
    [getInvitation],
  );

  // Apply client-side filtering
  const filteredUsers = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return users.filter((u) => {
      if (q) {
        const inEmail = u.email.toLowerCase().includes(q);
        const inName = (u.display_name || "").toLowerCase().includes(q);
        if (!inEmail && !inName) return false;
      }
      if (filters.roles.length > 0 && !filters.roles.includes(u.role)) {
        return false;
      }
      if (filters.statuses.length > 0) {
        if (!filters.statuses.includes(userStatus(u))) return false;
      }
      if (filters.authMethods.length > 0) {
        const auth = u.auth_provider === "sso" ? "sso" : "local";
        if (!filters.authMethods.includes(auth)) return false;
      }
      if (filters.invited && !getInvitation(u)) return false;
      return true;
    });
  }, [users, filters, userStatus, getInvitation]);

  // Keep the export handler's snapshot in sync with the latest filtered list
  useEffect(() => {
    filteredUsersRef.current = filteredUsers;
  }, [filteredUsers]);

  const handleResetColumns = useCallback(() => {
    setSelectedColumns(new Set(DEFAULT_USER_COLUMNS));
  }, []);

  /* ---- AG Grid column defs ---- */
  const columnDefs = useMemo<ColDef<User>[]>(
    () => [
      {
        headerName: "",
        field: "id",
        checkboxSelection: true,
        headerCheckboxSelection: true,
        headerCheckboxSelectionFilteredOnly: true,
        width: 44,
        pinned: "left",
        sortable: false,
        filter: false,
        resizable: false,
        suppressMovable: true,
        suppressHeaderMenuButton: true,
      },
      {
        field: "display_name",
        headerName: t("users.columns.name"),
        minWidth: 280,
        flex: 1,
        pinned: "left",
        hide: false, // always shown (locked)
        sortable: true,
        cellRenderer: (p: { data?: User; value: string }) => {
          const u = p.data;
          if (!u) return null;
          const inv = getInvitation(u);
          return (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                height: "100%",
                width: "100%",
              }}
            >
              <Typography
                variant="body2"
                noWrap
                sx={{ flex: 1, minWidth: 0 }}
                title={p.value}
              >
                {p.value}
              </Typography>
              <Box
                sx={{ display: "flex", gap: 0.25, alignItems: "center", flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip title={t("users.editTooltip")}>
                  <IconButton size="small" onClick={() => openEdit(u)}>
                    <MaterialSymbol icon="edit" size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  title={
                    u.is_active ? t("users.deactivateTooltip") : t("users.activateTooltip")
                  }
                >
                  <IconButton
                    size="small"
                    onClick={() => toggleActive(u)}
                    color={u.is_active ? "warning" : "success"}
                  >
                    <MaterialSymbol
                      icon={u.is_active ? "person_off" : "person"}
                      size={18}
                    />
                  </IconButton>
                </Tooltip>
                {inv && (
                  <Tooltip title={t("users.resendInviteTooltip")}>
                    <IconButton size="small" onClick={() => handleResendInvitationRow(inv)}>
                      <MaterialSymbol icon="forward_to_inbox" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
                {inv && (
                  <Tooltip title={t("users.invitations.revokeTooltip")}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleDeleteInvitation(inv)}
                    >
                      <MaterialSymbol icon="cancel_schedule_send" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
                {!u.is_active && (
                  <Tooltip title={t("users.deleteTooltip")}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleDelete(u)}
                    >
                      <MaterialSymbol icon="delete" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          );
        },
      },
      {
        field: "email",
        headerName: t("users.columns.email"),
        flex: 1.2,
        minWidth: 180,
        hide: !selectedColumns.has("email"),
        sortable: true,
      },
      {
        field: "role",
        headerName: t("users.columns.role"),
        width: 180,
        hide: !selectedColumns.has("role"),
        sortable: true,
        cellRenderer: (p: { data?: User; value: string }) => {
          const u = p.data;
          if (!u) return null;
          if (activeRoles.length > 0) {
            return (
              <Stack
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ height: "100%" }}
                onClick={(e) => e.stopPropagation()}
              >
                <Select
                  size="small"
                  value={u.role}
                  onChange={(e) => updateRole(u.id, e.target.value)}
                  sx={{
                    minWidth: 120,
                    "& .MuiSelect-select": { py: 0.25 },
                  }}
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
                          pointerEvents: "none",
                        }}
                      />
                    ) : (
                      val
                    );
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
            );
          }
          return renderRoleChip(p.value);
        },
      },
      {
        field: "auth_provider",
        headerName: t("users.columns.auth"),
        width: 140,
        hide: !selectedColumns.has("auth"),
        sortable: true,
        cellRenderer: (p: { data?: User }) => {
          const u = p.data;
          if (!u) return null;
          if (u.auth_provider === "sso") {
            return (
              <Chip size="small" label={t("users.auth.sso")} color="info" variant="outlined" />
            );
          }
          if (u.pending_setup) {
            return (
              <Chip
                size="small"
                label={t("users.auth.pendingSetup")}
                color="warning"
                variant="outlined"
              />
            );
          }
          return (
            <Chip size="small" label={t("users.auth.local")} color="default" variant="outlined" />
          );
        },
      },
      {
        field: "is_active",
        headerName: t("users.columns.status"),
        width: 130,
        hide: !selectedColumns.has("status"),
        sortable: true,
        valueGetter: (p: { data?: User }) =>
          p.data ? userStatus(p.data) : "inactive",
        cellRenderer: (p: { data?: User }) => {
          const u = p.data;
          if (!u) return null;
          const status = userStatus(u);
          if (status === "invited") {
            return (
              <Chip
                size="small"
                icon={<MaterialSymbol icon="mail" size={14} />}
                label={t("users.status.invited")}
                color="warning"
                variant="outlined"
              />
            );
          }
          return (
            <Chip
              size="small"
              label={
                status === "active"
                  ? t("users.status.active")
                  : t("users.status.disabled")
              }
              color={status === "active" ? "success" : "default"}
            />
          );
        },
      },
      {
        field: "last_login",
        headerName: t("users.columns.lastLogin"),
        width: 170,
        hide: !selectedColumns.has("last_login"),
        sortable: true,
        valueFormatter: (p: { value?: string }) =>
          p.value ? formatDateTime(p.value) : "—",
      },
      {
        field: "created_at",
        headerName: t("users.columns.createdAt"),
        width: 140,
        hide: !selectedColumns.has("created_at"),
        sortable: true,
        valueFormatter: (p: { value?: string }) =>
          p.value ? formatDate(p.value) : "—",
      },
      {
        field: "locale",
        headerName: t("users.columns.locale"),
        width: 100,
        hide: !selectedColumns.has("locale"),
        sortable: true,
        valueFormatter: (p: { value?: string }) => p.value || "—",
      },
      {
        field: "pending_setup",
        headerName: t("users.columns.pendingSetup"),
        width: 140,
        hide: !selectedColumns.has("pending_setup"),
        sortable: true,
        cellRenderer: (p: { value: boolean }) =>
          p.value ? (
            <MaterialSymbol icon="hourglass_top" size={18} color="#ed6c02" />
          ) : (
            <Typography variant="body2" color="text.disabled">
              —
            </Typography>
          ),
      },
    ],
    [
      t,
      selectedColumns,
      activeRoles,
      roleMap,
      updateRole,
      renderRoleChip,
      formatDate,
      formatDateTime,
      openEdit,
      toggleActive,
      handleDelete,
      getInvitation,
      userStatus,
      handleResendInvitationRow,
      handleDeleteInvitation,
    ],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, filter: true, resizable: true }),
    [],
  );
  const getRowId = useCallback((p: { data: User }) => p.data.id, []);
  const getRowStyle = useCallback(
    (p: { data?: User }) =>
      p.data && !p.data.is_active ? { opacity: 0.7 } : undefined,
    [],
  );

  const isEditingSsoUser = editForm.auth_provider === "sso";

  // Sidebar render — extracted so we can reuse it in Drawer + inline
  const renderSidebar = (collapsed: boolean) => (
    <UsersFilterSidebar
      roles={roles}
      filters={filters}
      onFiltersChange={setFilters}
      collapsed={collapsed}
      onToggleCollapse={() =>
        isMobile
          ? setFilterDrawerOpen((v) => !v)
          : setSidebarCollapsed((v) => !v)
      }
      width={isMobile ? 300 : sidebarWidth}
      onWidthChange={isMobile ? () => {} : setSidebarWidth}
      selectedColumns={selectedColumns}
      onSelectedColumnsChange={setSelectedColumns}
      onResetColumns={handleResetColumns}
    />
  );

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
      {tab === 0 && (
        <Box>
          {/* Toolbar */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 1.5,
              flexWrap: "wrap",
            }}
          >
            {isMobile && (
              <Tooltip title={t("users.filter.title")}>
                <IconButton onClick={() => setFilterDrawerOpen(true)} size="small">
                  <MaterialSymbol icon="filter_list" size={22} />
                </IconButton>
              </Tooltip>
            )}
            <Chip
              label={t("common:items", { count: filteredUsers.length })}
              size="small"
            />
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="download" size={20} />}
              onClick={handleExport}
              disabled={filteredUsers.length === 0}
            >
              {t("users.export")}
            </Button>
            <Button
              variant="outlined"
              startIcon={<MaterialSymbol icon="upload" size={20} />}
              onClick={() => setImportOpen(true)}
            >
              {t("users.import.button")}
            </Button>
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="person_add" size={20} />}
              onClick={openCreateUser}
            >
              {t("users.createUser")}
            </Button>
          </Box>

          {/* Bulk actions */}
          <BulkActionsToolbar
            selectedCount={selectedIds.length}
            busy={bulkBusy}
            onChangeRole={() => setBulkRoleOpen(true)}
            onActivate={() => handleBulkSetActive(true)}
            onDeactivate={() => handleBulkSetActive(false)}
            onDelete={handleBulkDelete}
            onClear={clearSelection}
          />

          {/* Banners */}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {warning && (
            <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setWarning(null)}>
              {warning}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

          {/* Sidebar + Grid */}
          <Paper
            variant="outlined"
            sx={{
              display: "flex",
              height: 560,
              overflow: "hidden",
              borderRadius: 1,
            }}
          >
            {isMobile ? (
              <Drawer
                open={filterDrawerOpen}
                onClose={() => setFilterDrawerOpen(false)}
                PaperProps={{ sx: { width: 300 } }}
              >
                {renderSidebar(false)}
              </Drawer>
            ) : (
              renderSidebar(sidebarCollapsed)
            )}

            <Box
              className={mode === "dark" ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
              sx={{ flex: 1, minHeight: 0 }}
            >
              <AgGridReact<User>
                key={isRtl ? "rtl" : "ltr"}
                enableRtl={isRtl}
                rowData={filteredUsers}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                getRowId={getRowId}
                getRowStyle={getRowStyle}
                loading={loading}
                animateRows
                rowHeight={48}
                rowSelection="multiple"
                suppressRowClickSelection
                onGridReady={(params) => {
                  gridApiRef.current = params.api;
                }}
                onSelectionChanged={(e: { api: GridApi<User> }) => {
                  const rows = e.api.getSelectedRows();
                  setSelectedIds(rows.map((r) => r.id));
                }}
                overlayNoRowsTemplate={`<span style="padding: 12px;">${t("users.noUsers")}</span>`}
              />
            </Box>
          </Paper>

          {/* Bulk role-change dialog */}
          <BulkRoleDialog
            open={bulkRoleOpen}
            onClose={() => setBulkRoleOpen(false)}
            onConfirm={handleBulkRoleConfirm}
            roles={roles}
            selectedCount={selectedIds.length}
          />

          {/* Import dialog */}
          <UserImportDialog
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onComplete={() => {
              fetchUsers();
              fetchInvitations();
            }}
            existingUsers={users}
            roles={roles}
          />

          {/* Create User Dialog */}
          <Dialog
            open={createUserOpen}
            onClose={() => setCreateUserOpen(false)}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>{t("users.create.title")}</DialogTitle>
            <DialogContent>
              <Stack spacing={2.5} sx={{ mt: 1 }}>
                {ssoEnabled && (
                  <Alert severity="info" variant="outlined">
                    {t("users.create.ssoHint")}
                  </Alert>
                )}
                {!ssoEnabled && (
                  <Alert severity="info" variant="outlined">
                    {t("users.create.emailHint")}
                  </Alert>
                )}
                <TextField
                  label={t("users.create.displayName")}
                  value={createUserForm.display_name}
                  onChange={(e) =>
                    setCreateUserForm((p) => ({ ...p, display_name: e.target.value }))
                  }
                  fullWidth
                  required
                  autoFocus
                  size="small"
                />
                <TextField
                  label={t("users.columns.email")}
                  type="email"
                  value={createUserForm.email}
                  onChange={(e) =>
                    setCreateUserForm((p) => ({ ...p, email: e.target.value }))
                  }
                  fullWidth
                  required
                  size="small"
                />
                <TextField
                  label={
                    ssoEnabled
                      ? t("users.create.passwordOptional")
                      : t("users.create.password")
                  }
                  type="password"
                  value={createUserForm.password}
                  onChange={(e) =>
                    setCreateUserForm((p) => ({ ...p, password: e.target.value }))
                  }
                  fullWidth
                  size="small"
                  required={!ssoEnabled}
                  helperText={
                    ssoEnabled
                      ? t("users.create.passwordSsoHelperText")
                      : t("users.create.passwordHelperText")
                  }
                />
                <FormControl fullWidth size="small">
                  <InputLabel>{t("users.columns.role")}</InputLabel>
                  <Select
                    label={t("users.columns.role")}
                    value={createUserForm.role}
                    onChange={(e) =>
                      setCreateUserForm((p) => ({
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
                      checked={createUserForm.send_email}
                      onChange={(e) =>
                        setCreateUserForm((p) => ({
                          ...p,
                          send_email: e.target.checked,
                        }))
                      }
                    />
                  }
                  label={t("users.create.sendEmail")}
                />
                {createUserError && <Alert severity="error">{createUserError}</Alert>}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button
                onClick={() => setCreateUserOpen(false)}
                disabled={createUserSubmitting}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                variant="contained"
                onClick={handleCreateUser}
                disabled={createUserSubmitting}
              >
                {createUserSubmitting
                  ? t("users.create.creating")
                  : t("users.createUser")}
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
                  label={t("users.create.displayName")}
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
        </Box>
      )}

      {/* ============================================================ */}
      {/*  TAB 1 -- Roles                                              */}
      {/* ============================================================ */}
      {tab === 1 && <RolesAdmin />}
    </Box>
  );
}
