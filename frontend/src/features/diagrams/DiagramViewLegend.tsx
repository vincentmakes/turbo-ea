import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { ColorEntry } from "./viewSource";

/** One colour scale — a card type's field rule, or the approval status scale. */
export interface LegendSection {
  key: string;
  title: string;
  entries: ColorEntry[];
}

interface Props {
  /** One per active rule. Several types can be coloured at once. */
  sections: LegendSection[];
  /** Number of cells a rule actually coloured. */
  appliedCount: number;
  onReset: () => void;
}

/**
 * Floating legend below the toolbar, one row per active colour rule.
 *
 * Sections rather than a single flat list because several card types can be
 * coloured at the same time, each by its own field — and two types' scales can
 * legitimately share an option key, so the swatches need to say which rule they
 * belong to.
 */
export default function DiagramViewLegend({ sections, appliedCount, onReset }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  if (sections.every((s) => s.entries.length === 0)) return null;
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 12,
        left: 12,
        bgcolor: "background.paper",
        borderRadius: 1,
        boxShadow: 2,
        px: 1.5,
        py: 1,
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        maxWidth: "calc(100% - 24px)",
        zIndex: 4,
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {t("legend.applied", { count: appliedCount })}
        </Typography>
        {sections
          .filter((s) => s.entries.length > 0)
          .map((section) => (
            <Box key={section.key} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="caption" fontWeight={700} sx={{ mr: 0.5 }}>
                {section.title}
              </Typography>
              {section.entries.map((e) => (
                <Box key={e.key} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "3px",
                      bgcolor: e.color,
                      border: "1px solid rgba(0,0,0,0.2)",
                    }}
                  />
                  <Typography variant="caption">{e.label}</Typography>
                </Box>
              ))}
            </Box>
          ))}
      </Box>
      <Tooltip title={t("legend.reset")}>
        <IconButton size="small" onClick={onReset} sx={{ ml: 1 }}>
          <MaterialSymbol icon="restart_alt" size={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
