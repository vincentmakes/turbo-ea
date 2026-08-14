import { Link as RouterLink } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

/**
 * The right-hand drawer a report opens when you click an aggregate — a bar
 * segment, a bubble group, a KPI tile — listing the cards behind it.
 *
 * Extracted from the portfolio report's inline drawer so a report that wants
 * this affordance does not have to reimplement the chrome (and drift from it).
 * Clicking an item is expected to hand off to `CardDetailSidePanel`; the
 * optional `inventoryHref` is the "View in inventory" bridge built by
 * `portfolioInventoryLink.ts`, omitted for slices the inventory cannot express.
 */

export interface ReportCardListItem {
  id: string;
  name: string;
  /** Dot-separated context under the name (subtype, score, EOL date, …). */
  secondary?: string;
  /** Trailing colour swatch, when the report is colouring by something. */
  dotColor?: string;
  /** Trailing orange warning glyph (EOL, overdue, …). */
  warn?: boolean;
}

export interface ReportCardListMetric {
  value: string | number;
  label: string;
  color?: string;
}

/**
 * The panel's card rows, on their own.
 *
 * Exported so a report that needs a *second* list (ProcessMap's Data Objects)
 * can render it inside `afterList` with identical rows, instead of the panel
 * growing a notion of multiple lists. Sharing the row is the point; owning
 * every section is not.
 */
export function ReportCardListRows({
  items,
  onItemClick,
}: {
  items: ReportCardListItem[];
  onItemClick: (id: string) => void;
}) {
  return (
    <List dense>
      {items.map((item) => (
        <ListItemButton key={item.id} onClick={() => onItemClick(item.id)}>
          <ListItemText primary={item.name} secondary={item.secondary || undefined} />
          {item.dotColor && (
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                bgcolor: item.dotColor,
                flexShrink: 0,
                ml: 1,
              }}
            />
          )}
          {item.warn && <MaterialSymbol icon="warning" size={16} color="#e65100" />}
        </ListItemButton>
      ))}
    </List>
  );
}

interface Props {
  open: boolean;
  title: string;
  items: ReportCardListItem[];
  loading?: boolean;
  metrics?: ReportCardListMetric[];
  listHeading?: string;
  emptyLabel: string;
  /** Shown under the list when `items` is a capped slice of a larger set. */
  truncatedLabel?: string;
  /** Inventory deep-link; the button is hidden when absent. */
  inventoryHref?: string;
  /** Between the title and the metrics — e.g. a row of metadata chips. */
  headerContent?: React.ReactNode;
  /** Between the metrics and the list — e.g. drill-down / child-node chips. */
  beforeList?: React.ReactNode;
  /** After the list — e.g. a second list built from `ReportCardListRows`. */
  afterList?: React.ReactNode;
  onItemClick: (id: string) => void;
  onClose: () => void;
}

export default function ReportCardListPanel({
  open,
  title,
  items,
  loading = false,
  metrics,
  listHeading,
  emptyLabel,
  truncatedLabel,
  inventoryHref,
  headerContent,
  beforeList,
  afterList,
  onItemClick,
  onClose,
}: Props) {
  const { t } = useTranslation(["reports"]);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}
    >
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
            {title}
          </Typography>
          {inventoryHref && (
            <Button
              size="small"
              variant="outlined"
              component={RouterLink}
              to={inventoryHref}
              startIcon={<MaterialSymbol icon="inventory_2" size={16} />}
              sx={{ textTransform: "none", flexShrink: 0 }}
            >
              {t("portfolio.viewInInventory")}
            </Button>
          )}
          <IconButton onClick={onClose}>
            <MaterialSymbol icon="close" size={20} />
          </IconButton>
        </Box>

        {headerContent}

        {metrics && metrics.length > 0 && (
          <Box sx={{ display: "flex", gap: 3, mb: 2, flexWrap: "wrap" }}>
            {metrics.map((m) => (
              <Box key={m.label} sx={{ textAlign: "center", minWidth: 80 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, color: m.color }}>
                  {m.value}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {m.label}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {beforeList}

        {listHeading && (
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {listHeading}
          </Typography>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
            <ReportCardListRows items={items} onItemClick={onItemClick} />
            {items.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {emptyLabel}
              </Typography>
            )}
            {truncatedLabel && items.length > 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", textAlign: "center", pb: 1 }}
              >
                {truncatedLabel}
              </Typography>
            )}
            {afterList}
          </>
        )}
      </Box>
    </Drawer>
  );
}
