import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type { Card as CardType, TranslationMap, User } from "@/types";
import CardTypePill from "./CardTypePill";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface RoleDescriptor {
  key: string;
  label: string;
  color: string;
  translations: TranslationMap;
}

interface MyStakeholderResponse {
  items: CardType[];
  roles_by_card_id: Record<string, RoleDescriptor[]>;
}

interface RoleGroup {
  role: RoleDescriptor;
  cards: CardType[];
}

const MAX_CARDS_PER_ROLE = 5;

export default function MyRolesSection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const rl = useResolveLabel();
  const { user: currentUser } = useAuthContext();
  const { can } = usePermissions(currentUser);
  const canViewOthers = can("stakeholders.view");

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CardType[]>([]);
  const [rolesByCard, setRolesByCard] = useState<Record<string, RoleDescriptor[]>>({});

  // null = look up self. Picking a user (id !== current user) refetches with
  // ?user_id=… so the section can show another user's stakeholder portfolio.
  const [pickedUser, setPickedUser] = useState<User | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerUsers, setPickerUsers] = useState<User[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const targetName = pickedUser?.display_name ?? null;

  // Fetch users for the picker the first time it opens. Users tend to be a
  // small enough list to grab once and filter client-side, same pattern as
  // StakeholdersTab.
  useEffect(() => {
    if (!showPicker || pickerUsers.length > 0) return;
    let cancelled = false;
    setPickerLoading(true);
    api
      .get<User[]>("/users")
      .then((data) => {
        if (cancelled) return;
        // Exclude the current user — picking yourself is the default state.
        setPickerUsers(data.filter((u) => u.id !== currentUser?.id));
      })
      .finally(() => {
        if (!cancelled) setPickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showPicker, pickerUsers.length, currentUser?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = pickedUser
      ? `/cards/my-stakeholder?user_id=${encodeURIComponent(pickedUser.id)}`
      : "/cards/my-stakeholder";
    api
      .get<MyStakeholderResponse>(url)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setRolesByCard(data.roles_by_card_id || {});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickedUser]);

  // Invert items × roles_by_card_id into one bucket per role.
  const groups = useMemo<RoleGroup[]>(() => {
    const buckets = new Map<string, RoleGroup>();
    for (const card of items) {
      for (const role of rolesByCard[card.id] || []) {
        const existing = buckets.get(role.key);
        if (existing) {
          existing.cards.push(card);
        } else {
          buckets.set(role.key, { role, cards: [card] });
        }
      }
    }
    return Array.from(buckets.values()).sort((a, b) => b.cards.length - a.cards.length);
  }, [items, rolesByCard]);

  const clearPickedUser = useCallback(() => {
    setPickedUser(null);
    setShowPicker(false);
  }, []);

  const title = targetName
    ? t("dashboard.workspace.rolesHeldBy", { name: targetName })
    : t("dashboard.workspace.myRoles");
  const emptyMessage = targetName
    ? t("dashboard.workspace.empty.rolesForUser", { name: targetName })
    : t("dashboard.workspace.empty.roles");

  const headerAction = canViewOthers ? (
    showPicker || pickedUser ? (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Autocomplete<User, false, false, false>
          size="small"
          sx={{ minWidth: 200 }}
          options={pickerUsers}
          loading={pickerLoading}
          value={pickedUser}
          getOptionLabel={(u) => u.display_name || u.email}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={(opts, { inputValue }) => {
            const q = inputValue.trim().toLowerCase();
            if (!q) return opts;
            return opts.filter(
              (u) =>
                (u.display_name || "").toLowerCase().includes(q) ||
                (u.email || "").toLowerCase().includes(q),
            );
          }}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <Box sx={{ display: "flex", flexDirection: "column", py: 0.25 }}>
                <Typography variant="body2">{option.display_name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.email}
                </Typography>
              </Box>
            </li>
          )}
          onChange={(_, next) => setPickedUser(next)}
          renderInput={(params) => (
            <TextField {...params} placeholder={t("dashboard.workspace.viewAsUser")} />
          )}
        />
        <Tooltip title={t("dashboard.workspace.viewAsUserClear")}>
          <IconButton size="small" onClick={clearPickedUser}>
            <MaterialSymbol icon="close" size={18} />
          </IconButton>
        </Tooltip>
      </Box>
    ) : (
      <Tooltip title={t("dashboard.workspace.viewAsUser")}>
        <IconButton size="small" onClick={() => setShowPicker(true)} aria-label={t("dashboard.workspace.viewAsUser")}>
          <MaterialSymbol icon="person_search" size={18} />
        </IconButton>
      </Tooltip>
    )
  ) : undefined;

  return (
    <SectionPaper
      icon="groups"
      iconColor="#1976d2"
      title={title}
      action={headerAction}
    >
      {loading ? (
        <LinearProgress />
      ) : groups.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <Box>
          {groups.map(({ role, cards }) => {
            const visible = cards.slice(0, MAX_CARDS_PER_ROLE);
            const overflow = cards.length - visible.length;
            const localizedRoleLabel = rl(role.label, role.translations);
            return (
              <Box key={role.key} sx={{ mb: 2, "&:last-of-type": { mb: 0 } }}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.5,
                    pl: 1,
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: role.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      color: "text.secondary",
                    }}
                  >
                    {localizedRoleLabel}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    ({cards.length})
                  </Typography>
                </Box>
                {visible.map((card) => (
                  <Box
                    key={`${role.key}-${card.id}`}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      py: 0.5,
                      px: 1,
                      borderRadius: 1,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                    onClick={() => navigate(`/cards/${card.id}`)}
                  >
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {card.name}
                    </Typography>
                    <CardTypePill typeKey={card.type} />
                  </Box>
                ))}
                {overflow > 0 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ pl: 1, display: "block" }}
                  >
                    {t("dashboard.workspace.andMore", { count: overflow })}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}
