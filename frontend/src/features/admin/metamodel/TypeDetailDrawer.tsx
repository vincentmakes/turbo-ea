import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import IconPicker from "@/components/IconPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import CardLayoutEditor from "@/features/admin/CardLayoutEditor";
import { api } from "@/api/client";
import { LOCALE_LABELS } from "@/i18n";
import type {
  CardType as FSType,
  RelationType as RType,
  FieldDef,
  SectionDef,
} from "@/types";
import { emptyField } from "./helpers";
import FieldEditorDialog from "./FieldEditorDialog";
import DataQualityPanel from "./DataQualityPanel";
import StakeholderRolePanel from "./StakeholderRolePanel";
import TranslationDialog from "./TranslationDialog";

/* ------------------------------------------------------------------ */
/*  Type Detail Dialog (full-width, 2-panel layout)                    */
/* ------------------------------------------------------------------ */

/** Render a preview of the first generated card ID from the current config. */
function formatIdExample(prefix: string, start: number, padding: number): string {
  const n = Number.isFinite(start) ? Math.max(0, Math.trunc(start)) : 0;
  return padding > 0 ? `${prefix}${String(n).padStart(padding, "0")}` : `${prefix}${n}`;
}

/** Suggested default ID prefix for a card type, e.g. "Application" → "APP-". */
function defaultPrefixForType(key: string): string {
  const base = (key || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  return base ? `${base}-` : "";
}

type TabKey = "main" | "relations" | "stakeholders" | "dataQuality";

export interface TypeDrawerProps {
  open: boolean;
  typeKey: string | null;
  types: FSType[];
  relationTypes: RType[];
  onClose: () => void;
  onRefresh: () => void;
  onCreateRelation: (preselectedTypeKey: string) => void;
}

export default function TypeDetailDrawer({
  open,
  typeKey,
  types,
  relationTypes,
  onClose,
  onRefresh,
  onCreateRelation,
}: TypeDrawerProps) {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const locale = i18n.language;
  const cardTypeKey = types.find((ct) => ct.key === typeKey) || null;

  /* --- Editable header state --- */
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("#1976d2");
  const [icon, setIcon] = useState("category");
  const [hasHierarchy, setHasHierarchy] = useState(false);
  const [hasSuccessors, setHasSuccessors] = useState(false);
  /* --- Human-readable card ID config (#811) --- */
  const [idEnabled, setIdEnabled] = useState(false);
  const [idPrefix, setIdPrefix] = useState("");
  const [idStart, setIdStart] = useState(1);
  const [idPadding, setIdPadding] = useState(5);
  const [editingPrefix, setEditingPrefix] = useState(false);
  // Locked once any card of this type already has an ID — the format (prefix /
  // start / min-digits) is then frozen so generated IDs stay stable & unique.
  const [idLocked, setIdLocked] = useState(false);
  const [idMissing, setIdMissing] = useState(0); // cards of this type with no ID yet
  const [generating, setGenerating] = useState(false);
  const [generateConfirm, setGenerateConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState("");

  /* --- Subtype inline add --- */
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [newSubKey, setNewSubKey] = useState("");
  const [newSubLabel, setNewSubLabel] = useState("");

  /* --- Subtype template editor --- */
  const [editingSubtypeKey, setEditingSubtypeKey] = useState<string | null>(null);
  const [draftHiddenFields, setDraftHiddenFields] = useState<Set<string>>(new Set());

  /* --- Translation dialog --- */
  const [translationDialogOpen, setTranslationDialogOpen] = useState(false);

  /* --- Drawer tab (general / relations / stakeholders / data quality) --- */
  const [tab, setTab] = useState<TabKey>("main");
  // Reset to the main tab only when switching to a different type — not on the
  // object-identity churn from onRefresh (which would kick the user out of the
  // current tab on every slider change).
  useEffect(() => {
    setTab("main");
  }, [typeKey]);

  /* --- Field editor --- */
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingSectionIdx, setEditingSectionIdx] = useState(0);
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<FieldDef>(emptyField());

  /* --- Field deletion confirmation --- */
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<{
    sectionIdx: number;
    fieldIdx: number;
    fieldKey: string;
    fieldLabel: string;
    cardCount: number | null; // null = loading
  } | null>(null);

  /* --- Section deletion confirmation --- */
  const [deleteSectionConfirm, setDeleteSectionConfirm] = useState<{
    sectionIdx: number;
    sectionName: string;
    fieldCount: number;
    cardCount: number | null; // null = loading
  } | null>(null);

  /* --- Add section --- */

  /* --- Calculated fields map (type_key → field_keys[]) --- */
  const [calculatedFieldKeys, setCalculatedFieldKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!open || !cardTypeKey) return;
    api
      .get<Record<string, string[]>>("/calculations/calculated-fields")
      .then((map) => setCalculatedFieldKeys(map[cardTypeKey.key] || []))
      .catch(() => setCalculatedFieldKeys([]));
    setIdLocked(false);
    setIdMissing(0);
    refreshReferenceUsage(cardTypeKey.key);
  }, [open, cardTypeKey]);

  const refreshReferenceUsage = (key: string) =>
    api
      .get<{ locked: boolean; missing: number }>(`/metamodel/types/${key}/reference-usage`)
      .then((r) => {
        setIdLocked(!!r.locked);
        setIdMissing(r.missing ?? 0);
      })
      .catch(() => {
        setIdLocked(false);
        setIdMissing(0);
      });

  /* Initialise local state from the type whenever the dialog opens or the type changes */
  useEffect(() => {
    if (cardTypeKey) {
      setLabel(cardTypeKey.translations?.label?.[locale] || cardTypeKey.label);
      setDescription(cardTypeKey.translations?.description?.[locale] || cardTypeKey.description || "");
      setCategory(cardTypeKey.category || "");
      setColor(cardTypeKey.color);
      setIcon(cardTypeKey.icon);
      setHasHierarchy(cardTypeKey.has_hierarchy);
      setHasSuccessors(cardTypeKey.has_successors);
      const rc = cardTypeKey.reference_config || {};
      setIdEnabled(rc.mode === "auto");
      setIdPrefix(rc.prefix || "");
      setIdStart(rc.start ?? 1);
      setIdPadding(rc.padding ?? 5);
      setEditingPrefix(false);
      setError(null);
      setAddSubOpen(false);
      setEditingSubtypeKey(null);
      setDeleteFieldConfirm(null);
      setDeleteSectionConfirm(null);
    }
  }, [cardTypeKey, locale]);

  if (!cardTypeKey) return null;

  const connectedRelations = relationTypes.filter(
    (r) =>
      (r.source_type_key === cardTypeKey.key || r.target_type_key === cardTypeKey.key) &&
      !r.key.endsWith("Successor"),
  );

  /* --- Save header --- */
  const handleSaveHeader = async () => {
    setSaving(true);
    try {
      const mergedTranslations = {
        ...cardTypeKey.translations,
        label: { ...cardTypeKey.translations?.label, [locale]: label },
        description: { ...cardTypeKey.translations?.description, [locale]: description || "" },
      };
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        label,
        description: description || undefined,
        category,
        color,
        icon,
        has_hierarchy: hasHierarchy,
        has_successors: hasSuccessors,
        reference_config: idEnabled
          ? { mode: "auto", prefix: idPrefix, start: idStart, padding: idPadding }
          : { mode: "off" },
        translations: mergedTranslations,
      });
      onRefresh();
      setError(null);
      setSnack(t("metamodel.typeDrawer.typeSaved"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  /* --- Card ID generation (explicit backfill of existing cards, #811) --- */
  const savedRc = cardTypeKey.reference_config || {};
  const idConfigDirty =
    idEnabled !== (savedRc.mode === "auto") ||
    (idEnabled &&
      (idPrefix !== (savedRc.prefix || "") ||
        idStart !== (savedRc.start ?? 1) ||
        idPadding !== (savedRc.padding ?? 5)));

  const handleGenerate = async () => {
    setGenerateConfirm(false);
    setGenerating(true);
    try {
      const r = await api.post<{ generated: number }>(
        `/metamodel/types/${cardTypeKey.key}/generate-references`,
        {},
      );
      await refreshReferenceUsage(cardTypeKey.key);
      setError(null);
      setSnack(t("metamodel.typeDrawer.cardId.generated", { count: r.generated }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToSave"));
    } finally {
      setGenerating(false);
    }
  };

  /* --- Subtypes --- */
  const handleAddSubtype = async () => {
    if (!newSubKey || !newSubLabel) return;
    try {
      const updated = [
        ...(cardTypeKey.subtypes || []),
        { key: newSubKey, label: newSubLabel, hidden_fields: [] },
      ];
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, { subtypes: updated });
      onRefresh();
      setNewSubKey("");
      setNewSubLabel("");
      setAddSubOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToAddSubtype"));
    }
  };

  const handleRemoveSubtype = async (subKey: string) => {
    try {
      const updated = (cardTypeKey.subtypes || []).filter((s) => s.key !== subKey);
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, { subtypes: updated });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToRemoveSubtype"));
    }
  };

  /* --- Subtype field visibility --- */
  const editingSubtype = editingSubtypeKey
    ? (cardTypeKey.subtypes || []).find((s) => s.key === editingSubtypeKey) ?? null
    : null;
  const allFields: { key: string; label: string; section: string }[] = [];
  for (const sec of cardTypeKey.fields_schema || []) {
    for (const f of sec.fields) {
      allFields.push({ key: f.key, label: f.label, section: sec.section === "__description" ? t("metamodel.typeDrawer.descriptionSection") : sec.section });
    }
  }
  const fieldSections = allFields.reduce<Record<string, { key: string; label: string }[]>>((acc, f) => {
    (acc[f.section] ??= []).push({ key: f.key, label: f.label });
    return acc;
  }, {});

  const openSubtypeTemplate = (subKey: string) => {
    const sub = (cardTypeKey.subtypes || []).find((s) => s.key === subKey);
    setDraftHiddenFields(new Set(sub?.hidden_fields ?? []));
    setEditingSubtypeKey(subKey);
  };

  const handleToggleFieldVisibility = (fieldKey: string) => {
    setDraftHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  };

  const handleSaveSubtypeTemplate = async () => {
    if (!editingSubtypeKey) return;
    const subtypes = (cardTypeKey.subtypes || []).map((s) => {
      if (s.key !== editingSubtypeKey) return s;
      return { ...s, hidden_fields: [...draftHiddenFields] };
    });
    try {
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, { subtypes });
      onRefresh();
      setEditingSubtypeKey(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToSave"));
    }
  };

  /* --- Fields --- */
  const openAddField = (sectionIdx: number) => {
    setEditingSectionIdx(sectionIdx);
    setEditingFieldIdx(null);
    setEditingField(emptyField());
    setFieldDialogOpen(true);
  };

  const openEditField = (sectionIdx: number, fieldIdx: number) => {
    setEditingSectionIdx(sectionIdx);
    setEditingFieldIdx(fieldIdx);
    setEditingField({ ...cardTypeKey.fields_schema[sectionIdx].fields[fieldIdx] });
    setFieldDialogOpen(true);
  };

  const handleSaveField = async (field: FieldDef) => {
    try {
      const schema: SectionDef[] = cardTypeKey.fields_schema.map((s) => ({
        ...s,
        fields: [...s.fields],
      }));
      if (editingFieldIdx !== null) {
        schema[editingSectionIdx].fields[editingFieldIdx] = field;
      } else {
        schema[editingSectionIdx].fields.push(field);
      }
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        fields_schema: schema,
      });
      onRefresh();
      setFieldDialogOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToSaveField"));
    }
  };

  const promptDeleteField = (sectionIdx: number, fieldIdx: number) => {
    const field = cardTypeKey.fields_schema[sectionIdx].fields[fieldIdx];
    setDeleteFieldConfirm({
      sectionIdx,
      fieldIdx,
      fieldKey: field.key,
      fieldLabel: field.label,
      cardCount: null,
    });
    api
      .get<{ card_count: number }>(
        `/metamodel/types/${cardTypeKey.key}/field-usage?field_key=${encodeURIComponent(field.key)}`,
      )
      .then((r) => setDeleteFieldConfirm((prev) => (prev ? { ...prev, cardCount: r.card_count } : null)))
      .catch(() => setDeleteFieldConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null)));
  };

  const confirmDeleteField = async () => {
    if (!deleteFieldConfirm) return;
    const { sectionIdx, fieldIdx } = deleteFieldConfirm;
    setDeleteFieldConfirm(null);
    try {
      const schema: SectionDef[] = cardTypeKey.fields_schema.map((s) => ({
        ...s,
        fields: [...s.fields],
      }));
      schema[sectionIdx].fields.splice(fieldIdx, 1);
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        fields_schema: schema,
      });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToDeleteField"));
    }
  };


  /* --- Section deletion --- */
  const promptDeleteSection = (sectionIdx: number) => {
    const section = cardTypeKey.fields_schema[sectionIdx];
    if (!section || section.section === "__description") return;
    const fieldKeys = section.fields.map((f) => f.key);
    setDeleteSectionConfirm({
      sectionIdx,
      sectionName: section.section,
      fieldCount: fieldKeys.length,
      cardCount: null,
    });
    if (fieldKeys.length === 0) {
      setDeleteSectionConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null));
    } else {
      api
        .get<{ card_count: number }>(
          `/metamodel/types/${cardTypeKey.key}/section-usage?field_keys=${encodeURIComponent(fieldKeys.join(","))}`,
        )
        .then((r) => setDeleteSectionConfirm((prev) => (prev ? { ...prev, cardCount: r.card_count } : null)))
        .catch(() => setDeleteSectionConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null)));
    }
  };

  const confirmDeleteSection = async () => {
    if (!deleteSectionConfirm) return;
    const { sectionIdx } = deleteSectionConfirm;
    setDeleteSectionConfirm(null);
    try {
      // Remove the section from fields_schema
      const schema = cardTypeKey.fields_schema.filter((_, i) => i !== sectionIdx);
      // Rebuild section_config.__order: remove the deleted custom:N key and re-index
      const secCfg = (cardTypeKey.section_config || {}) as Record<string, unknown> & { __order?: string[] };
      const customSections = cardTypeKey.fields_schema.filter((s) => s.section !== "__description");
      const deletedCustomIdx = customSections.findIndex(
        (s) => cardTypeKey.fields_schema.indexOf(s) === sectionIdx,
      );
      let newOrder = secCfg.__order as string[] | undefined;
      if (newOrder && Array.isArray(newOrder)) {
        // Remove the deleted key and re-index higher custom indices
        newOrder = newOrder
          .filter((k) => k !== `custom:${deletedCustomIdx}`)
          .map((k) => {
            if (k.startsWith("custom:")) {
              const idx = parseInt(k.split(":")[1], 10);
              if (idx > deletedCustomIdx) return `custom:${idx - 1}`;
            }
            return k;
          });
      }
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        fields_schema: schema,
        section_config: { ...secCfg, __order: newOrder },
      });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToDeleteSection"));
    }
  };

  /* --- Hide / Unhide --- */
  const handleToggleHidden = async () => {
    try {
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, { is_hidden: !cardTypeKey.is_hidden });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToUpdateVisibility"));
    }
  };

  /* --- Render --- */
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { height: "90vh", maxHeight: "90vh" } }}
    >
      {/* ---------- Header ---------- */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 3, py: 1.5,
          borderBottom: 1, borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              bgcolor: color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <MaterialSymbol icon={icon} size={22} color="#fff" />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
              {label || cardTypeKey.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {cardTypeKey.key}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Tooltip title={t("metamodel.translationDialog.manage")}>
            <IconButton size="small" onClick={() => setTranslationDialogOpen(true)} color="primary">
              <MaterialSymbol icon="translate" size={20} />
            </IconButton>
          </Tooltip>
          <Tooltip title={cardTypeKey.is_hidden ? t("metamodel.typeDrawer.unhideType") : t("metamodel.typeDrawer.hideType")}>
            <IconButton size="small" onClick={handleToggleHidden}>
              <MaterialSymbol
                icon={cardTypeKey.is_hidden ? "visibility_off" : "visibility"}
                size={20}
                color={cardTypeKey.is_hidden ? "#f57c00" : "#999"}
              />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            onClick={handleSaveHeader}
            disabled={saving}
          >
            {saving ? t("metamodel.typeDrawer.saving") : t("common:actions.save")}
          </Button>
          <IconButton onClick={onClose}>
            <MaterialSymbol icon="close" size={22} />
          </IconButton>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mx: 3, mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: "divider", px: { xs: 2, sm: 4 } }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v as TabKey)} variant="scrollable" scrollButtons="auto">
          <Tab value="main" label={t("metamodel.typeDrawer.tabMain")} />
          <Tab value="relations" label={t("metamodel.typeDrawer.relations")} />
          <Tab value="stakeholders" label={t("metamodel.stakeholderPanel.title")} />
          <Tab value="dataQuality" label={t("metamodel.dataQuality.title")} />
        </Tabs>
      </Box>

      {/* ---------- Single scrollable body ---------- */}
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 4 }, py: 3 }}>
        {tab === "main" && (
        <>
        {/* -- Type Properties -- */}
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
          {t("metamodel.typeDrawer.typeProperties")}
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5, mb: 1.5 }}>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <IconPicker value={icon} onChange={setIcon} color={color} />
            <TextField
              size="small"
              label={`${t("metamodel.typeDrawer.label")} (${LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale})`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              fullWidth
            />
          </Box>
          <TextField
            size="small"
            label={t("metamodel.typeDrawer.category")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            helperText={t("metamodel.typeDrawer.categoryHelper")}
          />
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5, mb: 2.5 }}>
          <TextField
            size="small"
            label={`${t("metamodel.typeDrawer.description")} (${LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale})`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            rows={2}
          />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <ColorPicker
              value={color}
              onChange={setColor}
              disabled={!!cardTypeKey?.built_in}
              label={cardTypeKey?.built_in ? t("metamodel.typeDrawer.colorBuiltIn") : t("metamodel.typeDrawer.color")}
            />
            <FormControlLabel
              control={<Switch checked={hasHierarchy} onChange={(e) => setHasHierarchy(e.target.checked)} />}
              label={t("metamodel.typeDrawer.supportsHierarchy")}
            />
            <FormControlLabel
              control={<Switch checked={hasSuccessors} onChange={(e) => setHasSuccessors(e.target.checked)} />}
              label={t("metamodel.typeDrawer.supportsSuccessors")}
            />
            {/* -- Human-readable card ID (#811) -- */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={idEnabled}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setIdEnabled(on);
                      if (on && !idPrefix) setIdPrefix(defaultPrefixForType(cardTypeKey.key));
                      if (!on) setEditingPrefix(false);
                    }}
                  />
                }
                label={t("metamodel.typeDrawer.cardId.label")}
              />
              {idEnabled && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5, mb: 0.5 }}>
                  {idLocked
                    ? t("metamodel.typeDrawer.cardId.locked")
                    : t("metamodel.typeDrawer.cardId.help")}
                </Typography>
              )}
              {idEnabled && !idLocked && (
                <Alert severity="warning" variant="outlined" sx={{ py: 0, mb: 0.5 }}>
                  {t("metamodel.typeDrawer.cardId.oneTimeSetup")}
                </Alert>
              )}
              {idEnabled && (
                <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
                  {/* Prefix — shown as text, editable via the pencil (locked once IDs exist) */}
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t("metamodel.typeDrawer.cardId.prefix")}
                    </Typography>
                    {editingPrefix && !idLocked ? (
                      <TextField
                        size="small"
                        autoFocus
                        value={idPrefix}
                        onChange={(e) => setIdPrefix(e.target.value)}
                        onBlur={() => setEditingPrefix(false)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "Escape") setEditingPrefix(false);
                        }}
                        sx={{ width: 120, "& input": { fontFamily: "monospace" } }}
                      />
                    ) : (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                        <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                          {idPrefix || "—"}
                        </Typography>
                        {!idLocked && (
                          <Tooltip title={t("common:actions.edit")}>
                            <IconButton size="small" onClick={() => setEditingPrefix(true)}>
                              <MaterialSymbol icon="edit" size={15} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    )}
                  </Box>
                  <TextField
                    size="small"
                    type="number"
                    label={t("metamodel.typeDrawer.cardId.start")}
                    value={idStart}
                    disabled={idLocked}
                    onChange={(e) => setIdStart(Number(e.target.value))}
                    sx={{ width: 90 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={t("metamodel.typeDrawer.cardId.padding")}
                    value={idPadding}
                    disabled={idLocked}
                    onChange={(e) => setIdPadding(Number(e.target.value))}
                    sx={{ width: 90 }}
                  />
                  <Box sx={{ ml: { sm: "auto" }, textAlign: { sm: "right" } }}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t("metamodel.typeDrawer.cardId.example")}
                    </Typography>
                    <Typography
                      sx={{ fontFamily: "monospace", fontWeight: 700, color, lineHeight: 1.3 }}
                    >
                      {formatIdExample(idPrefix, idStart, idPadding)}
                    </Typography>
                  </Box>
                </Box>
              )}
              {/* Generate — explicit backfill of existing cards, separate from Save */}
              {idEnabled && (
                <Box sx={{ mt: 0.5 }}>
                  {generating && <LinearProgress sx={{ mb: 0.75, maxWidth: 260 }} />}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={generating || idConfigDirty || idMissing === 0}
                      onClick={() => setGenerateConfirm(true)}
                      startIcon={
                        generating ? (
                          <CircularProgress size={14} />
                        ) : (
                          <MaterialSymbol icon="autorenew" size={16} />
                        )
                      }
                    >
                      {idMissing > 0
                        ? t("metamodel.typeDrawer.cardId.generateN", { count: idMissing })
                        : t("metamodel.typeDrawer.cardId.generateNone")}
                    </Button>
                    {idConfigDirty && (
                      <Typography variant="caption" color="text.secondary">
                        {t("metamodel.typeDrawer.cardId.saveFirst")}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* -- Subtypes -- */}
        <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              {t("metamodel.typeDrawer.subtypes")}
            </Typography>
            {(cardTypeKey.subtypes || []).length > 0 ? (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1.5 }}>
                {(cardTypeKey.subtypes || []).map((s) => {
                  const hiddenCount = (s.hidden_fields ?? []).length;
                  return (
                    <Chip
                      key={s.key}
                      label={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <span>{`${s.label} (${s.key})`}</span>
                          {hiddenCount > 0 && (
                            <Chip
                              size="small"
                              label={t("metamodel.typeDrawer.hiddenFieldCount", { count: hiddenCount })}
                              color="warning"
                              sx={{ height: 18, fontSize: "0.65rem", ml: 0.5 }}
                            />
                          )}
                        </Box>
                      }
                      onClick={() => openSubtypeTemplate(s.key)}
                      onDelete={() => handleRemoveSubtype(s.key)}
                      variant={editingSubtypeKey === s.key ? "filled" : "outlined"}
                      color={editingSubtypeKey === s.key ? "primary" : "default"}
                      size="small"
                      icon={<MaterialSymbol icon="tune" size={16} />}
                    />
                  );
                })}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t("metamodel.typeDrawer.noSubtypes")}
              </Typography>
            )}
            {addSubOpen ? (
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <KeyInput
                  size="small"
                  label={t("metamodel.typeDrawer.key")}
                  value={newSubKey}
                  onChange={setNewSubKey}
                  sx={{ flex: 1 }}
                  required={!!newSubLabel.trim()}
                />
                <TextField
                  size="small"
                  label={t("metamodel.typeDrawer.label")}
                  value={newSubLabel}
                  onChange={(e) => setNewSubLabel(e.target.value)}
                  sx={{ flex: 1 }}
                  error={!newSubLabel.trim()}
                />
                <Button size="small" variant="contained" onClick={handleAddSubtype} disabled={!newSubKey || !newSubLabel || !isValidKey(newSubKey)} sx={{ mt: "8px" }}>
                  {t("common:actions.add")}
                </Button>
                <IconButton size="small" onClick={() => { setAddSubOpen(false); setNewSubKey(""); setNewSubLabel(""); }} sx={{ mt: "8px" }}>
                  <MaterialSymbol icon="close" size={18} />
                </IconButton>
              </Box>
            ) : (
              <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={() => setAddSubOpen(true)}>
                {t("metamodel.typeDrawer.addSubtype")}
              </Button>
            )}
        </Box>

        {/* -- Card Layout -- */}
        {cardTypeKey && (
          <CardLayoutEditor
            cardType={cardTypeKey}
            onRefresh={onRefresh}
            openAddField={openAddField}
            openEditField={openEditField}
            promptDeleteField={promptDeleteField}
            promptDeleteSection={promptDeleteSection}
            calculatedFieldKeys={calculatedFieldKeys}
          />
        )}
        </>
        )}

        {/* -- Relations tab -- */}
        {tab === "relations" && (
          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              {t("metamodel.typeDrawer.relations")}
            </Typography>
            {connectedRelations.length > 0 ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 1 }}>
                {connectedRelations.map((r) => {
                  const isSource = r.source_type_key === cardTypeKey.key;
                  const otherKey = isSource ? r.target_type_key : r.source_type_key;
                  const otherType = types.find((ct) => ct.key === otherKey);
                  const isVisible = isSource ? r.source_visible : r.target_visible;
                  const isMandatory = isSource ? r.source_mandatory : r.target_mandatory;
                  const handleToggle = async (field: string, value: boolean) => {
                    try {
                      await api.patch(`/metamodel/relation-types/${r.key}`, { [field]: value });
                      onRefresh();
                    } catch {
                      setError(t("common:errors.generic"));
                    }
                  };
                  return (
                    <Box
                      key={r.key}
                      sx={{
                        p: 1.5,
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1,
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {isSource ? r.label : r.reverse_label || r.label}
                        </Typography>
                        <MaterialSymbol icon={isSource ? "arrow_forward" : "arrow_back"} size={14} color="#999" />
                        {otherType && (
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: otherType.color, flexShrink: 0 }} />
                            <Typography variant="body2">{otherType.label}</Typography>
                          </Box>
                        )}
                        <Chip size="small" label={r.cardinality} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                      </Box>
                      <Box sx={{ display: "flex", gap: 2 }}>
                        <Tooltip title={t("metamodel.typeDrawer.visibleTooltip")}>
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={isVisible}
                                onChange={(_, v) => handleToggle(isSource ? "source_visible" : "target_visible", v)}
                              />
                            }
                            label={<Typography variant="caption">{t("metamodel.typeDrawer.visible")}</Typography>}
                          />
                        </Tooltip>
                        <Tooltip title={t("metamodel.typeDrawer.mandatoryTooltip")}>
                          <FormControlLabel
                            control={
                              <Switch
                                size="small"
                                checked={isMandatory}
                                onChange={(_, v) => handleToggle(isSource ? "source_mandatory" : "target_mandatory", v)}
                              />
                            }
                            label={<Typography variant="caption">{t("metamodel.typeDrawer.mandatory")}</Typography>}
                          />
                        </Tooltip>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t("metamodel.typeDrawer.noRelations")}
              </Typography>
            )}
            <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={() => onCreateRelation(cardTypeKey.key)}>
              {t("metamodel.typeDrawer.addRelation")}
            </Button>
          </Box>
        )}

        {/* -- Stakeholder Roles tab -- */}
        {tab === "stakeholders" && (
        <StakeholderRolePanel
          typeKey={cardTypeKey.key}
          onError={(msg) => setError(msg)}
        />
        )}

        {/* -- Data Quality tab -- */}
        {tab === "dataQuality" && (
          <DataQualityPanel cardType={cardTypeKey} onRefresh={onRefresh} />
        )}
      </Box>

      {/* --- Field deletion confirmation dialog --- */}
      <Dialog open={generateConfirm} onClose={() => setGenerateConfirm(false)} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogTitle>{t("metamodel.typeDrawer.cardId.generateConfirmTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {t("metamodel.typeDrawer.cardId.generateConfirmBody", { count: idMissing })}
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700, color }}>
            {t("metamodel.typeDrawer.cardId.example")}: {formatIdExample(idPrefix, idStart, idPadding)}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerateConfirm(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleGenerate}>
            {t("metamodel.typeDrawer.cardId.generateConfirmAction")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteFieldConfirm} onClose={() => setDeleteFieldConfirm(null)} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogTitle>{t("metamodel.typeDrawer.deleteField")}</DialogTitle>
        <DialogContent>
          {deleteFieldConfirm && (
            <>
              <Typography variant="body2" sx={{ mb: 2 }} dangerouslySetInnerHTML={{ __html: t("metamodel.typeDrawer.deleteFieldConfirm", { label: deleteFieldConfirm.fieldLabel, key: deleteFieldConfirm.fieldKey }) }} />
              {deleteFieldConfirm.cardCount === null ? (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  {t("metamodel.typeDrawer.checkingFieldUsage")}
                </Alert>
              ) : deleteFieldConfirm.cardCount > 0 ? (
                <Alert severity="warning">
                  <span dangerouslySetInnerHTML={{ __html: t("metamodel.typeDrawer.fieldUsedByCards", { count: deleteFieldConfirm.cardCount }) }} />
                </Alert>
              ) : (
                <Alert severity="info">{t("metamodel.typeDrawer.fieldSafeToDelete")}</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFieldConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteFieldConfirm?.cardCount === null}
            onClick={confirmDeleteField}
          >
            {t("metamodel.typeDrawer.deleteField")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Section deletion confirmation dialog --- */}
      <Dialog open={!!deleteSectionConfirm} onClose={() => setDeleteSectionConfirm(null)} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogTitle>{t("metamodel.typeDrawer.deleteSection")}</DialogTitle>
        <DialogContent>
          {deleteSectionConfirm && (
            <>
              <Typography variant="body2" sx={{ mb: 2 }} dangerouslySetInnerHTML={{ __html: deleteSectionConfirm.fieldCount > 0
                  ? t("metamodel.typeDrawer.deleteSectionWithFields", { name: deleteSectionConfirm.sectionName, count: deleteSectionConfirm.fieldCount })
                  : t("metamodel.typeDrawer.deleteSectionConfirm", { name: deleteSectionConfirm.sectionName })
              }} />
              {deleteSectionConfirm.cardCount === null ? (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  {t("metamodel.typeDrawer.checkingSectionUsage")}
                </Alert>
              ) : deleteSectionConfirm.fieldCount === 0 ? (
                <Alert severity="info">{t("metamodel.typeDrawer.sectionNoFields")}</Alert>
              ) : deleteSectionConfirm.cardCount > 0 ? (
                <Alert severity="warning">
                  <span dangerouslySetInnerHTML={{ __html: t("metamodel.typeDrawer.sectionUsedByCards", { count: deleteSectionConfirm.cardCount }) }} />
                </Alert>
              ) : (
                <Alert severity="info">{t("metamodel.typeDrawer.sectionSafeToDelete")}</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteSectionConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteSectionConfirm?.cardCount === null}
            onClick={confirmDeleteSection}
          >
            {t("metamodel.typeDrawer.deleteSection")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Field editor dialog --- */}
      <FieldEditorDialog
        open={fieldDialogOpen}
        field={editingField}
        typeKey={cardTypeKey.key}
        fieldKey={editingField.key}
        isCalculated={calculatedFieldKeys.includes(editingField.key)}
        onClose={() => setFieldDialogOpen(false)}
        onSave={handleSaveField}
      />

      {/* --- Translation dialog --- */}
      <TranslationDialog
        open={translationDialogOpen}
        cardType={cardTypeKey}
        onClose={() => setTranslationDialogOpen(false)}
        onSave={() => {
          onRefresh();
          setSnack(t("metamodel.translationDialog.saved"));
        }}
      />

      {/* --- Subtype template editor dialog --- */}
      <Dialog
        open={!!editingSubtypeKey}
        onClose={() => setEditingSubtypeKey(null)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MaterialSymbol icon="tune" size={22} />
          {t("metamodel.typeDrawer.subtypeTemplate", { name: editingSubtype?.label ?? "" })}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("metamodel.typeDrawer.subtypeTemplateHelp")}
          </Typography>
          {allFields.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("metamodel.typeDrawer.noFieldsDefined")}
            </Typography>
          ) : (
            Object.entries(fieldSections).map(([sectionName, fields]) => (
              <Box key={sectionName} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5, color: "text.secondary" }}>
                  {sectionName}
                </Typography>
                {fields.map((f) => (
                  <FormControlLabel
                    key={f.key}
                    sx={{ display: "flex", ml: 0 }}
                    control={
                      <Switch
                        size="small"
                        checked={!draftHiddenFields.has(f.key)}
                        onChange={() => handleToggleFieldVisibility(f.key)}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {f.label}
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                          ({f.key})
                        </Typography>
                      </Typography>
                    }
                  />
                ))}
              </Box>
            ))
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingSubtypeKey(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleSaveSubtypeTemplate}>
            {t("common:actions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Dialog>
  );
}
