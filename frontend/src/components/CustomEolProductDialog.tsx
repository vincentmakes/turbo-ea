/**
 * Create / edit a custom EOL product, and add a cycle to one.
 *
 * Shared by the card's End of Life section (create a product on the fly when
 * endoflife.date has nothing for it, add a missing cycle) and the admin grid
 * in Settings → EOL. A product is created with its first cycles in one
 * request, so the card flow can pick the new cycle straight away.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import type { MenuProps } from "@mui/material/Menu";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { DateField } from "@/components/DateField";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  isValidCustomEolKey,
  isValidEolLink,
  milestoneMode,
  milestoneValue,
  suggestCustomEolKey,
  type MilestoneKind,
  type MilestoneMode,
} from "@/lib/eolCustom";
import type { EolCustomCycle, EolCustomCycleInput, EolCustomProduct, EolMilestone } from "@/types";

// ── Milestone (EOL / end of support) field ─────────────────────────────────

const MODES: MilestoneMode[] = ["unset", "date", "ongoing", "ended"];

interface MilestoneFieldProps {
  kind: MilestoneKind;
  value: EolMilestone;
  onChange: (value: EolMilestone) => void;
  size?: "small" | "medium";
  /** Passed to the select's menu — a grid cell editor needs `disablePortal`. */
  menuProps?: Partial<MenuProps>;
}

/**
 * A date, or one of the two answers endoflife.date allows when no date is
 * known: still going ("no end announced" / "still supported") or already over.
 */
