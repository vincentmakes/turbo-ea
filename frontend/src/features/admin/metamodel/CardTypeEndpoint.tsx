import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";

/**
 * A card type rendered as colour dot + icon + name — the identity cluster every
 * row on the Relations tab leads with.
 *
 * Extracted because `RelationTypesPanel` and `HierarchyLinkTypesSection` sit on
 * the same tab, one above the other, and each had its own copy: the second drew
 * the same three elements with a different gap and a `minWidth`, so two lists of
 * card types on one screen did not line up. One component is what stops that
 * recurring.
 *
 * `type` may be undefined when a row references a key the metamodel no longer
 * has; the name then falls back to the raw key rather than rendering nothing.
 */
export default function CardTypeEndpoint({
  type,
  typeKey,
}: {
  type: CardType | undefined;
  /** Shown when `type` is missing, so a dangling reference stays legible. */
  typeKey: string;
}) {
  const typeLabel = useTypeLabel();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      {type && (
        <>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: type.color,
              flexShrink: 0,
            }}
          />
          <MaterialSymbol icon={type.icon} size={16} color={type.color} />
        </>
      )}
      <Typography variant="body2" fontWeight={500}>
        {type ? typeLabel(type) : typeKey}
      </Typography>
    </Box>
  );
}
