/**
 * ResourcesStatsPanel — storage & usage summary above the repository-wide
 * Resources grid. KPI tiles reuse the shared `MetricCard`; the breakdown
 * tables are collapsed by default so the grid stays the focus.
 *
 * The figures honour the active filters (same contract as the Risk
 * Register's KPI tiles), so a "filtered" chip appears whenever the numbers
 * describe a subset rather than the whole workspace.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { formatBytes, type ByteUnitKey } from "@/lib/formatBytes";
import type { ResourceStats } from "@/types";

interface Props {
  stats: ResourceStats | null;
  filtered: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Resolves a card-type key to its translated label (entity-aware). */
  cardTypeLabel: (key: string) => string;
  /** Resolves a file-category / link-type key to its translated label. */
  categoryLabel: (kind: "file" | "link", key: string | null) => string;
  onDownloadFile: (id: string, name: string) => void;
}

export default function ResourcesStatsPanel({
  stats,
  filtered,
  expanded,
  onToggleExpanded,
  cardTypeLabel,
  categoryLabel,
  onDownloadFile,
}: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const unitLabel = (u: ByteUnitKey) => t(`resources.units.${u}`);

  if (!stats) return null;

  const totalCount = stats.file_count + stats.link_count;

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "stretch" }}>
        <MetricCard
          label={t("resources.stats.total")}
          value={totalCount.toLocaleString()}
          icon="folder_open"
        />
        <MetricCard
          label={t("resources.stats.files")}
          value={stats.file_count.toLocaleString()}
          icon="attach_file"
        />
        <MetricCard
          label={t("resources.stats.links")}
          value={stats.link_count.toLocaleString()}
          icon="link"
        />
        <MetricCard
          label={t("resources.stats.storage")}
          value={formatBytes(stats.total_bytes, unitLabel)}
          icon="database"
          iconColor="#7b1fa2"
        />
        <MetricCard
          label={t("resources.stats.cards")}
          value={stats.card_count.toLocaleString()}
          icon="dashboard"
        />
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
        <Button
          size="small"
          onClick={onToggleExpanded}
          startIcon={<MaterialSymbol icon={expanded ? "expand_less" : "expand_more"} size={18} />}
          sx={{ textTransform: "none" }}
        >
          {expanded ? t("resources.stats.hideBreakdown") : t("resources.stats.showBreakdown")}
        </Button>
        {filtered && (
          <Chip size="small" variant="outlined" label={t("resources.stats.filtered")} />
        )}
      </Box>

      <Collapse in={expanded}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
            gap: 1.5,
            mt: 1,
          }}
        >
          <Paper variant="outlined" sx={{ p: 1.5, overflowX: "auto" }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("resources.stats.byCategory")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("resources.columns.category")}</TableCell>
                  <TableCell align="right">{t("resources.stats.count")}</TableCell>
                  <TableCell align="right">{t("resources.stats.storage")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats.by_category.map((b) => (
                  <TableRow key={`file-${b.key ?? "none"}`}>
                    <TableCell>{categoryLabel("file", b.key)}</TableCell>
                    <TableCell align="right">{b.count.toLocaleString()}</TableCell>
                    <TableCell align="right">{formatBytes(b.bytes, unitLabel)}</TableCell>
                  </TableRow>
                ))}
                {stats.by_link_type.map((b) => (
                  <TableRow key={`link-${b.key ?? "none"}`}>
                    <TableCell>{categoryLabel("link", b.key)}</TableCell>
                    <TableCell align="right">{b.count.toLocaleString()}</TableCell>
                    <TableCell align="right">—</TableCell>
                  </TableRow>
                ))}
                {!stats.by_category.length && !stats.by_link_type.length && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        {t("resources.empty")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5, overflowX: "auto" }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("resources.stats.byCardType")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("resources.columns.cardType")}</TableCell>
                  <TableCell align="right">{t("resources.kinds.file")}</TableCell>
                  <TableCell align="right">{t("resources.kinds.link")}</TableCell>
                  <TableCell align="right">{t("resources.stats.storage")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats.by_card_type.map((b) => (
                  <TableRow key={b.key}>
                    <TableCell>{cardTypeLabel(b.key)}</TableCell>
                    <TableCell align="right">{b.file_count.toLocaleString()}</TableCell>
                    <TableCell align="right">{b.link_count.toLocaleString()}</TableCell>
                    <TableCell align="right">{formatBytes(b.bytes, unitLabel)}</TableCell>
                  </TableRow>
                ))}
                {!stats.by_card_type.length && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        {t("resources.empty")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5, overflowX: "auto" }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("resources.stats.largestFiles")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("resources.columns.name")}</TableCell>
                  <TableCell>{t("resources.columns.card")}</TableCell>
                  <TableCell align="right">{t("resources.columns.size")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats.largest_files.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Button
                        size="small"
                        onClick={() => onDownloadFile(f.id, f.name)}
                        sx={{ textTransform: "none", p: 0, minWidth: 0 }}
                      >
                        {f.name}
                      </Button>
                    </TableCell>
                    <TableCell>{f.card_name}</TableCell>
                    <TableCell align="right">{formatBytes(f.size, unitLabel)}</TableCell>
                  </TableRow>
                ))}
                {!stats.largest_files.length && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        {t("resources.empty")}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      </Collapse>
    </Box>
  );
}
