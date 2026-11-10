/**
 * The Inventory views widget: the saved inventory views the reader can open
 * (`GET /bookmarks?filter=…` — all, their own or those shared with them),
 * query views only when the widget says so, six at most in the API's order.
 *
 * Each row reads like the inventory's Views list: the card type's icon (a
 * bookmark when the view spans several types), the name, the query-view mark
 * (the MCP robot when an assistant created it), the visibility mark, and a
 * second line — the query's path for a query view, else its card type. A row
 * is a real link to `/inventory?view=<id>`, so it opens in a new tab too.
 *
 * `/bookmarks` needs `bookmarks.manage`, which the widget does not require of
 * its viewer (it is a workspace widget): a role without it gets a short note
 * instead of an error.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { ApiError } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { ORIGIN_META } from "@/components/originMeta";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { compactPath } from "@/features/inventory/queryPath";
import { startTypes } from "@/features/inventory/querySet";
import type { Bookmark, CardType, DashboardWidget, RelationType } from "@/types";
import { widgetTitle } from "../widgets/widgetMeta";
import { inventoryViewsPath, readInventoryViewsConfig, shownViews } from "../widgets/inventoryViewsConfig";
import SectionPaper, { EmptyState, ViewAllLink } from "./SectionPaper";

export default function InventoryViewsSection({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation("common");
  const config = useMemo(() => readInventoryViewsConfig(widget.config), [widget.config]);
  const { data, loading, error } = useApiQuery<Bookmark[]>(inventoryViewsPath(config));
  const { types, relationTypes } = useMetamodel();
  const views = useMemo(() => shownViews(data ?? [], config), [data, config]);

  let body;
  if (error && !data) {
    body =
      error instanceof ApiError && error.status === 403 ? (
        <EmptyState message={t("dashboard.inventoryViews.forbidden")} />
      ) : (
        <Alert severity="error" variant="outlined" sx={{ py: 0 }}>
          {error.message || t("errors.generic")}
        </Alert>
      );
  } else if (loading && !data) {
    body = <LinearProgress />;
  } else if (views.length === 0) {
    body = (
      <EmptyState
        message={t(config.queryOnly ? "dashboard.inventoryViews.emptyQuery" : "dashboard.inventoryViews.empty")}
      />
    );
  } else {
    body = (
      <List dense disablePadding data-testid="inventory-views">
        {views.map((bm) => (
          <ViewRow key={bm.id} bm={bm} types={types} relationTypes={relationTypes} />
        ))}
      </List>
    );
  }

  return (
    <SectionPaper
      icon="view_list"
      title={widgetTitle(widget, t)}
      action={<ViewAllLink to="/inventory" label={t("actions.viewAll")} />}
    >
      {body}
    </SectionPaper>
  );
}

function ViewRow({ bm, types, relationTypes }: { bm: Bookmark; types: CardType[]; relationTypes: RelationType[] }) {
  const { t, i18n } = useTranslation(["common", "inventory"]);
  const typeLabel = useTypeLabel();
  const filters = bm.filters as Record<string, unknown> | undefined;
  // A query view is about its start types, whatever its stored facets say.
  const viewTypes = bm.query ? startTypes(bm.query) : ((filters?.types as string[] | undefined) ?? []);
  const matchedType = viewTypes.length === 1 ? types.find((ct) => ct.key === viewTypes[0]) : undefined;
  const visibility = bm.visibility === "public" ? "public" : bm.visibility === "shared" ? "group" : null;

  const secondary = bm.query
    ? compactPath(bm.query, {
        types,
        relationTypes,
        locale: i18n.language,
        hasNo: t("inventory:queryView.hasNo"),
        and: t("inventory:queryView.connectiveAnd"),
        or: t("inventory:queryView.connectiveOr"),
        conditions: (count) => t("inventory:queryView.conditionCount", { count }),
      })
    : matchedType
      ? typeLabel(matchedType)
      : viewTypes.length > 1
        ? t("inventory:views.nTypes", { count: viewTypes.length })
        : t("inventory:views.allTypes");
  const owner = bm.is_owner
    ? ""
    : t("inventory:views.byOwner", { name: bm.owner_name || t("inventory:views.unknown") });

  return (
    <Tooltip title={owner} placement="top-start" describeChild>
      <ListItemButton
        component={RouterLink}
        to={`/inventory?view=${bm.id}`}
        data-testid="inventory-view-row"
        sx={{ py: 0.5, px: 1, borderRadius: 1 }}
      >
        <ListItemIcon sx={{ minWidth: 28 }} data-testid="inventory-view-icon">
          {matchedType ? (
            <MaterialSymbol icon={matchedType.icon} size={18} color={matchedType.color} />
          ) : (
            <MaterialSymbol icon="bookmark" size={18} />
          )}
        </ListItemIcon>
        <ListItemText
          disableTypography
          primary={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {bm.name}
              </Typography>
              {bm.query && (
                <Box
                  component="span"
                  role="img"
                  aria-label={t("inventory:queryView.badge")}
                  data-testid="inventory-view-query-mark"
                  sx={{ display: "inline-flex" }}
                >
                  {bm.created_via === "mcp" ? (
                    <MaterialSymbol icon="smart_toy" size={16} color={ORIGIN_META.mcp.color} />
                  ) : (
                    <MaterialSymbol icon="view_in_ar" size={16} />
                  )}
                </Box>
              )}
              {visibility && (
                <Box
                  component="span"
                  role="img"
                  aria-label={t(
                    visibility === "public" ? "inventory:views.visibilityPublic" : "inventory:views.visibilityShared",
                  )}
                  data-testid="inventory-view-visibility"
                  sx={{ display: "inline-flex" }}
                >
                  <MaterialSymbol icon={visibility} size={16} />
                </Box>
              )}
            </Box>
          }
          secondary={
            <Typography variant="caption" color="text.secondary" noWrap component="div" data-testid="inventory-view-line">
              {secondary}
            </Typography>
          }
        />
      </ListItemButton>
    </Tooltip>
  );
}
