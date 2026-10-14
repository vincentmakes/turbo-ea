/**
 * AuditLogAdmin — Admin → Settings → Audit log. A thin container over two
 * sub-tabs:
 *
 *  - **Changes** (`AuditLogChangesTab`) — the mutation-batch ledger: every
 *    landscape-content write, with per-event diffs and rollback.
 *  - **Security & admin** (`SecurityLogAdmin`) — the `audit_log` table:
 *    sign-ins and sign-outs, failed attempts, impersonation, password events
 *    and audit-log exports. Read-only by design.
 *
 * The active sub-tab rides in the URL as `?tab=audit-log&view=security`, so a
 * reload or a shared link lands on the same view (the IntegrationsHub
 * pattern). Changes is the default and carries no `view` param.
 */
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import MaterialSymbol from "@/components/MaterialSymbol";
import AuditLogChangesTab from "./AuditLogChangesTab";
import SecurityLogAdmin from "./SecurityLogAdmin";

export const AUDIT_LOG_VIEWS = ["changes", "security"] as const;
export type AuditLogView = (typeof AUDIT_LOG_VIEWS)[number];

const VIEW_PARAM = "view";

export default function AuditLogAdmin() {
  const { t } = useTranslation("admin");
  const [params, setParams] = useSearchParams();
  // An unknown value — a hand-typed link — lands on Changes.
  const view: AuditLogView = params.get(VIEW_PARAM) === "security" ? "security" : "changes";

  const handleChange = (_e: unknown, next: AuditLogView) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === "security") p.set(VIEW_PARAM, "security");
        else p.delete(VIEW_PARAM);
        return p;
      },
      { replace: true },
    );
  };

  return (
    <Box>
      <Tabs
        value={view}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab
          value="changes"
          label={t("auditLog.subtabs.changes")}
          icon={<MaterialSymbol icon="history" size={18} />}
          iconPosition="start"
          sx={{ minHeight: 48 }}
        />
        <Tab
          value="security"
          label={t("auditLog.subtabs.security")}
          icon={<MaterialSymbol icon="admin_panel_settings" size={18} />}
          iconPosition="start"
          sx={{ minHeight: 48 }}
        />
      </Tabs>
      {view === "changes" ? <AuditLogChangesTab /> : <SecurityLogAdmin />}
    </Box>
  );
}
