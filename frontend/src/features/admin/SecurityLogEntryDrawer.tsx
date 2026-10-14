/**
 * SecurityLogEntryDrawer — right-side drawer opened from the Security & admin
 * grid. Read-only by design: an audit_log row is immutable, so unlike the
 * batch drawer there is no action here.
 *
 * Shows the entry's metadata (the layout of `AuditLogBatchDrawer`) and its
 * `details`: a field/old/new table when every value is an `{old, new}` pair —
 * the shape `audit_log.diff()` writes — and formatted JSON otherwise. A
 * `details.reason` code is pulled out and translated through
 * `securityLog.reasons.*`.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import { originColor } from "./AuditLogBatchDrawer";
import {
  actionLabelKey,
  categoryColor,
  isFieldDiff,
  outcomeColor,
  reasonLabelKey,
  type SecurityLogEntry,
} from "./SecurityLogTypes";

/** A value in a details table cell — scalars inline, anything else as JSON. */
export function formatDetailValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ typography: "body2", wordBreak: "break-word" }}>{children}</Box>
    </Box>
  );
}

function DetailsBlock({ details }: { details: Record<string, unknown> | null }) {
  const { t } = useTranslation("admin");
  const rest = details ? { ...details } : null;
  if (rest) delete rest.reason;
  if (!rest || Object.keys(rest).length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
        {t("securityLog.entry.noDetails")}
      </Typography>
    );
  }
  if (isFieldDiff(rest)) {
    return (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" data-testid="security-details-diff">
          <TableHead>
            <TableRow>
              <TableCell>{t("securityLog.entry.field")}</TableCell>
              <TableCell>{t("securityLog.entry.old")}</TableCell>
              <TableCell>{t("securityLog.entry.new")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(rest).map(([field, change]) => (
              <TableRow key={field}>
                <TableCell>
                  <code style={{ fontSize: 12 }}>{field}</code>
                </TableCell>
                <TableCell sx={{ wordBreak: "break-word" }}>
                  {formatDetailValue(change.old)}
                </TableCell>
                <TableCell sx={{ wordBreak: "break-word" }}>
                  {formatDetailValue(change.new)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }
  return (
    <Box
      component="pre"
      data-testid="security-details-json"
      sx={{
        m: 0,
        p: 1.5,
        fontSize: 12,
        borderRadius: 1,
        bgcolor: "action.hover",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {JSON.stringify(rest, null, 2)}
    </Box>
  );
}

export default function SecurityLogEntryDrawer({
  entry,
  open,
  onClose,
}: {
  entry: SecurityLogEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");
  const { formatDateTime } = useDateFormat();

  if (!entry) return null;
  const empty = t("auditLog.batch.emptyValue");
  const reason =
    entry.details && typeof entry.details.reason === "string" ? entry.details.reason : null;
  const target =
    entry.target_label || entry.target_id
      ? [entry.target_type, entry.target_label ?? entry.target_id].filter(Boolean).join(" · ")
      : null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 560 } } }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" alignItems="center" gap={1}>
          <MaterialSymbol icon="admin_panel_settings" size={22} />
          <Typography variant="h6">{t("securityLog.entry.title")}</Typography>
        </Stack>
        <Tooltip title={t("securityLog.entry.close")}>
          <IconButton onClick={onClose} size="small" aria-label={t("securityLog.entry.close")}>
            <MaterialSymbol icon="close" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ px: 2, py: 2, overflowY: "auto", flex: 1 }}>
        <Stack spacing={1.5}>
          <Meta label={t("securityLog.columns.action")}>
            <Typography variant="body1" fontWeight={600}>
              {t(actionLabelKey(entry.action), { defaultValue: entry.action })}
            </Typography>
            <code style={{ fontSize: 11 }}>{entry.action}</code>
          </Meta>

          <Stack direction="row" gap={2} flexWrap="wrap">
            <Meta label={t("securityLog.columns.category")}>
              <Chip
                size="small"
                label={t(`securityLog.categories.${entry.category}`, {
                  defaultValue: entry.category,
                })}
                variant="outlined"
                sx={{
                  mt: 0.5,
                  borderColor: categoryColor(entry.category),
                  color: categoryColor(entry.category),
                }}
              />
            </Meta>
            <Meta label={t("securityLog.columns.outcome")}>
              <Chip
                size="small"
                label={t(`securityLog.outcomes.${entry.outcome}`, {
                  defaultValue: entry.outcome,
                })}
                sx={{
                  mt: 0.5,
                  bgcolor: outcomeColor(entry.outcome),
                  color: "common.white",
                }}
              />
            </Meta>
            <Meta label={t("securityLog.columns.origin")}>
              {entry.origin ? (
                <Chip
                  size="small"
                  label={entry.origin}
                  color={originColor(entry.origin)}
                  variant={entry.origin === "mcp" ? "filled" : "outlined"}
                  sx={{ mt: 0.5 }}
                />
              ) : (
                empty
              )}
            </Meta>
            <Meta label={t("securityLog.columns.when")}>{formatDateTime(entry.created_at)}</Meta>
          </Stack>

          {reason && (
            <Meta label={t("securityLog.entry.reason")}>
              <Typography variant="body2" data-testid="security-reason">
                {t(reasonLabelKey(reason), { defaultValue: reason })}{" "}
                <code style={{ fontSize: 11, opacity: 0.7 }}>({reason})</code>
              </Typography>
            </Meta>
          )}

          <Stack direction="row" gap={2} flexWrap="wrap">
            <Meta label={t("securityLog.columns.actor")}>{entry.actor_email ?? empty}</Meta>
            <Meta label={t("securityLog.columns.subject")}>{entry.subject_email ?? empty}</Meta>
            <Meta label={t("securityLog.columns.target")}>{target ?? empty}</Meta>
          </Stack>

          <Stack direction="row" gap={2} flexWrap="wrap">
            <Meta label={t("securityLog.columns.ip")}>
              {entry.ip ? <code>{entry.ip}</code> : empty}
            </Meta>
            <Meta label={t("securityLog.columns.impersonatedRole")}>
              {entry.impersonated_role ?? empty}
            </Meta>
          </Stack>

          <Meta label={t("securityLog.columns.userAgent")}>
            {entry.user_agent ? (
              <code style={{ fontSize: 11 }}>{entry.user_agent}</code>
            ) : (
              empty
            )}
          </Meta>

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2">{t("securityLog.entry.details")}</Typography>
          <DetailsBlock details={entry.details} />
        </Stack>
      </Box>
    </Drawer>
  );
}
