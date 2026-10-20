import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";

/** A derived figure reads italic, after a small "from beneath" glyph. */
// Stryker disable next-line ObjectLiteral: layout of the glyph beside the figure is presentation; the italic is pinned by the tabs' tests
const DERIVED_VALUE_SX = {
  fontStyle: "italic",
  display: "inline-flex",
  alignItems: "center",
  gap: 0.25,
} as const;

/** The glyph's own spacing is presentation. */
// Stryker disable next-line ObjectLiteral: presentation
const GLYPH_STYLE = { opacity: 0.7 } as const;

/**
 * A figure on an initiative's page that is the total of the initiatives
 * beneath it rather than its own: italic, marked with the
 * `subdirectory_arrow_right` glyph and explained by `tip`. Without `tip` the
 * figure renders as it is.
 */
export default function DerivedValue({
  tip,
  children,
}: {
  tip: string | undefined;
  children: ReactNode;
}) {
  if (!tip) return <>{children}</>;
  return (
    <Tooltip title={tip}>
      <Box component="span" data-derived="true" sx={DERIVED_VALUE_SX}>
        <MaterialSymbol icon="subdirectory_arrow_right" size={16} style={GLYPH_STYLE} />
        {children}
      </Box>
    </Tooltip>
  );
}
