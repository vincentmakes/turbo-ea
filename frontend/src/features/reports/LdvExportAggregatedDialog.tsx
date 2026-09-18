/**
 * The step before the name prompt when a diagram is created from an
 * AGGREGATED Layered Dependency View.
 *
 * A grouped view exports as containers with live cards inside and merged
 * connectors between them, and the connectors are decoration — one line
 * standing for N relations has no relation identity to sync or to flag when
 * the inventory moves. That is a different bargain from the plain export,
 * where every line is a relation, so it is said once, here, before the
 * reader commits. Its own component (rather than a step inside the view's
 * name dialog) so it can be tested under jsdom, where React Flow cannot lay
 * out the view.
 */
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
  /** The fullscreen container, when the view is fullscreen — a dialog
   *  portalled to the body would otherwise open behind it. */
  container?: HTMLElement | null;
}

export default function LdvExportAggregatedDialog({ open, onClose, onContinue, container }: Props) {
  const { t } = useTranslation("reports");
  const rows: { icon: string; key: string }[] = [
    { icon: "link", key: "dependency.createDiagramAggregatedCards" },
    { icon: "select_all", key: "dependency.createDiagramAggregatedBoxes" },
    { icon: "linear_scale", key: "dependency.createDiagramAggregatedConnectors" },
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      disableRestoreFocus
      container={container ?? undefined}
    >
      <DialogTitle>{t("dependency.createDiagramAggregatedTitle")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {t("dependency.createDiagramAggregatedIntro")}
        </Typography>
        <List dense disablePadding sx={{ mt: 1 }}>
          {rows.map((row) => (
            <ListItem key={row.key} disableGutters alignItems="flex-start">
              <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
                <MaterialSymbol icon={row.icon} size={18} />
              </ListItemIcon>
              <ListItemText
                primary={t(row.key)}
                primaryTypographyProps={{ variant: "body2" }}
              />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={onContinue} autoFocus>
          {t("dependency.createDiagramAggregatedContinue")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
