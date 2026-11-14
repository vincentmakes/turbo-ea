/**
 * The two grouped tables of an initiative's Budget & Costs: planned budget
 * lines and cost items, one collapsible group per fiscal year with its
 * subtotals, and a grand-total footer.
 *
 * The tab renders them with its add / edit / delete buttons and the year
 * toggles; the read-only Initiative Report renders them `readOnly` (no
 * buttons, no actions column) and `expandAll` (every year open, nothing
 * clipped). Grouping and derived figures come from `costTableGroups` and
 * `derivedFinancials`; nothing is re-derived here.
 */
import { Fragment, useMemo, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableFooter from "@mui/material/TableFooter";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import LinearProgress from "@mui/material/LinearProgress";
import { useTranslation } from "react-i18next";
import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { bucketFor, type BudgetTotals } from "./costChartData";
import { grandTotals, type GroupKey, type LineGroup } from "./costTableGroups";
import type { DerivedSide, DerivedYearRow } from "./derivedFinancials";
import type { PpmBudgetLine, PpmCostLine } from "@/types";

// Stryker disable next-line ObjectLiteral: spacing is presentation
const LOADING_CELL_SX = { py: 2 } as const;
// Stryker disable next-line ObjectLiteral: spacing is presentation
const EMPTY_CELL_SX = { py: 2 } as const;
// Stryker disable next-line ObjectLiteral: spacing is presentation
const LINE_COUNT_SX = { ml: 0.5 } as const;
// Stryker disable next-line ObjectLiteral: spacing is presentation
const DESCRIPTION_CELL_SX = { maxWidth: 240 } as const;
/** Expanded for reading: the whole description, wrapped at the cell's width. */
const FULL_DESCRIPTION_SX = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
// Stryker disable next-line ObjectLiteral: typography is presentation
const NUM_SX = { fontVariantNumeric: "tabular-nums" } as const;
// Stryker disable next-line ObjectLiteral: typography is presentation
const SUBTOTAL_SX = { fontVariantNumeric: "tabular-nums", fontWeight: 700 } as const;
// Stryker disable next-line ObjectLiteral: colour is presentation
const YEAR_ROW_SX = { bgcolor: "action.hover" } as const;
// Stryker disable next-line ObjectLiteral: colour is presentation
const FOOTER_ROW_SX = { bgcolor: "action.selected" } as const;
// Stryker disable next-line ObjectLiteral: typography is presentation
const FOOTER_CELL_SX = {
  fontVariantNumeric: "tabular-nums",
  fontWeight: 700,
  color: "text.primary",
  fontSize: "0.875rem",
} as const;
/** A figure summed from the initiatives beneath reads italic. */
const DERIVED_NUM_SX = { ...NUM_SX, fontStyle: "italic" } as const;
const DERIVED_FOOTER_CELL_SX = { ...FOOTER_CELL_SX, fontStyle: "italic" } as const;
/** The caption heading a derived table: what it is and where it comes from. */
// Stryker disable next-line ObjectLiteral: layout of the glyph beside the caption is presentation
const DERIVED_CAPTION_SX = { display: "flex", alignItems: "center", gap: 0.5 } as const;

// Stryker disable all: how a narrow screen scrolls a table sideways (momentum scrolling, a 660 px floor below md) and the gap under the budget table; jsdom does no layout and evaluates no media query
const BUDGET_CONTAINER_SX = { mb: 3, WebkitOverflowScrolling: "touch" } as const;
const COST_CONTAINER_SX = { WebkitOverflowScrolling: "touch" } as const;
const TABLE_SX = { minWidth: { xs: 660, md: "auto" } } as const;
// Stryker restore all

/** No group is open: the stand-in when the caller passes no `expanded` set. */
const NONE_OPEN: ReadonlySet<GroupKey | null> = new Set();

/**
 * One side's figures summed from the initiatives beneath, shown in place of
 * an empty table: one row per fiscal year and the side's total.
 */
export interface DerivedTable {
  rows: DerivedYearRow[];
  totals: BudgetTotals;
}

/** What both tables share. */
interface CostTableCommon {
  /**
   * Figures from the initiatives beneath, when this side is derived: they
   * replace the "no lines" row and the footer reads their total, in italic.
   */
  derived?: DerivedTable | null;
  /** How many initiatives lie beneath (the derived caption names it). */
  derivedCount?: number;
  /** No add / edit / delete buttons and no actions column. */
  readOnly?: boolean;
  /** Every fiscal-year group open, no toggles, descriptions in full. */
  expandAll?: boolean;
  /** The groups shown open (ignored with `expandAll`). */
  expanded?: ReadonlySet<GroupKey | null>;
  /** A year's toggle was clicked. */
  onToggle?: (key: GroupKey) => void;
}

/** The table's label for a group: its fiscal year's name, or "Undated". */
function useGroupLabel() {
  const { t } = useTranslation("ppm");
  const { month: fyStart } = useFiscalYearStart();
  return (key: GroupKey) => (key === "undated" ? t("undated") : fiscalYearLabel(key, fyStart, t));
}

/**
 * In place of an empty table's "no lines" row: one read-only row per fiscal
 * year of the initiatives beneath, under a caption saying so. No toggles,
 * no edit or delete — adding a line of its own is how the initiative takes
 * the figure back.
 */
function DerivedRows({
  side,
  rows,
  labelSpan,
  count,
  readOnly,
}: {
  side: DerivedSide;
  rows: DerivedYearRow[];
  labelSpan: number;
  count?: number;
  readOnly: boolean;
}) {
  const { t } = useTranslation("ppm");
  const { fmt } = useCurrency();
  const groupLabel = useGroupLabel();
  return (
    <>
      <TableRow data-derived={side}>
        <TableCell colSpan={labelSpan + (readOnly ? 3 : 4)}>
          <Box sx={DERIVED_CAPTION_SX}>
            <MaterialSymbol icon="subdirectory_arrow_right" size={18} />
            <Typography variant="body2" color="text.secondary">
              {t(side === "budget" ? "derivedBudgetCaption" : "derivedCostCaption", { count })}
            </Typography>
          </Box>
        </TableCell>
      </TableRow>
      {rows.map((row) => (
        <TableRow key={row.key} data-derived-row={side}>
          <TableCell colSpan={labelSpan}>{groupLabel(row.key)}</TableCell>
          <TableCell align="right" sx={DERIVED_NUM_SX}>
            {fmt.format(row.capex)}
          </TableCell>
          <TableCell align="right" sx={DERIVED_NUM_SX}>
            {fmt.format(row.opex)}
          </TableCell>
          <TableCell align="right" sx={DERIVED_NUM_SX}>
            {fmt.format(row.total)}
          </TableCell>
          {!readOnly && <TableCell />}
        </TableRow>
      ))}
    </>
  );
}

/**
 * A line's amount under its category's column; one whose category is
 * neither shows it under Total, the only figure it counts towards.
 */
function AmountCells({ amount, category }: { amount: number; category: string }) {
  const { fmt } = useCurrency();
  const bucket = bucketFor(category);
  const text = fmt.format(amount);
  return (
    <>
      <TableCell align="right" sx={NUM_SX}>
        {bucket === "capex" ? text : ""}
      </TableCell>
      <TableCell align="right" sx={NUM_SX}>
        {bucket === "opex" ? text : ""}
      </TableCell>
      <TableCell align="right" sx={NUM_SX}>
        {bucket === null ? text : ""}
      </TableCell>
    </>
  );
}

/** A year group's subtotals, in the header row. */
function SubtotalCells({ totals }: { totals: BudgetTotals }) {
  const { fmt } = useCurrency();
  return (
    <>
      <TableCell align="right" sx={SUBTOTAL_SX}>
        {fmt.format(totals.capex)}
      </TableCell>
      <TableCell align="right" sx={SUBTOTAL_SX}>
        {fmt.format(totals.opex)}
      </TableCell>
      <TableCell align="right" sx={SUBTOTAL_SX}>
        {fmt.format(totals.total)}
      </TableCell>
    </>
  );
}

/** The first cell of a year's header row: its toggle (unless all are open), name and line count. */
function GroupTitleCell({
  groupKey,
  count,
  open,
  toggleable,
  onToggle,
  colSpan = 1,
}: {
  groupKey: GroupKey;
  count: number;
  open: boolean;
  toggleable: boolean;
  onToggle?: (key: GroupKey) => void;
  colSpan?: number;
}) {
  const { t } = useTranslation("ppm");
  const label = useGroupLabel()(groupKey);
  return (
    <TableCell colSpan={colSpan}>
      <Box display="flex" alignItems="center" gap={0.5}>
        {toggleable && (
          <IconButton
            size="small"
            aria-expanded={open}
            aria-label={t("toggleYear", { year: label })}
            onClick={() => onToggle?.(groupKey)}
          >
            <MaterialSymbol icon={open ? "expand_more" : "chevron_right"} size={18} />
          </IconButton>
        )}
        <Typography variant="body2" fontWeight={700}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={LINE_COUNT_SX}>
          {t("lineCount", { count })}
        </Typography>
      </Box>
    </TableCell>
  );
}

/** A line's description: clipped to one line with a tooltip, or in full. */
function DescriptionCell({ text, full }: { text: string; full: boolean }) {
  return (
    <TableCell sx={full ? undefined : DESCRIPTION_CELL_SX}>
      <Typography
        variant="body2"
        noWrap={!full}
        title={full ? undefined : text}
        sx={full ? FULL_DESCRIPTION_SX : undefined}
      >
        <LinkifiedText text={text} />
      </Typography>
    </TableCell>
  );
}

/** A line's edit and delete buttons. */
function LineActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  // Stryker disable next-line StringLiteral: equivalent, both keys name their namespace ("common:"), so the default namespace is never read
  const { t } = useTranslation("ppm");
  return (
    <TableCell>
      <Box display="flex" gap={0.5}>
        <IconButton size="small" aria-label={t("common:actions.edit")} onClick={onEdit}>
          <MaterialSymbol icon="edit" size={16} />
        </IconButton>
        <IconButton size="small" aria-label={t("common:actions.delete")} onClick={onDelete}>
          <MaterialSymbol icon="delete" size={16} />
        </IconButton>
      </Box>
    </TableCell>
  );
}

