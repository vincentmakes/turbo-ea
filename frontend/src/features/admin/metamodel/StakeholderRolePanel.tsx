import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { coerceKey, isValidKey } from "@/components/KeyInput";
import { api } from "@/api/client";
import { LOCALE_LABELS } from "@/i18n";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import type { StakeholderRoleDefinitionFull, MetamodelTranslations } from "@/types";

/** What blocks deleting or re-keying a role, from `.../stakeholder-roles/{key}/usage`. */
interface RoleUsage {
  role_key: string;
  stakeholder_count: number;
  card_count: number;
  survey_count: number;
  is_last_active: boolean;
  can_delete: boolean;
  /** A rename is refused only while somebody holds the role — surveys follow it. */
  can_rekey: boolean;
}

/** Backend grammar for a role key: `^[a-zA-Z][a-zA-Z0-9]{2,49}$`. */
const ROLE_KEY_MIN = 3;
const ROLE_KEY_MAX = 50;

/**
 * KeyInput's shared `isValidKey` covers the character set but permits any
 * length; the role endpoint additionally requires 3-50 characters. Checking
 * both here is what stops a server-side 422 reaching the user.
 */
function isValidRoleKey(key: string): boolean {
  return isValidKey(key) && key.length >= ROLE_KEY_MIN && key.length <= ROLE_KEY_MAX;
}

/**
 * Derive a key from a display label, e.g. "Business Architect" → "businessArchitect".
 *
 * Mirrors the auto-key behaviour the relation-type editor already has. Admins
 * should never have to hand-author a key that matches the metamodel grammar —
 * doing so is what produced the typo'd, unfixable role in #907.
 */
function deriveKey(label: string): string {
  const words = label.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return "";
  const [first, ...rest] = words;
  return coerceKey(
    first.toLowerCase() + rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(""),
  );
}

