import { useState, useEffect, useCallback } from "react";
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
import FormControlLabel from "@mui/material/FormControlLabel";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { EAPrinciple } from "@/types";

interface PrincipleForm {
  title: string;
  description: string;
  rationale: string;
  implications: string;
  is_active: boolean;
}

const EMPTY_FORM: PrincipleForm = {
  title: "",
  description: "",
  rationale: "",
  implications: "",
  is_active: true,
};

export default function PrinciplesAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [principles, setPrinciples] = useState<EAPrinciple[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showInDelivery, setShowInDelivery] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PrincipleForm>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<EAPrinciple | null>(null);

  const fetchPrinciples = useCallback(async () => {
    setLoading(true);
    try {
      const [data, displaySetting] = await Promise.all([
        api.get<EAPrinciple[]>("/metamodel/principles"),
        api.get<{ enabled: boolean }>("/settings/principles-display"),
      ]);
      setPrinciples(data);
      setShowInDelivery(displaySetting.enabled);
    } catch {
      setError(t("metamodel.principles.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPrinciples();
  }, [fetchPrinciples]);

  const handleToggleDisplay = async (checked: boolean) => {
    setShowInDelivery(checked);
    try {
      await api.patch("/settings/principles-display", { enabled: checked });
    } catch {
      setShowInDelivery(!checked);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (p: EAPrinciple) => {
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description || "",
      rationale: p.rationale || "",
      implications: p.implications || "",
      is_active: p.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await api.patch(`/metamodel/principles/${editingId}`, {
          title: form.title,
          description: form.description || null,
          rationale: form.rationale || null,
          implications: form.implications || null,
          is_active: form.is_active,
        });
      } else {
        await api.post("/metamodel/principles", {
          title: form.title,
          description: form.description || null,
          rationale: form.rationale || null,
          implications: form.implications || null,
          is_active: form.is_active,
          sort_order: principles.length,
        });
      }
      setDialogOpen(false);
      fetchPrinciples();
    } catch {
      setError(t("metamodel.principles.saveError"));
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/metamodel/principles/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      fetchPrinciples();
    } catch {
      setError(t("metamodel.principles.deleteError"));
    }
  };

  const handleToggleActive = async (p: EAPrinciple) => {
    await api.patch(`/metamodel/principles/${p.id}`, {
      is_active: !p.is_active,
    });
    fetchPrinciples();
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
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 600 }}>
          {t("metamodel.principles.description")}
        </Typography>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={openCreate}
        >
          {t("metamodel.principles.add")}
        </Button>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showInDelivery}
              onChange={(_, v) => handleToggleDisplay(v)}
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              {t("metamodel.principles.showInDelivery")}
            </Typography>
          }
        />
      </Box>

      <Divider sx={{ mb: 2 }} />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {!loading && principles.length === 0 && (
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
            {t("metamodel.principles.empty")}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {principles.map((p) => (
          <Card
            key={p.id}
            sx={{
              opacity: p.is_active ? 1 : 0.55,
              transition: "opacity 0.2s",
            }}
          >
            <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
                <MaterialSymbol
                  icon="gavel"
                  size={22}
                  color={p.is_active ? "#1976d2" : "#bbb"}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      {p.title}
                    </Typography>
                    {!p.is_active && (
                      <Chip
                        size="small"
                        label={t("metamodel.principles.inactive")}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    )}
                  </Box>
                  {p.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      {p.description}
                    </Typography>
                  )}
                  {(p.rationale || p.implications) && (
                    <Box sx={{ display: "flex", gap: 3, mt: 0.5, flexWrap: "wrap" }}>
                      {p.rationale && (
                        <Box sx={{ flex: 1, minWidth: 200 }}>
                          <Typography variant="caption" color="text.secondary" fontWeight={600}>
                            {t("metamodel.principles.rationale")}:
                          </Typography>
                          <Box
                            component="ul"
                            sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}
                          >
                            {p.rationale.split("\n").filter(Boolean).map((line, idx) => (
                              <Typography
                                key={idx}
                                component="li"
                                variant="caption"
                                color="text.secondary"
                                sx={{ py: 0.1 }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Box>
                        </Box>
                      )}
                      {p.implications && (
                        <Box sx={{ flex: 1, minWidth: 200 }}>
                          <Typography variant="caption" color="text.secondary" fontWeight={600}>
                            {t("metamodel.principles.implications")}:
                          </Typography>
                          <Box
                            component="ul"
                            sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}
                          >
                            {p.implications.split("\n").filter(Boolean).map((line, idx) => (
                              <Typography
                                key={idx}
                                component="li"
                                variant="caption"
                                color="text.secondary"
                                sx={{ py: 0.1 }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
                <Tooltip title={p.is_active ? t("metamodel.principles.deactivate") : t("metamodel.principles.activate")}>
                  <Switch
                    size="small"
                    checked={p.is_active}
                    onChange={() => handleToggleActive(p)}
                  />
                </Tooltip>
                <Tooltip title={t("common:actions.edit")}>
                  <IconButton size="small" onClick={() => openEdit(p)}>
                    <MaterialSymbol icon="edit" size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("common:actions.delete")}>
                  <IconButton size="small" onClick={() => setDeleteConfirm(p)}>
                    <MaterialSymbol icon="delete" size={18} />
                  </IconButton>
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
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>
          {editingId
            ? t("metamodel.principles.editTitle")
            : t("metamodel.principles.createTitle")}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label={t("metamodel.principles.titleLabel")}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            sx={{ mt: 1, mb: 2 }}
            placeholder={t("metamodel.principles.titlePlaceholder")}
          />
          <TextField
            fullWidth
            multiline
            rows={2}
            label={t("metamodel.principles.descriptionLabel")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            sx={{ mb: 2 }}
            placeholder={t("metamodel.principles.descriptionPlaceholder")}
          />
          <TextField
            fullWidth
            multiline
            rows={2}
            label={t("metamodel.principles.rationaleLabel")}
            value={form.rationale}
            onChange={(e) => setForm({ ...form, rationale: e.target.value })}
            sx={{ mb: 2 }}
            placeholder={t("metamodel.principles.rationalePlaceholder")}
          />
          <TextField
            fullWidth
            multiline
            rows={2}
            label={t("metamodel.principles.implicationsLabel")}
            value={form.implications}
            onChange={(e) => setForm({ ...form, implications: e.target.value })}
            placeholder={t("metamodel.principles.implicationsPlaceholder")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.title.trim()}>
            {editingId ? t("common:actions.save") : t("common:actions.create")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{t("metamodel.principles.deleteTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("metamodel.principles.deleteConfirm", { title: deleteConfirm?.title })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
