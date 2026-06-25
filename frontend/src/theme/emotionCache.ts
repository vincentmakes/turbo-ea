/**
 * Emotion style caches for LTR and RTL rendering.
 *
 * MUI styles are emitted through emotion. For right-to-left locales (Arabic)
 * we need the `stylis-plugin-rtl` middleware so physical CSS properties
 * (margin-left, padding-right, …) are flipped automatically. We keep two
 * caches and swap them via `<CacheProvider>` in `App.tsx` based on the active
 * locale's direction (see `dirForLocale` in `@/i18n`).
 */

import createCache from "@emotion/cache";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";

export const ltrCache = createCache({
  key: "mui",
  stylisPlugins: [prefixer],
});

export const rtlCache = createCache({
  key: "muirtl",
  stylisPlugins: [prefixer, rtlPlugin],
});
