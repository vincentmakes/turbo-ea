import { useState, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card, StakeholderRef, StakeholderRoleDef, User } from "@/types";

// ── Tab: Stakeholders ──────────────────────────────────────────
function StakeholdersTab({ card, onRefresh, canManageStakeholders = true }: { card: Card; onRefresh: () => void; canManageStakeholders?: boolean }) {
  const [subs, setSubs] = useState<StakeholderRef[]>([]);
  const [roles, setRoles] = useState<StakeholderRoleDef[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addRole, setAddRole] = useState("");
  const [addUserId, setAddUserId] = useState("");

  const load = useCallback(() => {
    api.get<StakeholderRef[]>(`/cards/${card.id}/stakeholders`).then(setSubs).catch(() => {});
  }, [card.id]);

  useEffect(() => {
    load();
    api.get<StakeholderRoleDef[]>(`/stakeholder-roles?type_key=${card.type}`).then(setRoles).catch(() => {});
    api.get<User[]>("/users").then(setUsers).catch(() => {});
  }, [load, card.type]);

  const handleAdd = async () => {
    if (!addRole || !addUserId) return;
    try {
      await api.post(`/cards/${card.id}/stakeholders`, {
        user_id: addUserId,
        role: addRole,
      });
      load();
      onRefresh();
      setAddOpen(false);
      setAddRole("");
      setAddUserId("");
    } catch {
      /* silently ignore duplicates */
    }
  };

  const handleDelete = async (subId: string) => {
    await api.delete(`/stakeholders/${subId}`);
    load();
    onRefresh();
  };

  // Group by role
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
            Add Stakeholder
          </Button>
        </Box>
      )}
      {grouped.map(({ role, items }) => (
        <MuiCard key={role.key} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {role.label}
            </Typography>
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No {role.label.toLowerCase()} assigned
              </Typography>
            ) : (
              <List dense disablePadding>
                {items.map((s) => (
                  <ListItem
                    key={s.id}
                    secondaryAction={
                      canManageStakeholders ? (
                        <IconButton size="small" onClick={() => handleDelete(s.id)}>
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      ) : undefined
                    }
                  >
                    <MaterialSymbol icon="person" size={20} />
                    <ListItemText
                      primary={s.user_display_name || s.user_email}
                      sx={{ ml: 1 }}
                    />
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
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Add Stakeholder
            </Typography>
            <Box sx={{ display: "flex", gap: 2, alignItems: "flex-end", flexWrap: "wrap" }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Role</InputLabel>
                <Select value={addRole} label="Role" onChange={(e) => setAddRole(e.target.value)}>
                  {roles.map((r) => (
                    <MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>User</InputLabel>
                <Select value={addUserId} label="User" onChange={(e) => setAddUserId(e.target.value)}>
                  {users.filter((u) => u.is_active).map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.display_name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button size="small" variant="contained" onClick={handleAdd} disabled={!addRole || !addUserId}>
                Add
              </Button>
              <Button size="small" onClick={() => { setAddOpen(false); setAddRole(""); setAddUserId(""); }}>
                Cancel
              </Button>
            </Box>
          </CardContent>
        </MuiCard>
      )}
    </Box>
  );
}

export default StakeholdersTab;