/** The grand-total footer row. */
function FooterRow({
  labelSpan,
  totals,
  derived,
  readOnly,
  figure,
}: {
  labelSpan: number;
  totals: BudgetTotals;
  derived: boolean;
  readOnly: boolean;
  figure: (n: number) => ReactNode;
}) {
  const { t } = useTranslation("ppm");
  const sx = derived ? DERIVED_FOOTER_CELL_SX : FOOTER_CELL_SX;
  return (
    <TableFooter>
      <TableRow sx={FOOTER_ROW_SX}>
        <TableCell colSpan={labelSpan} sx={FOOTER_CELL_SX}>
          {t("totalAllYears")}
        </TableCell>
        <TableCell align="right" sx={sx}>
          {figure(totals.capex)}
        </TableCell>
        <TableCell align="right" sx={sx}>
          {figure(totals.opex)}
        </TableCell>
        <TableCell align="right" sx={sx}>
          {figure(totals.total)}
        </TableCell>
        {!readOnly && <TableCell />}
      </TableRow>
    </TableFooter>
  );
}

export interface BudgetTableProps extends CostTableCommon {
  /** The budget lines grouped by fiscal year (`groupBudgetLines`). */
  groups: LineGroup<PpmBudgetLine>[];
  /** False until the budget lines have loaded: the figures read "—", never $0. */
  known?: boolean;
  /** The budget lines are loading (a progress row shows while not `known`). */
  loading?: boolean;
  /** "+" on a year's row: add a line to that fiscal year. */
  onAdd?: (fiscalYear: number) => void;
  onEdit?: (line: PpmBudgetLine) => void;
  onDelete?: (id: string) => void;
}

