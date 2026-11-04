import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { readableTextColor } from "@/lib/color";

interface Props {
  typeKey: string;
}

/**
 * Compact pill that renders a card type using its brand colour and the
 * localised label from the metamodel. Falls back to the raw key when the
 * type isn't in the metamodel cache (e.g. soft-deleted types).
 */
export default function CardTypePill({ typeKey }: Props) {
  const theme = useTheme();
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const type = getType(typeKey);
  const color = type?.color ?? theme.palette.grey[600];
  const label = type ? typeLabel(type) : typeKey;

  return (
    <Chip
      size="small"
      label={label}
      sx={{
        bgcolor: color,
        color: readableTextColor(color),
        height: 20,
        fontSize: 11,
        fontWeight: 500,
        flexShrink: 0,
        "& .MuiChip-label": { px: 0.75 },
      }}
    />
  );
}
