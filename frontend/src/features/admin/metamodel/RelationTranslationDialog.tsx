import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { TranslationGroup, TranslationRow } from "./translationParts";
import { cleanTranslations } from "./helpers";
import type { CardType, MetamodelTranslations, RelationType } from "@/types";

/** The two translatable verbs on a relation type. */
const VERB_PROPERTIES = ["label", "reverse_label"] as const;
type VerbProperty = (typeof VERB_PROPERTIES)[number];

/**
 * The English source text for a verb. English lives in the `label` /
 * `reverse_label` columns; seeded rows additionally carry an `en` translation
 * that mirrors it.
 */
function englishVerb(rt: RelationType, property: VerbProperty): string {
  const column = property === "label" ? rt.label : rt.reverse_label;
  return rt.translations?.[property]?.en || column || "";
}

export interface RelationTranslationDialogProps {
  open: boolean;
  relationTypes: RelationType[];
  types: CardType[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Per-locale editor for relation verbs — the one metamodel label with no
 * translation editor until now.
 *
 * Deliberately shows **no English tab**: English is the `label` / `reverse_label`
 * column, edited on the relation itself, and offering it here would let the two
 * drift apart again (issue #912). Same reasoning as `StakeholderRolePanel`,
 * which filters English out of its translation fields for exactly this reason.
 */
export default function RelationTranslationDialog({
  open,
  relationTypes,
  types,
  onClose,
  onSaved,
}: RelationTranslationDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const { enabledLocales } = useEnabledLocales();
  const typeLabel = useTypeLabel();

  const visibleLocales = useMemo(
    () => SUPPORTED_LOCALES.filter((l) => l !== "en" && enabledLocales.includes(l)),
    [enabledLocales],
  );

  const [activeLocale, setActiveLocale] = useState<string>(visibleLocales[0] || "de");
  const [drafts, setDrafts] = useState<Record<string, MetamodelTranslations>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deep-clone on open so Cancel is a true discard and the save can diff.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, MetamodelTranslations> = {};
    for (const rt of relationTypes) {
      next[rt.key] = JSON.parse(JSON.stringify(rt.translations || {}));
    }
    setDrafts(next);
    setError(null);
  }, [open, relationTypes]);

  const updateVerb = useCallback(
    (key: string, property: VerbProperty, locale: string, value: string) => {
      setDrafts((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          [property]: { ...prev[key]?.[property], [locale]: value },
        },
      }));
    },
    [],
  );

  const typeByKey = useMemo(() => new Map(types.map((ct) => [ct.key, ct])), [types]);

  /** Which verbs each relation actually has — a relation may have no reverse. */
  const verbsFor = useCallback(
    (rt: RelationType): VerbProperty[] =>
      VERB_PROPERTIES.filter((p) => englishVerb(rt, p).trim().length > 0),
    [],
  );

  const completionCounts = useMemo(() => {
    const counts: Record<string, { filled: number; total: number }> = {};
    for (const locale of visibleLocales) {
      let filled = 0;
      let total = 0;
      for (const rt of relationTypes) {
        for (const property of verbsFor(rt)) {
          total++;
          if (drafts[rt.key]?.[property]?.[locale]?.trim()) filled++;
        }
      }
      counts[locale] = { filled, total };
    }
    return counts;
  }, [drafts, relationTypes, visibleLocales, verbsFor]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // PATCH only what actually changed — a translation pass usually touches a
      // handful of rows out of forty.
      const changed = relationTypes.filter(
        (rt) =>
          JSON.stringify(drafts[rt.key] || {}) !== JSON.stringify(rt.translations || {}),
      );
      await Promise.all(
        changed.map((rt) =>
          api.patch(`/metamodel/relation-types/${rt.key}`, {
            // NOT NULL column — send an empty map, never null.
            translations: cleanTranslations(drafts[rt.key]) || {},
          }),
        ),
      );
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("metamodel.translationDialog.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const tabLocale = visibleLocales.includes(activeLocale as (typeof visibleLocales)[number])
    ? activeLocale
    : visibleLocales[0] || "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      disableRestoreFocus
      PaperProps={{ sx: { height: "85vh", maxHeight: "85vh" } }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <MaterialSymbol icon="translate" size={22} color="#666" />
          <span>{t("metamodel.translationDialog.relationsTitle")}</span>
        </Box>
        <IconButton onClick={onClose} size="small">
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      {visibleLocales.length > 0 && (
        <Box sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
          <Tabs
            value={tabLocale}
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
      )}

      <DialogContent sx={{ px: 3, py: 2, overflow: "auto" }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {t("metamodel.translationDialog.englishHint")}
        </Typography>

        {visibleLocales.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("metamodel.translationDialog.noOtherLocales")}
          </Typography>
        )}

        {visibleLocales.length > 0 &&
          relationTypes.map((rt) => {
            const source = typeByKey.get(rt.source_type_key);
            const target = typeByKey.get(rt.target_type_key);
            const title = `${typeLabel(source) || rt.source_type_key} → ${
              typeLabel(target) || rt.target_type_key
            }`;
            return (
              <TranslationGroup key={rt.key} title={title}>
                {verbsFor(rt).map((property) => (
                  <TranslationRow
                    key={property}
                    reference={englishVerb(rt, property)}
                    value={drafts[rt.key]?.[property]?.[tabLocale] || ""}
                    onChange={(v) => updateVerb(rt.key, property, tabLocale, v)}
                  />
                ))}
              </TranslationGroup>
            );
          })}
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <CircularProgress size={16} sx={{ mr: 1 }} />
              {t("metamodel.translationDialog.saving")}
            </>
          ) : (
            t("common:actions.save")
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
