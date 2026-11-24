import { Fragment, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  groupCheckState,
  rowChecked,
  rowName,
  setSurfaceForRows,
  type DisplayGroup,
  type DisplayRow,
  type DisplaySurface,
  type DisplayToggles,
} from "./portalDisplayGroups";

/** The Visitor filter column: which filters can be ticked now, which are, and how to change them. */
export interface VisitorFilterColumn {
  eligible: ReadonlySet<string>;
  checked: ReadonlySet<string>;
  /** Tick or untick these filters (all of them eligible). */
  onChange: (keys: string[], checked: boolean) => void;
}

export interface PortalDisplayConfigProps {
  /** The built-in properties, then each section's fields, then the relation types. */
  general: DisplayGroup;
  sections: DisplayGroup[];
  relations: DisplayGroup | null;
  /** The card type has subtypes: a Subtype row carries only its filter checkbox. */
  subtypeRow: boolean;
  toggles: DisplayToggles;
  onTogglesChange: Dispatch<SetStateAction<DisplayToggles>>;
  filters: VisitorFilterColumn;
}

const SURFACES: DisplaySurface[] = ["card", "detail"];

/**
 * A web portal's Display configuration: what each row shows on the summary
 * card, in the expanded detail and as a visitor filter. Rows are grouped —
 * the built-in properties, each metamodel section, the relation types — under
 * a shaded header whose checkboxes tick or untick the whole group per column
 * (half-filled while the group is mixed), and which folds the group away. A
 * folded group keeps its checkboxes, so a long section can be switched without
 * opening it.
 */
