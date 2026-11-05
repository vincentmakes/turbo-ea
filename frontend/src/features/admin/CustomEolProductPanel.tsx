/**
 * The right-hand panel a row of the Custom products grid opens: one custom
 * EOL product, its fields and its release cycles (Details), and the draft
 * contribution to endoflife.date (Contribute).
 *
 * The grid owns the products and their loading: every write here goes to the
 * API and then calls `onChanged()`, after which the grid reloads and passes a
 * fresh `product`. Editors are mounted only while something is being edited
 * and are seeded when they mount, so a reload never clobbers a draft. The
 * body is keyed on the product, so opening another product starts afresh.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { ApiError, api } from "@/api/client";
import {
  CycleFields,
  EMPTY_CYCLE,
  ProductFields,
  cycleIssues,
  cyclePayload,
  productDraft,
  productDraftIssues,
  productPayload,
  type CycleDraft,
  type CycleIssueField,
  type ProductDraft,
} from "@/components/CustomEolProductDialog";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import { EOL_STATUS_COLORS, EOL_STATUS_LABEL_KEYS } from "@/lib/eol";
import { cycleStatus, milestoneLabelKey, milestoneMode, type MilestoneKind } from "@/lib/eolCustom";
import type { EolCustomCycle, EolCustomProduct, EolMilestone } from "@/types";
import CustomEolContributeTab from "./CustomEolContributeTab";

// Stryker disable all: layout, spacing and typography are presentation; jsdom lays nothing out
const SX = {
  paper: {
    width: { xs: "100%", sm: 600, md: 720 },
    display: "flex",
    flexDirection: "column",
  },
  header: { display: "flex", alignItems: "flex-start", gap: 1, px: 3, pt: 2.5, pb: 1 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { wordBreak: "break-word" },
  chips: { display: "flex", flexWrap: "wrap", gap: 1, mt: 1 },
  readOnly: { mx: 3, mb: 1 },
  tabs: { px: 3, borderBottom: 1, borderColor: "divider" },
  body: { flex: 1, overflowY: "auto", px: 3, py: 2.5 },
  sectionHeading: { mb: 2 },
  inlineError: { mb: 2 },
  editActions: { display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 },
  divider: { my: 3 },
  cyclesHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 },
  cycleRow: { py: 1.5 },
  cycleHead: { display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" },
  cycleName: { fontWeight: 700 },
  cycleSpacer: { flex: 1 },
  cycleFacts: {
    display: "grid",
    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
    columnGap: 2,
    rowGap: 0.25,
    mt: 0.75,
  },
  cycleWarning: { mt: 1 },
  editor: { py: 2 },
  noCycles: { fontStyle: "italic" },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 1,
    px: 3,
    py: 1.5,
    borderTop: 1,
    borderColor: "divider",
  },
  statusChip: { color: "common.white", fontWeight: 600 },
} as const;
// Stryker restore all

export interface CustomEolProductPanelProps {
  product: EolCustomProduct | null;
  canManage: boolean;
  upstreamMatch?: { name: string; score: number };
  onClose: () => void;
  /** Called after every successful write; the grid reloads and passes a fresh `product`. */
  onChanged: () => void;
  onRequestSwitch: (target: string | null) => void;
  onDeleted: () => void;
  /** Page-level errors (a delete refused because cards link the row, …). */
  onError: (message: string) => void;
}

type TFn = ReturnType<typeof useTranslation>["t"];

/** A refused delete: `cards_linked` names how many cards still link the row. */
function deleteErrorMessage(e: unknown, linkedKey: string, t: TFn): string {
  const detail = e instanceof ApiError ? (e.detail as { code?: string; count?: number }) : null;
  if (detail?.code === "cards_linked") return t(linkedKey, { count: detail.count ?? 0 });
  return e instanceof Error ? e.message : t("common:errors.generic");
}

function cycleDraft(c: EolCustomCycle): CycleDraft {
  return {
    cycle: c.cycle,
    releaseDate: c.releaseDate,
    support: c.support,
    eol: c.eol,
    latest: c.latest,
    latestReleaseDate: c.latestReleaseDate,
  };
}

// ── Product fields ─────────────────────────────────────────────────────────

function sameDraft(a: ProductDraft, b: ProductDraft): boolean {
  return a.title === b.title && a.link === b.link && a.description === b.description;
}

