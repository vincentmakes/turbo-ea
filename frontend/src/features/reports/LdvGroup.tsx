import { memo } from "react";
import type { NodeProps, Node } from "@xyflow/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { readableTypeColor } from "@/lib/color";
import type { LdvGroupData } from "./layeredDependencyLayout";

/**
 * A layer lane of the Layered Dependency View: a dashed box in the layer's
 * colour, titled with the layer's name. Its cards are its React Flow children,
 * clamped inside it by `extent: "parent"`.
 *
 * It grows as a card is dragged against an edge and shrinks back as the card
 * is moved back, never below its laid-out size (#1295): the view runs
 * `fitParentForDrag` (`ldvLaneSizing.ts`) on every drag move. There is
 * deliberately no manual resize handle.
 *
 * A file of its own, like `LdvCluster`, because `LayeredDependencyView`
 * cannot mount React Flow under jsdom.
 */
const LdvGroup = memo(({ data }: NodeProps<Node<LdvGroupData>>) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const accent = readableTypeColor(data.color, isDark);

  return (
    <Box
      data-testid="ldv-lane"
      sx={{
        width: "100%",
        height: "100%",
        border: `1.5px dashed ${accent}`,
        borderRadius: "12px",
        bgcolor: isDark
          ? alpha(theme.palette.common.white, 0.02)
          : alpha(theme.palette.common.black, 0.012),
        position: "relative",
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          position: "absolute",
          top: 8,
          left: 14,
          fontWeight: 700,
          color: accent,
          fontSize: "0.8rem",
        }}
      >
        {data.label}
      </Typography>
    </Box>
  );
});
LdvGroup.displayName = "LdvGroup";

export default LdvGroup;
