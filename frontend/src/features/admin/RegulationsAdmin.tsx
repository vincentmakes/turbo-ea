/**
 * RegulationsAdmin — admin CRUD for compliance regulations.
 *
 * The list is the single source of truth for which regulations appear in
 * the TurboLens compliance scan picker, the "create finding" dialog, and
 * the compliance register tabs. Built-ins (the 6 seeded defaults) can be
 * disabled but never hard-deleted; custom regulations can be deleted.
 *
 * Translations cover the display label only — the assessment-scope text
 * (which the AI scanner consumes) stays in English by design so prompt
 * behaviour is consistent across UI locales.
 */
import { useCallback, useEffect, useState } from "react";
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
import { api } from "@/api/client";
import { useComplianceRegulations } from "@/hooks/useComplianceRegulations";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import { brand } from "@/theme/tokens";
import type { ComplianceRegulation, TranslationMap } from "@/types";

interface FormState {
  key: string;
  label: string;
  description: string;
  is_enabled: boolean;
  sort_order: number;
  translations: TranslationMap;
}

const EMPTY_FORM: FormState = {
  key: "",
  label: "",
  description: "",
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

export default function RegulationsAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const { refresh } = useComplianceRegulations();

  const [items, setItems] = useState<ComplianceRegulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ComplianceRegulation | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] =
    useState<ComplianceRegulation | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ComplianceRegulation[]>(
        "/metamodel/compliance-regulations",
      );
      setItems(data);
      // Push the fresh list into the singleton so the rest of the app
      // sees the change without needing to refetch.
      refresh();
    } catch {
      setError(t("metamodel.regulations.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, refresh]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, sort_order: items.length * 10 + 100 });
    setDialogOpen(true);
  };

  const openEdit = (r: ComplianceRegulation) => {
    setEditing(r);
    setForm({
      key: r.key,
      label: r.label,
      description: r.description ?? "",
      is_enabled: r.is_enabled,
      sort_order: r.sort_order,
      translations: { ...r.translations },
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      label: form.label.trim(),
      description: form.description.trim() || null,
      is_enabled: form.is_enabled,
      sort_order: form.sort_order,
      translations: cleanTranslations(form.translations),
    };
    try {
      if (editing) {
        await api.patch(
          `/metamodel/compliance-regulations/${editing.id}`,
          payload,
        );
      } else {
        await api.post("/metamodel/compliance-regulations", {
          key: form.key.trim().toLowerCase(),
          ...payload,
        });
      }
      setDialogOpen(false);
      fetchItems();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("metamodel.regulations.saveError"),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/metamodel/compliance-regulations/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      fetchItems();
    } catch {
      setError(t("metamodel.regulations.deleteError"));
    }
  };

  const handleToggleEnabled = async (r: ComplianceRegulation) => {
    try {
      await api.patch(`/metamodel/compliance-regulations/${r.id}`, {
        is_enabled: !r.is_enabled,
      });
      fetchItems();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("metamodel.regulations.saveError"),
      );
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 1,
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
          {t("metamodel.regulations.description")}
        </Typography>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={openCreate}
        >
          {t("metamodel.regulations.add")}
        </Button>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {!loading && items.length === 0 && (
        <Box
          sx={{
            py: 6,
            textAlign: "center",
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 2,
          }}
        >
          <MaterialSymbol icon="gavel" size={40} color="#bbb" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("metamodel.regulations.empty")}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {items.map((r) => (
          <Card
            key={r.id}
            sx={{
              opacity: r.is_enabled ? 1 : 0.55,
              transition: "opacity 0.2s",
            }}
          >
            <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
              <Box
                sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}
              >
                <MaterialSymbol
                  icon="gavel"
                  size={22}
                  color={r.is_enabled ? brand.primary : "#bbb"}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mb: 0.5,
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
                        label={t("metamodel.regulations.builtIn")}
                        color="primary"
                        variant="outlined"
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    )}
                    {!r.is_enabled && (
                      <Chip
                        size="small"
                        label={t("metamodel.regulations.disabled")}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    )}
                  </Box>
                  {r.description && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {r.description}
                    </Typography>
                  )}
                </Box>
                <Tooltip
                  title={
                    r.is_enabled
                      ? t("metamodel.regulations.disableTip")
                      : t("metamodel.regulations.enableTip")
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
                      ? t("metamodel.regulations.builtInProtected")
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
        ))}
      </Box>

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
            ? t("metamodel.regulations.editTitle")
            : t("metamodel.regulations.createTitle")}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label={t("metamodel.regulations.keyLabel")}
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              disabled={!!editing}
              helperText={t("metamodel.regulations.keyHelp")}
              placeholder="hipaa"
              fullWidth
            />
            <TextField
              size="small"
              label={t("metamodel.regulations.labelLabel")}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="HIPAA"
              fullWidth
            />
            <TextField
              size="small"
              multiline
              minRows={4}
              label={t("metamodel.regulations.descriptionLabel")}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              helperText={t("metamodel.regulations.descriptionHelp")}
              fullWidth
            />
            <TextField
              size="small"
              type="number"
              label={t("metamodel.regulations.sortOrderLabel")}
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
                {t("metamodel.regulations.translationsLabel")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("metamodel.regulations.translationsHelp")}
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "1fr 1fr",
                  },
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
        <DialogTitle>{t("metamodel.regulations.deleteTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("metamodel.regulations.deleteConfirm", {
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
