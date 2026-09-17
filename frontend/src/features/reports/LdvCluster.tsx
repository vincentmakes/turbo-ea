import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { readableTypeColor } from "@/lib/color";
import { LDV_HANDLE_SPECS } from "./ldvHandles";
import { CL_HEADER_H, type LdvClusterData } from "./ldvAggregate";

const HANDLE_POSITIONS = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
} as const;

/**
 * A box of cards on the Layered Dependency View when relations are aggregated:
 * every related card of one layer / type / subtype, under a title carrying how
 * many are inside.
 *
 * It is the aggregate mode's *endpoint* — merged connectors attach to it rather
 * than to the cards it holds — so it renders the same named handles a card does
 * (`ldvHandles.ts`), at the same fractions of its own width. That is what lets
 * the edge component stay ignorant of aggregation entirely.
 *
 * A file of its own because `LayeredDependencyView` cannot mount under jsdom
 * (React Flow needs layout APIs it does not implement), so anything rendered
 * inside that view is untestable — the same reason `LdvNode` is exported for
 * its test and `LdvShowOnCard` was extracted.
 *
 * Not clickable: a box is a grouping, not a card, and there is nothing to
 * navigate to. Clicks are stopped so one never reads as a click on the canvas.
 */
const LdvCluster = memo(({ data }: NodeProps<Node<LdvClusterData>>) => {
  const theme = useTheme();
  const { t } = useTranslation(["reports"]);
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const subtypeLabel = useCardSubtypeLabel();
  const isDark = theme.palette.mode === "dark";
  const accent = readableTypeColor(data.color, isDark);

  const usedSet = useMemo(() => new Set(data.usedHandles ?? []), [data.usedHandles]);
  const hs = (id: string, extra?: React.CSSProperties) => {
    // Mirrored handles (ts-N, bt-N) share visibility with their base (t-N, b-N),
    // exactly as on a card.
    const baseId = id.startsWith("ts-")
      ? "t-" + id.slice(3)
      : id.startsWith("bt-")
        ? "b-" + id.slice(3)
        : id;
    const isUsed = usedSet.has(id) || usedSet.has(baseId);
    return {
      background: isUsed ? accent : "transparent",
      width: 5,
      height: 5,
      border: "none",
      opacity: isUsed ? 1 : 0,
      ...extra,
    } as const;
  };

  /* The title goes through the metamodel resolvers, so a box reads in the
     reader's language exactly like the cards inside it. The builder's own
     label is the fallback for a type that is no longer in the metamodel. */
  const title = useMemo(() => {
    if (!data.typeKey) return data.label;
    const tp = types.find((x) => x.key === data.typeKey);
    const base = (tp ? typeLabel(tp) : "") || data.label;
    if (!data.subtypeKey) return base;
    const sub = subtypeLabel(data.typeKey, data.subtypeKey);
    return sub ? `${base} · ${sub}` : base;
  }, [data.typeKey, data.subtypeKey, data.label, types, typeLabel, subtypeLabel]);

  return (
    <Box
      onClick={(e) => e.stopPropagation()}
      sx={{
        width: "100%",
        height: "100%",
        border: `1.5px solid ${accent}`,
        borderRadius: "10px",
        bgcolor: "background.paper",
        backgroundImage: `linear-gradient(${
          isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"
        }, ${isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"})`,
        position: "relative",
        cursor: "default",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 5,
          left: 10,
          right: 10,
          height: CL_HEADER_H - 8,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          overflow: "hidden",
        }}
      >
        {/* `ldv-type-icon` is what image export strips: the glyph is a font
            ligature html-to-image cannot embed (see exportImage). */}
        <MaterialSymbol className="ldv-type-icon" icon={data.icon} size={16} color={accent} />
        <Typography
          variant="subtitle2"
          noWrap
          sx={{ fontWeight: 700, color: accent, fontSize: "0.8rem" }}
        >
          {t("dependency.clusterTitle", { label: title, count: data.count })}
        </Typography>
      </Box>

      {LDV_HANDLE_SPECS.map((spec) => (
        <Handle
          key={spec.id}
          type={spec.kind}
          position={HANDLE_POSITIONS[spec.side]}
          id={spec.id}
          style={hs(
            spec.id,
            spec.side === "top" || spec.side === "bottom"
              ? { left: `${spec.frac * 100}%` }
              : undefined,
          )}
        />
      ))}
    </Box>
  );
});
LdvCluster.displayName = "LdvCluster";

export default LdvCluster;
