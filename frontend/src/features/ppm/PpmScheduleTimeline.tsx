/**
 * An initiative's work packages and tasks on one read-only timeline: the
 * Initiative Report's Tasks & Schedule section.
 *
 * One more MUI `Table` of the report's family (§3.6: outlined container,
 * `size="small"`, header on `action.hover`): a real `<thead>`, so the scale
 * repeats at the top of every printed page the schedule spans. The timeline
 * lane is drawn as the Portfolio board (`PpmPortfolioView.tsx`) draws it:
 * the quarters (`Q1'26`) at their start, 16 px bars at percentage positions
 * and the board's faint red now line through every lane. Rows follow
 * `scheduleRows`: each work package, its tasks beneath it, then its child
 * packages, indented by depth; tasks in no package come last under their own
 * heading.
 *
 * - A work package's bar is a light track filled to its completion, and its
 *   completion reads off a `PercentBar` in the Progress column.
 * - A task's bar is its status colour, its status and priority are the task
 *   board's chips.
 * - A milestone is the Gantt chart's diamond at its date, and a smaller one
 *   before its title; an item with one date gets a small marker there; an
 *   item with none gets no bar. A shape, not an icon, so it survives the
 *   PowerPoint export (which drops icon-font glyphs).
 * - When nothing has a date the lane column is left out.
 *
 * Every row is a `<tr>` carrying `data-export-row`, the print stylesheet's
 * "do not split" unit; a group heading row also carries `data-export-heading`,
 * so the deck never ends a slide on it. Positions use logical insets, so the scale runs right to left in a
 * right-to-left language with no second code path.
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PercentBar } from "@/components/PercentBar";
import { useDateFormat } from "@/hooks/useDateFormat";
import { brand, iconSize } from "@/theme/tokens";
import type { PpmTask, PpmTaskStatus, PpmWbs } from "@/types";
import {
  milestonePosition,
  scheduleRows,
  taskSpan,
  timelineModel,
  timelinePosition,
  wbsSpan,
  type ScheduleRow,
  type TimelineModel,
  type TimelineSpan,
} from "./ppmReportModel";
import { TaskPriorityChip, TaskStatusChip } from "./ppmTaskChips";
import { taskStatusColor, taskStatusLabelKey } from "./ppmTaskModel";

export interface PpmScheduleTimelineProps {
  wbs: readonly PpmWbs[];
  tasks: readonly PpmTask[];
  /** "Today" for the now line; the current time when omitted. */
  now?: Date;
}

/** A milestone's diamond: its side, in the lane and before its title. */
export const MILESTONE_SIZE = { lane: 12, title: 9 } as const;

/** Beyond this many quarters only each year's first quarter is labelled. */
export const COMPACT_QUARTERS_OVER = 12;

const TASK_STATUSES: readonly PpmTaskStatus[] = ["todo", "in_progress", "done", "blocked"];

/** Fixed column widths; the lane takes what is left (`tableLayout: fixed`). */
const TITLE_WIDTH = "30%";
const PROGRESS_WIDTH = 132;
const PRIORITY_WIDTH = 104;

/** The header row, as the report's other tables draw theirs. */
const HEAD_ROW_SX = { bgcolor: "action.hover" } as const;

/** A table cell's own 16 px, then 16 px a level, as the Portfolio board nests its tree. */
const indentOf = (depth: number): number => 2 + depth * 2;

/** The lane's drawing area inside its cell: 4 px clear of either border. */
const LANE_AREA_SX = {
  position: "absolute",
  top: 0,
  bottom: 0,
  insetInlineStart: "4px",
  insetInlineEnd: "4px",
} as const;

const ROW_HEIGHT = 44;

const BAR_HEIGHT = 16;
const MARK_SIZE = 10;
/** A work package's track: the brand blue's light step, filled in the brand blue. */
const TRACK_COLOR = brand.primaryLight;
const FILL_COLOR = brand.primary;

const pct = (n: number) => `${n}%`;

