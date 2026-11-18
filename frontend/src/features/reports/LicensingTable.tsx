import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { formatPct, pairKey, STATUS_LABEL_KEY, STATUS_ORDER, statusColor } from "@/lib/licenses";
import type { LicenseReportRow, LicenseStatus, LicenseTypeResult } from "@/types";

export interface LicensingTableRow {
  id: string;
  name: string;
  type: string;
  group?: string;
  status: LicenseStatus;
  raw: LicenseReportRow;
}

export interface LicensingTableProps {
  rows: LicensingTableRow[];
  /** The `metric:type` pairs shown as column groups, in catalogue order, labelled `Metric: Type`. */
  pairs: { key: string; metric: string; label: string }[];
  /** The metrics those pairs belong to; each has its own totals, never one across metrics. */
  metrics: { key: string; label: string }[];
  /** Group headers in display order; rows are matched on `row.group`. */
  groups?: { key: string; label: string }[];
  extraColumns: string[];
  extraLabel: (fieldKey: string) => string;
  extraValue: (row: LicensingTableRow, fieldKey: string) => string;
  typeOf: (typeKey: string) => { icon: string; label: string } | null;
  /** False for a Platform aggregate, which has no status. */
  showStatus: boolean;
  sortK: string;
  sortD: "asc" | "desc";
  onSort: (key: string) => void;
  onOpen: (cardId: string) => void;
  onDrill: (target: { id: string } | { group: string }) => void;
}

const DASH = "—";
const num = (v: number | null | undefined) => (v == null ? DASH : String(v));

