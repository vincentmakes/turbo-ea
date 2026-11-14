/**
 * RiskMatrix — reusable probability × impact heatmap.
 *
 * Used in three surfaces: the Risk Register header, the TurboLens
 * Security Overview (initial levels only), and the Card Detail → Risks
 * tab. Cells can be clicked to filter a companion list; the currently
 * selected cell is outlined until the caller clears it.
 *
 * Without `rows` / `cols` it is the GRC register's 4×4 (probability
 * very_high..low down, impact critical..low across, cells tinted by the
 * derived risk level). A caller with other axes — a PPM initiative's 5×5 —
 * passes `rows`, `cols`, `cellColor` and its own `legendItems`, and gets the
 * same look: tinted cells, counts, "—" for zero, axis labels and the swatch
 * legend beneath. Such a matrix is read-only.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { RiskImpact, RiskProbability } from "@/types";
import RiskMatrixLegend, { type RiskMatrixLegendItem } from "./RiskMatrixLegend";
import { deriveLevelFromPair, riskLevelBackground } from "./riskMatrixColors";

const PROBABILITIES: RiskProbability[] = ["very_high", "high", "medium", "low"];
const IMPACTS: RiskImpact[] = ["critical", "high", "medium", "low"];

export interface RiskMatrixSelection {
  probability: RiskProbability;
  impact: RiskImpact;
}

/** One row or column of a matrix with its own axes: its key and its visible label. */
export interface RiskMatrixAxisItem {
  key: string;
  label: string;
}

interface BaseProps {
  /** Counts, one array per row, one number per column, in display order. */
  matrix: number[][];
  /** Label for the label column (defaults to the translated "Probability"). */
  probabilityAxisLabel?: string;
  impactAxisLabel?: string;
}

/** The GRC register's 4×4: rows = probability (very_high..low), cols = impact (critical..low). */
interface DefaultAxesProps extends BaseProps {
  rows?: undefined;
  cols?: undefined;
  cellColor?: undefined;
  legendItems?: undefined;
  onSelect?: (selection: RiskMatrixSelection | null) => void;
  highlight?: RiskMatrixSelection | null;
}

/** Any other grid: its rows (top to bottom), columns (in reading order) and cell tint. */
interface CustomAxesProps extends BaseProps {
  rows: readonly RiskMatrixAxisItem[];
  cols: readonly RiskMatrixAxisItem[];
  /** The background of the cell at (row, column), whatever it holds. */
  cellColor: (rowKey: string, colKey: string) => string;
  /** The legend beneath the grid. */
  legendItems: readonly RiskMatrixLegendItem[];
  onSelect?: never;
  highlight?: never;
}

export type RiskMatrixProps = DefaultAxesProps | CustomAxesProps;

export default function RiskMatrix(props: RiskMatrixProps) {
  const { matrix, probabilityAxisLabel, impactAxisLabel } = props;
  const { t } = useTranslation("grc");

  const custom = props.rows !== undefined;
  const rows: readonly RiskMatrixAxisItem[] = custom
    ? props.rows
    : PROBABILITIES.map((p) => ({ key: p, label: t(`risks.probability.${p}`) }));
  const cols: readonly RiskMatrixAxisItem[] = custom
    ? props.cols
    : IMPACTS.map((i) => ({ key: i, label: t(`risks.impact.${i}`) }));
  const cellColor = custom
    ? props.cellColor
    : (rowKey: string, colKey: string) =>
        riskLevelBackground(deriveLevelFromPair(rowKey, colKey));
  const onSelect = custom ? undefined : props.onSelect;
  const highlight = custom ? undefined : props.highlight;

  return (
    <Box sx={{ mt: 1 }}>
      <Box
        sx={{
          display: "grid",
          // Narrower label column on phones so the data cells stay legible.
          gridTemplateColumns: {
            xs: `84px repeat(${cols.length}, 1fr)`,
            sm: `130px repeat(${cols.length}, 1fr)`,
          },
          gap: 0.5,
          alignItems: "stretch",
        }}
      >
        <Box sx={{ py: 1, pr: 1, textAlign: "right" }}>
          <Typography variant="caption" color="text.secondary">
            {impactAxisLabel ?? t("risks.matrix.impact")} → /{" "}
            {probabilityAxisLabel ?? t("risks.matrix.probability")} ↓
          </Typography>
        </Box>
        {cols.map((col) => (
          <Typography
            key={col.key}
            variant="caption"
            color="text.secondary"
            align="center"
            sx={{ py: 1 }}
          >
            {col.label}
          </Typography>
        ))}

        {rows.map((row, rowIdx) => (
          <RiskMatrixRow
            key={row.key}
            row={row}
            cols={cols}
            counts={matrix[rowIdx] ?? []}
            cellColor={cellColor}
            onSelect={onSelect}
            highlight={highlight}
          />
        ))}
      </Box>
      <RiskMatrixLegend items={custom ? props.legendItems : undefined} />
    </Box>
  );
}

function RiskMatrixRow({
  row,
  cols,
  counts,
  cellColor,
  onSelect,
  highlight,
}: {
  row: RiskMatrixAxisItem;
  cols: readonly RiskMatrixAxisItem[];
  counts: number[];
  cellColor: (rowKey: string, colKey: string) => string;
  onSelect?: (selection: RiskMatrixSelection | null) => void;
  highlight?: RiskMatrixSelection | null;
}) {
  return (
    <>
      <Box
        sx={{
          py: 1.25,
          px: 1,
          textAlign: "right",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <Typography variant="body2" fontWeight={600}>
          {row.label}
        </Typography>
      </Box>
      {cols.map((col, colIdx) => {
        const count = counts[colIdx] ?? 0;
        const isActive =
          highlight && highlight.probability === row.key && highlight.impact === col.key;
        // Only the default axes take onSelect, so the keys are a probability and an impact.
        const selection = {
          probability: row.key,
          impact: col.key,
        } as RiskMatrixSelection;
        const handleClick = onSelect
          ? () => onSelect(isActive ? null : selection)
          : undefined;
        return (
          <Box
            key={col.key}
            data-row={row.key}
            data-col={col.key}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={handleClick}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleClick?.();
                    }
                  }
                : undefined
            }
            sx={{
              py: 1.25,
              borderRadius: 1,
              textAlign: "center",
              cursor: onSelect ? "pointer" : "default",
              bgcolor: cellColor(row.key, col.key),
              outline: isActive ? "2px solid" : "none",
              outlineColor: "primary.main",
              transition: "outline 120ms",
              "&:hover": onSelect ? { filter: "brightness(1.05)" } : undefined,
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
              },
            }}
          >
            <Typography variant="body2" fontWeight={count > 0 ? 700 : 500}>
              {count || "—"}
            </Typography>
          </Box>
        );
      })}
    </>
  );
}
