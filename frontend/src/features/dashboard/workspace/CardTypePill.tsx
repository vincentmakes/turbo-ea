import Chip from "@mui/material/Chip";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";

interface Props {
  typeKey: string;
}

/**
 * Compact pill that renders a card type using its brand colour and the
 * localised label from the metamodel. Falls back to the raw key when the
 * type isn't in the metamodel cache (e.g. soft-deleted types).
 */
export default function CardTypePill({ typeKey }: Props) {
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const type = getType(typeKey);
  const color = type?.color ?? "#757575";
  const label = type ? typeLabel(type) : typeKey;

  return (
    <Chip
      size="small"
      label={label}
      sx={{
        bgcolor: color,
        color: "#fff",
        height: 20,
        fontSize: 11,
        fontWeight: 500,
        flexShrink: 0,
        "& .MuiChip-label": { px: 0.75 },
      }}
    />
  );
}