export default function PortalDisplayConfig({
  general,
  sections,
  relations,
  subtypeRow,
  toggles,
  onTogglesChange,
  filters,
}: PortalDisplayConfigProps) {
  const { t } = useTranslation("admin");
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const surfaceLabel = (surface: DisplaySurface, item: string) =>
    t(surface === "card" ? "webPortals.showOnCard" : "webPortals.showInDetail", { item });
  const groupSurfaceLabel = (surface: DisplaySurface, section: string) =>
    t(surface === "card" ? "webPortals.groupOnCard" : "webPortals.groupInDetail", { section });

  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** A row's Visitor filter cell: a checkbox when the row can be a filter, greyed out while it is shown nowhere. */
  const filterCell = (filterKey: string | undefined, item: string) => {
    if (!filterKey) return <TableCell />;
    const enabled = filters.eligible.has(filterKey);
    const box = (
      <Checkbox
        size="small"
        checked={enabled && filters.checked.has(filterKey)}
        disabled={!enabled}
        inputProps={{ "aria-label": t("webPortals.visitorFilterFor", { item }) }}
        onChange={(e) => filters.onChange([filterKey], e.target.checked)}
      />
    );
    return (
      <TableCell align="center">
        {enabled ? (
          box
        ) : (
          <Tooltip title={t("webPortals.visitorFilterNeedsShown")}>
            <span>{box}</span>
          </Tooltip>
        )}
      </TableCell>
    );
  };

  /** A group's Visitor filter cell: over the rows that can be a filter now; none ever, no box. */
  const groupFilterCell = (group: DisplayGroup) => {
    const keys = group.rows.flatMap((r) => (r.filterKey ? [r.filterKey] : []));
    if (keys.length === 0) return <TableCell />;
    const eligible = keys.filter((k) => filters.eligible.has(k));
    const state = groupCheckState(eligible.map((k) => filters.checked.has(k)));
    return (
      <TableCell align="center">
        <Checkbox
          size="small"
          checked={state.checked}
          indeterminate={state.indeterminate}
          disabled={eligible.length === 0}
          inputProps={{
            "aria-label": t("webPortals.groupAsFilter", { section: group.label }),
            "aria-checked": state.indeterminate ? "mixed" : undefined,
          }}
          onChange={() => filters.onChange(eligible, !state.checked)}
        />
      </TableCell>
    );
  };

  const groupRow = (group: DisplayGroup) => {
    const open = !folded.has(group.key);
    return (
      <TableRow key={`${group.key}:header`} sx={{ bgcolor: "action.hover" }}>
        <TableCell>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <IconButton
              size="small"
              aria-expanded={open}
              aria-label={t(open ? "webPortals.foldGroup" : "webPortals.unfoldGroup", { section: group.label })}
              onClick={() => toggleFold(group.key)}
              sx={{ p: 0.25 }}
            >
              <MaterialSymbol icon={open ? "expand_more" : "chevron_right"} size={18} />
            </IconButton>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {group.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("webPortals.groupCount", { count: group.rows.length })}
            </Typography>
          </Box>
        </TableCell>
        {SURFACES.map((surface) => {
          const state = groupCheckState(group.rows.map((r) => rowChecked(toggles, r, surface)));
          return (
            <TableCell key={surface} align="center">
              <Checkbox
                size="small"
                checked={state.checked}
                indeterminate={state.indeterminate}
                inputProps={{
                  "aria-label": groupSurfaceLabel(surface, group.label),
                  "aria-checked": state.indeterminate ? "mixed" : undefined,
                }}
                onChange={() =>
                  onTogglesChange((prev) => setSurfaceForRows(prev, group.rows, surface, !state.checked))
                }
              />
            </TableCell>
          );
        })}
        {groupFilterCell(group)}
      </TableRow>
    );
  };

  const fieldRow = (group: DisplayGroup, row: DisplayRow) => {
    const name = rowName(row);
    return (
      <TableRow key={`${group.key}:${row.key}`}>
        <TableCell sx={{ py: 0 }}>
          {/* Indented under its group, with a guide line down the group. */}
          <Box sx={{ ml: 1.75, pl: 2.25, py: 0.5, borderLeft: 2, borderColor: "divider" }}>
            <Typography variant="body2">
              {row.label}
              {row.hint && (
                <>
                  {" "}
                  <Typography component="span" variant="caption" color="text.secondary">
                    ({row.hint})
                  </Typography>
                </>
              )}
            </Typography>
          </Box>
        </TableCell>
        {SURFACES.map((surface) => (
          <TableCell key={surface} align="center">
            <Checkbox
              size="small"
              checked={rowChecked(toggles, row, surface)}
              inputProps={{ "aria-label": surfaceLabel(surface, name) }}
              onChange={(e) =>
                onTogglesChange((prev) => setSurfaceForRows(prev, [row], surface, e.target.checked))
              }
            />
          </TableCell>
        ))}
        {filterCell(row.filterKey, name)}
      </TableRow>
    );
  };

  const group = (g: DisplayGroup): ReactNode => (
    <Fragment key={g.key}>
      {groupRow(g)}
      {!folded.has(g.key) && g.rows.map((row) => fieldRow(g, row))}
    </Fragment>
  );

  return (
    <Table size="small" sx={{ "& td, & th": { py: 0.5, px: 1 } }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 600, width: "50%" }}>{t("webPortals.columns.property")}</TableCell>
          <TableCell align="center" sx={{ fontWeight: 600 }}>{t("webPortals.columns.summaryCard")}</TableCell>
          <TableCell align="center" sx={{ fontWeight: 600 }}>{t("webPortals.columns.expandedDetail")}</TableCell>
          <TableCell align="center" sx={{ fontWeight: 600 }}>{t("webPortals.columns.visitorFilter")}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {subtypeRow && (
          <TableRow>
            <TableCell>
              <Typography variant="body2">{t("webPortals.subtypeFilterRow")}</Typography>
            </TableCell>
            <TableCell />
            <TableCell />
            {filterCell("subtype", t("webPortals.subtypeFilterRow"))}
          </TableRow>
        )}
        {group(general)}
        {sections.length > 0 && (
          <TableRow>
            <TableCell
              colSpan={4}
              sx={{
                pt: 1.5,
                pb: 0.5,
                fontWeight: 600,
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "text.secondary",
                borderBottom: "none",
              }}
            >
              {t("webPortals.customFields")}
            </TableCell>
          </TableRow>
        )}
        {sections.map(group)}
        {relations && relations.rows.length > 0 && group(relations)}
      </TableBody>
    </Table>
  );
}
