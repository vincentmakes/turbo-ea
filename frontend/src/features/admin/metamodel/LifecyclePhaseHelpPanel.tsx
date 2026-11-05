/**
 * Admin → Metamodel → Lifecycle phases: one help text per lifecycle phase and
 * language. The five phases are fixed keys, so the text is an app setting
 * (`/settings/lifecycle-phase-help`), not metamodel data; it reaches every
 * card's Lifecycle section through `useLifecyclePhaseHelp`.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PHASE_ICONS } from "@/components/LifecycleBadge";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useEnabledLocales } from "@/hooks/useEnabledLocales";
import { invalidateLifecyclePhaseHelp } from "@/hooks/useLifecyclePhaseHelp";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/i18n";
import { PHASES, getPhaseLabels } from "@/lib/lifecyclePhases";
import { LIFECYCLE_PHASE_COLORS } from "@/theme/tokens";
import type { LifecyclePhaseHelp } from "@/types";

type PhaseHelpResponse = { phases: LifecyclePhaseHelp };

export default function LifecyclePhaseHelpPanel() {
  const { t } = useTranslation("admin");
  const { enabledLocales } = useEnabledLocales();
  // English first, then the other enabled languages in the app's order.
  const locales = useMemo(
    () => SUPPORTED_LOCALES.filter((l) => l === "en" || enabledLocales.includes(l)),
    [enabledLocales],
  );
  const [activeLocale, setActiveLocale] = useState<string>("en");
  const { data, loading, error: loadError } = useApiQuery<PhaseHelpResponse>(
    "/settings/lifecycle-phase-help",
  );
  const [draft, setDraft] = useState<LifecyclePhaseHelp>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setDraft(data.phases || {});
  }, [data]);

  const phaseLabels = getPhaseLabels(t);

  const setText = (phase: string, value: string) =>
    setDraft((prev) => ({ ...prev, [phase]: { ...prev[phase], [activeLocale]: value } }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.patch<PhaseHelpResponse>("/settings/lifecycle-phase-help", {
        phases: draft,
      });
      // The server trims and drops empty texts; show what it stored.
      setDraft(result.phases);
      invalidateLifecyclePhaseHelp(result.phases);
      setSaved(true);
    } catch {
      setError(t("metamodel.lifecycleHelp.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("metamodel.lifecycleHelp.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("metamodel.lifecycleHelp.intro")}
        </Typography>
        {loading && !data ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            {locales.length > 1 && (
              <Tabs
                value={activeLocale}
                onChange={(_, v: string) => setActiveLocale(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ mb: 2 }}
              >
                {locales.map((l) => (
                  <Tab key={l} value={l} label={LOCALE_LABELS[l]} />
                ))}
              </Tabs>
            )}
            {loadError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {t("common:errors.generic")}
              </Alert>
            )}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {PHASES.map((phase) => (
                <Box key={phase} sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                  <Box sx={{ pt: 1, display: "inline-flex" }}>
                    <MaterialSymbol
                      icon={PHASE_ICONS[phase]}
                      size={20}
                      color={LIFECYCLE_PHASE_COLORS[phase]}
                    />
                  </Box>
                  <TextField
                    label={t("metamodel.lifecycleHelp.phaseLabel", { phase: phaseLabels[phase] })}
                    value={draft[phase]?.[activeLocale] || ""}
                    placeholder={activeLocale === "en" ? undefined : draft[phase]?.en}
                    onChange={(e) => setText(phase, e.target.value)}
                    multiline
                    minRows={2}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 2000, "data-phase": phase } }}
                  />
                </Box>
              ))}
            </Box>
            {error && (
              <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
              <Button variant="contained" onClick={save} disabled={saving || !data}>
                {t("common:actions.save")}
              </Button>
            </Box>
          </>
        )}
      </CardContent>
      <Snackbar
        open={saved}
        autoHideDuration={3000}
        onClose={() => setSaved(false)}
        message={t("metamodel.lifecycleHelp.saved")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Card>
  );
}