// Stryker disable all: static layout of the title cell, the rows, the group headings and the legend (flex, gaps, wrapping, spacing, row height); jsdom does no layout, and the marks' geometry is asserted in PpmScheduleTimeline.test.tsx
const SX = {
  titleCell: { py: 0.75, overflowWrap: "anywhere" },
  titleLine: { display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 },
  titleDiamond: { flexShrink: 0, mx: 0.5 },
  titleText: { minWidth: 0 },
  row: { height: ROW_HEIGHT },
  heading: { display: "flex", alignItems: "center", gap: 1 },
  legend: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, mt: 1.5 },
  legendItem: { display: "flex", alignItems: "center", gap: 0.75 },
} as const;
// Stryker restore all

/**
 * A quarter rule: fainter than a year rule (the theme divider, 12 %). Built
 * from the text ink, since `alpha()` of the divider would replace its own
 * opacity rather than reduce it.
 */
const QUARTER_RULE = (ink: string) => alpha(ink, 0.05);

export default function PpmScheduleTimeline({ wbs, tasks, now }: PpmScheduleTimelineProps) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const { formatDate } = useDateFormat();
  // `now` is a value the caller may rebuild every render; key on its time.
  const nowTime = (now ?? new Date()).getTime();

  const { rows, unassigned } = useMemo(() => scheduleRows(wbs, tasks), [wbs, tasks]);
  const model = useMemo(
    () => timelineModel([...wbs.map(wbsSpan), ...tasks.map(taskSpan)], new Date(nowTime)),
    [wbs, tasks, nowTime],
  );
  if (rows.length === 0 && unassigned.length === 0) return null;

  const colCount = model ? 4 : 3;

  const dateLine = (span: TimelineSpan): string | null => {
    if (!span.start && !span.end) return null;
    const from = span.start ? formatDate(span.start) : "";
    const to = span.end ? formatDate(span.end) : "";
    return `${from} – ${to}`.trim();
  };

  const titleCell = (
    title: string,
    depth: number,
    span: TimelineSpan,
    owner: string | null,
    milestone: boolean,
  ) => {
    const dates = dateLine(span);
    return (
      <TableCell
        data-depth={depth}
        sx={{ ...SX.titleCell, pl: indentOf(depth) }}
      >
        <Box sx={SX.titleLine}>
          {milestone && (
            <Box sx={SX.titleDiamond}>
              <MilestoneDiamond size={MILESTONE_SIZE.title} />
            </Box>
          )}
          <Typography variant="body2" fontWeight={depth === 0 ? 600 : 400} sx={SX.titleText}>
            {title}
          </Typography>
        </Box>
        {(dates || owner) && (
          <Typography variant="caption" color="text.secondary" component="div">
            {[dates, owner ? `${t("pdfOwner")}: ${owner}` : null].filter(Boolean).join(" · ")}
          </Typography>
        )}
      </TableCell>
    );
  };

  const lane = (m: TimelineModel, mark: ReactNode) => (
    <TableCell data-lane sx={{ position: "relative", p: 0 }}>
      <Box sx={LANE_AREA_SX}>
        {m.quarters
          .filter((q) => q.startPct > 0)
          .map((q) => (
            <Box
              key={q.label}
              data-rule={q.yearStart ? "year" : "quarter"}
              sx={{
                position: "absolute",
                insetInlineStart: pct(q.startPct),
                top: 0,
                bottom: 0,
                width: "1px",
                bgcolor: q.yearStart
                  ? theme.palette.divider
                  : QUARTER_RULE(theme.palette.text.primary),
              }}
            />
          ))}
        {mark}
        {m.todayPct !== null && (
          <Box
            data-now-line
            sx={{
              position: "absolute",
              insetInlineStart: pct(m.todayPct),
              top: 0,
              bottom: 0,
              width: 1.5,
              bgcolor: theme.palette.error.main,
              opacity: 0.3,
              zIndex: 1,
              pointerEvents: "none",
            }}
          />
        )}
      </Box>
    </TableCell>
  );

  /** A dot at a single date, centred on it. */
  const point = (atPct: number, color: string) => (
    <Box
      data-mark="point"
      sx={{
        position: "absolute",
        insetInlineStart: pct(atPct),
        top: "50%",
        width: MARK_SIZE,
        height: MARK_SIZE,
        mt: `${-MARK_SIZE / 2}px`,
        marginInlineStart: `${-MARK_SIZE / 2}px`,
        borderRadius: "50%",
        bgcolor: color,
      }}
    />
  );

  const bar = (startPct: number, widthPct: number, color: string, children?: ReactNode) => (
    <Box
      data-mark="bar"
      sx={{
        position: "absolute",
        insetInlineStart: pct(startPct),
        width: pct(widthPct),
        top: "50%",
        height: BAR_HEIGHT,
        mt: `${-BAR_HEIGHT / 2}px`,
        borderRadius: 2,
        bgcolor: color,
        opacity: 0.9,
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );

  const wbsMark = (m: TimelineModel, w: PpmWbs): ReactNode => {
    if (w.is_milestone) {
      const at = milestonePosition(m, w);
      return at === null ? null : (
        <Box
          data-mark="milestone"
          sx={{
            position: "absolute",
            insetInlineStart: pct(at),
            top: "50%",
            mt: `${-MILESTONE_SIZE.lane / 2}px`,
            marginInlineStart: `${-MILESTONE_SIZE.lane / 2}px`,
            display: "flex",
          }}
        >
          <MilestoneDiamond size={MILESTONE_SIZE.lane} />
        </Box>
      );
    }
    const pos = timelinePosition(m, wbsSpan(w));
    if (!pos) return null;
    if ("atPct" in pos) return point(pos.atPct, FILL_COLOR);
    const fill = Math.min(Math.max(w.completion, 0), 100);
    return bar(
      pos.startPct,
      pos.widthPct,
      TRACK_COLOR,
      <Box
        data-fill
        sx={{
          position: "absolute",
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          width: pct(fill),
          bgcolor: FILL_COLOR,
        }}
      />,
    );
  };

  const taskMark = (m: TimelineModel, task: PpmTask): ReactNode => {
    const pos = timelinePosition(m, taskSpan(task));
    const color = taskStatusColor(task.status);
    if (!pos) return null;
    return "atPct" in pos ? point(pos.atPct, color) : bar(pos.startPct, pos.widthPct, color);
  };

  const renderRow = (row: ScheduleRow) => {
    if (row.kind === "wbs") {
      const w = row.item;
      return (
        <TableRow key={`w-${w.id}`} data-export-row data-kind="wbs" sx={SX.row}>
          {titleCell(w.title, row.depth, wbsSpan(w), w.assignee_name, w.is_milestone)}
          {model && lane(model, wbsMark(model, w))}
          <TableCell>
            <PercentBar value={w.completion} />
          </TableCell>
          <TableCell />
        </TableRow>
      );
    }
    const task = row.item;
    return (
      <TableRow key={`t-${task.id}`} data-export-row data-kind="task" sx={SX.row}>
        {titleCell(task.title, row.depth, taskSpan(task), task.assignee_name, false)}
        {model && lane(model, taskMark(model, task))}
        <TableCell>
          <TaskStatusChip status={task.status} />
        </TableCell>
        <TableCell>
          <TaskPriorityChip priority={task.priority} />
        </TableCell>
      </TableRow>
    );
  };

  /** A group heading row, as the cost tables head a fiscal year: on `action.hover`. */
  const groupHeader = (icon: string, label: string, count: number) => (
    <TableRow data-export-row data-export-heading data-group sx={HEAD_ROW_SX}>
      <TableCell colSpan={colCount}>
        <Box sx={SX.heading}>
          <MaterialSymbol icon={icon} size={iconSize.sm} color={theme.palette.action.active} />
          <Typography variant="body2" fontWeight={600}>
            {label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {count}
          </Typography>
        </Box>
      </TableCell>
    </TableRow>
  );

  const showQuarterLabel = (m: TimelineModel, index: number) =>
    m.quarters.length <= COMPACT_QUARTERS_OVER || index === 0 || m.quarters[index].yearStart;

  return (
    <Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ tableLayout: "fixed", minWidth: model ? 760 : 480 }}>
          <TableHead>
            <TableRow data-schedule-head sx={HEAD_ROW_SX}>
              <TableCell sx={{ width: model ? TITLE_WIDTH : undefined }}>{t("wbsTitle")}</TableCell>
              {model && (
                <TableCell data-scale sx={{ position: "relative", p: 0 }}>
                  <Box sx={LANE_AREA_SX}>
                    {model.quarters.map((q, index) =>
                      showQuarterLabel(model, index) ? (
                        <Typography
                          key={q.label}
                          data-qlabel
                          variant="caption"
                          fontWeight={600}
                          sx={{
                            position: "absolute",
                            insetInlineStart: pct(q.startPct),
                            bottom: 6,
                            px: 0.5,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {q.label}
                        </Typography>
                      ) : null,
                    )}
                  </Box>
                </TableCell>
              )}
              <TableCell sx={{ width: PROGRESS_WIDTH }}>{t("pdfProgress")}</TableCell>
              <TableCell sx={{ width: PRIORITY_WIDTH }}>{t("taskPriority")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length > 0 &&
              unassigned.length > 0 &&
              groupHeader("account_tree", t("wbs"), rows.length)}
            {rows.map(renderRow)}
            {unassigned.length > 0 &&
              rows.length > 0 &&
              groupHeader("assignment", t("unassigned"), unassigned.length)}
            {
              // Stryker disable next-line StringLiteral: equivalent, renderRow branches on `kind === "wbs"` alone, so any other kind renders the task row
              unassigned.map((task) => renderRow({ kind: "task", item: task, depth: 0 }))
            }
          </TableBody>
        </Table>
      </TableContainer>
      {model && <ScheduleLegend today={model.todayPct !== null} />}
    </Box>
  );
}

/**
 * A milestone as the Gantt chart draws one: a square turned 45°, in the brand
 * blue. `size` is the square's side, so the diamond spans `size × √2`.
 */
export function MilestoneDiamond({ size }: { size: number }) {
  return (
    <Box
      data-milestone-diamond
      sx={{
        width: size,
        height: size,
        transform: "rotate(45deg)",
        bgcolor: FILL_COLOR,
      }}
    />
  );
}

/** What the timeline's marks mean, drawn as the risk matrix's legend is: swatch, then caption. */
function ScheduleLegend({ today }: { today: boolean }) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const swatch = (sx: Record<string, unknown>, children?: ReactNode) => (
    <Box
      data-legend-swatch
      sx={{
        width: 14,
        height: 14,
        borderRadius: 0.5,
        position: "relative",
        overflow: "hidden",
        ...sx,
      }}
    >
      {children}
    </Box>
  );
  const items: { key: string; label: string; mark: ReactNode }[] = [
    {
      key: "wbs",
      label: t("pdfLegendWorkPackage"),
      mark: swatch(
        { bgcolor: TRACK_COLOR },
        <Box
          sx={{
            position: "absolute",
            insetInlineStart: 0,
            top: 0,
            bottom: 0,
            width: "50%",
            bgcolor: FILL_COLOR,
          }}
        />,
      ),
    },
    ...TASK_STATUSES.map((status) => ({
      key: status,
      label: `${t("pdfLegendTask")}: ${t(taskStatusLabelKey(status) ?? status)}`,
      mark: swatch({ bgcolor: taskStatusColor(status) }),
    })),
    {
      key: "milestone",
      label: t("milestone"),
      mark: <MilestoneDiamond size={MILESTONE_SIZE.title} />,
    },
    {
      key: "point",
      label: t("pdfLegendOneDate"),
      mark: swatch({
        bgcolor: FILL_COLOR,
        borderRadius: "50%",
        width: MARK_SIZE,
        height: MARK_SIZE,
      }),
    },
  ];
  if (today) {
    items.push({
      key: "today",
      label: t("pdfToday"),
      mark: swatch({ width: 2, borderRadius: 0, bgcolor: theme.palette.error.main }),
    });
  }
  return (
    <Box
      data-schedule-legend
      sx={SX.legend}
    >
      {items.map((item) => (
        <Box
          key={item.key}
          data-legend-item={item.key}
          sx={SX.legendItem}
        >
          {item.mark}
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