/** Sum of the counts; `null` when none of them exists (no actual recorded at all). */
function sumOrNull(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

type Pair = LicensingTableProps["pairs"][number];
type Count = number | null | undefined;

export default function LicensingTable({
  rows,
  pairs,
  metrics,
  groups,
  extraColumns,
  extraLabel,
  extraValue,
  typeOf,
  showStatus,
  sortK,
  sortD,
  onSort,
  onOpen,
  onDrill,
}: LicensingTableProps) {
  const { t } = useTranslation(["reports", "common"]);

  const cellOf = (r: LicensingTableRow, p: Pair): LicenseTypeResult | undefined =>
    r.raw.by_metric
      .find((m) => m.metric === p.metric)
      ?.types.find((x) => pairKey(p.metric, x.key) === p.key);
  const licensedOf = (r: LicensingTableRow, p: Pair) => cellOf(r, p)?.licensed;
  const actualOf = (r: LicensingTableRow, p: Pair) => cellOf(r, p)?.actual;
  const totalLic = (r: LicensingTableRow, metric: string) =>
    r.raw.by_metric.find((m) => m.metric === metric)?.licensed_total;
  const totalAct = (r: LicensingTableRow, metric: string) =>
    r.raw.by_metric.find((m) => m.metric === metric)?.actual_total;

  // The value a column sorts on; a missing figure sorts as the lowest one.
  const sortValue = (r: LicensingTableRow): string | number => {
    if (sortK === "name") return r.name;
    if (sortK === "status") return STATUS_ORDER.indexOf(r.status);
    // `kind:rest`, where rest is a metric key or a `metric:type` pair key.
    const at = sortK.indexOf(":");
    const kind = sortK.slice(0, at);
    const rest = sortK.slice(at + 1);
    if (kind === "tlic") return totalLic(r, rest) ?? 0;
    if (kind === "tact") return totalAct(r, rest) ?? -1;
    const p = pairs.find((x) => x.key === rest);
    if (!p) return 0;
    if (kind === "lic") return licensedOf(r, p) ?? 0;
    if (kind === "act") return actualOf(r, p) ?? -1;
    if (kind === "pct") {
      const c = cellOf(r, p);
      return c?.no_licence ? Number.POSITIVE_INFINITY : (c?.pct ?? -1);
    }
    return 0;
  };
  const byColumn = (a: LicensingTableRow, b: LicensingTableRow) => {
    const d = sortD === "asc" ? 1 : -1;
    const va = sortValue(a);
    const vb = sortValue(b);
    if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * d;
    return ((va as number) - (vb as number)) * d;
  };

  const sortHead = (key: string, label: string, align: "left" | "right" = "right") => (
    <TableCell key={key} align={align}>
      <TableSortLabel
        active={sortK === key}
        direction={sortK === key ? sortD : "asc"}
        onClick={() => onSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const typeBadge = (r: LicensingTableRow) => {
    const tp = typeOf(r.type);
    return tp ? (
      <Typography
        component="span"
        variant="caption"
        color="text.secondary"
        sx={{ ml: 1, display: "inline-flex", alignItems: "center", gap: 0.5, verticalAlign: "middle" }}
      >
        <MaterialSymbol icon={tp.icon} size={14} />
        {tp.label}
      </Typography>
    ) : null;
  };

  // The counts of each pair, then the totals of each metric: the same cells in a card row and a total row.
  const countCells = (
    lic: (p: Pair) => Count,
    act: (p: Pair) => Count,
    pct: ((p: Pair) => string) | null,
    totals: (metric: string) => [Count, Count],
    strong = false,
  ) => {
    const sx = strong ? { fontWeight: 700 } : undefined;
    return (
      <>
        {pairs.map((p) => (
          <Fragment key={p.key}>
            <TableCell align="right" sx={sx}>{num(lic(p))}</TableCell>
            <TableCell align="right" sx={sx}>{num(act(p))}</TableCell>
            <TableCell align="right" sx={sx}>{pct ? pct(p) : ""}</TableCell>
          </Fragment>
        ))}
        {metrics.map((m) => (
          <Fragment key={m.key}>
            <TableCell align="right" sx={sx}>{num(totals(m.key)[0])}</TableCell>
            <TableCell align="right" sx={sx}>{num(totals(m.key)[1])}</TableCell>
          </Fragment>
        ))}
      </>
    );
  };

  const cardRow = (r: LicensingTableRow, indent: boolean) => (
    <TableRow
      key={r.id}
      hover
      sx={{ cursor: "pointer" }}
      onClick={() => onOpen(r.id)}
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault();
        onDrill({ id: r.id });
      }}
    >
      <TableCell sx={{ fontWeight: 500, ...(indent && { pl: 4 }) }}>
        <span data-testid="licensing-row-name">{r.name}</span>
        {typeBadge(r)}
      </TableCell>
      {countCells(
        (p) => licensedOf(r, p),
        (p) => actualOf(r, p),
        (p) => {
          const c = cellOf(r, p);
          return c ? formatPct(c.pct, c.no_licence, t) : DASH;
        },
        (m) => [totalLic(r, m), totalAct(r, m)],
      )}
      {showStatus && (
        <TableCell>
          <Chip
            size="small"
            variant="outlined"
            label={t(STATUS_LABEL_KEY[r.status])}
            sx={{ borderColor: statusColor(r.status), color: statusColor(r.status) }}
          />
        </TableCell>
      )}
      {extraColumns.map((key) => (
        <TableCell key={key} align="right">
          {extraValue(r, key)}
        </TableCell>
      ))}
    </TableRow>
  );

  const totalsCells = (members: LicensingTableRow[]) => (
    <>
      {countCells(
        (p) => sumOrNull(members.map((m) => licensedOf(m, p))) ?? 0,
        (p) => sumOrNull(members.map((m) => actualOf(m, p))),
        null,
        (metric) => [
          sumOrNull(members.map((m) => totalLic(m, metric))) ?? 0,
          sumOrNull(members.map((m) => totalAct(m, metric))),
        ],
        true,
      )}
      {showStatus && <TableCell />}
      {extraColumns.map((key) => (
        <TableCell key={key} sx={{ fontWeight: 700 }} />
      ))}
    </>
  );

  const sorted = [...rows].sort(byColumn);

  return (
    <Paper variant="outlined" sx={{ overflow: "auto" }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {sortHead("name", t("common:labels.name"), "left")}
            {pairs.map((p) => (
              <Fragment key={p.key}>
                {sortHead(`lic:${p.key}`, t("licensing.colLic", { label: p.label }))}
                {sortHead(`act:${p.key}`, t("licensing.colAct", { label: p.label }))}
                {sortHead(`pct:${p.key}`, t("licensing.colPct", { label: p.label }))}
              </Fragment>
            ))}
            {metrics.map((m) => (
              <Fragment key={m.key}>
                {sortHead(`tlic:${m.key}`, t("licensing.metricTotalLic", { label: m.label }))}
                {sortHead(`tact:${m.key}`, t("licensing.metricTotalAct", { label: m.label }))}
              </Fragment>
            ))}
            {showStatus && sortHead("status", t("licensing.status"), "left")}
            {extraColumns.map((key) => (
              <TableCell key={key} align="right">
                {extraLabel(key)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups
            ? groups.map((g) => {
                const members = sorted.filter((r) => r.group === g.key);
                return (
                  <Fragment key={g.key}>
                    <TableRow
                      hover
                      sx={{ bgcolor: "action.hover", cursor: "pointer" }}
                      onContextMenu={(e: React.MouseEvent) => {
                        e.preventDefault();
                        onDrill({ group: g.key });
                      }}
                    >
                      <TableCell sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        {g.label}
                        <Box component="span" sx={{ ml: 1, color: "text.secondary", fontSize: "0.75rem" }}>
                          ({members.length})
                        </Box>
                      </TableCell>
                      {totalsCells(members)}
                    </TableRow>
                    {members.map((r) => cardRow(r, true))}
                  </Fragment>
                );
              })
            : sorted.map((r) => cardRow(r, false))}
          <TableRow sx={{ bgcolor: "action.selected" }} data-testid="licensing-total-row">
            <TableCell sx={{ fontWeight: 700 }}>{t("cost.total")}</TableCell>
            {totalsCells(rows)}
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  );
}
