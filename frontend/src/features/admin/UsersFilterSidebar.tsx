import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColumnFreezeToggle from "@/components/grid/ColumnFreezeToggle";
import ColumnOrderSection, {
  type ColumnOrderItem,
} from "@/components/grid/ColumnOrderSection";
import type { AppRole } from "@/types";

export type UserStatusFilter = "active" | "invited" | "inactive";

export interface UserFilters {
  search: string;
  roles: string[];
  statuses: UserStatusFilter[];
  authMethods: ("local" | "sso")[];
  invited: boolean;
}

export const EMPTY_USER_FILTERS: UserFilters = {
  search: "",
  roles: [],
  statuses: [],
  authMethods: [],
  invited: false,
};

/**
 * `key` drives visibility (what the prefs store); `colId` is the grid's own
 * id for the same column and drives freezing. They differ for three columns,
 * so never use one where the other is meant.
 */
export const USER_COLUMNS = [
  { key: "name", colId: "display_name", icon: "person", tKey: "users.columns.name" as const },
  { key: "email", colId: "email", icon: "mail", tKey: "users.columns.email" as const },
  { key: "role", colId: "role", icon: "shield", tKey: "users.columns.role" as const },
  { key: "auth", colId: "auth_provider", icon: "vpn_key", tKey: "users.columns.auth" as const },
  { key: "status", colId: "is_active", icon: "check_circle", tKey: "users.columns.status" as const },
  {
    key: "last_login",
    colId: "last_login",
    icon: "schedule",
    tKey: "users.columns.lastLogin" as const,
  },
  {
    key: "created_at",
    colId: "created_at",
    icon: "event",
    tKey: "users.columns.createdAt" as const,
  },
  { key: "locale", colId: "locale", icon: "language", tKey: "users.columns.locale" as const },
  {
    key: "pending_setup",
    colId: "pending_setup",
    icon: "hourglass_top",
    tKey: "users.columns.pendingSetup" as const,
  },
];

export const USER_COLUMN_KEYS = USER_COLUMNS.map((c) => c.key);

export const DEFAULT_USER_COLUMNS = new Set<string>([
  "name",
  "email",
  "role",
  "auth",
  "status",
  "last_login",
]);

export const LOCKED_USER_COLUMN_KEYS: ReadonlySet<string> = new Set(["name"]);

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

const STATUS_OPTIONS: { key: UserStatusFilter; tKey: string; color: string }[] = [
  { key: "active", tKey: "users.status.active", color: "#4caf50" },
  { key: "invited", tKey: "users.status.invited", color: "#ed6c02" },
  { key: "inactive", tKey: "users.status.disabled", color: "#9e9e9e" },
];

const AUTH_OPTIONS: { key: "local" | "sso"; tKey: string; color: string }[] = [
  { key: "local", tKey: "users.auth.local", color: "#607d8b" },
  { key: "sso", tKey: "users.auth.sso", color: "#1976d2" },
];