/** Planned budget lines, grouped by fiscal year. */
export function BudgetTable({
  groups,
  known = true,
  loading = false,
  derived = null,
  derivedCount,
  readOnly = false,
  expandAll = false,
  expanded = NONE_OPEN,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: BudgetTableProps) {
  const { t } = useTranslation("ppm");
  const { fmt } = useCurrency();
  const groupLabel = useGroupLabel();
  const grand = useMemo(() => grandTotals(groups), [groups]);
  const columns = readOnly ? 4 : 5;
  const figure = (n: number) => (known ? fmt.format(n) : "—");
  const hasLines = groups.length > 0;

  return (
    <TableContainer
      data-testid="ppm-budget-table"
      component={Paper}
      variant="outlined"
      sx={BUDGET_CONTAINER_SX}
    >
      <Table size="small" sx={TABLE_SX}>
        <TableHead>
          <TableRow>
            <TableCell>{t("common:labels.description")}</TableCell>
            <TableCell align="right">{t("capex")}</TableCell>
            <TableCell align="right">{t("opex")}</TableCell>
            <TableCell align="right">{t("total")}</TableCell>
            {!readOnly && <TableCell width={80} />}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            const open = expandAll || expanded.has(g.key);
            const year = g.key as number;
            return (
              <Fragment key={g.key}>
                <TableRow data-year-row data-export-heading sx={YEAR_ROW_SX}>
                  <GroupTitleCell
                    groupKey={g.key}
                    count={g.lines.length}
                    open={open}
                    toggleable={!expandAll}
                    onToggle={onToggle}
                  />
                  <SubtotalCells totals={g.totals} />
                  {!readOnly && (
                    <TableCell>
                      <IconButton
                        size="small"
                        aria-label={t("addLineForYear", { year: groupLabel(g.key) })}
                        onClick={() => onAdd?.(year)}
                      >
                        <MaterialSymbol icon="add" size={16} />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
                {open &&
                  g.lines.map((bl) => (
                    <TableRow key={bl.id} hover>
                      <DescriptionCell text={bl.description ?? ""} full={expandAll} />
                      <AmountCells amount={bl.amount} category={bl.category} />
                      {!readOnly && (
                        <LineActions
                          onEdit={() => onEdit?.(bl)}
                          onDelete={() => onDelete?.(bl.id)}
                        />
                      )}
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
          {!known && loading && (
            <TableRow>
              <TableCell colSpan={columns} sx={LOADING_CELL_SX}>
                <LinearProgress />
              </TableCell>
            </TableRow>
          )}
          {derived && (
            <DerivedRows
              side="budget"
              rows={derived.rows}
              labelSpan={1}
              count={derivedCount}
              readOnly={readOnly}
            />
          )}
          {known && !hasLines && !derived && (
            <TableRow>
              <TableCell colSpan={columns} align="center" sx={EMPTY_CELL_SX}>
                <Typography variant="body2" color="text.secondary">
                  {t("noBudgetLines")}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {(!known || hasLines || derived) && (
          <FooterRow
            labelSpan={1}
            totals={derived ? derived.totals : grand}
            derived={!!derived}
            readOnly={readOnly}
            figure={figure}
          />
        )}
      </Table>
    </TableContainer>
  );
}

export interface CostTableProps extends CostTableCommon {
  /** The cost lines grouped by fiscal year (`groupCostLines`). */
  groups: LineGroup<PpmCostLine>[];
  onEdit?: (line: PpmCostLine) => void;
  onDelete?: (id: string) => void;
}

/** Cost items (actuals), grouped by the fiscal year of their date. */
export function CostTable({
  groups,
  derived = null,
  derivedCount,
  readOnly = false,
  expandAll = false,
  expanded = NONE_OPEN,
  onToggle,
  onEdit,
  onDelete,
}: CostTableProps) {
  const { t } = useTranslation("ppm");
  const { fmt } = useCurrency();
  const { formatDate } = useDateFormat();
  const grand = useMemo(() => grandTotals(groups), [groups]);
  const hasLines = groups.length > 0;

  return (
    <TableContainer
      data-testid="ppm-cost-table"
      component={Paper}
      variant="outlined"
      sx={COST_CONTAINER_SX}
    >
      <Table size="small" sx={TABLE_SX}>
        <TableHead>
          <TableRow>
            <TableCell>{t("common:labels.description")}</TableCell>
            <TableCell>{t("date")}</TableCell>
            <TableCell align="right">{t("capex")}</TableCell>
            <TableCell align="right">{t("opex")}</TableCell>
            <TableCell align="right">{t("total")}</TableCell>
            {!readOnly && <TableCell width={80} />}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            const open = expandAll || expanded.has(g.key);
            return (
              <Fragment key={g.key}>
                <TableRow data-year-row data-export-heading sx={YEAR_ROW_SX}>
                  <GroupTitleCell
                    groupKey={g.key}
                    count={g.lines.length}
                    open={open}
                    toggleable={!expandAll}
                    onToggle={onToggle}
                    colSpan={2}
                  />
                  <SubtotalCells totals={g.totals} />
                  {!readOnly && <TableCell />}
                </TableRow>
                {open &&
                  g.lines.map((cl) => (
                    <TableRow key={cl.id} hover>
                      <DescriptionCell text={cl.description} full={expandAll} />
                      <TableCell>{cl.date ? formatDate(cl.date) : "—"}</TableCell>
                      <AmountCells amount={cl.actual} category={cl.category} />
                      {!readOnly && (
                        <LineActions
                          onEdit={() => onEdit?.(cl)}
                          onDelete={() => onDelete?.(cl.id)}
                        />
                      )}
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
          {derived && (
            <DerivedRows
              side="cost"
              rows={derived.rows}
              labelSpan={2}
              count={derivedCount}
              readOnly={readOnly}
            />
          )}
          {!hasLines && !derived && (
            <TableRow>
              <TableCell colSpan={readOnly ? 5 : 6} align="center" sx={EMPTY_CELL_SX}>
                <Typography variant="body2" color="text.secondary">
                  {t("noCostLines")}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {(hasLines || derived) && (
          <FooterRow
            labelSpan={2}
            totals={derived ? derived.totals : grand}
            derived={!!derived}
            readOnly={readOnly}
            figure={(n) => fmt.format(n)}
          />
        )}
      </Table>
    </TableContainer>
  );
}
