/**
 * An extension's logo, with a graceful chain of fallbacks.
 *
 * Precedence is bundle → catalogue → generated tile. The bundle logo wins
 * because it is the signature-covered artwork of the version this instance is
 * actually running, and because it is the only one an air-gapped install can
 * reach; the catalogue logo covers everything that is not installed yet.
 *
 * Nothing here is ever load-bearing: an extension that ships no artwork, a
 * store that cannot be reached, and a 404 on either URL all land on the same
 * generated tile rather than a broken-image glyph. A puzzle-piece glyph on
 * every extension would just restate the problem this component exists to
 * fix, so the tile carries the extension's initials on a colour derived from
 * its key — stable across renders, sessions, and a vendor rename.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import { CATEGORICAL_COLORS } from "@/theme/tokens";

interface Props {
  /** Extension key — drives the deterministic fallback colour. */
  extKey: string;
  /** Display name — supplies the fallback initials. */
  name: string;
  /** Same-origin URL from `GET /admin/extensions` → `logo_url`. */
  bundleLogoUrl?: string | null;
  /** Absolute store URL from the catalogue item's `logo`. */
  catalogLogoUrl?: string | null;
  size?: number;
  /** Border radius in theme units. */
  radius?: number;
}

function fallbackColor(extKey: string): string {
  let hash = 0;
  for (const char of extKey) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return CATEGORICAL_COLORS[Math.abs(hash) % CATEGORICAL_COLORS.length];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export default function ExtensionLogo({
  extKey,
  name,
  bundleLogoUrl,
  catalogLogoUrl,
  size = 40,
  radius = 1.5,
}: Props) {
  const sources = [bundleLogoUrl, catalogLogoUrl].filter(Boolean) as string[];
  // A cursor over the candidates rather than a boolean: a 404 on the bundle
  // logo (mid-uninstall, a wiped volume) should still try the catalogue one.
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [bundleLogoUrl, catalogLogoUrl]);

  const src = sources[index];

  const common = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
  } as const;

  if (src) {
    return (
      <Box
        component="img"
        src={src}
        // The name is always rendered next to this, so alt text would make a
        // screen reader announce it twice.
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setIndex((i) => i + 1)}
        sx={{
          ...common,
          // Never `cover` — a vendor's mark must not be cropped. The neutral
          // plate keeps a transparent PNG legible in both themes.
          objectFit: "contain",
          bgcolor: "action.hover",
        }}
      />
    );
  }

  return (
    <Box
      aria-hidden
      sx={{
        ...common,
        bgcolor: fallbackColor(extKey),
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {initials(name)}
    </Box>
  );
}