interface Props {
  roles: AppRole[];
  filters: UserFilters;
  onFiltersChange: (f: UserFilters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  selectedColumns: Set<string>;
  onSelectedColumnsChange: (cols: Set<string>) => void;
  /** Grid colIds frozen to the leading edge; the pin on each row toggles one. */
  frozenColumns: Set<string>;
  onToggleFrozen: (colId: string) => void;
  onResetColumns?: () => void;
  /** Visible, movable columns in grid order — feeds the reorder section. */
  columnOrderItems: ColumnOrderItem[];
  /** The full stored colId order (may include hidden columns). */
  columnOrder: string[];
  onColumnOrderChange: (next: string[]) => void;
  onResetColumnOrder?: () => void;
}

export default function UsersFilterSidebar({
  roles,
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  selectedColumns,
  onSelectedColumnsChange,
  frozenColumns,
  onToggleFrozen,
  onResetColumns,
  columnOrderItems,
  columnOrder,
  onColumnOrderChange,
  onResetColumnOrder,
}: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const [tab, setTab] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    search: true,
    roles: true,
    status: true,
    auth: true,
    advanced: false,
  });

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleRole = (key: string) => {
    const next = filters.roles.includes(key)
      ? filters.roles.filter((r) => r !== key)
      : [...filters.roles, key];
    onFiltersChange({ ...filters, roles: next });
  };

  const toggleStatus = (key: UserStatusFilter) => {
    const next = filters.statuses.includes(key)
      ? filters.statuses.filter((s) => s !== key)
      : [...filters.statuses, key];
    onFiltersChange({ ...filters, statuses: next });
  };

  const toggleAuth = (key: "local" | "sso") => {
    const next = filters.authMethods.includes(key)
      ? filters.authMethods.filter((a) => a !== key)
      : [...filters.authMethods, key];
    onFiltersChange({ ...filters, authMethods: next });
  };

  const activeCount = useMemo(() => {
    let c = 0;
    if (filters.search.trim()) c += 1;
    c += filters.roles.length;
    c += filters.statuses.length;
    c += filters.authMethods.length;
    if (filters.invited) c += 1;
    return c;
  }, [filters]);

  const clearAll = () => onFiltersChange(EMPTY_USER_FILTERS);

  const columnsChanged = useMemo(() => {
    if (selectedColumns.size !== DEFAULT_USER_COLUMNS.size) return true;
    for (const k of DEFAULT_USER_COLUMNS) if (!selectedColumns.has(k)) return true;
    return false;
  }, [selectedColumns]);

  const toggleColumn = (key: string) => {
    if (LOCKED_USER_COLUMN_KEYS.has(key)) return;
    const next = new Set(selectedColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedColumnsChange(next);
  };

  /* ---- Resize drag ---- */
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (ev.clientX - startX)));
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  /* ---- Collapsed rail ---- */
  if (collapsed) {
    return (
      <Box
        sx={{
          width: 44,
          minWidth: 44,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title={t("users.filter.expand")} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 12 }}
          />
        )}
      </Box>
    );
  }

  /* ---- Expanded sidebar ---- */
  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          minWidth: MIN_WIDTH,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 0.5,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{
              minHeight: 36,
              "& .MuiTab-root": {
                minHeight: 36,
                py: 0,
                textTransform: "none",
                fontSize: 14,
                minWidth: 0,
              },
            }}
          >
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {t("users.filter.title")}
                  {activeCount > 0 && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "primary.main",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
              }
            />
            <Tab
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {t("users.columns.title")}
                  {columnsChanged && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "primary.main",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
              }
            />
          </Tabs>
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {tab === 0 ? (
            <>
              {/* Search */}
              <SectionHeader
                label={t("common:actions.search")}
                icon="search"
                expanded={expandedSections.search}
                onToggle={() => toggleSection("search")}
              />
              <Collapse in={expandedSections.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("users.filter.searchPlaceholder")}
                  value={filters.search}
                  onChange={(e) =>
                    onFiltersChange({ ...filters, search: e.target.value })
                  }
                  sx={{ mb: 2 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <MaterialSymbol icon="search" size={16} />
                      </InputAdornment>
                    ),
                    ...(filters.search
                      ? {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                size="small"
                                onClick={() =>
                                  onFiltersChange({ ...filters, search: "" })
                                }
                              >
                                <MaterialSymbol icon="close" size={14} />
                              </IconButton>
                            </InputAdornment>
                          ),
                        }
                      : {}),
                  }}
                />
              </Collapse>

              {/* Roles */}
              <SectionHeader
                label={t("users.columns.role")}
                icon="shield"
                expanded={expandedSections.roles}
                onToggle={() => toggleSection("roles")}
                count={filters.roles.length}
              />
              <Collapse in={expandedSections.roles}>
                <List dense disablePadding sx={{ mb: 1 }}>
                  {roles
                    .filter((r) => !r.is_archived)
                    .map((r) => (
                      <ListItemButton
                        key={r.key}
                        dense
                        onClick={() => toggleRole(r.key)}
                        sx={{ py: 0.25, px: 1, borderRadius: 1 }}
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <Checkbox
                            size="small"
                            checked={filters.roles.includes(r.key)}
                            disableRipple
                            sx={{ p: 0 }}
                          />
                        </ListItemIcon>
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            bgcolor: r.color,
                            flexShrink: 0,
                          }}
                        />
                        <ListItemText
                          primary={r.label}
                          primaryTypographyProps={{
                            fontSize: 14,
                            ml: 0.75,
                            noWrap: true,
                          }}
                        />
                      </ListItemButton>
                    ))}
                </List>
              </Collapse>

              {/* Status */}
              <SectionHeader
                label={t("users.columns.status")}
                icon="check_circle"
                expanded={expandedSections.status}
                onToggle={() => toggleSection("status")}
                count={filters.statuses.length}
              />
              <Collapse in={expandedSections.status}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                  {STATUS_OPTIONS.map((s) => (
                    <Chip
                      key={s.key}
                      label={t(s.tKey)}
                      size="small"
                      onClick={() => toggleStatus(s.key)}
                      variant={filters.statuses.includes(s.key) ? "filled" : "outlined"}
                      sx={
                        filters.statuses.includes(s.key)
                          ? { bgcolor: s.color, color: "#fff", borderColor: s.color }
                          : { borderColor: s.color, color: s.color }
                      }
                    />
                  ))}
                </Box>
              </Collapse>

              {/* Auth method */}
              <SectionHeader
                label={t("users.columns.auth")}
                icon="vpn_key"
                expanded={expandedSections.auth}
                onToggle={() => toggleSection("auth")}
                count={filters.authMethods.length}
              />
              <Collapse in={expandedSections.auth}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                  {AUTH_OPTIONS.map((a) => (
                    <Chip
                      key={a.key}
                      label={t(a.tKey)}
                      size="small"
                      onClick={() => toggleAuth(a.key)}
                      variant={filters.authMethods.includes(a.key) ? "filled" : "outlined"}
                      sx={
                        filters.authMethods.includes(a.key)
                          ? { bgcolor: a.color, color: "#fff", borderColor: a.color }
                          : { borderColor: a.color, color: a.color }
                      }
                    />
                  ))}
                </Box>
              </Collapse>

              {/* Advanced */}
              <SectionHeader
                label={t("users.filter.advanced")}
                icon="tune"
                expanded={expandedSections.advanced}
                onToggle={() => toggleSection("advanced")}
                count={filters.invited ? 1 : 0}
              />
              <Collapse in={expandedSections.advanced}>
                <Box sx={{ px: 0.5, mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={filters.invited}
                        onChange={(e) =>
                          onFiltersChange({
                            ...filters,
                            invited: e.target.checked,
                          })
                        }
                      />
                    }
                    label={
                      <Typography variant="body2" fontSize={13}>
                        {t("users.filter.invitedOnly")}
                      </Typography>
                    }
                  />
                </Box>
              </Collapse>

              {/* Clear all */}
              {activeCount > 0 && (
                <Box sx={{ mt: 2, px: 0.5 }}>
                  <Button
                    size="small"
                    fullWidth
                    variant="outlined"
                    onClick={clearAll}
                    startIcon={<MaterialSymbol icon="clear" size={16} />}
                  >
                    {t("users.filter.clearAll", { count: activeCount })}
                  </Button>
                </Box>
              )}
            </>
          ) : (
            /* ====================== COLUMNS TAB ====================== */
            <>
              <ColumnOrderSection
                items={columnOrderItems}
                order={columnOrder}
                frozen={frozenColumns}
                onToggleFrozen={onToggleFrozen}
                onReorder={onColumnOrderChange}
                onReset={onResetColumnOrder}
              />
              <List dense disablePadding>
                {USER_COLUMNS.map((c) => {
                  const locked = LOCKED_USER_COLUMN_KEYS.has(c.key);
                  const checked = selectedColumns.has(c.key) || locked;
                  return (
                    // The pin is a sibling of the row button, never a child:
                    // a locked row disables its button (which would swallow
                    // the click), and a locked column is worth freezing.
                    <Box key={c.key} sx={{ display: "flex", alignItems: "center" }}>
                    <ListItemButton
                      dense
                      onClick={() => toggleColumn(c.key)}
                      disabled={locked}
                      sx={{ py: 0.25, px: 1, borderRadius: 1, flex: 1, minWidth: 0 }}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <Checkbox
                          size="small"
                          checked={checked}
                          disabled={locked}
                          disableRipple
                          sx={{ p: 0 }}
                        />
                      </ListItemIcon>
                      <MaterialSymbol icon={c.icon} size={16} />
                      <ListItemText
                        primary={t(c.tKey)}
                        primaryTypographyProps={{
                          fontSize: 14,
                          ml: 0.75,
                          noWrap: true,
                        }}
                      />
                    </ListItemButton>
                    <ColumnFreezeToggle
                      frozen={frozenColumns.has(c.colId)}
                      onToggle={() => onToggleFrozen(c.colId)}
                    />
                    </Box>
                  );
                })}
              </List>
              {onResetColumns && columnsChanged && (
                <Box sx={{ mt: 2, px: 0.5 }}>
                  <Button
                    size="small"
                    fullWidth
                    variant="outlined"
                    onClick={onResetColumns}
                    startIcon={<MaterialSymbol icon="restart_alt" size={16} />}
                  >
                    {t("users.columns.reset")}
                  </Button>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 4,
          cursor: "col-resize",
          flexShrink: 0,
          "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
        }}
      />
    </Box>
  );
}

function SectionHeader({
  label,
  icon,
  expanded,
  onToggle,
  count,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        py: 0.5,
        px: 0.5,
        cursor: "pointer",
        borderRadius: 1,
        userSelect: "none",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <MaterialSymbol
        icon={expanded ? "expand_more" : "chevron_right"}
        size={16}
      />
      <MaterialSymbol icon={icon} size={16} />
      <Typography variant="body2" fontWeight={600} fontSize={13} sx={{ flex: 1 }}>
        {label}
      </Typography>
      {count != null && count > 0 && (
        <Chip
          label={count}
          size="small"
          color="primary"
          sx={{ height: 18, fontSize: 11 }}
        />
      )}
    </Box>
  );
}