/** Clean a MetamodelTranslations object, removing empty maps. */
function cleanTranslations(
  trans: MetamodelTranslations | undefined,
): MetamodelTranslations | undefined {
  if (!trans) return undefined;
  const cleaned: MetamodelTranslations = {};
  for (const [key, map] of Object.entries(trans)) {
    if (!map) continue;
    const cm: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      if (v && v.trim()) cm[k] = v.trim();
    }
    if (Object.keys(cm).length > 0) cleaned[key] = cm;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/* ------------------------------------------------------------------ */
/*  Stakeholder Role Panel                                            */
/* ------------------------------------------------------------------ */

export interface StakeholderRolePanelProps {
  typeKey: string;
  onError: (msg: string) => void;
}

export default function StakeholderRolePanel({ typeKey, onError }: StakeholderRolePanelProps) {
  const { t } = useTranslation(["admin", "common"]);
  const { enabledLocales } = useEnabledLocales();
  const [roles, setRoles] = useState<StakeholderRoleDefinitionFull[]>([]);
  const [permissionsSchema, setPermissionsSchema] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  /* --- Create role form --- */
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    key: "",
    label: "",
    description: "",
    color: "#1976d2",
    permissions: {} as Record<string, boolean>,
    translations: {} as MetamodelTranslations,
  });
  const [createSaving, setCreateSaving] = useState(false);
  /** False until the admin edits the key by hand, after which auto-derive stops. */
  const [createKeyTouched, setCreateKeyTouched] = useState(false);

  /* --- Edit role form --- */
  const [editRoleKey, setEditRoleKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    key: "",
    label: "",
    description: "",
    color: "#1976d2",
    permissions: {} as Record<string, boolean>,
    translations: {} as MetamodelTranslations,
  });
  const [editSaving, setEditSaving] = useState(false);
  /** Usage of the role being edited — `null` while still loading. */
  const [editUsage, setEditUsage] = useState<RoleUsage | null>(null);

  /* --- Destructive-action confirmation --- */
  const [confirm, setConfirm] = useState<{
    action: "delete" | "archive";
    role: StakeholderRoleDefinitionFull;
    usage: RoleUsage | null;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  /* --- Fetch roles + permissions schema --- */
  const fetchRoles = useCallback(async () => {
    try {
      // Archived roles are excluded server-side by default; fetch them too so
      // the "Show archived" toggle has something to reveal.
      const data = await api.get<StakeholderRoleDefinitionFull[]>(
        `/metamodel/types/${typeKey}/stakeholder-roles?include_archived=true`,
      );
      setRoles(data);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToFetchRoles"));
    }
  }, [typeKey, onError]);

  const fetchUsage = useCallback(
    (roleKey: string) =>
      api
        .get<RoleUsage>(
          `/metamodel/types/${typeKey}/stakeholder-roles/${encodeURIComponent(roleKey)}/usage`,
        )
        .catch(() => null),
    [typeKey],
  );

  const fetchPermissionsSchema = useCallback(async () => {
    try {
      const data = await api.get<Record<string, string>>("/stakeholder-roles/permissions-schema");
      setPermissionsSchema(data);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToFetchSchema"));
    }
  }, [onError]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRoles(), fetchPermissionsSchema()]).finally(() => setLoading(false));
  }, [fetchRoles, fetchPermissionsSchema]);

  /* Reset state when typeKey changes */
  useEffect(() => {
    setExpandedRole(null);
    setCreateOpen(false);
    setEditRoleKey(null);
    setConfirm(null);
  }, [typeKey]);

  /* --- Filter by archived --- */
  const displayRoles = showArchived ? roles : roles.filter((r) => !r.is_archived);

  /* --- Create role --- */
  const handleCreate = async () => {
    if (!isValidRoleKey(createForm.key) || !createForm.label) return;
    setCreateSaving(true);
    try {
      await api.post(`/metamodel/types/${typeKey}/stakeholder-roles`, {
        key: createForm.key,
        label: createForm.label,
        description: createForm.description || undefined,
        color: createForm.color,
        permissions: createForm.permissions,
        translations: cleanTranslations(createForm.translations) || undefined,
      });
      await fetchRoles();
      setCreateForm({ key: "", label: "", description: "", color: "#1976d2", permissions: {}, translations: {} });
      setCreateKeyTouched(false);
      setCreateOpen(false);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToCreate"));
    } finally {
      setCreateSaving(false);
    }
  };

  /* --- Edit role --- */
  const startEdit = (role: StakeholderRoleDefinitionFull) => {
    setEditRoleKey(role.key);
    setEditForm({
      key: role.key,
      label: role.label,
      description: role.description || "",
      color: role.color,
      permissions: { ...role.permissions },
      translations: role.translations ? { ...role.translations } : {},
    });
    setExpandedRole(role.key);
    // The key is only re-writable while the role is unused; find out which.
    setEditUsage(null);
    fetchUsage(role.key).then(setEditUsage);
  };

  const handleSaveEdit = async () => {
    if (!editRoleKey) return;
    setEditSaving(true);
    try {
      const keyChanged = editForm.key !== editRoleKey;
      await api.patch(`/metamodel/types/${typeKey}/stakeholder-roles/${editRoleKey}`, {
        key: keyChanged ? editForm.key : undefined,
        label: editForm.label,
        description: editForm.description || undefined,
        color: editForm.color,
        permissions: editForm.permissions,
        translations: cleanTranslations(editForm.translations) || null,
      });
      await fetchRoles();
      setEditRoleKey(null);
      if (keyChanged) setExpandedRole(editForm.key);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToUpdate"));
    } finally {
      setEditSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditRoleKey(null);
  };

  /* --- Archive / Delete / Restore --- */

  /**
   * Open the confirmation dialog and fetch the role's usage in the background.
   * `usage: null` is the loading sentinel that keeps the destructive button
   * disabled — same shape as the field/section delete dialogs.
   */
  const promptDestructive = (action: "delete" | "archive", role: StakeholderRoleDefinitionFull) => {
    setConfirm({ action, role, usage: null });
    fetchUsage(role.key).then((usage) =>
      setConfirm((prev) => (prev && prev.role.key === role.key ? { ...prev, usage } : prev)),
    );
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    const { action, role } = confirm;
    setConfirmBusy(true);
    try {
      if (action === "delete") {
        await api.delete(`/metamodel/types/${typeKey}/stakeholder-roles/${role.key}`);
      } else {
        await api.post(`/metamodel/types/${typeKey}/stakeholder-roles/${role.key}/archive`);
      }
      await fetchRoles();
      setConfirm(null);
    } catch (e: unknown) {
      onError(
        e instanceof Error
          ? e.message
          : t(
              action === "delete"
                ? "metamodel.stakeholderPanel.failedToDelete"
                : "metamodel.stakeholderPanel.failedToArchive",
            ),
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleRestore = async (roleKey: string) => {
    try {
      await api.post(`/metamodel/types/${typeKey}/stakeholder-roles/${roleKey}/restore`);
      await fetchRoles();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToRestore"));
    }
  };

  /* --- Permission checkbox helper --- */
  const renderPermissionEditor = (
    perms: Record<string, boolean>,
    onChange: (key: string, val: boolean) => void,
  ) => (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
        {t("metamodel.stakeholderPanel.permissions")}
      </Typography>
      {Object.entries(permissionsSchema).map(([permKey, permDesc]) => (
        <Box
          key={permKey}
          sx={{
            display: "flex",
            alignItems: "center",
            py: 0.25,
            "&:hover": { bgcolor: "action.hover" },
            borderRadius: 1,
          }}
        >
          <Checkbox
            size="small"
            checked={!!perms[permKey]}
            onChange={(e) => onChange(permKey, e.target.checked)}
            sx={{ p: 0.5 }}
          />
          <Box sx={{ ml: 0.5, minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={500} sx={{ lineHeight: 1.3 }}>
              {permKey}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
              {permDesc}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );

  /* --- Translation fields helper --- */
  const nonEnLocales = enabledLocales.filter((l) => l !== "en");
  const renderTranslationFields = (
    trans: MetamodelTranslations,
    onChange: (updated: MetamodelTranslations) => void,
  ) =>
    nonEnLocales.length > 0 ? (
      <Box sx={{ mt: 1 }}>
        <Typography
          variant="caption"
          fontWeight={600}
          color="text.secondary"
          sx={{ mb: 0.5, display: "block" }}
        >
          {t("metamodel.stakeholderPanel.translations")}
        </Typography>
        {nonEnLocales.map((locale) => (
          <TextField
            key={locale}
            size="small"
            label={LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale}
            value={trans?.label?.[locale] || ""}
            onChange={(e) =>
              onChange({
                ...trans,
                label: { ...trans?.label, [locale]: e.target.value },
              })
            }
            fullWidth
            sx={{ mb: 1 }}
          />
        ))}
      </Box>
    ) : null;

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header row */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("metamodel.stakeholderPanel.title")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          }
          label={<Typography variant="caption">{t("metamodel.stakeholderPanel.showArchived")}</Typography>}
          sx={{ mr: 0 }}
        />
      </Box>

      {/* Role list */}
      {displayRoles.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {showArchived ? t("metamodel.stakeholderPanel.noRoles") : t("metamodel.stakeholderPanel.noActiveRoles")}
        </Typography>
      )}

      {displayRoles.map((role) => {
        const isEditing = editRoleKey === role.key;
        const isExpanded = expandedRole === role.key;

        return (
          <Card
            key={role.key}
            variant="outlined"
            sx={{
              mb: 1,
              opacity: role.is_archived ? 0.6 : 1,
              borderLeft: `4px solid ${role.color}`,
            }}
          >
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              {/* Role header row */}
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
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                  {role.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {role.key}
                </Typography>
                {role.is_archived && (
                  <Chip size="small" label={t("metamodel.stakeholderPanel.archived")} sx={{ height: 20, fontSize: 11 }} />
                )}
                {typeof role.stakeholder_count === "number" && (
                  <Chip
                    size="small"
                    label={t("metamodel.stakeholderPanel.subscriberCount", { count: role.stakeholder_count })}
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11 }}
                  />
                )}
                <IconButton
                  size="small"
                  onClick={() => setExpandedRole(isExpanded ? null : role.key)}
                >
                  <MaterialSymbol
                    icon={isExpanded ? "expand_less" : "expand_more"}
                    size={18}
                  />
                </IconButton>
                {!role.is_archived && (
                  <IconButton size="small" onClick={() => startEdit(role)}>
                    <MaterialSymbol icon="edit" size={18} />
                  </IconButton>
                )}
                {role.is_archived ? (
                  <Tooltip title={t("common:actions.restore")}>
                    <IconButton size="small" onClick={() => handleRestore(role.key)}>
                      <MaterialSymbol icon="restore" size={18} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Tooltip title={t("common:actions.archive")}>
                    <IconButton size="small" onClick={() => promptDestructive("archive", role)}>
                      <MaterialSymbol icon="archive" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={t("common:actions.delete")}>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => promptDestructive("delete", role)}
                  >
                    <MaterialSymbol icon="delete" size={18} />
                  </IconButton>
                </Tooltip>
              </Box>

              {/* Description */}
              {role.description && !isEditing && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                  {role.description}
                </Typography>
              )}

              {/* Expanded content */}
              <Collapse in={isExpanded}>
                <Box sx={{ mt: 1.5 }}>
                  {isEditing ? (
                    /* --- Inline edit form --- */
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                      <KeyInput
                        size="small"
                        label={t("metamodel.stakeholderPanel.keyLabel")}
                        value={editForm.key}
                        onChange={(v) => setEditForm({ ...editForm, key: v })}
                        fullWidth
                        // Gated on `can_rekey`, NOT `can_delete`: a role that is
                        // merely a survey's target, or the type's only role, can
                        // still be renamed — only a live assignment blocks it.
                        locked={!editUsage || !editUsage.can_rekey}
                        lockedReason={
                          !editUsage
                            ? t("metamodel.stakeholderPanel.checkingUsage")
                            : t("metamodel.stakeholderPanel.keyLockedInUse")
                        }
                        required
                      />
                      <TextField
                        size="small"
                        label={t("metamodel.stakeholderPanel.labelLabel")}
                        value={editForm.label}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                        fullWidth
                        error={!editForm.label.trim()}
                      />
                      <TextField
                        size="small"
                        label={t("metamodel.stakeholderPanel.descriptionLabel")}
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        multiline
                        rows={2}
                        fullWidth
                      />
                      <ColorPicker
                        value={editForm.color}
                        onChange={(c) => setEditForm({ ...editForm, color: c })}
                        label={t("metamodel.stakeholderPanel.colorLabel")}
                      />
                      {renderPermissionEditor(editForm.permissions, (key, val) =>
                        setEditForm({
                          ...editForm,
                          permissions: { ...editForm.permissions, [key]: val },
                        }),
                      )}
                      {renderTranslationFields(editForm.translations, (updated) =>
                        setEditForm({ ...editForm, translations: updated }),
                      )}
                      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
                        <Button size="small" onClick={cancelEdit}>
                          {t("common:actions.cancel")}
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={handleSaveEdit}
                          disabled={
                            editSaving ||
                            !editForm.label ||
                            // Only hold the key to the current grammar when it
                            // is actually being changed. A role created before
                            // keys were camelCase (via the API, an import, or an
                            // older release) keeps its key, and its label,
                            // colour and permissions must stay editable.
                            (editForm.key !== editRoleKey && !isValidRoleKey(editForm.key))
                          }
                        >
                          {editSaving ? t("metamodel.stakeholderPanel.saving") : t("common:actions.save")}
                        </Button>
                      </Box>
                    </Box>
                  ) : (
                    /* --- Read-only permission display --- */
                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                        {t("metamodel.stakeholderPanel.permissions")}
                      </Typography>
                      {Object.keys(permissionsSchema).length === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          {t("metamodel.stakeholderPanel.noPermissions")}
                        </Typography>
                      ) : (
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {Object.entries(permissionsSchema).map(([permKey]) => (
                            <Chip
                              key={permKey}
                              size="small"
                              label={permKey}
                              variant={role.permissions[permKey] ? "filled" : "outlined"}
                              color={role.permissions[permKey] ? "success" : "default"}
                              sx={{
                                height: 22,
                                fontSize: 11,
                                opacity: role.permissions[permKey] ? 1 : 0.5,
                              }}
                            />
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              </Collapse>
            </CardContent>
          </Card>
        );
      })}

      {/* Create role form */}
      {createOpen ? (
        <Card variant="outlined" sx={{ mt: 1, mb: 2, borderStyle: "dashed" }}>
          <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
              {t("metamodel.stakeholderPanel.newRole")}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <TextField
                size="small"
                label={t("metamodel.stakeholderPanel.labelLabel")}
                value={createForm.label}
                onChange={(e) => {
                  const label = e.target.value;
                  // Keep the key in step with the label until the admin takes
                  // it over, so a valid key is the default rather than a chore.
                  setCreateForm((prev) => ({
                    ...prev,
                    label,
                    key: createKeyTouched ? prev.key : deriveKey(label),
                  }));
                }}
                placeholder={t("metamodel.stakeholderPanel.labelPlaceholder")}
                fullWidth
                error={!createForm.label.trim()}
              />
              <KeyInput
                size="small"
                label={t("metamodel.stakeholderPanel.keyLabel")}
                value={createForm.key}
                onChange={(v) => {
                  setCreateKeyTouched(true);
                  setCreateForm((prev) => ({ ...prev, key: v }));
                }}
                placeholder={t("metamodel.stakeholderPanel.keyPlaceholder")}
                fullWidth
                required={!!createForm.label.trim()}
                externalError={
                  // Character-set problems are reported by KeyInput itself;
                  // only the length rule is ours to add.
                  createForm.key && isValidKey(createForm.key) && !isValidRoleKey(createForm.key)
                    ? t("metamodel.stakeholderPanel.keyLength", {
                        min: ROLE_KEY_MIN,
                        max: ROLE_KEY_MAX,
                      })
                    : undefined
                }
              />
              <TextField
                size="small"
                label={t("metamodel.stakeholderPanel.descriptionLabel")}
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                multiline
                rows={2}
                fullWidth
              />
              <ColorPicker
                value={createForm.color}
                onChange={(c) => setCreateForm({ ...createForm, color: c })}
                label={t("metamodel.stakeholderPanel.colorLabel")}
              />
              {renderPermissionEditor(createForm.permissions, (key, val) =>
                setCreateForm({
                  ...createForm,
                  permissions: { ...createForm.permissions, [key]: val },
                }),
              )}
              {renderTranslationFields(createForm.translations, (updated) =>
                setCreateForm({ ...createForm, translations: updated }),
              )}
              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
                <Button
                  size="small"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateKeyTouched(false);
                    setCreateForm({ key: "", label: "", description: "", color: "#1976d2", permissions: {}, translations: {} });
                  }}
                >
                  {t("common:actions.cancel")}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleCreate}
                  disabled={createSaving || !isValidRoleKey(createForm.key) || !createForm.label}
                >
                  {createSaving ? t("metamodel.stakeholderPanel.creating") : t("common:actions.create")}
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="add" size={16} />}
          onClick={() => setCreateOpen(true)}
          sx={{ mb: 2 }}
        >
          {t("metamodel.stakeholderPanel.addRole")}
        </Button>
      )}

      {/* Delete / archive confirmation. `usage === null` is the loading
          sentinel that keeps the destructive button disabled, matching the
          field- and section-delete dialogs in TypeDetailDrawer. */}
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>
          {t(
            confirm?.action === "delete"
              ? "metamodel.stakeholderPanel.deleteRole"
              : "metamodel.stakeholderPanel.archiveRole",
          )}
        </DialogTitle>
        <DialogContent>
          {confirm && (
            <>
              <Typography
                variant="body2"
                sx={{ mb: 2 }}
                dangerouslySetInnerHTML={{
                  __html: t(
                    confirm.action === "delete"
                      ? "metamodel.stakeholderPanel.deleteRoleConfirm"
                      : "metamodel.stakeholderPanel.archiveRoleConfirm",
                    { label: confirm.role.label, key: confirm.role.key },
                  ),
                }}
              />
              {confirm.usage === null ? (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  {t("metamodel.stakeholderPanel.checkingUsage")}
                </Alert>
              ) : confirm.action === "archive" ? (
                confirm.usage.stakeholder_count > 0 ? (
                  <Alert severity="warning">
                    <span
                      dangerouslySetInnerHTML={{
                        __html: t("metamodel.stakeholderPanel.archiveRevokes", {
                          count: confirm.usage.stakeholder_count,
                        }),
                      }}
                    />
                  </Alert>
                ) : (
                  <Alert severity="info">
                    {t("metamodel.stakeholderPanel.archiveNoStakeholders")}
                  </Alert>
                )
              ) : confirm.usage.can_delete ? (
                <Alert severity="info">{t("metamodel.stakeholderPanel.roleSafeToDelete")}</Alert>
              ) : (
                /* Unlike a field, an in-use role is a hard block — deleting it
                   would strip card-level permissions from real users with no
                   way back. Offer archive as the way forward instead. */
                <Alert severity="warning">
                  <span
                    dangerouslySetInnerHTML={{
                      __html: confirm.usage.stakeholder_count
                        ? t("metamodel.stakeholderPanel.roleUsedByCards", {
                            count: confirm.usage.stakeholder_count,
                            cards: confirm.usage.card_count,
                          })
                        : confirm.usage.survey_count
                          ? t("metamodel.stakeholderPanel.roleUsedBySurveys", {
                              count: confirm.usage.survey_count,
                            })
                          : t("metamodel.stakeholderPanel.roleIsLastActive"),
                    }}
                  />
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{t("common:actions.cancel")}</Button>
          {confirm?.action === "delete" && confirm.usage && !confirm.usage.can_delete ? (
            // Delete is impossible; archive is what the admin actually wants,
            // so switch the primary action rather than leaving a dead end.
            <Button
              variant="contained"
              disabled={confirmBusy || confirm.usage.is_last_active}
              onClick={() => setConfirm({ ...confirm, action: "archive" })}
            >
              {t("metamodel.stakeholderPanel.archiveInstead")}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="error"
              disabled={
                confirmBusy ||
                !confirm?.usage ||
                (confirm.action === "delete" && !confirm.usage.can_delete)
              }
              onClick={handleConfirm}
            >
              {t(
                confirm?.action === "delete"
                  ? "metamodel.stakeholderPanel.deleteRole"
                  : "metamodel.stakeholderPanel.archiveRole",
              )}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