export function MilestoneField({
  kind,
  value,
  onChange,
  size = "small",
  menuProps,
}: MilestoneFieldProps) {
  const { t } = useTranslation("cards");
  // Choosing "Date" stores nothing until a date is picked, so the stored
  // value alone would read "Not set" and never show the date field: the
  // choice is remembered here until a date or another answer replaces it.
  const stored = milestoneMode(value, kind);
  const [datePicked, setDatePicked] = useState(stored === "date");
  // A yes/no answer set from outside replaces a pending "Date" choice.
  if (datePicked && (stored === "ended" || stored === "ongoing")) setDatePicked(false);
  const mode: MilestoneMode = stored === "unset" && datePicked ? "date" : stored;
  const label = t(kind === "eol" ? "eol.endOfLife" : "eol.activeSupport");
  return (
    <Stack direction="row" spacing={1} sx={{ minWidth: 0 }}>
      <FormControl size={size} sx={{ minWidth: 170, flex: mode === "date" ? "0 0 auto" : 1 }}>
        <InputLabel>{label}</InputLabel>
        <Select
          label={label}
          value={mode}
          onChange={(e) => {
            const next = e.target.value as MilestoneMode;
            setDatePicked(next === "date");
            onChange(milestoneValue(next, kind, typeof value === "string" ? value : ""));
          }}
          inputProps={{ "aria-label": label }}
          MenuProps={menuProps}
        >
          {MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {t(`eol.custom.milestone.${kind}.${m}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {mode === "date" && (
        <DateField
          size={size}
          label={t("eol.custom.date")}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v || null)}
          sx={{ flex: 1 }}
        />
      )}
    </Stack>
  );
}

// ── Cycle fields ───────────────────────────────────────────────────────────

export type CycleDraft = Required<EolCustomCycleInput>;

export const EMPTY_CYCLE: CycleDraft = {
  cycle: "",
  releaseDate: null,
  support: null,
  eol: null,
  latest: null,
  latestReleaseDate: null,
};

/** The first problem with a cycle, as an i18n key in `cards`, or null. */
export function cycleProblem(c: CycleDraft): string | null {
  if (!c.cycle.trim()) return "eol.custom.errors.cycleRequired";
  const release = c.releaseDate;
  if (release) {
    if (typeof c.eol === "string" && c.eol < release) return "eol.custom.errors.eolBeforeRelease";
    if (typeof c.support === "string" && c.support < release)
      return "eol.custom.errors.supportBeforeRelease";
  }
  return null;
}

/** The body a cycle is sent as — blank text becomes null. */
export function cyclePayload(c: CycleDraft): EolCustomCycleInput {
  return {
    cycle: c.cycle.trim(),
    releaseDate: c.releaseDate || null,
    support: c.support,
    eol: c.eol,
    latest: c.latest?.trim() || null,
    latestReleaseDate: c.latestReleaseDate || null,
  };
}

interface CycleFieldsProps {
  value: CycleDraft;
  onChange: (next: CycleDraft) => void;
  autoFocus?: boolean;
}

export function CycleFields({ value, onChange, autoFocus }: CycleFieldsProps) {
  const { t } = useTranslation("cards");
  const set = <K extends keyof CycleDraft>(key: K, v: CycleDraft[K]) =>
    onChange({ ...value, [key]: v });
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        gap: 1.5,
      }}
    >
      <TextField
        size="small"
        required
        autoFocus={autoFocus}
        label={t("eol.versionCycle")}
        placeholder={t("eol.custom.cyclePlaceholder")}
        value={value.cycle}
        onChange={(e) => set("cycle", e.target.value)}
        inputProps={{ maxLength: 100 }}
      />
      <DateField
        size="small"
        label={t("eol.releaseDate")}
        value={value.releaseDate ?? ""}
        onChange={(v) => set("releaseDate", v || null)}
      />
      <MilestoneField kind="support" value={value.support} onChange={(v) => set("support", v)} />
      <MilestoneField kind="eol" value={value.eol} onChange={(v) => set("eol", v)} />
      <TextField
        size="small"
        label={t("eol.latestVersion")}
        placeholder={t("eol.custom.latestPlaceholder")}
        value={value.latest ?? ""}
        onChange={(e) => set("latest", e.target.value)}
        inputProps={{ maxLength: 100 }}
      />
      <DateField
        size="small"
        label={t("eol.latestRelease")}
        value={value.latestReleaseDate ?? ""}
        onChange={(v) => set("latestReleaseDate", v || null)}
      />
    </Box>
  );
}

// ── Product dialog ─────────────────────────────────────────────────────────

interface ProductDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (product: EolCustomProduct) => void;
  /** Edit this product's title, link and description; create when absent. */
  product?: EolCustomProduct | null;
  /** Create mode: what the user typed when nothing matched. */
  initialTitle?: string;
}

/** Remounted per opening (see the wrapper) so every opening starts fresh. */
function ProductDialogBody({ onClose, onSaved, product, initialTitle = "" }: ProductDialogProps) {
  const { t } = useTranslation(["cards", "common"]);
  const editing = !!product;
  const [title, setTitle] = useState(product?.title ?? initialTitle.trim());
  const [key, setKey] = useState(product?.key ?? suggestCustomEolKey(initialTitle));
  const [keyTouched, setKeyTouched] = useState(editing);
  const [link, setLink] = useState(product?.link ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [cycles, setCycles] = useState<CycleDraft[]>(editing ? [] : [{ ...EMPTY_CYCLE }]);
  // Rows are keyed by a stable id, never their index: a field's own state
  // (MilestoneField's pending "Date") must not slide onto the next row when
  // one is removed.
  const nextRowId = useRef(1);
  const [rowIds, setRowIds] = useState<number[]>(editing ? [] : [0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const keyError = !editing && key !== "" && !isValidCustomEolKey(key);
  const linkError = link.trim() !== "" && !isValidEolLink(link);
  const cycleNames = cycles.map((c) => c.cycle.trim()).filter(Boolean);
  const duplicateCycle = new Set(cycleNames).size !== cycleNames.length;
  const firstCycleProblem = cycles.map(cycleProblem).find(Boolean) ?? null;
  const canSave =
    !saving &&
    title.trim() !== "" &&
    (editing || isValidCustomEolKey(key)) &&
    !linkError &&
    !duplicateCycle &&
    !firstCycleProblem;

  const handleTitle = (next: string) => {
    setTitle(next);
    if (!keyTouched) setKey(suggestCustomEolKey(next));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = {
        title: title.trim(),
        link: link.trim() || null,
        description: description.trim() || null,
      };
      const saved = editing
        ? await api.patch<EolCustomProduct>(
            `/eol/custom-products/${encodeURIComponent(product!.key)}`,
            body,
          )
        : await api.post<EolCustomProduct>("/eol/custom-products", {
            ...body,
            key,
            cycles: cycles.map(cyclePayload),
          });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
      setSaving(false);
    }
  };

  return (
    <>
      <DialogTitle>
        {editing ? t("eol.custom.editTitle") : t("eol.custom.createTitle")}
      </DialogTitle>
      <DialogContent>
        {!editing && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 0.5 }}>
            {t("eol.custom.createIntro")}
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <Stack spacing={1.5} sx={{ mt: editing ? 1 : 0 }}>
          <TextField
            size="small"
            required
            autoFocus
            label={t("eol.custom.productTitle")}
            value={title}
            onChange={(e) => handleTitle(e.target.value)}
            inputProps={{ maxLength: 200 }}
          />
          <TextField
            size="small"
            required
            label={t("eol.custom.productKey")}
            value={key}
            disabled={editing}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
            error={keyError}
            helperText={
              editing
                ? t("eol.custom.keyLocked")
                : keyError
                  ? t("eol.custom.errors.keyInvalid")
                  : t("eol.custom.keyHelp")
            }
            inputProps={{ maxLength: 100 }}
          />
          <TextField
            size="small"
            label={t("eol.custom.productLink")}
            placeholder="https://"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            error={linkError}
            helperText={linkError ? t("eol.custom.errors.linkInvalid") : undefined}
            inputProps={{ maxLength: 500 }}
          />
          <TextField
            size="small"
            multiline
            minRows={2}
            label={t("eol.custom.productDescription")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            inputProps={{ maxLength: 5000 }}
          />
        </Stack>

        {!editing && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("eol.custom.cyclesHeading")}
            </Typography>
            <Stack spacing={2} divider={<Divider flexItem />}>
              {cycles.map((c, i) => (
                <Box key={rowIds[i]} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <CycleFields
                      value={c}
                      onChange={(next) =>
                        setCycles((prev) => prev.map((p, j) => (j === i ? next : p)))
                      }
                    />
                  </Box>
                  <Tooltip title={t("eol.custom.removeCycle")}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t("eol.custom.removeCycle")}
                        disabled={cycles.length === 1}
                        onClick={() => {
                          setCycles((prev) => prev.filter((_, j) => j !== i));
                          setRowIds((prev) => prev.filter((_, j) => j !== i));
                        }}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ))}
            </Stack>
            <Button
              size="small"
              sx={{ mt: 1.5 }}
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={() => {
                setCycles((prev) => [...prev, { ...EMPTY_CYCLE }]);
                setRowIds((prev) => [...prev, nextRowId.current++]);
              }}
            >
              {t("eol.custom.addCycleRow")}
            </Button>
            {(duplicateCycle || firstCycleProblem) && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {duplicateCycle
                  ? t("eol.custom.errors.duplicateCycle")
                  : t(firstCycleProblem as string)}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button variant="contained" onClick={save} disabled={!canSave}>
          {editing ? t("common:actions.save") : t("eol.custom.create")}
        </Button>
      </DialogActions>
    </>
  );
}

export default function CustomEolProductDialog(props: ProductDialogProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      {props.open && <ProductDialogBody {...props} />}
    </Dialog>
  );
}

// ── Add-cycle dialog ───────────────────────────────────────────────────────

interface CycleDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (cycle: EolCustomCycle) => void;
  productKey: string;
  productLabel: string;
}

function CycleDialogBody({ onClose, onSaved, productKey, productLabel }: CycleDialogProps) {
  const { t } = useTranslation(["cards", "common"]);
  const [cycle, setCycle] = useState<CycleDraft>({ ...EMPTY_CYCLE });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const problem = cycleProblem(cycle);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await api.post<EolCustomCycle>(
        `/eol/custom-products/${encodeURIComponent(productKey)}/cycles`,
        cyclePayload(cycle),
      );
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
      setSaving(false);
    }
  };

  return (
    <>
      <DialogTitle>{t("eol.custom.addCycleTitle", { product: productLabel })}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <Box sx={{ mt: 1 }}>
          <CycleFields value={cycle} onChange={setCycle} autoFocus />
        </Box>
        {problem && cycle.cycle.trim() && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {t(problem)}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button variant="contained" onClick={save} disabled={saving || !!problem}>
          {t("eol.custom.addCycle")}
        </Button>
      </DialogActions>
    </>
  );
}

export function CustomEolCycleDialog(props: CycleDialogProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      {props.open && <CycleDialogBody {...props} />}
    </Dialog>
  );
}
