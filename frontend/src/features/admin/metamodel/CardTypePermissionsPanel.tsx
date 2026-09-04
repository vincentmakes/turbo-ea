import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { CardTypePermissionMatrix } from "@/types";

/**
 * Per-card-type RBAC overrides (discussion #1068).
 *
 * Every cell is tri-state: *inherit* (no stored value — the role's
 * landscape-wide grant decides), *allow*, or *deny*. That is what lets one
 * type both take a permission away from a role that has it globally and give
 * one to a role that does not, without minting a role per card type.
 *
 * Only overridden cells are sent; an action switched back to inherit is
 * deleted from the payload rather than stored as its inherited value, so a
 * later change to the role itself keeps flowing through.
 */

type CellState = "inherit" | "allow" | "deny";

/** The draft map mirrors the wire shape: `{roleKey: {permission: boolean}}`. */
type Draft = Record<string, Record<string, boolean>>;

interface CardTypePermissionsPanelProps {
  typeKey: string;
  onError: (msg: string) => void;
  /** Called after a successful save so the drawer can refresh the metamodel. */
  onSaved?: () => void;
}

function toDraft(matrix: CardTypePermissionMatrix): Draft {
  const draft: Draft = {};
  for (const role of matrix.roles) {
    if (Object.keys(role.overrides).length > 0) {
      draft[role.key] = { ...role.overrides };
    }
  }
  return draft;
}

function cellState(draft: Draft, roleKey: string, action: string): CellState {
  const cell = draft[roleKey]?.[action];
  if (cell === undefined) return "inherit";
  return cell ? "allow" : "deny";
}

