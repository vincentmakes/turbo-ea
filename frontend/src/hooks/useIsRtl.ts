import { useTranslation } from "react-i18next";
import { isRtlLocale } from "@/i18n";

/**
 * Live right-to-left flag for the current interface language.
 *
 * The global RTL plumbing (MUI theme direction, emotion cache swap, document
 * `dir`) is wired in `App.tsx`. This hook exposes the same signal to individual
 * components — notably third-party widgets (AG Grid, Recharts) that need their
 * own direction flag because they don't inherit `dir` from the DOM/theme.
 */
export function useIsRtl(): boolean {
  const { i18n } = useTranslation();
  return isRtlLocale(i18n.language);
}
