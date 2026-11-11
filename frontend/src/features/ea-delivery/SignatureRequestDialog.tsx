import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { DecisionPerson, User } from "@/types";
import { OpenThreadsWarning } from "./collab/ReviewDialogs";

/**
 * The decision makers the shortcut can add: the active users among them, in
 * order, that are not selected yet (free-text names cannot sign).
 */
export function addableDecisionMakers(
  people: DecisionPerson[] | undefined,
  users: User[],
  selected: ReadonlyMap<string, User>,
): User[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: User[] = [];
  for (const p of people ?? []) {
    const user = p.user_id ? byId.get(p.user_id) : undefined;
    if (user && !selected.has(user.id) && !out.includes(user)) out.push(user);
  }
  return out;
}

interface SignatureRequestDialogProps {
  open: boolean;
  onClose: () => void;
  onRequest: (userIds: string[]) => Promise<void>;
  title: string;
  description: string;
  requesting: boolean;
  /** A decision's makers: offers "Add decision makers" for those who are users. */
  decisionMakers?: DecisionPerson[];
  /** Open discussion threads: a warning, never a block. */
  openThreadCount?: number;
}

export default function SignatureRequestDialog({
  open,
  onClose,
  onRequest,
  title,
  description,
  requesting,
  decisionMakers,
  openThreadCount,
}: SignatureRequestDialogProps) {
  const { t } = useTranslation(["delivery", "common"]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<Map<string, User>>(new Map());
  const [search, setSearch] = useState("");

  // Load users when dialog opens
  useEffect(() => {
    if (!open) return;
    setSelected(new Map());
    setSearch("");
    api
      .get<User[]>("/users")
      .then((users) => setAllUsers(users.filter((u) => u.is_active)))
      .catch(() => {});
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return allUsers.filter(
      (u) =>
        !selected.has(u.id) &&
        (u.display_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)),
    );
  }, [search, allUsers, selected]);

  const addUser = (user: User) => {
    setSelected((prev) => new Map(prev).set(user.id, user));
    setSearch("");
  };

  const addable = addableDecisionMakers(decisionMakers, allUsers, selected);
  const hasMakerUsers = (decisionMakers ?? []).some((p) => p.user_id);

  const addDecisionMakers = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const u of addable) next.set(u.id, u);
      return next;
    });
  };

  const removeUser = (userId: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    await onRequest(Array.from(selected.keys()));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
        <OpenThreadsWarning count={openThreadCount} sx={{ mb: 2 }} />

        {hasMakerUsers && (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="group_add" size={18} />}
            onClick={addDecisionMakers}
            disabled={addable.length === 0}
            sx={{ textTransform: "none", mb: 1 }}
          >
            {t("adr.people.addDecisionMakers")}
          </Button>
        )}

        {/* Selected signatories as chips */}
        {selected.size > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
            {Array.from(selected.values()).map((u) => (
              <Chip
                key={u.id}
                label={u.display_name}
                onDelete={() => removeUser(u.id)}
                size="small"
              />
            ))}
          </Box>
        )}

        {/* Search field */}
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder={t("signatureDialog.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={20} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ mb: 1 }}
        />

        {/* Search results */}
        <Box
          sx={{
            minHeight: 150,
            maxHeight: 300,
            overflow: "auto",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {search.trim().length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center", py: 4 }}
            >
              {t("signatureDialog.searchPlaceholder")}
            </Typography>
          ) : filtered.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center", py: 4 }}
            >
              {t("signatureDialog.noResults")}
            </Typography>
          ) : (
            <List dense disablePadding>
              {filtered.map((u) => (
                <ListItemButton key={u.id} onClick={() => addUser(u)} dense>
                  <ListItemText primary={u.display_name} secondary={u.email} />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={selected.size === 0 || requesting}
          onClick={handleSubmit}
        >
          {requesting
            ? t("signatureDialog.sending")
            : t("signatureDialog.requestCount", { count: selected.size })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
