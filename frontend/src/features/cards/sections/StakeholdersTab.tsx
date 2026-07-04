import { useState, useCallback, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import StakeholderHoverCard from "@/components/StakeholderHoverCard";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/api/client";
import type { Card, StakeholderRef, StakeholderRoleDef, User } from "@/types";

// Loose email check — server-side EmailStr is authoritative; this just decides
// whether to surface the "Invite this email" sentinel in the dropdown.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserOption = { kind: "user"; user: User };
type InviteOption = { kind: "invite"; email: string };
type PickerOption = UserOption | InviteOption;

function StakeholdersTab({
  card,
  onRefresh,
  canManageStakeholders = true,
}: {
  card: Card;
  onRefresh: () => void;
  canManageStakeholders?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const rl = useResolveLabel();
  const { user: currentUser } = useAuth();

  const [subs, setSubs] = useState<StakeholderRef[]>([]);
  const [roles, setRoles] = useState<StakeholderRoleDef[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addRole, setAddRole] = useState<StakeholderRoleDef | null>(null);
  const [addUser, setAddUser] = useState<UserOption | null>(null);
  const [userQuery, setUserQuery] = useState("");

  // Inline invite-new-user form (revealed when the user picks the "Invite ..." row).
  // ``inviteMode`` is the visibility flag; ``inviteEmail`` is the field value
  // (which may legitimately be empty while the user is still typing).
  const [inviteMode, setInviteMode] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteSendEmail, setInviteSendEmail] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<
    { kind: "info" | "warning" | "error"; message: string } | null
  >(null);

  const canInvite = !!(
    currentUser?.permissions?.["*"] ||
    currentUser?.permissions?.["users.invite"] ||
    currentUser?.permissions?.["admin.users"]
  );

  const load = useCallback(() => {
    api.get<StakeholderRef[]>(`/cards/${card.id}/stakeholders`).then(setSubs).catch(() => {});
  }, [card.id]);

  useEffect(() => {
    load();
    api
      .get<StakeholderRoleDef[]>(`/stakeholder-roles?type_key=${card.type}`)
      .then(setRoles)
      .catch(() => {});
    api.get<User[]>("/users").then(setUsers).catch(() => {});
  }, [load, card.type]);

  const resetAddForm = useCallback(() => {
    setAddOpen(false);
    setAddRole(null);
    setAddUser(null);
    setUserQuery("");
    setInviteMode(false);
    setInviteEmail("");
    setInviteDisplayName("");
    setInviteSendEmail(false);
    setInviteFeedback(null);
    setInviteSubmitting(false);
  }, []);

  // Users already assigned to the currently-selected role — hidden from the
  // picker so we don't render duplicates that would just 409 on add.
  const alreadyAssignedUserIds = useMemo(() => {
    if (!addRole) return new Set<string>();
    return new Set(subs.filter((s) => s.role === addRole.key).map((s) => s.user_id));
  }, [addRole, subs]);

  const userOptions: UserOption[] = useMemo(
    () =>
      users
        .filter((u) => u.is_active && !alreadyAssignedUserIds.has(u.id))
        .map((u) => ({ kind: "user" as const, user: u })),
    [users, alreadyAssignedUserIds]
  );

  const handleAdd = async () => {
    if (!addRole || !addUser) return;
    try {
      await api.post(`/cards/${card.id}/stakeholders`, {
        user_id: addUser.user.id,
        role: addRole.key,
      });
      load();
      onRefresh();
      resetAddForm();
    } catch {
      /* silently ignore duplicates */
    }
  };

  const handleInviteAndAdd = async () => {
    if (!addRole || !EMAIL_RE.test(inviteEmail) || !inviteDisplayName.trim()) return;
    setInviteSubmitting(true);
    setInviteFeedback(null);
    try {
      const created = await api.post<{
        id: string;
        email: string;
        email_sent?: boolean;
        email_error?: string;
      }>("/users", {
        email: inviteEmail,
        display_name: inviteDisplayName.trim(),
        role: "member",
        send_email: inviteSendEmail,
      });
      await api.post(`/cards/${card.id}/stakeholders`, {
        user_id: created.id,
        role: addRole.key,
      });
      // Refresh the users list so the new user shows up immediately if the
      // admin reopens the picker.
      api.get<User[]>("/users").then(setUsers).catch(() => {});
      load();
      onRefresh();
      // If an invite email was requested but couldn't be sent, keep the form
      // open with a warning. Otherwise the account is created (password-less
      // users set their password via «Forgot password» on the login page).
      if (inviteSendEmail && created.email_error) {
        setInviteFeedback({ kind: "warning", message: created.email_error });
        setInviteSubmitting(false);
        return;
      }
      resetAddForm();
    } catch (e: unknown) {
      const detail =
        (e && typeof e === "object" && "detail" in e && (e as { detail?: string }).detail) ||
        t("stakeholders.inviteFailed");
      setInviteFeedback({ kind: "error", message: String(detail) });
      setInviteSubmitting(false);
    }
  };

  // Group displayed stakeholders by role (same as before)
  const grouped = roles.map((role) => ({
    role,
    items: subs.filter((s) => s.role === role.key),
  }));

  return (
    <Box>
      {canManageStakeholders && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="person_add" size={16} />}
            onClick={() => setAddOpen(true)}
          >
            {t("stakeholders.add")}
          </Button>
        </Box>
      )}
      {grouped.map(({ role, items }) => (
        <MuiCard key={role.key} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {rl(role.label, role.translations?.label)}
            </Typography>
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("stakeholders.noneAssigned", {
                  role: rl(role.label, role.translations?.label).toLowerCase(),
                })}
              </Typography>
            ) : (
              <List dense disablePadding>
                {items.map((s) => (
                  <ListItem
                    key={s.id}
                    secondaryAction={
                      canManageStakeholders ? (
                        <IconButton
                          size="small"
                          onClick={async () => {
                            await api.delete(`/stakeholders/${s.id}`);
                            load();
                            onRefresh();
                          }}
                        >
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      ) : undefined
                    }
                  >
                    <MaterialSymbol icon="person" size={20} />
                    <StakeholderHoverCard
                      userId={s.user_id}
                      userName={s.user_display_name || s.user_email}
                      display="block"
                    >
                      <ListItemText
                        primary={s.user_display_name || s.user_email}
                        secondary={s.user_display_name ? s.user_email : undefined}
                        sx={{ ml: 1 }}
                        slotProps={{ secondary: { sx: { fontSize: "0.75rem" } } }}
                      />
                    </StakeholderHoverCard>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </MuiCard>
      ))}
      {/* Add stakeholder inline */}
      {addOpen && (
        <MuiCard sx={{ mb: 2, border: "1px solid", borderColor: "primary.main" }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
              {t("stakeholders.add")}
            </Typography>
            <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
              <Autocomplete<StakeholderRoleDef, false, false, false>
                size="small"
                sx={{ minWidth: 200 }}
                options={roles}
                value={addRole}
                onChange={(_, next) => {
                  setAddRole(next);
                  // Clearing or changing the role invalidates the user selection
                  // (since "already assigned" filtering is role-scoped) and the
                  // invite-in-progress form.
                  setAddUser(null);
                  setInviteMode(false);
                  setInviteEmail("");
                  setInviteFeedback(null);
                }}
                getOptionLabel={(o) => rl(o.label, o.translations?.label)}
                isOptionEqualToValue={(a, b) => a.key === b.key}
                renderInput={(params) => (
                  <TextField {...params} label={t("stakeholders.role")} />
                )}
              />
              <Autocomplete<PickerOption, false, false, false>
                size="small"
                sx={{ minWidth: 320, flex: 1 }}
                options={userOptions}
                value={addUser}
                inputValue={userQuery}
                onInputChange={(_, q, reason) => {
                  if (reason !== "reset") setUserQuery(q);
                }}
                onChange={(_, next) => {
                  if (!next) {
                    setAddUser(null);
                    return;
                  }
                  if (next.kind === "invite") {
                    setAddUser(null);
                    setInviteMode(true);
                    setInviteEmail(next.email);
                    setInviteDisplayName("");
                    setInviteSendEmail(false);
                    setInviteFeedback(null);
                  } else {
                    setAddUser(next);
                    setInviteMode(false);
                  }
                }}
                getOptionLabel={(o) => (o.kind === "user" ? o.user.display_name : "")}
                isOptionEqualToValue={(a, b) =>
                  a.kind === "user" && b.kind === "user" && a.user.id === b.user.id
                }
                filterOptions={(opts, { inputValue }) => {
                  const q = inputValue.trim().toLowerCase();
                  const matches = q
                    ? opts.filter((o) => {
                        if (o.kind !== "user") return false;
                        return (
                          (o.user.display_name || "").toLowerCase().includes(q) ||
                          (o.user.email || "").toLowerCase().includes(q)
                        );
                      })
                    : opts;
                  // Always surface an "Invite a new user…" row at the bottom of
                  // the dropdown for accounts that can invite — discoverability
                  // matters more than purity. If the typed text already looks
                  // like an email, prefill it so one click skips straight to
                  // the form. If an existing user has that exact email, skip
                  // the sentinel (it'd just be a duplicate row).
                  if (
                    canInvite &&
                    !opts.some((o) => o.kind === "user" && o.user.email.toLowerCase() === q)
                  ) {
                    const prefill = EMAIL_RE.test(q) ? q : "";
                    return [...matches, { kind: "invite", email: prefill } as InviteOption];
                  }
                  return matches;
                }}
                renderOption={(props, option) => {
                  if (option.kind === "invite") {
                    return (
                      <li {...props} key="invite-new-user">
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            color: "primary.main",
                          }}
                        >
                          <MaterialSymbol icon="person_add" size={18} />
                          <Typography variant="body2">
                            {option.email
                              ? t("stakeholders.inviteOption", { email: option.email })
                              : t("stakeholders.inviteNewUser")}
                          </Typography>
                        </Box>
                      </li>
                    );
                  }
                  return (
                    <li {...props} key={option.user.id}>
                      <Box sx={{ display: "flex", flexDirection: "column", py: 0.25 }}>
                        <Typography variant="body2">{option.user.display_name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {option.user.email}
                        </Typography>
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t("stakeholders.user")}
                    placeholder={t("stakeholders.userPlaceholder")}
                  />
                )}
                noOptionsText={t("stakeholders.userPlaceholder")}
                disabled={!addRole}
              />
            </Box>

            {/* Invite-new-user inline form, revealed when the user picks "Invite ..." */}
            {inviteMode && (
              <Box
                sx={{
                  mt: 2,
                  pt: 2,
                  borderTop: "1px dashed",
                  borderColor: "divider",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                <Typography variant="subtitle2" fontWeight={600}>
                  {t("stakeholders.inviteFormTitle")}
                </Typography>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  <TextField
                    size="small"
                    label={t("stakeholders.inviteEmail")}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    sx={{ minWidth: 240, flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label={t("stakeholders.inviteDisplayName")}
                    value={inviteDisplayName}
                    onChange={(e) => setInviteDisplayName(e.target.value)}
                    required
                    autoFocus
                    sx={{ minWidth: 240, flex: 1 }}
                  />
                </Box>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={inviteSendEmail}
                      onChange={(e) => setInviteSendEmail(e.target.checked)}
                    />
                  }
                  label={t("stakeholders.inviteSendEmail")}
                />
                {inviteFeedback && (
                  <Alert
                    severity={inviteFeedback.kind === "info" ? "info" : inviteFeedback.kind}
                    sx={{ py: 0 }}
                  >
                    {inviteFeedback.message}
                  </Alert>
                )}
              </Box>
            )}

            <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
              {inviteMode ? (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleInviteAndAdd}
                  disabled={
                    inviteSubmitting ||
                    !addRole ||
                    !inviteDisplayName.trim() ||
                    !EMAIL_RE.test(inviteEmail)
                  }
                >
                  {t("stakeholders.inviteAndAdd")}
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleAdd}
                  disabled={!addRole || !addUser}
                >
                  {t("common:actions.add")}
                </Button>
              )}
              <Button size="small" onClick={resetAddForm}>
                {t("common:actions.cancel")}
              </Button>
            </Box>
          </CardContent>
        </MuiCard>
      )}
    </Box>
  );
}

export default StakeholdersTab;
