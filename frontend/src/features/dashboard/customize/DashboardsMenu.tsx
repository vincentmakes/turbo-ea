/**
 * The manager's kebab next to the dashboard tabs: create, duplicate, edit
 * settings, hide/show, reorder, reset a built-in to its default widgets and
 * delete a custom one. Each action calls the API and tells the page what to
 * show next (`onChanged`); the page refetches.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Dashboard } from "@/types";
import DashboardSettingsDialog from "./DashboardSettingsDialog";
import { swapSortOrders } from "./dashboardUtils";

export interface DashboardsChange {
  /** Key of the dashboard to open next. */
  select?: string;
  /** Open it in customize mode. */
  edit?: boolean;
  /** The current dashboard no longer exists. */
  removed?: boolean;
}

interface Props {
  /** The dashboard on screen (null when there is none yet). */
  dashboard: Dashboard | null;
  /** Every dashboard the manager sees, in tab order. */
  dashboards: Dashboard[];
  /** The dashboard's display name. */
  label: string;
  onChanged: (change: DashboardsChange) => void;
}

type Confirm = "reset" | "delete" | null;
type SettingsMode = "create" | "edit" | null;

export default function DashboardsMenu({ dashboard, dashboards, label, onChanged }: Props) {
  const { t } = useTranslation("common");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<SettingsMode>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const index = dashboard ? dashboards.findIndex((d) => d.id === dashboard.id) : -1;
  const close = () => setAnchor(null);

  const run = async (action: () => Promise<DashboardsChange>) => {
    close();
    setBusy(true);
    try {
      onChanged(await action());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("dashboard.menu.actionFailed"));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const duplicate = () =>
    run(async () => {
      const copy = await api.post<Dashboard>(`/dashboards/${dashboard!.id}/duplicate`, {
        name: t("dashboard.menu.copyOf", { name: label }),
      });
      return { select: copy.key };
    });

  const toggleHidden = () =>
    run(async () => {
      await api.patch(`/dashboards/${dashboard!.id}`, { is_hidden: !dashboard!.is_hidden });
      return {};
    });

  const move = (direction: -1 | 1) =>
    run(async () => {
      for (const patch of swapSortOrders(dashboards, index, direction)) {
        await api.patch(`/dashboards/${patch.id}`, { sort_order: patch.sort_order });
      }
      return { select: dashboard!.key };
    });

  const reset = () =>
    run(async () => {
      await api.post(`/dashboards/${dashboard!.id}/reset`);
      return {};
    });

  const remove = () =>
    run(async () => {
      await api.delete(`/dashboards/${dashboard!.id}`);
      return { removed: true };
    });

  const item = (key: string, icon: string, text: string, onClick: () => void, disabled = false) => (
    <MenuItem key={key} onClick={onClick} disabled={disabled || busy} data-testid={`dashboard-menu-${key}`}>
      <ListItemIcon>
        <MaterialSymbol icon={icon} size={20} />
      </ListItemIcon>
      <ListItemText>{text}</ListItemText>
    </MenuItem>
  );

  const items = [
    item("new", "add", t("dashboard.menu.newDashboard"), () => {
      close();
      setSettings("create");
    }),
  ];
  if (dashboard) {
    items.push(
      <Divider key="d1" />,
      item("duplicate", "content_copy", t("dashboard.menu.duplicate"), duplicate),
      item("settings", "settings", t("dashboard.menu.settings"), () => {
        close();
        setSettings("edit");
      }),
      dashboard.is_hidden
        ? item("show", "visibility", t("dashboard.menu.show"), toggleHidden)
        : item("hide", "visibility_off", t("dashboard.menu.hide"), toggleHidden),
      item("move-left", "arrow_back", t("dashboard.menu.moveLeft"), () => move(-1), index <= 0),
      item(
        "move-right",
        "arrow_forward",
        t("dashboard.menu.moveRight"),
        () => move(1),
        index < 0 || index >= dashboards.length - 1,
      ),
      <Divider key="d2" />,
      dashboard.built_in
        ? item("reset", "restart_alt", t("dashboard.menu.resetToDefault"), () => {
            close();
            setConfirm("reset");
          })
        : item("delete", "delete", t("dashboard.menu.delete"), () => {
            close();
            setConfirm("delete");
          }),
    );
  }

  return (
    <>
      <Tooltip title={t("dashboard.menu.manage")}>
        <IconButton aria-label={t("dashboard.menu.manage")} onClick={(e) => setAnchor(e.currentTarget)}>
          <MaterialSymbol icon="more_vert" size={20} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        {items}
      </Menu>

      <DashboardSettingsDialog
        open={settings !== null}
        dashboard={settings === "edit" ? dashboard : null}
        onClose={() => setSettings(null)}
        onSaved={(saved) => {
          const wasCreate = settings === "create";
          setSettings(null);
          onChanged(wasCreate ? { select: saved.key, edit: true } : {});
        }}
      />

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {confirm === "reset" ? t("dashboard.menu.resetTitle") : t("dashboard.menu.deleteTitle")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm === "reset"
              ? t("dashboard.menu.resetConfirm", { name: label })
              : t("dashboard.menu.deleteConfirm", { name: label })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{t("actions.cancel")}</Button>
          <Button
            variant="contained"
            color={confirm === "delete" ? "error" : "primary"}
            disabled={busy}
            onClick={confirm === "reset" ? reset : remove}
          >
            {confirm === "reset" ? t("actions.reset") : t("actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: "100%" }}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
