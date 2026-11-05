/**
 * "Switch to endoflife.date product…": once endoflife.date tracks a product
 * the organisation kept as a custom one, move the cards' links over and let
 * the custom copy go.
 *
 * Each custom cycle is mapped to an upstream cycle (same name preselected) or
 * kept on the custom product. The server relinks only the cards the caller
 * can see and never touches lifecycle dates (`POST
 * /eol/custom-products/{key}/switch`).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import type { EolCustomProduct, EolCycle, EolProduct } from "@/types";

/** The Select value for "keep this cycle's cards on the custom product". */
const KEEP = "__keep__";

export interface SwitchResult {
  relinked: number;
  kept: number;
  deleted: boolean;
}

/** Same-name cycles map onto each other; everything else is kept. */
export function initialCycleMap(
  customCycles: string[],
  upstream: EolCycle[],
): Record<string, string | null> {
  const names = new Set(upstream.map((c) => String(c.cycle)));
  return Object.fromEntries(customCycles.map((c) => [c, names.has(c) ? c : null]));
}

interface Props {
  open: boolean;
  product: EolCustomProduct | null;
  /** An upstream slug to start from (the grid's "Now on endoflife.date" hint). */
  initialTarget?: string | null;
  onClose: () => void;
  onSwitched: (result: SwitchResult) => void;
}

function SwitchBody({
  product,
  initialTarget,
  onClose,
  onSwitched,
}: Omit<Props, "open" | "product"> & { product: EolCustomProduct }) {
  const { t } = useTranslation(["admin", "common"]);
  const [search, setSearch] = useState(initialTarget ?? "");
  const [options, setOptions] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(initialTarget ?? null);
  const [upstream, setUpstream] = useState<EolCycle[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [cycleMap, setCycleMap] = useState<Record<string, string | null>>({});
  const [deleteWhenUnused, setDeleteWhenUnused] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [debounced] = useDebouncedValue(search, 300);
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (debounced.trim().length < 2) {
        setOptions([]);
        return;
      }
      try {
        const res = await api.get<EolProduct[]>(
          `/eol/products?search=${encodeURIComponent(debounced.trim())}`,
          { signal },
        );
        if (isCurrent()) setOptions(res.filter((p) => !p.custom).map((p) => p.name));
      } catch {
        if (isCurrent()) setOptions([]);
      }
    },
    [debounced],
  );

  const customCycleNames = useMemo(() => product.cycles.map((c) => c.cycle), [product]);

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!target) {
        setUpstream([]);
        setCycleMap({});
        return;
      }
      setLoadingCycles(true);
      setError("");
      try {
        const res = await api.get<EolCycle[]>(`/eol/products/${encodeURIComponent(target)}`, {
          signal,
        });
        if (!isCurrent()) return;
        setUpstream(res);
        setCycleMap(initialCycleMap(customCycleNames, res));
      } catch (e) {
        if (!isCurrent()) return;
        setUpstream([]);
        setError(e instanceof Error ? e.message : t("common:errors.generic"));
      } finally {
        if (isCurrent()) setLoadingCycles(false);
      }
    },
    [target, customCycleNames],
  );

  const moving = product.cycles.filter((c) => cycleMap[c.cycle]);
  const relinkCount = moving.reduce((n, c) => n + c.linked_cards, 0);

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.post<SwitchResult>(
        `/eol/custom-products/${encodeURIComponent(product.key)}/switch`,
        {
          target_product: target,
          cycle_map: cycleMap,
          delete_when_unused: deleteWhenUnused,
        },
      );
      onSwitched(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
      setSaving(false);
    }
  };

  return (
    <>
      <DialogTitle>{t("eol.custom.switch.title", { product: product.title })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 0.5 }}>
          {t("eol.custom.switch.intro")}
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <Autocomplete
          freeSolo
          options={options}
          inputValue={search}
          value={target}
          onInputChange={(_, v) => setSearch(v)}
          onChange={(_, v) => setTarget(v || null)}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label={t("eol.custom.switch.target")}
              placeholder={t("eol.custom.switch.targetPlaceholder")}
            />
          )}
          sx={{ mb: 2 }}
        />
        {loadingCycles && <LinearProgress sx={{ mb: 2 }} />}
        {target && !loadingCycles && !error && upstream.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("eol.custom.switch.noCycles")}
          </Typography>
        )}
        {target && !loadingCycles && upstream.length > 0 && (
          <Box sx={{ overflowX: "auto", mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("eol.custom.switch.customCycle")}</TableCell>
                  <TableCell align="right">{t("eol.custom.columns.linked")}</TableCell>
                  <TableCell>{t("eol.custom.switch.upstreamCycle")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {product.cycles.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.cycle}</TableCell>
                    <TableCell align="right">{c.linked_cards}</TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <Select
                        size="small"
                        fullWidth
                        value={cycleMap[c.cycle] ?? KEEP}
                        onChange={(e) =>
                          setCycleMap((prev) => ({
                            ...prev,
                            [c.cycle]: e.target.value === KEEP ? null : e.target.value,
                          }))
                        }
                        inputProps={{
                          "aria-label": t("eol.custom.switch.mapCycle", { cycle: c.cycle }),
                        }}
                      >
                        <MenuItem value={KEEP}>
                          <em>{t("eol.custom.switch.keep")}</em>
                        </MenuItem>
                        {upstream.map((u) => (
                          <MenuItem key={String(u.cycle)} value={String(u.cycle)}>
                            {String(u.cycle)}
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
        <FormControlLabel
          control={
            <Checkbox
              checked={deleteWhenUnused}
              onChange={(e) => setDeleteWhenUnused(e.target.checked)}
            />
          }
          label={t("eol.custom.switch.deleteWhenUnused")}
        />
        {target && upstream.length > 0 && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {t("eol.custom.switch.summary", { count: relinkCount, target })}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving || !target || upstream.length === 0}
        >
          {t("eol.custom.switch.confirm")}
        </Button>
      </DialogActions>
    </>
  );
}

export default function SwitchToUpstreamDialog({ open, product, ...rest }: Props) {
  return (
    <Dialog open={open} onClose={rest.onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      {open && product && <SwitchBody product={product} {...rest} />}
    </Dialog>
  );
}
