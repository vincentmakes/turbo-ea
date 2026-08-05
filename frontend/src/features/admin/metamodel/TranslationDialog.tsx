import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import { TranslationGroup, TranslationRow } from "./translationParts";
import { cleanTranslationMap, cleanTranslations } from "./helpers";
import type {
  CardType,
  MetamodelTranslations,
  SectionDef,
  SubtypeDef,
  StakeholderRoleDefinitionFull,
} from "@/types";

/* ------------------------------------------------------------------ */
/*  TranslationDialog                                                   */
/* ------------------------------------------------------------------ */

export interface TranslationDialogProps {
  open: boolean;
  cardType: CardType | null;
  onClose: () => void;
  onSave: () => void;
}

export default function TranslationDialog({
  open,
  cardType,
  onClose,
  onSave,
}: TranslationDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const { enabledLocales } = useEnabledLocales();
  const visibleLocales = SUPPORTED_LOCALES.filter((l) => enabledLocales.includes(l));
  const [activeLocale, setActiveLocale] = useState<string>(
    visibleLocales[0] || "en",
  );
  const [translations, setTranslations] = useState<MetamodelTranslations>({});
  const [subtypes, setSubtypes] = useState<SubtypeDef[]>([]);
  const [fieldsSchema, setFieldsSchema] = useState<SectionDef[]>([]);
  const [stakeholderRoles, setStakeholderRoles] = useState<
    { key: string; label: string; translations: MetamodelTranslations }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deep-clone state from cardType when dialog opens
  useEffect(() => {
    if (open && cardType) {
      setTranslations(JSON.parse(JSON.stringify(cardType.translations || {})));
      setSubtypes(JSON.parse(JSON.stringify(cardType.subtypes || [])));
      setFieldsSchema(JSON.parse(JSON.stringify(cardType.fields_schema || [])));
      // Fetch stakeholder roles for this type
      api
        .get<StakeholderRoleDefinitionFull[]>(
          `/metamodel/types/${cardType.key}/stakeholder-roles`,
        )
        .then((roles) =>
          setStakeholderRoles(
            roles
              .filter((r) => !r.is_archived)
              .map((r) => ({
                key: r.key,
                label: r.label,
                translations: JSON.parse(JSON.stringify(r.translations || {})),
              })),
          ),
        )
        .catch(() => setStakeholderRoles([]));
    }
  }, [open, cardType]);

  // --- Update helpers ---

  const updateTypeTranslation = useCallback(
    (property: "label" | "description", locale: string, value: string) => {
      setTranslations((prev) => ({
        ...prev,
        [property]: { ...prev[property], [locale]: value },
      }));
    },
    [],
  );

  const updateSubtypeTranslation = useCallback(
    (idx: number, locale: string, value: string) => {
      setSubtypes((prev) =>
        prev.map((s, i) =>
          i === idx ? { ...s, translations: { ...s.translations, [locale]: value } } : s,
        ),
      );
    },
    [],
  );

  const updateSectionTranslation = useCallback(
    (secIdx: number, locale: string, value: string) => {
      setFieldsSchema((prev) =>
        prev.map((sec, i) =>
          i === secIdx
            ? { ...sec, translations: { ...sec.translations, [locale]: value } }
            : sec,
        ),
      );
    },
    [],
  );

  const updateFieldTranslation = useCallback(
    (secIdx: number, fieldIdx: number, locale: string, value: string) => {
      setFieldsSchema((prev) =>
        prev.map((sec, si) =>
          si === secIdx
            ? {
                ...sec,
                fields: sec.fields.map((f, fi) =>
                  fi === fieldIdx
                    ? { ...f, translations: { ...f.translations, [locale]: value } }
                    : f,
                ),
              }
            : sec,
        ),
      );
    },
    [],
  );

  const updateOptionTranslation = useCallback(
    (secIdx: number, fieldIdx: number, optIdx: number, locale: string, value: string) => {
      setFieldsSchema((prev) =>
        prev.map((sec, si) =>
          si === secIdx
            ? {
                ...sec,
                fields: sec.fields.map((f, fi) =>
                  fi === fieldIdx
                    ? {
                        ...f,
                        options: (f.options || []).map((o, oi) =>
                          oi === optIdx
                            ? { ...o, translations: { ...o.translations, [locale]: value } }
                            : o,
                        ),
                      }
                    : f,
                ),
              }
            : sec,
        ),
      );
    },
    [],
  );

  const updateStakeholderRoleTranslation = useCallback(
    (idx: number, locale: string, value: string) => {
      setStakeholderRoles((prev) =>
        prev.map((r, i) =>
          i === idx
            ? {
                ...r,
                translations: {
                  ...r.translations,
                  label: { ...r.translations.label, [locale]: value },
                },
              }
            : r,
        ),
      );
    },
    [],
  );

  // --- Completion counts per locale ---

  const completionCounts = useMemo(() => {
    const counts: Record<string, { filled: number; total: number }> = {};
    visibleLocales.forEach((locale) => {
      let filled = 0;
      let total = 0;

      // Type label
      total++;
      if (translations.label?.[locale]?.trim()) filled++;

      // Type description (only count if any locale has one)
      if (cardType?.description || Object.values(translations.description || {}).some((v) => v?.trim())) {
        total++;
        if (translations.description?.[locale]?.trim()) filled++;
      }

      // Subtypes
      subtypes.forEach((s) => {
        total++;
        if (s.translations?.[locale]?.trim()) filled++;
      });

      // Sections & fields & options
      fieldsSchema.forEach((sec) => {
        if (sec.section !== "__description") {
          total++;
          if (sec.translations?.[locale]?.trim()) filled++;
        }
        sec.fields.forEach((f) => {
          total++;
          if (f.translations?.[locale]?.trim()) filled++;
          (f.options || []).forEach((o) => {
            total++;
            if (o.translations?.[locale]?.trim()) filled++;
          });
        });
      });

      // Stakeholder roles
      stakeholderRoles.forEach((r) => {
        total++;
        if (r.translations?.label?.[locale]?.trim()) filled++;
      });

      counts[locale] = { filled, total };
    });
    return counts;
  }, [translations, subtypes, fieldsSchema, stakeholderRoles, cardType, visibleLocales]);

  // --- Save ---

  const handleSave = async () => {
    if (!cardType) return;
    setSaving(true);
    setError(null);
    try {
      const cleaned = cleanTranslations(translations);
      // English is BOTH `translations.label.en` and the `label` column, and the
      // translation shadows the column everywhere labels are resolved. Editing
      // the English tab without carrying the column along would leave the two
      // disagreeing — the card-type twin of issue #912.
      const englishLabel = cleaned?.label?.en;
      const englishDescription = cleaned?.description?.en;
      await api.patch(`/metamodel/types/${cardType.key}`, {
        // `translations` is NOT NULL in the DB — send an empty map, never null.
        translations: cleaned || {},
        ...(englishLabel && englishLabel !== cardType.label ? { label: englishLabel } : {}),
        ...(englishDescription && englishDescription !== cardType.description
          ? { description: englishDescription }
          : {}),
        subtypes: subtypes.map((s) => ({
          ...s,
          translations: cleanTranslationMap(s.translations),
        })),
        fields_schema: fieldsSchema.map((sec) => ({
          ...sec,
          translations: cleanTranslationMap(sec.translations),
          fields: sec.fields.map((f) => ({
            ...f,
            translations: cleanTranslationMap(f.translations),
            options: f.options?.map((o) => ({
              ...o,
              translations: cleanTranslationMap(o.translations),
            })),
          })),
        })),
      });
      // Save stakeholder role translations
      await Promise.all(
        stakeholderRoles.map((r) => {
          const roleCleaned = cleanTranslations(r.translations);
          const roleEnglish = roleCleaned?.label?.en;
          return api.patch(`/metamodel/types/${cardType.key}/stakeholder-roles/${r.key}`, {
            translations: roleCleaned || {},
            ...(roleEnglish && roleEnglish !== r.label ? { label: roleEnglish } : {}),
          });
        }),
      );
      onSave();
      onClose();
    } catch (e) {
      // Never swallow: a failed save used to leave the dialog open with no
      // explanation, which reads as "nothing happened".
      setError(e instanceof Error ? e.message : t("metamodel.translationDialog.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!cardType) return null;

  // Visible sections (exclude __description)
  const visibleSections = fieldsSchema.filter((s) => s.section !== "__description");
  // Description section fields (if any)
  const descSection = fieldsSchema.find((s) => s.section === "__description");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      disableRestoreFocus
      PaperProps={{ sx: { height: "85vh", maxHeight: "85vh" } }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <MaterialSymbol icon="translate" size={22} color="#666" />
          <span>
            {t("metamodel.translationDialog.title", { label: cardType.key })}
          </span>
        </Box>
        <IconButton onClick={onClose} size="small">
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      {/* Locale tabs — enabled locales only */}
      <Box sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={visibleLocales.includes(activeLocale as typeof visibleLocales[number]) ? activeLocale : visibleLocales[0] || "en"}
          onChange={(_, v) => setActiveLocale(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {visibleLocales.map((locale) => {
            const { filled, total } = completionCounts[locale] || { filled: 0, total: 0 };
            const isComplete = filled === total && total > 0;
            return (
              <Tab
                key={locale}
                value={locale}
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <span>{LOCALE_LABELS[locale]}</span>
                    <Chip
                      size="small"
                      label={`${filled}/${total}`}
                      color={isComplete ? "success" : "default"}
                      variant={isComplete ? "filled" : "outlined"}
                      sx={{ height: 20, fontSize: 11, "& .MuiChip-label": { px: 0.75 } }}
                    />
                  </Box>
                }
                sx={{ textTransform: "none", minHeight: 48 }}
              />
            );
          })}
        </Tabs>
      </Box>

      {/* Content */}
      <DialogContent sx={{ px: 3, py: 2, overflow: "auto" }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {/* Type Info */}
        <TranslationGroup title={t("metamodel.translationDialog.typeInfo")}>
          <TranslationRow
            reference={cardType.key}
            value={translations.label?.[activeLocale] || ""}
            onChange={(v) => updateTypeTranslation("label", activeLocale, v)}
          />
          {(cardType.description || Object.values(translations.description || {}).some((v) => v?.trim())) && (
            <TranslationRow
              reference={`${cardType.key}.description`}
              value={translations.description?.[activeLocale] || ""}
              onChange={(v) => updateTypeTranslation("description", activeLocale, v)}
            />
          )}
        </TranslationGroup>

        {/* Subtypes */}
        {subtypes.length > 0 && (
          <>
            <Divider sx={{ mb: 2 }} />
            <TranslationGroup
              title={t("metamodel.translationDialog.subtypes")}
              count={subtypes.length}
            >
              {subtypes.map((s, idx) => (
                <TranslationRow
                  key={s.key}
                  reference={s.key}
                  value={s.translations?.[activeLocale] || ""}
                  onChange={(v) => updateSubtypeTranslation(idx, activeLocale, v)}
                />
              ))}
            </TranslationGroup>
          </>
        )}

        {/* Stakeholder Roles */}
        {stakeholderRoles.length > 0 && (
          <>
            <Divider sx={{ mb: 2 }} />
            <TranslationGroup
              title={t("metamodel.translationDialog.stakeholderRoles")}
              count={stakeholderRoles.length}
            >
              {stakeholderRoles.map((r, idx) => (
                <TranslationRow
                  key={r.key}
                  reference={r.label}
                  value={r.translations?.label?.[activeLocale] || ""}
                  onChange={(v) =>
                    updateStakeholderRoleTranslation(idx, activeLocale, v)
                  }
                />
              ))}
            </TranslationGroup>
          </>
        )}

        {/* Sections */}
        {visibleSections.length > 0 && (
          <>
            <Divider sx={{ mb: 2 }} />
            <TranslationGroup
              title={t("metamodel.translationDialog.sectionNames")}
              count={visibleSections.length}
            >
              {visibleSections.map((sec) => {
                const secIdx = fieldsSchema.indexOf(sec);
                return (
                  <TranslationRow
                    key={sec.section}
                    reference={sec.section}
                    value={sec.translations?.[activeLocale] || ""}
                    onChange={(v) => updateSectionTranslation(secIdx, activeLocale, v)}
                  />
                );
              })}
            </TranslationGroup>
          </>
        )}

        {/* Description section fields (if any) */}
        {descSection && descSection.fields.length > 0 && (
          <>
            <Divider sx={{ mb: 2 }} />
            <TranslationGroup
              title={t("metamodel.translationDialog.fieldsInSection", {
                section: t("metamodel.translationDialog.descriptionFields"),
              })}
              count={descSection.fields.length}
            >
              {descSection.fields.map((f, fi) => {
                const secIdx = fieldsSchema.indexOf(descSection);
                return (
                  <Box key={f.key}>
                    <TranslationRow
                      reference={f.key}
                      value={f.translations?.[activeLocale] || ""}
                      onChange={(v) => updateFieldTranslation(secIdx, fi, activeLocale, v)}
                    />
                    {/* Options for this field */}
                    {(f.options || []).length > 0 && (
                      <Box sx={{ pl: 3, borderLeft: 2, borderColor: "divider", ml: 1, mb: 0.5 }}>
                        {(f.options || []).map((o, oi) => (
                          <TranslationRow
                            key={o.key}
                            reference={o.key}
                            value={o.translations?.[activeLocale] || ""}
                            onChange={(v) =>
                              updateOptionTranslation(secIdx, fi, oi, activeLocale, v)
                            }
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </TranslationGroup>
          </>
        )}

        {/* Fields by section */}
        {visibleSections.map((sec) => {
          const secIdx = fieldsSchema.indexOf(sec);
          if (sec.fields.length === 0) return null;
          return (
            <Box key={sec.section}>
              <Divider sx={{ mb: 2 }} />
              <TranslationGroup
                title={t("metamodel.translationDialog.fieldsInSection", {
                  section: sec.section,
                })}
                count={sec.fields.length}
              >
                {sec.fields.map((f, fi) => (
                  <Box key={f.key}>
                    <TranslationRow
                      reference={f.key}
                      value={f.translations?.[activeLocale] || ""}
                      onChange={(v) => updateFieldTranslation(secIdx, fi, activeLocale, v)}
                    />
                    {/* Options indented under the field */}
                    {(f.options || []).length > 0 && (
                      <Box
                        sx={{ pl: 3, borderLeft: 2, borderColor: "divider", ml: 1, mb: 0.5 }}
                      >
                        {(f.options || []).map((o, oi) => (
                          <TranslationRow
                            key={o.key}
                            reference={o.key}
                            value={o.translations?.[activeLocale] || ""}
                            onChange={(v) =>
                              updateOptionTranslation(secIdx, fi, oi, activeLocale, v)
                            }
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                ))}
              </TranslationGroup>
            </Box>
          );
        })}
      </DialogContent>

      {/* Actions */}
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {saving ? t("metamodel.translationDialog.saving") : t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
