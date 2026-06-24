import { Box, Tab, Tabs } from "@mui/material";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";

const MigrationAdmin = lazy(() => import("./MigrationAdmin"));
const WorkspaceTransferAdmin = lazy(() => import("./WorkspaceTransferAdmin"));

/**
 * Container for the two migration-related tools, grouped under the single
 * Admin → Settings → Migration tab:
 *   - Platform migration: import a workspace from a foreign EA platform (LeanIX…)
 *   - Workspace transfer: export/import a whole Turbo EA workspace between instances
 */
export default function MigrationHub() {
  const { t } = useTranslation("admin");
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label={t("settings.tabs.platformMigration", "Platform migration")} />
        <Tab label={t("settings.tabs.workspaceTransfer", "Workspace transfer")} />
      </Tabs>

      <Suspense fallback={null}>
        {tab === 0 && <MigrationAdmin />}
        {tab === 1 && <WorkspaceTransferAdmin />}
      </Suspense>
    </Box>
  );
}
