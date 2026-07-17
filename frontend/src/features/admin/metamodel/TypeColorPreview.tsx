import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { isHexColor, readableTextColor, readableTypeColor } from "@/lib/color";

/**
 * Live sample panel for the card-type color picker: shows how the draft
 * color renders across the real UI — card-detail header (icon, type label,
 * subtype), inventory type chip, card-ID pill, and a mini Layered Dependency
 * View node — once for the light theme and once for the dark theme.
 *
 * Each sample deliberately re-applies the exact visual recipes of the real
 * components (CardDetail header, InventoryPage chip, CardIdPill, LdvNode)
 * with a hardcoded `isDark` per canvas instead of nested ThemeProviders, so
 * the preview stays cheap and always shows BOTH themes regardless of the
 * admin's current theme.
 */

interface Props {
  color: string;
  icon: string;
  typeLabel: string;
  subtypeLabel?: string;
}

function SampleCanvas({
  color,
  icon,
  typeLabel,
  subtypeLabel,
  isDark,
  title,
}: Props & { isDark: boolean; title: string }) {
  // Same non-hex guard as LdvNode / CardIdPill.
  const hex = isHexColor(color) ? color : "#9e9e9e";
  const accent = readableTypeColor(hex, isDark);
  const chipText = readableTextColor(hex);
  const textPrimary = isDark ? "#fff" : "#333";

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // LDV node tint: opaque mix toward white (light) / low-alpha wash (dark).
  const mix = (c: number) => Math.round(c + (255 - c) * 0.88);
  const ldvBg = isDark ? `rgba(${r},${g},${b},0.12)` : `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  const pillBg = `rgba(${r},${g},${b},${isDark ? 0.18 : 0.12})`;

  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 0.5, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          width: 210,
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: isDark ? "#121212" : "#ffffff",
          p: 1.25,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {/* Card-detail header: icon box + type label · subtype */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box
            sx={{
              width: 26,
              height: 26,
              borderRadius: 1,
              bgcolor: `${hex}18`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <MaterialSymbol icon={icon} size={16} color={hex} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              noWrap
              sx={{ display: "block", fontWeight: 600, color: textPrimary, lineHeight: 1.3 }}
            >
              {typeLabel}
            </Typography>
            <Typography variant="caption" noWrap sx={{ display: "block", color: hex, lineHeight: 1.3 }}>
              {typeLabel}
              {subtypeLabel ? ` · ${subtypeLabel}` : ""}
            </Typography>
          </Box>
        </Box>

        {/* Inventory type chip + card-ID pill */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Box
            sx={{
              height: 20,
              borderRadius: "10px",
              bgcolor: hex,
              color: chipText,
              px: 1,
              display: "inline-flex",
              alignItems: "center",
              fontSize: "0.7rem",
              fontWeight: 500,
              maxWidth: 110,
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {typeLabel}
          </Box>
          <Box
            sx={{
              height: 20,
              borderRadius: "10px",
              border: `1px solid ${accent}`,
              bgcolor: pillBg,
              px: 0.75,
              display: "inline-flex",
              alignItems: "center",
              gap: 0.375,
            }}
          >
            <MaterialSymbol icon="tag" size={11} color={accent} />
            <Typography
              variant="caption"
              sx={{ color: accent, fontWeight: 700, fontSize: "0.65rem", fontFamily: "monospace", lineHeight: 1 }}
            >
              ID-001
            </Typography>
          </Box>
        </Box>

        {/* Mini Layered Dependency View node */}
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: 52,
            borderRadius: "8px",
            border: `1.5px solid ${accent}`,
            bgcolor: ldvBg,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            px: 1,
          }}
        >
          <Box sx={{ position: "absolute", top: 4, left: 5, opacity: 0.9, lineHeight: 0 }}>
            <MaterialSymbol icon={icon} size={14} color={accent} />
          </Box>
          <Typography
            variant="caption"
            noWrap
            sx={{ fontWeight: 600, color: textPrimary, lineHeight: 1.3, maxWidth: "100%" }}
          >
            {typeLabel}
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{ color: accent, fontStyle: "italic", fontSize: "0.62rem", lineHeight: 1.2 }}
          >
            [{typeLabel}]
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default function TypeColorPreview(props: Props) {
  const { t } = useTranslation("common");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <SampleCanvas {...props} isDark={false} title={t("colorPicker.previewLight")} />
      <SampleCanvas {...props} isDark title={t("colorPicker.previewDark")} />
    </Box>
  );
}
