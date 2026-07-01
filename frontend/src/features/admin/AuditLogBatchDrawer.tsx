/**
 * AuditLogBatchDrawer — right-side drawer opened from the audit-log
 * grid when an admin clicks a batch row. Shows:
 *
 *  - batch metadata (actor, tool, origin, status, timestamps)
 *  - the per-event diff fetched lazily from
 *    `GET /mutation-batches/{id}/events`
 *  - a rollback action that runs `dry_run=true` first to surface the
 *    inverse-op plan, then `dry_run=false` on confirm. Conflicts (when
 *    a later batch touched the same entities) surface in the same
 *    dialog with a `force` switch.
 *
 * Mirrors the "click row → side drawer" pattern from Inventory's
 * `CardDetailSidePanel`, but is self-contained — no global router
 * navigation, the drawer closes when the admin clicks away or selects
 * another row.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { AuditBatch } from "./AuditLogTypes";

interface BatchEvent {
  id: string;
  event_type: string;
  data: Record<string, unknown> | null;
  card_id: string | null;
  user_id: string | null;
  user_display_name: string | null;
  created_at: string;
}

interface BatchHistory {
  batch: AuditBatch;
  events: BatchEvent[];
}

interface RollbackOp {
  event_id: string;
  op: string;
  card_id?: string;
  relation_id?: string;
  fields?: Record<string, unknown>;
  event_type?: string;
  reason?: string;
  status?: string;
}

interface RollbackPlan {
  dry_run?: boolean;
  batch: AuditBatch;
  operations: RollbackOp[];
  unsupported_events: RollbackOp[];
  event_count: number;
}

interface ConflictingBatch {
  batch_id: string;
  tool_name: string;
  created_at: string;
  touched_entities: string[];
}

export function originColor(origin: string): "default" | "primary" | "warning" {
  if (origin === "mcp") return "warning";
  if (origin === "web") return "primary";
  return "default";
}

export function statusOf(batch: AuditBatch): {
  key: "committed" | "dry_run" | "open";
  labelKey: string;
} {
  if (batch.dry_run && !batch.committed_at) {
    return { key: "dry_run", labelKey: "auditLog.statuses.dryRun" };
  }
  if (batch.committed_at)
    return { key: "committed", labelKey: "auditLog.statuses.committed" };
  return { key: "open", labelKey: "auditLog.statuses.openShort" };
}

// ── Rollback dialog ───────────────────────────────────────────────────────

function RollbackDialog({
  batch,
  open,
  onClose,
  onCompleted,
}: {
  batch: AuditBatch | null;
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { t } = useTranslation("admin");
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [plan, setPlan] = useState<RollbackPlan | null>(null);
  const [conflicts, setConflicts] = useState<ConflictingBatch[]>([]);
  const [force, setForce] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [committedResult, setCommittedResult] = useState<unknown>(null);

  useEffect(() => {
    if (!open || !batch) return;
    setPlan(null);
    setConflicts([]);
    setError("");
    setCommittedResult(null);
    setForce(false);
    setLoadingPlan(true);
    (async () => {
      try {
        const p = await api.post<RollbackPlan>(
          `/mutation-batches/${batch.id}/rollback`,
          { dry_run: true, force: false },
        );
        setPlan(p);
      } catch (err) {
        if (err instanceof ApiError) {
          const detail = err.detail as
            | { error?: string; conflicting_batches?: ConflictingBatch[]; message?: string }
            | undefined;
          if (detail?.error === "rollback_conflict") {
            setConflicts(detail.conflicting_batches ?? []);
            setError(detail.message ?? t("auditLog.rollback.conflictsDetected"));
          } else {
            setError(err.message);
          }
        } else {
          setError(String(err));
        }
      } finally {
        setLoadingPlan(false);
      }
    })();
  }, [open, batch, t]);

  const commit = useCallback(async () => {
    if (!batch) return;
    setCommitting(true);
    setError("");
    try {
      const result = await api.post(`/mutation-batches/${batch.id}/rollback`, {
        dry_run: false,
        force,
      });
      setCommittedResult(result);
      onCompleted();
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = err.detail as
          | { error?: string; conflicting_batches?: ConflictingBatch[]; message?: string }
          | undefined;
        if (detail?.error === "rollback_conflict") {
          setConflicts(detail.conflicting_batches ?? []);
          setError(detail.message ?? t("auditLog.rollback.conflictsDetected"));
        } else {
          setError(err.message);
        }
      } else {
        setError(String(err));
      }
    } finally {
      setCommitting(false);
    }
  }, [batch, force, onCompleted, t]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {t("auditLog.rollback.title", {
          id: `${batch?.id?.slice(0, 8) ?? ""}…`,
        })}{" "}
        <Typography component="span" variant="body2" color="text.secondary">
          {t("auditLog.rollback.toolSuffix", { tool: batch?.tool_name ?? "" })}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {loadingPlan && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {committedResult ? (
          <Alert severity="success">
            {t("auditLog.rollback.committed", {
              count: plan?.operations?.length ?? 0,
            })}
          </Alert>
        ) : (
          <>
            {error && (
              <Alert
                severity={conflicts.length ? "warning" : "error"}
                sx={{ mb: 2 }}
              >
                {error}
              </Alert>
            )}

            {conflicts.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  {t("auditLog.rollback.conflictHeading")}
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("auditLog.rollback.colBatch")}</TableCell>
                        <TableCell>{t("auditLog.rollback.colTool")}</TableCell>
                        <TableCell>{t("auditLog.rollback.colWhen")}</TableCell>
                        <TableCell>
                          {t("auditLog.rollback.colTouched")}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {conflicts.map((c) => (
                        <TableRow key={c.batch_id}>
                          <TableCell>
                            <code>{c.batch_id.slice(0, 8)}…</code>
                          </TableCell>
                          <TableCell>{c.tool_name}</TableCell>
                          <TableCell>
                            {new Date(c.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>{c.touched_entities.length}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={
                    <Switch
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                  }
                  label={t("auditLog.rollback.forceLabel")}
                />
              </Box>
            )}

            {plan && (
              <>
                <Typography variant="subtitle2" gutterBottom>
                  {t("auditLog.rollback.planHeading", {
                    count: plan.operations.length,
                  })}
                </Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("auditLog.rollback.colOp")}</TableCell>
                        <TableCell>{t("auditLog.rollback.colTarget")}</TableCell>
                        <TableCell>{t("auditLog.rollback.colDetail")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {plan.operations.map((op) => (
                        <TableRow key={op.event_id}>
                          <TableCell>
                            <code>{op.op}</code>
                          </TableCell>
                          <TableCell>
                            <code>
                              {(op.card_id || op.relation_id || "—").slice(0, 8)}
                              …
                            </code>
                          </TableCell>
                          <TableCell>
                            {op.fields ? (
                              <code style={{ fontSize: 11 }}>
                                {Object.keys(op.fields).join(", ")}
                              </code>
                            ) : (
                              t("auditLog.batch.emptyValue")
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {plan.unsupported_events.length > 0 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t("auditLog.rollback.unsupported", {
                      count: plan.unsupported_events.length,
                      types: Array.from(
                        new Set(
                          plan.unsupported_events.map((e) => e.event_type ?? "?"),
                        ),
                      ).join(", "),
                    })}
                  </Alert>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {committedResult
            ? t("auditLog.rollback.close")
            : t("auditLog.rollback.cancel")}
        </Button>
        {!committedResult && plan && (
          <Button
            onClick={commit}
            variant="contained"
            color="error"
            disabled={committing || (conflicts.length > 0 && !force)}
            startIcon={
              committing ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <MaterialSymbol icon="undo" />
              )
            }
          >
            {committing
              ? t("auditLog.rollback.rollingBack")
              : force
                ? t("auditLog.rollback.force")
                : t("auditLog.rollback.rollback")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ── Batch events table ────────────────────────────────────────────────────

function BatchEventsTable({ batchId }: { batchId: string }) {
  const { t } = useTranslation("admin");
  const [history, setHistory] = useState<BatchHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { formatDateTime } = useDateFormat();

  useEffect(() => {
    setLoading(true);
    api
      .get<BatchHistory>(`/mutation-batches/${batchId}/events`)
      .then(setHistory)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, [batchId]);

  if (loading) {
    return (
      <Box sx={{ py: 2, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={20} />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!history) return null;

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {t("auditLog.events.count", { count: history.events.length })}
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("auditLog.events.colWhen")}</TableCell>
              <TableCell>{t("auditLog.events.colEvent")}</TableCell>
              <TableCell>{t("auditLog.events.colCard")}</TableCell>
              <TableCell>{t("auditLog.events.colData")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.events.map((e) => (
              <TableRow key={e.id}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {formatDateTime(e.created_at)}
                </TableCell>
                <TableCell>
                  <code>{e.event_type}</code>
                </TableCell>
                <TableCell>
                  {e.card_id ? (
                    <code>{e.card_id.slice(0, 8)}…</code>
                  ) : (
                    t("auditLog.batch.emptyValue")
                  )}
                </TableCell>
                <TableCell
                  sx={{
                    fontSize: 11,
                    maxWidth: 360,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <code>{JSON.stringify(e.data)}</code>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────

export default function AuditLogBatchDrawer({
  batch,
  open,
  onClose,
  onRolledBack,
}: {
  batch: AuditBatch | null;
  open: boolean;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const { t } = useTranslation("admin");
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const { formatDateTime } = useDateFormat();

  if (!batch) return null;
  const status = statusOf(batch);
  const canRollback = status.key === "committed";

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 720 } } }}
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
          <MaterialSymbol icon="history" size={22} />
          <Typography variant="h6">{t("auditLog.batch.detailTitle")}</Typography>
        </Stack>
        <Tooltip title={t("auditLog.batch.close")}>
          <IconButton onClick={onClose} size="small">
            <MaterialSymbol icon="close" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ px: 2, py: 2, overflowY: "auto", flex: 1 }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("auditLog.batch.batchId")}
            </Typography>
            <Typography variant="body2">
              <code style={{ fontSize: 11 }}>{batch.id}</code>
            </Typography>
          </Box>

          <Stack direction="row" gap={2} flexWrap="wrap">
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("auditLog.batch.tool")}
              </Typography>
              <Typography variant="body2">
                <code>{batch.tool_name}</code>
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("auditLog.batch.origin")}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Chip
                  size="small"
                  label={batch.origin}
                  color={originColor(batch.origin)}
                  variant={batch.origin === "mcp" ? "filled" : "outlined"}
                />
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("auditLog.batch.status")}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Chip
                  size="small"
                  label={t(status.labelKey)}
                  color={
                    status.key === "committed"
                      ? "success"
                      : status.key === "dry_run"
                        ? "default"
                        : "warning"
                  }
                  variant="outlined"
                />
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("auditLog.batch.actor")}
              </Typography>
              <Typography variant="body2">
                {batch.actor_display_name ?? t("auditLog.batch.emptyValue")}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" gap={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("auditLog.batch.created")}
              </Typography>
              <Typography variant="body2">
                {formatDateTime(batch.created_at)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("auditLog.batch.committed")}
              </Typography>
              <Typography variant="body2">
                {batch.committed_at
                  ? formatDateTime(batch.committed_at)
                  : t("auditLog.batch.emptyValue")}
              </Typography>
            </Box>
          </Stack>

          {status.key === "dry_run" && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {t("auditLog.batch.dryRunNotice")}
            </Alert>
          )}

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2">
            {t("auditLog.batch.eventsHeading")}
          </Typography>
          <BatchEventsTable batchId={batch.id} />
        </Stack>
      </Box>

      <Box
        sx={{
          borderTop: 1,
          borderColor: "divider",
          px: 2,
          py: 1.5,
          display: "flex",
          justifyContent: "flex-end",
          gap: 1,
        }}
      >
        <Button onClick={onClose}>{t("auditLog.batch.close")}</Button>
        <Tooltip
          title={
            canRollback
              ? t("auditLog.batch.rollbackTooltip")
              : t("auditLog.batch.rollbackDisabledTooltip")
          }
        >
          <span>
            <Button
              variant="contained"
              color="error"
              disabled={!canRollback}
              onClick={() => setRollbackOpen(true)}
              startIcon={<MaterialSymbol icon="undo" />}
            >
              {t("auditLog.batch.rollback")}
            </Button>
          </span>
        </Tooltip>
      </Box>

      <RollbackDialog
        batch={batch}
        open={rollbackOpen}
        onClose={() => setRollbackOpen(false)}
        onCompleted={() => {
          setRollbackOpen(false);
          onRolledBack();
        }}
      />
    </Drawer>
  );
}
