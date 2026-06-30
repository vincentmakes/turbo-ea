import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useResolveLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { useMetamodel } from "@/hooks/useMetamodel";
import SectionPaper, { EmptyState } from "../workspace/SectionPaper";

interface DirectoryCard {
  id: string;
  name: string;
}

interface DirectoryUser {
  user_id: string;
  display_name: string;
  email?: string;
  card_count: number;
  cards: DirectoryCard[];
}

interface DirectoryRole {
  role_key: string;
  role_label: string;
  role_color: string;
  role_translations: Record<string, string>;
  users: DirectoryUser[];
}

interface DirectoryCardType {
  type_key: string;
  type_label: string;
  type_icon: string;
  type_color: string;
  holders_count: number;
  roles: DirectoryRole[];
}

interface DirectoryResponse {
  card_types: DirectoryCardType[];
}

/** Compose a stable key for a specific user-under-a-role placement so the
 * expansion state for the same person under two different roles is
 * independent. */
function userKey(typeKey: string, roleKey: string, userId: string) {
  return `${typeKey}::${roleKey}::${userId}`;
}

export default function StakeholderDirectorySection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const rl = useResolveLabel();
  const resolveTypeLabel = useTypeLabel();
  const { getType } = useMetamodel();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [nameFilter, setNameFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get<DirectoryResponse>("/reports/stakeholder-directory")
      .then((res) => {
        if (cancelled) return;
        setData(res);
        // Pre-expand the first card type so the section isn't fully
        // collapsed by default — the user can see the structure at a
        // glance and click the others to drill in.
        if (res.card_types[0]) {
          setExpandedTypes(new Set([res.card_types[0].type_key]));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter the tree by user name. When the filter is active, drop users
  // whose name doesn't match, then drop roles with no remaining users,
  // then drop card types with no remaining roles. The card-type accordion
  // auto-expands when filtered so the matches are visible without an extra
  // click.
  const filteredCardTypes = useMemo(() => {
    if (!data) return [];
    const q = nameFilter.trim().toLowerCase();
    if (!q) return data.card_types;
    const out: DirectoryCardType[] = [];
    for (const ct of data.card_types) {
      const roles: DirectoryRole[] = [];
      for (const role of ct.roles) {
        const users = role.users.filter(
          (u) =>
            (u.display_name || "").toLowerCase().includes(q) ||
            (u.email || "").toLowerCase().includes(q),
        );
        if (users.length > 0) {
          roles.push({ ...role, users });
        }
      }
      if (roles.length > 0) {
        out.push({
          ...ct,
          roles,
          holders_count: new Set(roles.flatMap((r) => r.users.map((u) => u.user_id))).size,
        });
      }
    }
    return out;
  }, [data, nameFilter]);

  const filterActive = nameFilter.trim().length > 0;

  const toggleType = (typeKey: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeKey)) next.delete(typeKey);
      else next.add(typeKey);
      return next;
    });
  };

  const toggleUser = (key: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <SectionPaper
      icon="groups_3"
      iconColor="#1976d2"
      title={t("dashboard.admin.stakeholderDirectory")}
    >
      {loading ? (
        <LinearProgress />
      ) : !data || data.card_types.length === 0 ? (
        <EmptyState message={t("dashboard.admin.stakeholderDirectory.empty")} />
      ) : (
        <Box>
          <TextField
            size="small"
            fullWidth
            placeholder={t("dashboard.admin.stakeholderDirectory.filterPlaceholder")}
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            sx={{ mb: 1.5 }}
            slotProps={{
              input: {
                startAdornment: (
                  <Box sx={{ display: "flex", alignItems: "center", pr: 1 }}>
                    <MaterialSymbol icon="search" size={18} color="#999" />
                  </Box>
                ),
                endAdornment: filterActive ? (
                  <IconButton
                    size="small"
                    onClick={() => setNameFilter("")}
                    aria-label={t("dashboard.admin.stakeholderDirectory.clearFilter")}
                  >
                    <MaterialSymbol icon="close" size={16} />
                  </IconButton>
                ) : undefined,
              },
            }}
          />
          {filteredCardTypes.length === 0 ? (
            <EmptyState
              message={t("dashboard.admin.stakeholderDirectory.noMatches", {
                query: nameFilter,
              })}
            />
          ) : (
            filteredCardTypes.map((ct) => {
              // While filtering, force every card-type accordion open so the
              // matches are immediately visible.
              const isOpen = filterActive || expandedTypes.has(ct.type_key);
              return (
                <Box key={ct.type_key} sx={{ mb: 1, "&:last-of-type": { mb: 0 } }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      py: 0.75,
                      px: 1,
                      borderRadius: 1,
                      cursor: filterActive ? "default" : "pointer",
                      bgcolor: isOpen ? "action.hover" : "transparent",
                      "&:hover": filterActive ? {} : { bgcolor: "action.hover" },
                    }}
                    onClick={() => {
                      if (!filterActive) toggleType(ct.type_key);
                    }}
                  >
                    <IconButton size="small" sx={{ p: 0.25 }} disabled={filterActive}>
                      <MaterialSymbol
                        icon={isOpen ? "expand_more" : "chevron_right"}
                        size={18}
                      />
                    </IconButton>
                    <MaterialSymbol icon={ct.type_icon} size={18} color={ct.type_color} />
                    <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }} noWrap>
                      {resolveTypeLabel(getType(ct.type_key)) || ct.type_label}
                    </Typography>
                    <Chip
                      size="small"
                      label={t("dashboard.admin.stakeholderDirectory.holdersCount", {
                        count: ct.holders_count,
                      })}
                      sx={{
                        height: 22,
                        fontSize: "0.7rem",
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                      }}
                    />
                  </Box>
                  {isOpen && (
                    <Box sx={{ pl: 4, pt: 0.5, pb: 1 }}>
                      {ct.roles.map((role) => (
                        <Box
                          key={role.role_key}
                          sx={{ mb: 1.25, "&:last-of-type": { mb: 0 } }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.75,
                              mb: 0.5,
                            }}
                          >
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                bgcolor: role.role_color,
                                flexShrink: 0,
                              }}
                            />
                            <Typography
                              variant="caption"
                              sx={{
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                fontSize: "0.7rem",
                                color: "text.secondary",
                              }}
                            >
                              {rl(role.role_label, role.role_translations)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                            {role.users.map((u) => {
                              const k = userKey(ct.type_key, role.role_key, u.user_id);
                              const isUserOpen = expandedUsers.has(k);
                              return (
                                <Box key={u.user_id}>
                                  <Chip
                                    size="small"
                                    onClick={() => toggleUser(k)}
                                    icon={
                                      <MaterialSymbol
                                        icon={isUserOpen ? "expand_more" : "chevron_right"}
                                        size={14}
                                      />
                                    }
                                    label={
                                      <Box
                                        component="span"
                                        sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}
                                      >
                                        <Box component="span">{u.display_name}</Box>
                                        <Box
                                          component="span"
                                          sx={{ fontSize: "0.65rem", opacity: 0.75 }}
                                        >
                                          ·{" "}
                                          {t(
                                            "dashboard.admin.stakeholderDirectory.cardsCount",
                                            { count: u.card_count },
                                          )}
                                        </Box>
                                      </Box>
                                    }
                                    sx={{
                                      alignSelf: "flex-start",
                                      height: 24,
                                      fontSize: "0.72rem",
                                      bgcolor: "background.paper",
                                      border: 1,
                                      borderColor: "divider",
                                      cursor: "pointer",
                                      "&:hover": { bgcolor: "action.hover" },
                                    }}
                                  />
                                  {isUserOpen && (
                                    <Box sx={{ pl: 3.5, pt: 0.5, pb: 0.25 }}>
                                      {u.cards.map((card) => (
                                        <Box
                                          key={card.id}
                                          onClick={() => navigate(`/cards/${card.id}`)}
                                          sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 0.75,
                                            py: 0.25,
                                            px: 0.75,
                                            borderRadius: 0.5,
                                            cursor: "pointer",
                                            "&:hover": { bgcolor: "action.hover" },
                                          }}
                                        >
                                          <MaterialSymbol
                                            icon={ct.type_icon}
                                            size={14}
                                            color={ct.type_color}
                                          />
                                          <Typography
                                            variant="body2"
                                            sx={{ fontSize: "0.78rem" }}
                                            noWrap
                                          >
                                            {card.name}
                                          </Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  )}
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      )}
    </SectionPaper>
  );
}
