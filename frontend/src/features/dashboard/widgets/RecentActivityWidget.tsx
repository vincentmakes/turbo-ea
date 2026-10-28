/**
 * The Overview's Recent Activity feed, fed from the dashboard's shared
 * `/reports/dashboard` payload. `config.max_rows` and `config.filter` (the tab
 * selected on mount) are optional.
 */
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import { useTranslation } from "react-i18next";
import RecentActivity from "../RecentActivity";
import { useDashboardSource } from "../DashboardSources";
import type { ActivityFilter } from "../formatActivityEvent";
import type { WidgetProps } from "./widgetMeta";

const FILTERS: ActivityFilter[] = ["all", "cards", "approvals", "relations", "comments"];

export default function RecentActivityWidget({ widget }: WidgetProps) {
  const { t } = useTranslation("common");
  const { data, loading, error } = useDashboardSource("reports.dashboard");
  const config = widget.config ?? {};
  const maxRows = typeof config.max_rows === "number" && config.max_rows > 0 ? config.max_rows : undefined;
  const filter = FILTERS.includes(config.filter as ActivityFilter) ? (config.filter as ActivityFilter) : "all";

  if (error && !data) return <Alert severity="error">{error.message || t("errors.generic")}</Alert>;
  if (loading && !data) return <LinearProgress sx={{ my: 2 }} />;
  return <RecentActivity events={data?.recent_events ?? []} maxRows={maxRows} defaultFilter={filter} />;
}
