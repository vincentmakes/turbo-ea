/**
 * The widget catalogue, grouped by family. A generic KPI or chart opens the
 * configuration dialog first (the parent does that on `onPick`); everything
 * else is added straight away. A single-instance widget already on the
 * dashboard is greyed with "Already added" — removing one and picking it
 * here again is how a built-in widget comes back. The metamodel-aware presets
 * are resolved from the card and relation types while the drawer is open.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { DashboardWidget } from "@/types";
import { NO_MODULES, type DashboardModules } from "../widgets/widgetMeta";
import { FAMILY_ORDER, catalogueFor, isAlreadyAdded, type CatalogueEntry } from "./catalogue";

interface Props {
  open: boolean;
  widgets: DashboardWidget[];
  /** Which optional modules are on — a module's tiles are offered only then. */
  modules?: DashboardModules;
  onClose: () => void;
  onPick: (entry: CatalogueEntry) => void;
}

export default function AddWidgetDrawer({ open, widgets, modules = NO_MODULES, onClose, onPick }: Props) {
  const { t } = useTranslation("common");
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 380 } } } }}>
      <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          {t("dashboard.customize.catalogueTitle")}
        </Typography>
        <IconButton aria-label={t("actions.close")} onClick={onClose}>
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </Box>
      <CatalogueList widgets={widgets} modules={modules} onPick={onPick} />
    </Drawer>
  );
}

/** The grouped entries — mounted only while the drawer is open. */
function CatalogueList({
  widgets,
  modules,
  onPick,
}: {
  widgets: DashboardWidget[];
  modules: DashboardModules;
  onPick: (entry: CatalogueEntry) => void;
}) {
  const { t } = useTranslation("common");
  const user = useOptionalAuthUser();
  const { types, relationTypes } = useMetamodel();
  const entries = useMemo(
    () => catalogueFor(user?.permissions, modules, { types, relationTypes }),
    [user?.permissions, modules, types, relationTypes],
  );
  const families = FAMILY_ORDER.map((family) => ({
    family,
    entries: entries.filter((e) => e.family === family),
  })).filter((g) => g.entries.length > 0);

  return (
    <List dense sx={{ overflow: "auto", flex: 1 }}>
      {families.map(({ family, entries: items }) => (
        <li key={family}>
          <ul style={{ padding: 0 }}>
            <ListSubheader sx={{ lineHeight: "36px" }}>{t(`dashboard.widgets.family.${family}`)}</ListSubheader>
            {items.map((entry) => {
              const added = isAlreadyAdded(entry, widgets);
              return (
                <ListItemButton
                  key={entry.id}
                  disabled={added}
                  data-testid={`catalogue-${entry.id}`}
                  onClick={() => onPick(entry)}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <MaterialSymbol icon={entry.icon} size={20} />
                  </ListItemIcon>
                  <ListItemText
                    primary={t(entry.labelKey)}
                    secondary={
                      added
                        ? t("dashboard.customize.alreadyAdded")
                        : entry.needsConfig
                          ? t("dashboard.customize.needsConfig")
                          : undefined
                    }
                  />
                </ListItemButton>
              );
            })}
          </ul>
        </li>
      ))}
    </List>
  );
}
