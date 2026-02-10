import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { api } from "@/api/client";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

export default function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    api.get<UserRow[]>("/users").then(setUsers);
  }, []);

  const updateRole = async (userId: string, role: string) => {
    await api.patch(`/users/${userId}`, { role });
    setUsers(users.map((u) => (u.id === userId ? { ...u, role } : u)));
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>User Management</Typography>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Role</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.display_name}</TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>
                <Select
                  size="small"
                  value={u.role}
                  onChange={(e) => updateRole(u.id, e.target.value)}
                >
                  <MenuItem value="admin">Admin</MenuItem>
                  <MenuItem value="member">Member</MenuItem>
                  <MenuItem value="viewer">Viewer</MenuItem>
                </Select>
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={u.is_active ? "Active" : "Disabled"}
                  color={u.is_active ? "success" : "default"}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
