/**
 * SPA outlet for extension page contributions. `App.tsx` mounts it once
 * under the wildcard route `/ext/*`; it resolves the current location
 * against every registered extension route, enforces the contribution's
 * declared permission, and renders the page inside an error boundary.
 */

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { matchPath, useLocation } from "react-router-dom";

import RequirePermission from "@/components/RequirePermission";
import { ExtensionBoundary, useExtensionUI } from "@/lib/extensionHost";

export default function ExtensionRoutesOutlet() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const extensions = useExtensionUI();

  for (const { key, plugin } of extensions) {
    for (const route of plugin.routes ?? []) {
      if (!matchPath({ path: route.path, end: true }, location.pathname)) continue;
      const Page = route.component;
      const page = (
        <ExtensionBoundary extensionKey={key}>
          <Page />
        </ExtensionBoundary>
      );
      return route.permission ? (
        <RequirePermission permission={route.permission}>{page}</RequirePermission>
      ) : (
        page
      );
    }
  }

  return (
    <Box sx={{ maxWidth: 640, mx: "auto", mt: { xs: 4, sm: 8 }, px: 2 }}>
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6">{t("notFound.title", "Page not found")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t(
            "notFound.extensionHint",
            "This page belongs to an extension that is not installed, not enabled, or still loading.",
          )}
        </Typography>
      </Paper>
    </Box>
  );
}
