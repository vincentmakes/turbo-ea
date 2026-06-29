/**
 * ResourceTypesAdmin — admin CRUD for the two global lists shown on a card's
 * Resources tab: **link types** (document-link "type") and **file categories**
 * (file-attachment category).
 *
 * Both lists live in the `resource_types` table, discriminated by `kind`.
 * Built-in defaults (incl. the seeded "contract" link type) can be edited or
 * disabled but never hard-deleted; custom rows can be deleted. Link types
 * carry a Material Symbol `icon`; file categories don't. Saving pushes the
 * fresh list into the `useResourceTypes` singleton so the Resources tab
 * updates without a reload.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import MaterialSymbol from "@/components/MaterialSymbol";
import IconPicker from "@/components/IconPicker";
import { api } from "@/api/client";
import { useResourceTypes } from "@/hooks/useResourceTypes";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import { brand } from "@/theme/tokens";
import type { ResourceType, ResourceTypeKind, TranslationMap } from "@/types";

interface FormState {
  key: string;
  label: string;
  icon: string;
  is_enabled: boolean;
  sort_order: number;
  translations: TranslationMap;
}

const EMPTY_FORM: FormState = {
  key: "",
  label: "",
  icon: "",
  is_enabled: true,
  sort_order: 0,
  translations: {},
};

function cleanTranslations(map: TranslationMap): TranslationMap {
  const out: TranslationMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) out[k] = v.trim();
  }
  return out;
}

const KINDS: ResourceTypeKind[] = ["link_type", "file_category"];

export default function ResourceTypesAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const { refresh } = useResourceTypes();

  const [items, setItems] = useState<ResourceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dialogKind, setDialogKind] = useState<ResourceTypeKind>("link_type");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceType | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<ResourceType | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ResourceType[]>("/metamodel/resource-types");
      setItems(data);
      // Push the fresh list into the singleton so the Resources tab sees it.
      refresh();
    } catch {
      setError(t("metamodel.resourceTypes.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, refresh]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const byKind = useMemo(() => {
    const map: Record<ResourceTypeKind, ResourceType[]> = {
      link_type: [],
      file_category: [],
    };
    for (const r of items) map[r.kind]?.push(r);
    for (const k of KINDS) {
      map[k].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      );
    }
    return map;
  }, [items]);

  const openCreate = (kind: ResourceTypeKind) => {
    setDialogKind(kind);
    setEditing(null);
    setForm({ ...EMPTY_FORM, sort_order: byKind[kind].length * 10 + 100 });
    setDialogOpen(true);
  };

  const openEdit = (r: ResourceType) => {
    setDialogKind(r.kind);
    setEditing(r);
    setForm({
      key: r.key,
      label: r.label,
      icon: r.icon ?? "",
      is_enabled: r.is_enabled,
      sort_order: r.sort_order,
      translations: { ...r.translations },
    });
    setDialogOpen(true);
  };

  const isLinkType = dialogKind === "link_type";

  const handleSave = async () => {
    const payload = {
      label: form.label.trim(),
      icon: isLinkType ? form.icon.trim() || null : null,
      is_enabled: form.is_enabled,
      sort_order: form.sort_order,
      translations: cleanTranslations(form.translations),
    };
    try {
      if (editing) {
        await api.patch(`/metamodel/resource-types/${editing.id}`, payload);
      } else {
        await api.post("/metamodel/resource-types", {
          kind: dialogKind,
          key: form.key.trim().toLowerCase(),
          ...payload,
        });
      }
      setDialogOpen(false);
      fetchItems();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("metamodel.resourceTypes.saveError"),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/metamodel/resource-types/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      fetchItems();
    } catch {
      setError(t("metamodel.resourceTypes.deleteError"));
    }
  };

  const handleToggleEnabled = async (r: ResourceType) => {
    await api.patch(`/metamodel/resource-types/${r.id}`, {
      is_enabled: !r.is_enabled,
    });
    fetchItems();
  };

  const renderRow = (r: ResourceType) => (
    <Card
      key={r.id}
      sx={{ opacity: r.is_enabled ? 1 : 0.55, transition: "opacity 0.2s" }}
    >
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <MaterialSymbol
            icon={r.kind === "link_type" ? r.icon || "link" : "label"}
            size={20}
            color={r.is_enabled ? brand.primary : "#bbb"}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                flexWrap: "wrap",
              }}
            >
              <Typography variant="subtitle2" fontWeight={600}>
                {r.label}
              </Typography>
              <Chip
                size="small"
                label={r.key}
                sx={{ height: 20, fontSize: 11, fontFamily: "monospace" }}
              />
              {r.built_in && (
                <Chip
                  size="small"
                  label={t("metamodel.resourceTypes.builtIn")}
                  color="primary"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11 }}
                />
              )}
              {!r.is_enabled && (
                <Chip
                  size="small"
                  label={t("metamodel.resourceTypes.disabled")}
                  sx={{ height: 20, fontSize: 11 }}
                />
              )}
            </Box>
          </Box>
          <Tooltip
            title={
              r.is_enabled
                ? t("metamodel.resourceTypes.disableTip")
                : t("metamodel.resourceTypes.enableTip")
            }
          >
            <Switch
              size="small"
              checked={r.is_enabled}
              onChange={() => handleToggleEnabled(r)}
            />
          </Tooltip>
          <Tooltip title={t("common:actions.edit")}>
            <IconButton size="small" onClick={() => openEdit(r)}>
              <MaterialSymbol icon="edit" size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={
              r.built_in
                ? t("metamodel.resourceTypes.builtInProtected")
                : t("common:actions.delete")
            }
          >
            {/* span wrapper so Tooltip works while button is disabled */}
            <span>
              <IconButton
                size="small"
                disabled={r.built_in}
                onClick={() => setDeleteConfirm(r)}
              >
                <MaterialSymbol icon="delete" size={18} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </CardContent>
    </Card>
  );

  const renderSection = (kind: ResourceTypeKind) => (
    <Box sx={{ mb: 4 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 1,
        }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {kind === "link_type"
              ? t("metamodel.resourceTypes.linkTypesTitle")
              : t("metamodel.resourceTypes.fileCategoriesTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {kind === "link_type"
              ? t("metamodel.resourceTypes.linkTypesDescription")
              : t("metamodel.resourceTypes.fileCategoriesDescription")}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => openCreate(kind)}
        >
          {kind === "link_type"
            ? t("metamodel.resourceTypes.addLinkType")
            : t("metamodel.resourceTypes.addFileCategory")}
        </Button>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {byKind[kind].map(renderRow)}
      </Box>
    </Box>
  );

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
        {t("metamodel.resourceTypes.description")}
      </Typography>

      <Divider sx={{ mb: 2 }} />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {!loading && (
        <>
          {renderSection("link_type")}
          {renderSection("file_category")}
        </>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>
          {editing
            ? t("metamodel.resourceTypes.editTitle")
            : t("metamodel.resourceTypes.createTitle")}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label={t("metamodel.resourceTypes.keyLabel")}
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              disabled={!!editing}
              helperText={t("metamodel.resourceTypes.keyHelp")}
              placeholder="contract"
              fullWidth
            />
            <TextField
              size="small"
              label={t("metamodel.resourceTypes.labelLabel")}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Contract"
              fullWidth
            />
            {isLinkType && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {t("metamodel.resourceTypes.iconLabel")}
                </Typography>
                <IconPicker
                  value={form.icon || "link"}
                  onChange={(icon) => setForm({ ...form, icon })}
                  color={brand.primary}
                />
              </Box>
            )}
            <TextField
              size="small"
              type="number"
              label={t("metamodel.resourceTypes.sortOrderLabel")}
              value={form.sort_order}
              onChange={(e) =>
                setForm({
                  ...form,
                  sort_order: Number.parseInt(e.target.value, 10) || 0,
                })
              }
              sx={{ maxWidth: 220 }}
            />

            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("metamodel.resourceTypes.translationsLabel")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("metamodel.resourceTypes.translationsHelp")}
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  gap: 1,
                  mt: 1,
                }}
              >
                {SUPPORTED_LOCALES.filter((l) => l !== "en").map((locale) => (
                  <TextField
                    key={locale}
                    size="small"
                    label={LOCALE_LABELS[locale] ?? locale}
                    value={form.translations[locale] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        translations: {
                          ...form.translations,
                          [locale]: e.target.value,
                        },
                      })
                    }
                  />
                ))}
              </Box>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!form.label.trim() || (!editing && !form.key.trim())}
          >
            {editing ? t("common:actions.save") : t("common:actions.create")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{t("metamodel.resourceTypes.deleteTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("metamodel.resourceTypes.deleteConfirm", {
              label: deleteConfirm?.label,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
