import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { api } from "@/api/client";
import { useResolveLabel } from "@/hooks/useResolveLabel";
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
  const tierColor = useTierColor();

  const secCfg = (cardType.section_config || {}) as Record<string, unknown> & {
    __dataQuality?: DataQualityConfig;
  };
  const dqConfig: DataQualityConfig = secCfg.__dataQuality || {};

  const patch = async (body: Record<string, unknown>) => {
    await api.patch(`/metamodel/types/${cardType.key}`, body);
    onRefresh();
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
        label: rl(f.key, f.translations),
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
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        {t("metamodel.dataQuality.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("metamodel.dataQuality.subtitle")}
      </Typography>

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

      {/* Built-in factors */}
      <FactorGroup label={t("metamodel.dataQuality.builtInGroup")} factors={builtInFactors} />

      {/* Field factors, grouped by section */}
      {fieldGroups.map(
        (g, i) =>
          g.factors.length > 0 && <FactorGroup key={i} label={g.label} factors={g.factors} />,
      )}
    </Box>
  );
}

function FactorGroup({ label, factors }: { label: string; factors: Factor[] }) {
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
            <ImportanceSlider value={f.weight} onChange={f.set} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