function ProductSection({
  product,
  canManage,
  onChanged,
}: {
  product: EolCustomProduct;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation(["admin", "cards", "common"]);
  const [draft, setDraft] = useState<ProductDraft>(() => productDraft(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = !sameDraft(draft, productDraft(product));
  const valid = Object.keys(productDraftIssues(draft)).length === 0;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.patch(
        `/eol/custom-products/${encodeURIComponent(product.key)}`,
        productPayload(draft),
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={SX.sectionHeading}>
        {t("eol.custom.panel.sectionProduct")}
      </Typography>
      {error && (
        <Alert severity="error" sx={SX.inlineError} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <ProductFields value={draft} onChange={setDraft} disabled={!canManage} />
      {canManage && (
        <Box sx={SX.editActions}>
          <Button
            onClick={() => {
              setDraft(productDraft(product));
              setError("");
            }}
            disabled={!dirty || saving}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" onClick={save} disabled={!dirty || !valid || saving}>
            {t("common:actions.save")}
          </Button>
        </Box>
      )}
    </Box>
  );
}

// ── Cycle editor (add / edit) ──────────────────────────────────────────────

function CycleEditor({
  initial,
  showErrorsAtStart,
  submit,
  onDone,
  onCancel,
}: {
  initial: CycleDraft;
  /** An existing cycle shows its problems at once (a legacy row without EOL). */
  showErrorsAtStart: boolean;
  submit: (draft: CycleDraft) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const [draft, setDraft] = useState<CycleDraft>(initial);
  const [touched, setTouched] = useState(showErrorsAtStart);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const issues = cycleIssues(draft);
  const blocked = Object.keys(issues).length > 0;
  const errors = touched
    ? (Object.fromEntries(Object.entries(issues).map(([f, k]) => [f, t(k)])) as Partial<
        Record<CycleIssueField, string>
      >)
    : {};

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await submit(draft);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
      setSaving(false);
    }
  };

  return (
    <Box sx={SX.editor} data-testid="eol-cycle-editor">
      {error && (
        <Alert severity="error" sx={SX.inlineError} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <CycleFields
        value={draft}
        autoFocus
        errors={errors}
        onChange={(next) => {
          setTouched(true);
          setDraft(next);
        }}
      />
      <Box sx={SX.editActions}>
        <Button onClick={onCancel} disabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button variant="contained" onClick={save} disabled={blocked || saving}>
          {t("common:actions.save")}
        </Button>
      </Box>
    </Box>
  );
}

// ── One cycle ──────────────────────────────────────────────────────────────

function CycleRow({
  productKey,
  cycle,
  canManage,
  onChanged,
  onDelete,
}: {
  productKey: string;
  cycle: EolCustomCycle;
  canManage: boolean;
  onChanged: () => void;
  onDelete: (cycle: EolCustomCycle) => void;
}) {
  const { t } = useTranslation(["admin", "cards", "common", "reports"]);
  const { formatDate } = useDateFormat();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CycleEditor
        initial={cycleDraft(cycle)}
        showErrorsAtStart
        submit={(draft) =>
          api.patch(
            `/eol/custom-products/${encodeURIComponent(productKey)}/cycles/${cycle.id}`,
            cyclePayload(draft),
          )
        }
        onDone={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const status = cycleStatus(cycle.eol, cycle.support);
  const milestoneText = (value: EolMilestone, kind: MilestoneKind) => {
    const key = milestoneLabelKey(value, kind);
    return key ? t(`cards:${key}`) : formatDate(value as string);
  };
  const linked = cycle.linked_cards > 0;

  return (
    <Box sx={SX.cycleRow} data-testid={`eol-cycle-${cycle.id}`}>
      <Box sx={SX.cycleHead}>
        <Typography variant="body1" sx={SX.cycleName}>
          {cycle.cycle}
        </Typography>
        <Chip
          size="small"
          label={t(`reports:${EOL_STATUS_LABEL_KEYS[status]}`)}
          sx={{ ...SX.statusChip, bgcolor: EOL_STATUS_COLORS[status] }}
        />
        <Box sx={SX.cycleSpacer} />
        <Typography variant="caption" color="text.secondary">
          {t("eol.custom.panel.linkedCards", { count: cycle.linked_cards })}
        </Typography>
        {canManage && (
          <>
            <Tooltip title={t("eol.custom.panel.editCycle", { cycle: cycle.cycle })}>
              <IconButton
                size="small"
                aria-label={t("eol.custom.panel.editCycle", { cycle: cycle.cycle })}
                onClick={() => setEditing(true)}
              >
                <MaterialSymbol icon="edit" size={18} />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={
                linked
                  ? t("eol.custom.confirmDeleteCycleBlocked", { count: cycle.linked_cards })
                  : t("eol.custom.panel.deleteCycle", { cycle: cycle.cycle })
              }
            >
              <span>
                <IconButton
                  size="small"
                  aria-label={t("eol.custom.panel.deleteCycle", { cycle: cycle.cycle })}
                  disabled={linked}
                  onClick={() => onDelete(cycle)}
                >
                  <MaterialSymbol icon="delete" size={18} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Box>
      <Box sx={SX.cycleFacts}>
        <Typography variant="body2" color="text.secondary">
          {t("cards:eol.releaseDate")}: {cycle.releaseDate ? formatDate(cycle.releaseDate) : "—"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("cards:eol.latestVersion")}: {cycle.latest || "—"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("cards:eol.activeSupport")}: {milestoneText(cycle.support, "support")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("cards:eol.endOfLife")}: {milestoneText(cycle.eol, "eol")}
        </Typography>
      </Box>
      {milestoneMode(cycle.eol, "eol") === "unset" && (
        <Alert severity="warning" sx={SX.cycleWarning}>
          {t("eol.custom.panel.eolMissing")}
        </Alert>
      )}
    </Box>
  );
}

// ── Cycles ─────────────────────────────────────────────────────────────────

function CyclesSection({
  product,
  canManage,
  onChanged,
  onError,
}: {
  product: EolCustomProduct;
  canManage: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(["admin", "cards", "common"]);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<EolCustomCycle | null>(null);
  const productPath = `/eol/custom-products/${encodeURIComponent(product.key)}`;

  const runDelete = async () => {
    if (!confirm) return;
    const cycle = confirm;
    setConfirm(null);
    try {
      await api.delete(`${productPath}/cycles/${cycle.id}`);
    } catch (e) {
      onError(deleteErrorMessage(e, "eol.custom.errors.cycleLinked", t));
    }
    // A refusal means the counts shown were stale: reload either way.
    onChanged();
  };

  return (
    <Box>
      <Box sx={SX.cyclesHeader}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t("cards:eol.custom.cyclesHeading")}
        </Typography>
        {canManage && !adding && (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="add" size={16} />}
            onClick={() => setAdding(true)}
          >
            {t("cards:eol.custom.addCycle")}
          </Button>
        )}
      </Box>
      {adding && (
        <CycleEditor
          initial={EMPTY_CYCLE}
          showErrorsAtStart={false}
          submit={(draft) => api.post(`${productPath}/cycles`, cyclePayload(draft))}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {product.cycles.length === 0 && !adding ? (
        <Typography variant="body2" color="text.secondary" sx={SX.noCycles}>
          {t("eol.custom.noCycles")}
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />}>
          {product.cycles.map((c) => (
            <CycleRow
              key={c.id}
              productKey={product.key}
              cycle={c}
              canManage={canManage}
              onChanged={onChanged}
              onDelete={setConfirm}
            />
          ))}
        </Stack>
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} disableRestoreFocus>
        <DialogTitle>
          {t("eol.custom.confirmDeleteCycleTitle", { cycle: confirm?.cycle ?? "" })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{t("eol.custom.confirmDeleteCycle")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button color="error" variant="contained" onClick={runDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────

type PanelTab = "details" | "contribute";

function PanelBody({
  product,
  canManage,
  upstreamMatch,
  onClose,
  onChanged,
  onRequestSwitch,
  onDeleted,
  onError,
}: CustomEolProductPanelProps & { product: EolCustomProduct }) {
  const { t } = useTranslation(["admin", "cards", "common"]);
  const [tab, setTab] = useState<PanelTab>("details");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const linked = product.linked_cards > 0;

  const deleteProduct = async () => {
    setConfirmDelete(false);
    try {
      await api.delete(`/eol/custom-products/${encodeURIComponent(product.key)}`);
      onDeleted();
    } catch (e) {
      onError(deleteErrorMessage(e, "eol.custom.errors.cardsLinked", t));
      onChanged();
    }
  };

  const upstreamHint = upstreamMatch
    ? t(
        canManage ? "eol.custom.upstreamMatchHint" : "eol.custom.upstreamMatchHintReadOnly",
        { name: upstreamMatch.name },
      )
    : "";

  return (
    <>
      <Box sx={SX.header}>
        <Box sx={SX.titleBlock}>
          <Typography variant="h6" component="h2" sx={SX.title}>
            {product.title}
          </Typography>
          <Box sx={SX.chips}>
            <Chip
              size="small"
              variant="outlined"
              icon={<MaterialSymbol icon="edit_note" size={16} />}
              label={t("cards:eol.custom.badge")}
            />
            {upstreamMatch && (
              <Tooltip title={upstreamHint} describeChild>
                <Chip
                  size="small"
                  color="info"
                  variant="outlined"
                  icon={<MaterialSymbol icon="sync_alt" size={16} />}
                  label={t("eol.custom.upstreamMatch")}
                  onClick={canManage ? () => onRequestSwitch(upstreamMatch.name) : undefined}
                />
              </Tooltip>
            )}
          </Box>
        </Box>
        <Tooltip title={t("common:actions.close")}>
          <IconButton aria-label={t("common:actions.close")} onClick={onClose}>
            <MaterialSymbol icon="close" size={20} />
          </IconButton>
        </Tooltip>
      </Box>
      {!canManage && (
        <Alert severity="info" sx={SX.readOnly}>
          {t("eol.custom.panel.readOnly")}
        </Alert>
      )}
      <Tabs
        value={tab}
        onChange={(_, v: PanelTab) => setTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={SX.tabs}
      >
        <Tab
          value="details"
          label={t("eol.custom.panel.tabDetails")}
          id="eol-panel-tab-details"
          aria-controls="eol-panel-details"
        />
        <Tab
          value="contribute"
          label={t("eol.custom.panel.tabContribute")}
          id="eol-panel-tab-contribute"
          aria-controls="eol-panel-contribute"
        />
      </Tabs>
      <Box sx={SX.body}>
        {/* Both tabs stay mounted, so a draft survives a switch of tab. */}
        <Box
          role="tabpanel"
          id="eol-panel-details"
          aria-labelledby="eol-panel-tab-details"
          hidden={tab !== "details"}
        >
          <ProductSection product={product} canManage={canManage} onChanged={onChanged} />
          <Divider sx={SX.divider} />
          <CyclesSection
            product={product}
            canManage={canManage}
            onChanged={onChanged}
            onError={onError}
          />
        </Box>
        <Box
          role="tabpanel"
          id="eol-panel-contribute"
          aria-labelledby="eol-panel-tab-contribute"
          hidden={tab !== "contribute"}
        >
          <CustomEolContributeTab
            product={product}
            canManage={canManage}
            onChanged={onChanged}
            onError={onError}
          />
        </Box>
      </Box>
      {canManage && (
        <Box sx={SX.footer}>
          <Button
            startIcon={<MaterialSymbol icon="swap_horiz" size={18} />}
            onClick={() => onRequestSwitch(upstreamMatch?.name ?? null)}
          >
            {t("eol.custom.switch.action")}
          </Button>
          <Tooltip
            title={
              linked
                ? t("eol.custom.confirmDeleteProductBlocked", { count: product.linked_cards })
                : ""
            }
          >
            <span>
              <Button
                color="error"
                disabled={linked}
                startIcon={<MaterialSymbol icon="delete" size={18} />}
                onClick={() => setConfirmDelete(true)}
              >
                {t("eol.custom.deleteProduct")}
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} disableRestoreFocus>
        <DialogTitle>
          {t("eol.custom.confirmDeleteProductTitle", { product: product.title })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{t("eol.custom.confirmDeleteProduct")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t("common:actions.cancel")}</Button>
          <Button color="error" variant="contained" onClick={deleteProduct}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default function CustomEolProductPanel(props: CustomEolProductPanelProps) {
  const { product, onClose } = props;
  return (
    <Drawer anchor="right" open={!!product} onClose={onClose} PaperProps={{ sx: SX.paper }}>
      {product && <PanelBody key={product.key} {...props} product={product} />}
    </Drawer>
  );
}
