import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { api } from "@/api/client";
import { useResolveLabel, useFieldLabel } from "@/hooks/useResolveLabel";
import type { CardType, DataQualityConfig } from "@/types";
import ImportanceSlider, { useTierColor, weightToTier } from "./ImportanceSlider";

interface Factor {
  id: string;
  label: string;
  weight: number; // effective weight (default 1)
  set: (weight: number) => void;
}

interface DataQualityPanelProps {
  cardType: CardType;
  onRefresh: () => void;
}

const BUILT_IN_BUCKETS = ["description", "lifecycle", "relations", "tags", "stakeholders"] as const;

export default function DataQualityPanel({ cardType, onRefresh }: DataQualityPanelProps) {
  const { t } = useTranslation(["admin", "common"]);
  const rl = useResolveLabel();
  const fieldLabel = useFieldLabel();
  const tierColor = useTierColor();

  const secCfg = (cardType.section_config || {}) as Record<string, unknown> & {
    __dataQuality?: DataQualityConfig;
  };
  const dqConfig: DataQualityConfig = secCfg.__dataQuality || {};

  // A weight change re-scores every card of the type on the server, which can
  // take a moment on a large landscape. While it is in flight the panel says
  // so and locks its sliders, so a second change cannot start from the now
  // stale copy of the type (the ref is the guard; a commit can land before
  // the re-render). A failure is shown here and the sliders are remounted so
  // they snap back to the stored weights.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const patch = async (body: Record<string, unknown>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/metamodel/types/${cardType.key}`, body);
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("metamodel.typeDrawer.failedToSave"));
      setRevision((r) => r + 1);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const setBuiltin = (bucket: string, weight: number) =>
    patch({ section_config: { ...secCfg, __dataQuality: { ...dqConfig, [bucket]: weight } } });

  const setFieldWeight = (sectionIdx: number, fieldIdx: number, weight: number) =>
    patch({
      fields_schema: cardType.fields_schema.map((s, i) =>
        i !== sectionIdx
          ? s
          : { ...s, fields: s.fields.map((f, j) => (j !== fieldIdx ? f : { ...f, weight })) },
      ),
    });

  // ── Built-in factors ────────────────────────────────────────────────
  const builtInFactors: Factor[] = BUILT_IN_BUCKETS.map((bucket) => ({
    id: `builtin:${bucket}`,
    label: t(`metamodel.dataQuality.${bucket}`),
    weight: dqConfig[bucket] ?? 1,
    set: (w) => setBuiltin(bucket, w),
  }));

  // ── Field factors grouped by section ────────────────────────────────
  const fieldGroups = cardType.fields_schema.map((section, si) => ({
    label:
      section.section === "__description"
        ? t("metamodel.dataQuality.descriptionSection")
        : rl(section.section, section.translations),
    factors: section.fields.map(
      (f, fi): Factor => ({
        id: `${si}:${fi}`,
        label: fieldLabel(f),
        weight: f.weight ?? 1,
        set: (w) => setFieldWeight(si, fi, w),
      }),
    ),
  }));

  // ── Score composition (relative weight of every counted factor) ──────
  const counted = [
    ...builtInFactors,
    ...fieldGroups.flatMap((g) => g.factors),
  ].filter((f) => f.weight > 0);
  const totalWeight = counted.reduce((sum, f) => sum + f.weight, 0);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {t("metamodel.dataQuality.title")}
        </Typography>
        {saving && (
          <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
              {t("metamodel.typeDrawer.saving")}
            </Typography>
          </Box>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("metamodel.dataQuality.subtitle")}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Composition bar — each counted factor's share of the max score */}
      {totalWeight > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" color="text.secondary">
            {t("metamodel.dataQuality.composition")}
          </Typography>
          <Box
            sx={{
              display: "flex",
              height: 14,
              borderRadius: 1,
              overflow: "hidden",
              mt: 0.5,
              border: 1,
              borderColor: "divider",
            }}
          >
            {counted.map((f) => {
              const pct = (f.weight / totalWeight) * 100;
              return (
                <Tooltip key={f.id} title={`${f.label} — ${Math.round(pct)}%`}>
                  <Box
                    sx={{
                      width: `${pct}%`,
                      bgcolor: tierColor(weightToTier(f.weight)),
                      borderRight: "1px solid rgba(255,255,255,0.5)",
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Keyed on the revision so a failed save remounts the sliders onto the stored weights. */}
      <Box key={revision}>
        {/* Built-in factors */}
        <FactorGroup
          label={t("metamodel.dataQuality.builtInGroup")}
          factors={builtInFactors}
          disabled={saving}
        />

        {/* Field factors, grouped by section */}
        {fieldGroups.map(
          (g, i) =>
            g.factors.length > 0 && (
              <FactorGroup key={i} label={g.label} factors={g.factors} disabled={saving} />
            ),
        )}
      </Box>
    </Box>
  );
}

function FactorGroup({
  label,
  factors,
  disabled,
}: {
  label: string;
  factors: Factor[];
  disabled: boolean;
}) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: "block", mb: 0.5, lineHeight: 1.6 }}
      >
        {label}
      </Typography>
      {factors.map((f) => (
        <Box
          key={f.id}
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "stretch", sm: "center" },
            gap: { xs: 0.25, sm: 3 },
            py: { xs: 0.75, sm: 0.5 },
            px: 1,
            borderRadius: 1,
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Typography
            variant="body2"
            sx={{ width: { sm: 200 }, flexShrink: 0 }}
            noWrap
            title={f.label}
          >
            {f.label}
          </Typography>
          <Box sx={{ flex: 1, maxWidth: { sm: 380 }, minWidth: 0 }}>
            <ImportanceSlider value={f.weight} onChange={f.set} disabled={disabled} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
