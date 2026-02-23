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
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput from "@/components/KeyInput";
import { api } from "@/api/client";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import type { StakeholderRoleDefinitionFull, MetamodelTranslations, TranslationMap } from "@/types";

/** Locales to show translation inputs for (all except English). */
const TRANSLATION_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== "en");

/** Remove empty-string entries from a TranslationMap. Returns undefined if all empty. */
function cleanTranslationMap(map: TranslationMap | undefined): TranslationMap | undefined {
  if (!map) return undefined;
  const cleaned: TranslationMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) cleaned[k] = v.trim();
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/** Clean a MetamodelTranslations object, removing empty maps. */
function cleanTranslations(
  trans: MetamodelTranslations | undefined,
): MetamodelTranslations | undefined {
  if (!trans) return undefined;
  const cleaned: MetamodelTranslations = {};
  for (const [key, map] of Object.entries(trans)) {
    const c = cleanTranslationMap(map);
    if (c) cleaned[key] = c;
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

  /* --- Edit role form --- */
  const [editRoleKey, setEditRoleKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    label: "",
    description: "",
    color: "#1976d2",
    permissions: {} as Record<string, boolean>,
    translations: {} as MetamodelTranslations,
  });
  const [editSaving, setEditSaving] = useState(false);

  /* --- Fetch roles + permissions schema --- */
  const fetchRoles = useCallback(async () => {
    try {
      const data = await api.get<StakeholderRoleDefinitionFull[]>(
        `/metamodel/types/${typeKey}/stakeholder-roles`,
      );
      setRoles(data);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToFetchRoles"));
    }
  }, [typeKey, onError]);

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
  }, [typeKey]);

  /* --- Filter by archived --- */
  const displayRoles = showArchived ? roles : roles.filter((r) => !r.is_archived);

  /* --- Create role --- */
  const handleCreate = async () => {
    if (!createForm.key || !createForm.label) return;
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
      label: role.label,
      description: role.description || "",
      color: role.color,
      permissions: { ...role.permissions },
      translations: role.translations ? { ...role.translations } : {},
    });
    setExpandedRole(role.key);
  };

  const handleSaveEdit = async () => {
    if (!editRoleKey) return;
    setEditSaving(true);
    try {
      await api.patch(`/metamodel/types/${typeKey}/stakeholder-roles/${editRoleKey}`, {
        label: editForm.label,
        description: editForm.description || undefined,
        color: editForm.color,
        permissions: editForm.permissions,
        translations: cleanTranslations(editForm.translations) || null,
      });
      await fetchRoles();
      setEditRoleKey(null);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToUpdate"));
    } finally {
      setEditSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditRoleKey(null);
  };

  /* --- Archive / Restore --- */
  const handleArchive = async (roleKey: string) => {
    try {
      await api.post(`/metamodel/types/${typeKey}/stakeholder-roles/${roleKey}/archive`);
      await fetchRoles();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : t("metamodel.stakeholderPanel.failedToArchive"));
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
                    <IconButton size="small" onClick={() => handleArchive(role.key)}>
                      <MaterialSymbol icon="archive" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
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
                      <TextField
                        size="small"
                        label={t("metamodel.stakeholderPanel.labelLabel")}
                        value={editForm.label}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                        fullWidth
                      />
                      <Accordion variant="outlined" disableGutters sx={{ "&:before": { display: "none" } }}>
                        <AccordionSummary
                          expandIcon={<MaterialSymbol icon="expand_more" size={16} />}
                          sx={{ minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.25 } }}
                        >
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <MaterialSymbol icon="translate" size={14} color="#999" />
                            <Typography variant="caption" color="text.secondary">
                              {t("metamodel.translations.roleTranslations")}
                            </Typography>
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails sx={{ pt: 0, pb: 1 }}>
                          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                            {TRANSLATION_LOCALES.map((locale) => (
                              <TextField
                                key={`edit-role-${locale}`}
                                size="small"
                                label={LOCALE_LABELS[locale]}
                                value={editForm.translations.label?.[locale] || ""}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    translations: {
                                      ...editForm.translations,
                                      label: { ...editForm.translations.label, [locale]: e.target.value },
                                    },
                                  })
                                }
                              />
                            ))}
                          </Box>
                        </AccordionDetails>
                      </Accordion>
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
                      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
                        <Button size="small" onClick={cancelEdit}>
                          {t("common:actions.cancel")}
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={handleSaveEdit}
                          disabled={editSaving || !editForm.label}
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
              <KeyInput
                size="small"
                label={t("metamodel.stakeholderPanel.keyLabel")}
                value={createForm.key}
                onChange={(v) => setCreateForm({ ...createForm, key: v })}
                placeholder={t("metamodel.stakeholderPanel.keyPlaceholder")}
                fullWidth
              />
              <TextField
                size="small"
                label={t("metamodel.stakeholderPanel.labelLabel")}
                value={createForm.label}
                onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })}
                placeholder={t("metamodel.stakeholderPanel.labelPlaceholder")}
                fullWidth
              />
              <Accordion variant="outlined" disableGutters sx={{ "&:before": { display: "none" } }}>
                <AccordionSummary
                  expandIcon={<MaterialSymbol icon="expand_more" size={16} />}
                  sx={{ minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.25 } }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <MaterialSymbol icon="translate" size={14} color="#999" />
                    <Typography variant="caption" color="text.secondary">
                      {t("metamodel.translations.roleTranslations")}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1 }}>
                  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                    {TRANSLATION_LOCALES.map((locale) => (
                      <TextField
                        key={`create-role-${locale}`}
                        size="small"
                        label={LOCALE_LABELS[locale]}
                        value={createForm.translations.label?.[locale] || ""}
                        onChange={(e) =>
                          setCreateForm({
                            ...createForm,
                            translations: {
                              ...createForm.translations,
                              label: { ...createForm.translations.label, [locale]: e.target.value },
                            },
                          })
                        }
                      />
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
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
              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
                <Button
                  size="small"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateForm({ key: "", label: "", description: "", color: "#1976d2", permissions: {}, translations: {} });
                  }}
                >
                  {t("common:actions.cancel")}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleCreate}
                  disabled={createSaving || !createForm.key || !createForm.label}
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
    </Box>
  );
}