export default function CardTypePermissionsPanel({
  typeKey,
  onError,
  onSaved,
}: CardTypePermissionsPanelProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [matrix, setMatrix] = useState<CardTypePermissionMatrix | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<CardTypePermissionMatrix>(
        `/metamodel/types/${typeKey}/permissions`
      );
      setMatrix(data);
      setDraft(toDraft(data));
    } catch (e: unknown) {
      onError(
        e instanceof Error ? e.message : t("metamodel.permissionsPanel.failedToFetch")
      );
    } finally {
      setLoading(false);
    }
    // `t` is stable enough for an error fallback; refetching on a language
    // switch would throw away unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey, onError]);

  useEffect(() => {
    setSaveError(null);
    setSaved(false);
    fetchMatrix();
  }, [fetchMatrix]);

  const original = useMemo(() => (matrix ? toDraft(matrix) : {}), [matrix]);
  const dirty = useMemo(
    () => JSON.stringify(original) !== JSON.stringify(draft),
    [original, draft]
  );

  const setCell = (roleKey: string, action: string, state: CellState) => {
    setSaved(false);
    setDraft((prev) => {
      const next: Draft = { ...prev, [roleKey]: { ...(prev[roleKey] ?? {}) } };
      if (state === "inherit") {
        delete next[roleKey][action];
      } else {
        next[roleKey][action] = state === "allow";
      }
      // An empty override map means "inherit everything", which is the same
      // statement as having no entry at all — and is what the API stores.
      if (Object.keys(next[roleKey]).length === 0) delete next[roleKey];
      return next;
    });
  };

  const resetRole = (roleKey: string) => {
    setSaved(false);
    setDraft((prev) => {
      const next = { ...prev };
      delete next[roleKey];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/metamodel/types/${typeKey}`, { role_permissions: draft });
      await fetchMatrix();
      setSaved(true);
      onSaved?.();
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : t("metamodel.permissionsPanel.failedToSave");
      setSaveError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  const actionLabel = (key: string) => {
    const suffix = key.split(".")[1] ?? key;
    const translated = t(`metamodel.permissionsPanel.action.${suffix}`, { defaultValue: "" });
    return translated || key;
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (!matrix) return null;

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
        {t("metamodel.permissionsPanel.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("metamodel.permissionsPanel.description")}
      </Typography>

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {saved && !dirty && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>
          {t("metamodel.permissionsPanel.saved")}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>
                {t("metamodel.permissionsPanel.roleColumn")}
              </TableCell>
              {matrix.actions.map((action) => (
                <TableCell key={action.key} align="center" sx={{ fontWeight: 600 }}>
                  <Tooltip title={action.description}>
                    <span>{actionLabel(action.key)}</span>
                  </Tooltip>
                </TableCell>
              ))}
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {matrix.roles.map((role) => {
              const hasOverrides = Object.keys(draft[role.key] ?? {}).length > 0;
              return (
                <TableRow key={role.key} hover>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: role.color,
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="body2">{role.label}</Typography>
                    </Box>
                  </TableCell>

                  {matrix.actions.map((action) => {
                    // The admin (wildcard) role is never overridable — that is
                    // the escape hatch that keeps an instance recoverable.
                    if (role.is_wildcard) {
                      return (
                        <TableCell key={action.key} align="center">
                          <Tooltip title={t("metamodel.permissionsPanel.adminLocked")}>
                            <span>
                              <MaterialSymbol icon="lock" size={18} color="#9e9e9e" />
                            </span>
                          </Tooltip>
                        </TableCell>
                      );
                    }

                    const state = cellState(draft, role.key, action.key);
                    const inherited = !!role.inherited[action.key];
                    return (
                      <TableCell key={action.key} align="center" sx={{ px: 0.5 }}>
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={state}
                          onChange={(_, v) => {
                            if (v) setCell(role.key, action.key, v as CellState);
                          }}
                          aria-label={`${role.label} ${actionLabel(action.key)}`}
                        >
                          <ToggleButton
                            value="inherit"
                            aria-label={t("metamodel.permissionsPanel.inherit")}
                          >
                            <Tooltip
                              title={t(
                                inherited
                                  ? "metamodel.permissionsPanel.inheritedAllowed"
                                  : "metamodel.permissionsPanel.inheritedDenied"
                              )}
                            >
                              <span style={{ display: "flex" }}>
                                <MaterialSymbol
                                  icon={inherited ? "check" : "close"}
                                  size={16}
                                  color={inherited ? "#2e7d32" : "#9e9e9e"}
                                />
                              </span>
                            </Tooltip>
                          </ToggleButton>
                          <ToggleButton
                            value="allow"
                            aria-label={t("metamodel.permissionsPanel.allow")}
                          >
                            <Tooltip title={t("metamodel.permissionsPanel.allow")}>
                              <span style={{ display: "flex" }}>
                                <MaterialSymbol icon="check_circle" size={16} color="#2e7d32" />
                              </span>
                            </Tooltip>
                          </ToggleButton>
                          <ToggleButton
                            value="deny"
                            aria-label={t("metamodel.permissionsPanel.deny")}
                          >
                            <Tooltip title={t("metamodel.permissionsPanel.deny")}>
                              <span style={{ display: "flex" }}>
                                <MaterialSymbol icon="block" size={16} color="#c62828" />
                              </span>
                            </Tooltip>
                          </ToggleButton>
                        </ToggleButtonGroup>
                      </TableCell>
                    );
                  })}

                  <TableCell align="right" sx={{ width: 48 }}>
                    {!role.is_wildcard && (
                      <Tooltip title={t("metamodel.permissionsPanel.resetRow")}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!hasOverrides}
                            onClick={() => resetRole(role.key)}
                            aria-label={t("metamodel.permissionsPanel.resetRow")}
                          >
                            <MaterialSymbol icon="restart_alt" size={18} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: "flex", gap: 1 }}>
        <Button variant="contained" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? t("metamodel.permissionsPanel.saving") : t("common:actions.save")}
        </Button>
        <Button
          variant="text"
          color="inherit"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(original);
            setSaveError(null);
          }}
        >
          {t("common:actions.cancel")}
        </Button>
      </Box>
    </Box>
  );
}
