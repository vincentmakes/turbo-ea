/**
 * Review a custom language string by string: the English source beside the
 * translation, filtered by namespace, status and a search, one server page at
 * a time. A string is corrected or cleared in place; the edit is stored as a
 * manual one, which "retranslate everything" leaves alone.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import i18n from "@/i18n";
import type {
  CustomLocale,
  CustomLocaleString,
  CustomLocaleStringsPage,
  CustomLocaleWriteResult,
} from "@/types";
import { errorMessage, reasonLabel } from "./customLocaleUtils";

const STATUS_FILTERS = ["untranslated", "missing", "stale", "translated", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_CHIP_COLOR = {
  missing: "error",
  stale: "warning",
  translated: "success",
} as const;

const PAGE_SIZES = [25, 50, 100];

interface Props {
  locale: CustomLocale;
  onClose: () => void;
  /** Called after a string was saved or cleared. */
  onChanged: () => void;
}

interface Editing {
  namespace: string;
  key: string;
  value: string;
}

export default function ReviewStringsDialog({ locale, onClose, onChanged }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const [namespace, setNamespace] = useState("");
  const [status, setStatus] = useState<StatusFilter>("untranslated");
  const [search, setSearch] = useState("");
  const [debouncedSearch, searchPending] = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [refetchKey, setRefetchKey] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The namespaces are the English bundle's: the same 14 the server knows.
  const namespaces = Object.keys(i18n.getDataByLanguage("en") ?? {}).sort();

  const params = new URLSearchParams({
    status,
    limit: String(pageSize),
    offset: String(page * pageSize),
  });
  if (namespace) params.set("namespace", namespace);
  if (debouncedSearch) params.set("search", debouncedSearch);
  const base = `/custom-locales/${encodeURIComponent(locale.code)}/strings`;
  const { data, loading, error: loadError } = useApiQuery<CustomLocaleStringsPage>(
    `${base}?${params.toString()}`,
    { refetchKey },
  );
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const write = async (row: CustomLocaleString, value: string | null) => {
    setSaving(true);
    setError("");
    try {
      const res = await api.post<CustomLocaleWriteResult>(base, {
        strings: { [row.namespace]: { [row.key]: value } },
        origin: "manual",
      });
      const rejected = Array.isArray(res?.rejected) ? res.rejected : [];
      if (rejected.length > 0) {
        setError(
          t("customLocales.review.rejected", { reason: reasonLabel(rejected[0].reason, t) }),
        );
        return;
      }
      setEditing(null);
      setRefetchKey((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(errorMessage(e, t, t("customLocales.review.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const resetPage = () => setPage(0);

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{t("customLocales.review.title", { name: locale.name })}</DialogTitle>
      <DialogContent>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 1, mb: 2 }}>
          <TextField
            select
            size="small"
            label={t("customLocales.review.namespace")}
            value={namespace}
            onChange={(e) => {
              setNamespace(e.target.value);
              resetPage();
            }}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">{t("customLocales.review.allNamespaces")}</MenuItem>
            {namespaces.map((ns) => (
              <MenuItem key={ns} value={ns}>
                {ns}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("customLocales.review.status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              resetPage();
            }}
            sx={{ minWidth: 180 }}
          >
            {STATUS_FILTERS.map((s) => (
              <MenuItem key={s} value={s}>
                {t(`customLocales.review.filter.${s}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={t("customLocales.review.search")}
            placeholder={t("customLocales.review.searchHint")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            sx={{ flex: 1 }}
          />
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {loadError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage(loadError, t, t("customLocales.review.loadFailed"))}
          </Alert>
        )}
        {(loading || searchPending) && <LinearProgress sx={{ mb: 1 }} />}

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "40%" }}>{t("customLocales.review.source")}</TableCell>
              <TableCell>{t("customLocales.review.translation")}</TableCell>
              <TableCell sx={{ width: 110 }}>{t("customLocales.review.status")}</TableCell>
              <TableCell sx={{ width: 96 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((row) => {
              const isEditing =
                editing !== null &&
                editing.namespace === row.namespace &&
                editing.key === row.key;
              return (
                <TableRow key={`${row.namespace}:${row.key}`} data-testid="review-row">
                  <TableCell sx={{ verticalAlign: "top" }}>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {row.source}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.namespace} · {row.key}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>
                    {isEditing ? (
                      <TextField
                        size="small"
                        fullWidth
                        multiline
                        autoFocus
                        label={t("customLocales.review.translation")}
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      />
                    ) : (
                      <Typography
                        variant="body2"
                        sx={{ whiteSpace: "pre-wrap" }}
                        color={row.value ? "text.primary" : "text.secondary"}
                      >
                        {row.value || t("customLocales.review.noTranslation")}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>
                    <Chip
                      size="small"
                      color={STATUS_CHIP_COLOR[row.status] ?? "default"}
                      label={t(`customLocales.status.${row.status}`)}
                    />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {isEditing ? (
                      <>
                        <Tooltip title={t("common:actions.save")}>
                          <span>
                            <IconButton
                              size="small"
                              aria-label={t("common:actions.save")}
                              disabled={saving || !editing.value.trim()}
                              onClick={() => write(row, editing.value)}
                            >
                              <MaterialSymbol icon="check" size={18} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={t("common:actions.cancel")}>
                          <IconButton
                            size="small"
                            aria-label={t("common:actions.cancel")}
                            onClick={() => setEditing(null)}
                          >
                            <MaterialSymbol icon="close" size={18} />
                          </IconButton>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <Tooltip title={t("common:actions.edit")}>
                          <IconButton
                            size="small"
                            aria-label={t("common:actions.edit")}
                            onClick={() =>
                              setEditing({
                                namespace: row.namespace,
                                key: row.key,
                                value: row.value ?? row.source,
                              })
                            }
                          >
                            <MaterialSymbol icon="edit" size={18} />
                          </IconButton>
                        </Tooltip>
                        {row.value && (
                          <Tooltip title={t("customLocales.review.clear")}>
                            <span>
                              <IconButton
                                size="small"
                                aria-label={t("customLocales.review.clear")}
                                disabled={saving}
                                onClick={() => write(row, null)}
                              >
                                <MaterialSymbol icon="backspace" size={18} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!loading && !searchPending && items.length === 0 && !loadError && (
          <Box sx={{ py: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {t("customLocales.review.empty")}
            </Typography>
          </Box>
        )}
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={pageSize}
          rowsPerPageOptions={PAGE_SIZES}
          onPageChange={(_e, p) => setPage(p)}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            resetPage();
          }}
          labelRowsPerPage={t("customLocales.review.rowsPerPage")}
          labelDisplayedRows={({ from, to, count }) =>
            t("customLocales.review.displayedRows", { from, to, total: count })
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
