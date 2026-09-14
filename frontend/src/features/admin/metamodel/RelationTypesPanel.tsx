import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { useFieldLabel, useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { LOCALE_LABELS } from "@/i18n";
import { api } from "@/api/client";
import type {
  CardType as FSType,
  RelationType as RType,
  MetamodelTranslations,
} from "@/types";
import RelationTypeValuesDialog from "./RelationTypeValuesDialog";
import RelationTranslationDialog from "./RelationTranslationDialog";
import { cleanTranslations, deriveRelationKey } from "./helpers";
import { CARDINALITY_OPTIONS } from "./constants";
import { successorRelationKeys } from "@/lib/successorRelation";
import { expandSides, sideFlags, sideKey } from "@/lib/relationSort";

/**
 * English is the base language: it lives in the `label` / `reverse_label`
 * columns and is the fallback every locale without its own translation falls
 * back to. Accepts region variants ("en-US") so a browser-provided locale
 * still counts as English.
 */
function isBaseLocale(locale: string): boolean {
  return locale.split("-")[0] === "en";
}

/**
 * Merge a relation-type verb edit into the per-locale `translations` map.
 *
 * `translations[property][locale]` SHADOWS the raw column everywhere labels are
 * resolved (`relationLabel` in `useResolveLabel.ts`), and every seeded relation
 * type carries an `en` entry. Writing only the column therefore renamed nothing
 * a user could see (#912) — the translation has to move with it.
 */
function mergeVerbTranslation(
  trans: MetamodelTranslations | undefined,
  property: "label" | "reverse_label",
  locale: string,
  value: string,
): MetamodelTranslations {
  return {
    ...trans,
    [property]: { ...trans?.[property], [locale]: value },
  };
}

export interface RelationTypesPanelProps {
  /** ALL card types — the endpoint pickers, colour dots and delete-confirm
   *  labels resolve against this, hidden types included. */
  types: FSType[];
  /** UNFILTERED relation types. `deriveRelationKey` needs the whole taken-key
   *  set, and the pair-conflict warning and lineage filter read it too. */
  relationTypes: RType[];
  /** Invalidate the metamodel cache and refetch. Every mutation calls it. */
  onRefresh: () => void;
  /** Card-type mode: show only the relation types touching this type, one row
   *  per SIDE, with that side's visibility/mandatory flags. Omit for the
   *  landscape-wide list. */
  scopeTypeKey?: string;
  /** Suppresses the "no relation types" empty state while the first fetch is
   *  still in flight. */
  loading?: boolean;
}

/**
 * The relation-type manager, rendered in two places from one implementation.
 *
 * It used to exist twice: the full editor inline in `MetamodelAdmin`, and a
 * near-read-only list in the card type drawer that could set only the per-side
 * visible/mandatory flags and bounced "Add relation" back up to the page. The
 * two drifted — the drawer never gained edit, delete, relation values,
 * translations or the hidden badge, and the general tab never gained the flags
 * — so both are now this component.
 *
 * **Sides come from `expandSides`, never from comparing the type key.** A
 * self-referencing relation type (Organization *has site* Organization) is
 * source AND target of the same card type, so `r.source_type_key === key` is
 * true at both ends: the drawer used to render such a type once and could only
 * ever write `source_visible` / `source_mandatory`, leaving the target-side
 * flags unreachable from anywhere in the product. That is the bug
 * `lib/relationSort.ts` was written for, and this is the last surface to adopt
 * it.
 */
export default function RelationTypesPanel({
  types,
  relationTypes,
  onRefresh,
  scopeTypeKey,
  loading = false,
}: RelationTypesPanelProps) {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const fieldLabel = useFieldLabel();
  const relationLabel = useRelationLabel();
  const typeLabel = useTypeLabel();
  const locale = i18n.language;
  const localeSuffix = ` (${LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale})`;

  const [showHiddenRels, setShowHiddenRels] = useState(false);
  const [createRelOpen, setCreateRelOpen] = useState(false);
  const [newRel, setNewRel] = useState({
    key: "",
    label: "",
    reverse_label: "",
    source_type_key: "",
    target_type_key: "",
    cardinality: "1:n" as "1:1" | "1:n" | "n:m",
    translations: {} as MetamodelTranslations,
  });
  const [editRelOpen, setEditRelOpen] = useState(false);
  const [editRel, setEditRel] = useState<(RType & { translations?: MetamodelTranslations }) | null>(
    null,
  );
  const [relError, setRelError] = useState<string | null>(null);
  // Failures from the inline visible/mandatory switches, which fire with no
  // dialog open. Kept apart from `relError` so one message never renders twice.
  const [flagError, setFlagError] = useState<string | null>(null);
  // True once the admin edits the key by hand. The suggestion tracks the types
  // and verb until then; after that the key is theirs and a later type change
  // must not silently wipe it.
  const [relKeyTouched, setRelKeyTouched] = useState(false);
  const [valuesRel, setValuesRel] = useState<RType | null>(null);
  const [translateRelsOpen, setTranslateRelsOpen] = useState(false);
  const [deleteRelConfirm, setDeleteRelConfirm] = useState<{
    key: string;
    label: string;
    builtIn: boolean;
    instanceCount: number | null; // null = not yet fetched
  } | null>(null);

  const resolveType = (key: string) => types.find((ct) => ct.key === key);

  const successorRelKeys = useMemo(() => successorRelationKeys(relationTypes), [relationTypes]);

  const displayRelationTypes = useMemo(() => {
    const visible = (
      showHiddenRels ? relationTypes : relationTypes.filter((r) => !r.is_hidden)
      // Hide each card type's ONE lineage relation (managed by the type's "Supports
      // Lineage" toggle) — but never every `*Successor`-suffixed key: any other
      // self-pair relation type is an ordinary relation and must stay editable here.
    ).filter((r) => !successorRelKeys.has(r.key));
    if (!scopeTypeKey) return visible;
    return visible.filter(
      (r) => r.source_type_key === scopeTypeKey || r.target_type_key === scopeTypeKey,
    );
  }, [relationTypes, showHiddenRels, successorRelKeys, scopeTypeKey]);

  /**
   * One entry per rendered row. Scoped: one per SIDE, so a self-pair yields two.
   * Unscoped: one per relation type, with `isSource` undefined — the row then
   * shows both endpoints and both sides' flags.
   */
  const rows = useMemo(
    () =>
      scopeTypeKey
        ? expandSides(displayRelationTypes, scopeTypeKey).map(({ rt, isSource }) => ({
            rt,
            isSource,
          }))
        : displayRelationTypes.map((rt) => ({ rt, isSource: undefined as boolean | undefined })),
    [displayRelationTypes, scopeTypeKey],
  );

  // Suggested key for a new relation type. The rule lives in
  // `metamodel/helpers.deriveRelationKey` so the unit test exercises the real
  // implementation rather than a copy that could silently drift from it.
  const autoRelKey = useMemo(
    () =>
      deriveRelationKey(
        newRel.source_type_key,
        newRel.target_type_key,
        newRel.label,
        relationTypes,
      ),
    [newRel.source_type_key, newRel.target_type_key, newRel.label, relationTypes],
  );

  // Relation types already connecting the chosen pair. Not an error — the
  // metamodel allows any number — but worth surfacing, since a variant of one
  // relationship is usually better modelled as an attribute on the existing type.
  const relPairConflicts = useMemo(() => {
    if (!newRel.source_type_key || !newRel.target_type_key) return [];
    return relationTypes.filter(
      (r) =>
        !r.is_hidden &&
        r.source_type_key === newRel.source_type_key &&
        r.target_type_key === newRel.target_type_key,
    );
  }, [newRel.source_type_key, newRel.target_type_key, relationTypes]);

  /* ---- Handlers ---- */

  const openCreateRelation = () => {
    setNewRel({
      key: "",
      label: "",
      reverse_label: "",
      // In card-type mode the type under view is the obvious source.
      source_type_key: scopeTypeKey || "",
      target_type_key: "",
      cardinality: "1:n",
      translations: {},
    });
    setRelError(null);
    setRelKeyTouched(false);
    setCreateRelOpen(true);
  };

  const handleCreateRelation = async () => {
    const finalKey = newRel.key || autoRelKey;
    const { translations: rawTrans, ...rest } = newRel;
    // The typed verbs always seed the base (English) columns — they are the
    // fallback for every locale without its own entry. When the admin is
    // working in another language, mirror them into that locale too so the
    // create path matches what the edit dialog writes.
    let trans = rawTrans;
    if (!isBaseLocale(locale)) {
      trans = mergeVerbTranslation(trans, "label", locale, rest.label);
      if (rest.reverse_label) {
        trans = mergeVerbTranslation(trans, "reverse_label", locale, rest.reverse_label);
      }
    }
    try {
      await api.post("/metamodel/relation-types", {
        ...rest,
        key: finalKey,
        attributes_schema: [],
        built_in: false,
        translations: cleanTranslations(trans) || undefined,
      });
    } catch (e) {
      setRelError(e instanceof Error ? e.message : t("metamodel.relationSaveFailed"));
      return;
    }
    onRefresh();
    setCreateRelOpen(false);
    setRelError(null);
    setNewRel({
      key: "",
      label: "",
      reverse_label: "",
      source_type_key: "",
      target_type_key: "",
      cardinality: "1:n",
      translations: {},
    });
  };

  const handleUpdateRelation = async () => {
    if (!editRel) return;
    try {
      await api.patch(`/metamodel/relation-types/${editRel.key}`, {
        label: editRel.label,
        reverse_label: editRel.reverse_label,
        cardinality: editRel.cardinality,
        // `translations` is NOT NULL in the DB — send an empty map, never null.
        translations: cleanTranslations(editRel.translations) || {},
      });
    } catch (e) {
      setRelError(e instanceof Error ? e.message : t("metamodel.relationSaveFailed"));
      return;
    }
    onRefresh();
    setEditRelOpen(false);
    setEditRel(null);
    setRelError(null);
  };

  const promptDeleteRelation = (rt: RType) => {
    setDeleteRelConfirm({
      key: rt.key,
      label: `${typeLabel(resolveType(rt.source_type_key)) || rt.source_type_key} → ${typeLabel(resolveType(rt.target_type_key)) || rt.target_type_key}`,
      builtIn: rt.built_in,
      instanceCount: null,
    });
    // Fetch instance count for the warning message
    api
      .get<{ instance_count: number }>(`/metamodel/relation-types/${rt.key}/instance-count`)
      .then((resp) => {
        setDeleteRelConfirm((prev) => (prev ? { ...prev, instanceCount: resp.instance_count } : null));
      })
      .catch(() => {
        setDeleteRelConfirm((prev) => (prev ? { ...prev, instanceCount: 0 } : null));
      });
  };

  const confirmDeleteRelation = async () => {
    if (!deleteRelConfirm) return;
    try {
      const resp = await api.delete<{ status?: string }>(
        `/metamodel/relation-types/${deleteRelConfirm.key}?force=true`,
      );
      if (resp?.status === "hidden") {
        setShowHiddenRels(true);
      }
      onRefresh();
      setDeleteRelConfirm(null);
    } catch {
      // Shouldn't fail with force=true, but just in case
    }
  };

  const handleRestoreRelation = async (key: string) => {
    await api.post(`/metamodel/relation-types/${key}/restore`);
    onRefresh();
  };

  /**
   * Flip one side's `visible` / `mandatory`. The field name is built from the
   * side passed in, never from a comparison against the card type, so the two
   * rows of a self-pair write different columns.
   */
  const toggleSideFlag = async (
    rt: RType,
    isSource: boolean,
    which: "visible" | "mandatory",
    value: boolean,
  ) => {
    const field = `${isSource ? "source" : "target"}_${which}`;
    try {
      setFlagError(null);
      await api.patch(`/metamodel/relation-types/${rt.key}`, { [field]: value });
      onRefresh();
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : t("common:errors.generic"));
    }
  };

  /** The two switches for one side, labelled with the type they apply to. */
  const renderSideFlags = (rt: RType, isSource: boolean, withTypeLabel: boolean) => {
    const flags = sideFlags(rt, isSource);
    const endpointKey = isSource ? rt.source_type_key : rt.target_type_key;
    return (
      <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
        {withTypeLabel && (
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 90 }}>
            {typeLabel(resolveType(endpointKey)) || endpointKey}
          </Typography>
        )}
        <Tooltip title={t("metamodel.typeDrawer.visibleTooltip")}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={flags.visible}
                onChange={(_, v) => toggleSideFlag(rt, isSource, "visible", v)}
              />
            }
            label={<Typography variant="caption">{t("metamodel.typeDrawer.visible")}</Typography>}
          />
        </Tooltip>
        <Tooltip title={t("metamodel.typeDrawer.mandatoryTooltip")}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={flags.mandatory}
                onChange={(_, v) => toggleSideFlag(rt, isSource, "mandatory", v)}
              />
            }
            label={<Typography variant="caption">{t("metamodel.typeDrawer.mandatory")}</Typography>}
          />
        </Tooltip>
      </Box>
    );
  };

  /** Colour dot + icon + label for one endpoint. */
  const renderEndpoint = (typeKey: string) => {
    const ct = resolveType(typeKey);
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {ct && (
          <>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                bgcolor: ct.color,
                flexShrink: 0,
              }}
            />
            <MaterialSymbol icon={ct.icon} size={16} color={ct.color} />
          </>
        )}
        <Typography variant="body2" fontWeight={500}>
          {typeLabel(ct) || typeKey}
        </Typography>
      </Box>
    );
  };

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
          mb: 2,
        }}
      >
        <FormControlLabel
          control={
            <Switch
              checked={showHiddenRels}
              onChange={(e) => setShowHiddenRels(e.target.checked)}
            />
          }
          label={t("metamodel.showHiddenRelations")}
        />
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="translate" size={18} />}
            onClick={() => setTranslateRelsOpen(true)}
          >
            {t("metamodel.translationDialog.manage")}
          </Button>
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={openCreateRelation}
          >
            {t("metamodel.newRelation")}
          </Button>
        </Box>
      </Box>

      {flagError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setFlagError(null)}>
          {flagError}
        </Alert>
      )}

      {rows.map(({ rt, isSource }) => {
        // "Type" dimensions = the single_select pickers managed via the
        // Manage relation values dialog. Surface their count as a badge.
        const typeDims = (rt.attributes_schema ?? []).filter((f) => f.type === "single_select");
        const scoped = isSource !== undefined;
        return (
          <Card
            key={scoped ? sideKey(rt, isSource) : rt.key}
            sx={{ mb: 1, opacity: rt.is_hidden ? 0.5 : 1 }}
          >
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                {scoped ? (
                  <>
                    {/* Read from the card type outwards: its verb for this
                        side, then the other end. */}
                    <Typography variant="body2" fontWeight={600} color="primary.main">
                      {relationLabel(rt, !isSource)}
                    </Typography>
                    <MaterialSymbol
                      icon={isSource ? "arrow_forward" : "arrow_back"}
                      size={16}
                      color="#bbb"
                    />
                    {renderEndpoint(isSource ? rt.target_type_key : rt.source_type_key)}
                  </>
                ) : (
                  <>
                    {renderEndpoint(rt.source_type_key)}
                    <MaterialSymbol icon="arrow_forward" size={16} color="#bbb" />
                    <Typography variant="body2" fontWeight={600} color="primary.main">
                      {relationLabel(rt)}
                    </Typography>
                    <MaterialSymbol icon="arrow_forward" size={16} color="#bbb" />
                    {renderEndpoint(rt.target_type_key)}
                  </>
                )}

                <Box sx={{ flex: 1 }} />

                <Chip
                  size="small"
                  label={rt.cardinality}
                  variant="outlined"
                  sx={{ height: 22, fontSize: 11 }}
                />
                {rt.built_in && (
                  <Chip
                    size="small"
                    label={t("metamodel.builtIn")}
                    color="info"
                    sx={{ height: 22, fontSize: 11 }}
                  />
                )}
                {rt.is_hidden && (
                  <Chip
                    size="small"
                    label={t("metamodel.hidden")}
                    color="warning"
                    sx={{ height: 22, fontSize: 11 }}
                  />
                )}

                {typeDims.length > 0 && (
                  <Tooltip title={typeDims.map((f) => fieldLabel(f)).join(", ")}>
                    <Chip
                      size="small"
                      color="secondary"
                      icon={<MaterialSymbol icon="sell" size={13} color="inherit" />}
                      label={typeDims.length}
                      sx={{ height: 22, fontSize: 11 }}
                    />
                  </Tooltip>
                )}

                {rt.is_hidden ? (
                  <Tooltip title={t("common:actions.restore")}>
                    <IconButton size="small" onClick={() => handleRestoreRelation(rt.key)}>
                      <MaterialSymbol icon="restore" size={18} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <>
                    <Tooltip title={t("metamodel.manageRelationValues")}>
                      <IconButton size="small" onClick={() => setValuesRel(rt)}>
                        <MaterialSymbol icon="label" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("common:actions.edit")}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditRel({ ...rt });
                          setRelError(null);
                          setEditRelOpen(true);
                        }}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("common:actions.delete")}>
                      <IconButton size="small" onClick={() => promptDeleteRelation(rt)}>
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Box>

              {/* Per-side visibility / mandatory. Scoped shows the side under
                  view; unscoped shows both, each labelled with its endpoint —
                  the general tab could not reach these at all before. */}
              <Box sx={{ mt: 1 }}>
                {scoped ? (
                  renderSideFlags(rt, isSource, false)
                ) : (
                  <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {renderSideFlags(rt, true, true)}
                    {renderSideFlags(rt, false, true)}
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        );
      })}

      {rows.length === 0 && !loading && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", mt: 2 }}>
          {scopeTypeKey ? t("metamodel.typeDrawer.noRelations") : t("metamodel.noRelationTypes")}
        </Typography>
      )}

      <RelationTypeValuesDialog
        open={!!valuesRel}
        relationType={valuesRel}
        onClose={() => setValuesRel(null)}
        onSaved={onRefresh}
      />

      <RelationTranslationDialog
        open={translateRelsOpen}
        relationTypes={displayRelationTypes}
        types={types}
        onClose={() => setTranslateRelsOpen(false)}
        onSaved={onRefresh}
      />

      {/* --- Create relation dialog --- */}
      <Dialog
        open={createRelOpen}
        onClose={() => {
          setCreateRelOpen(false);
          setRelError(null);
        }}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{t("metamodel.createRelationType")}</DialogTitle>
        <DialogContent>
          {relError && (
            <Alert severity="error" sx={{ mt: 1, mb: 2 }} onClose={() => setRelError(null)}>
              {relError}
            </Alert>
          )}
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
            <InputLabel>{t("metamodel.sourceType")}</InputLabel>
            <Select
              value={newRel.source_type_key}
              label={t("metamodel.sourceType")}
              onChange={(e) =>
                setNewRel({
                  ...newRel,
                  source_type_key: e.target.value,
                  // Clear so the derived key refills — unless the admin typed
                  // their own, which is theirs to keep.
                  key: relKeyTouched ? newRel.key : "",
                })
              }
            >
              {types.map((ct) => (
                <MenuItem key={ct.key} value={ct.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: ct.color }}
                    />
                    <MaterialSymbol icon={ct.icon} size={16} color={ct.color} />
                    {ct.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>{t("metamodel.targetType")}</InputLabel>
            <Select
              value={newRel.target_type_key}
              label={t("metamodel.targetType")}
              onChange={(e) =>
                setNewRel({
                  ...newRel,
                  target_type_key: e.target.value,
                  key: relKeyTouched ? newRel.key : "",
                })
              }
            >
              {types.map((ct) => (
                <MenuItem key={ct.key} value={ct.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: ct.color }}
                    />
                    <MaterialSymbol icon={ct.icon} size={16} color={ct.color} />
                    {ct.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {relPairConflicts.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t("metamodel.relPairExistsWarning", {
                relations: relPairConflicts.map((r) => relationLabel(r)).join(", "),
              })}
            </Alert>
          )}

          <TextField
            fullWidth
            label={`${t("metamodel.labelVerb")}${localeSuffix}`}
            value={newRel.label}
            onChange={(e) => setNewRel({ ...newRel, label: e.target.value })}
            sx={{ mb: 2 }}
            error={!newRel.label.trim()}
          />
          <TextField
            fullWidth
            label={`${t("metamodel.reverseLabel")}${localeSuffix}`}
            value={newRel.reverse_label}
            onChange={(e) => setNewRel({ ...newRel, reverse_label: e.target.value })}
            sx={{ mb: 2 }}
          />
          <KeyInput
            fullWidth
            label={t("metamodel.keyLabel")}
            value={newRel.key || autoRelKey}
            onChange={(v) => {
              setRelKeyTouched(true);
              setNewRel({ ...newRel, key: v });
            }}
            sx={{ mb: 2 }}
            size="small"
            required={!!newRel.label.trim()}
            hint={t("metamodel.relKeyGeneratedHint")}
          />
          <FormControl fullWidth>
            <InputLabel>{t("metamodel.cardinality")}</InputLabel>
            <Select
              value={newRel.cardinality}
              label={t("metamodel.cardinality")}
              onChange={(e) =>
                setNewRel({
                  ...newRel,
                  cardinality: e.target.value as "1:1" | "1:n" | "n:m",
                })
              }
            >
              {CARDINALITY_OPTIONS.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateRelOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleCreateRelation}
            disabled={
              !newRel.source_type_key ||
              !newRel.target_type_key ||
              !(newRel.key || autoRelKey) ||
              !newRel.label ||
              !isValidKey(newRel.key || autoRelKey)
            }
          >
            {t("common:actions.create")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Edit relation dialog --- */}
      <Dialog
        open={editRelOpen}
        onClose={() => {
          setEditRelOpen(false);
          setRelError(null);
        }}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{t("metamodel.editRelationType")}</DialogTitle>
        {editRel && (
          <>
            <DialogContent>
              {relError && (
                <Alert severity="error" sx={{ mt: 1, mb: 2 }} onClose={() => setRelError(null)}>
                  {relError}
                </Alert>
              )}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, mt: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {typeLabel(resolveType(editRel.source_type_key)) || editRel.source_type_key}
                </Typography>
                <MaterialSymbol icon="arrow_forward" size={16} color="#bbb" />
                <Typography variant="body2" color="text.secondary">
                  {typeLabel(resolveType(editRel.target_type_key)) || editRel.target_type_key}
                </Typography>
              </Box>
              <TextField
                fullWidth
                label={`${t("common:labels.name")}${localeSuffix}`}
                value={editRel.translations?.label?.[locale] ?? editRel.label}
                onChange={(e) =>
                  setEditRel({
                    ...editRel,
                    // English is the base column; other locales live only in
                    // `translations` so the English fallback stays intact.
                    ...(isBaseLocale(locale) ? { label: e.target.value } : {}),
                    translations: mergeVerbTranslation(
                      editRel.translations,
                      "label",
                      locale,
                      e.target.value,
                    ),
                  })
                }
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                label={`${t("metamodel.reverseLabel")}${localeSuffix}`}
                value={
                  editRel.translations?.reverse_label?.[locale] ?? editRel.reverse_label ?? ""
                }
                onChange={(e) =>
                  setEditRel({
                    ...editRel,
                    ...(isBaseLocale(locale) ? { reverse_label: e.target.value } : {}),
                    translations: mergeVerbTranslation(
                      editRel.translations,
                      "reverse_label",
                      locale,
                      e.target.value,
                    ),
                  })
                }
                sx={{ mb: 2 }}
              />
              <FormControl fullWidth>
                <InputLabel>{t("metamodel.cardinality")}</InputLabel>
                <Select
                  value={editRel.cardinality}
                  label={t("metamodel.cardinality")}
                  onChange={(e) =>
                    setEditRel({
                      ...editRel,
                      cardinality: e.target.value as "1:1" | "1:n" | "n:m",
                    })
                  }
                >
                  {CARDINALITY_OPTIONS.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditRelOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button variant="contained" onClick={handleUpdateRelation}>
                {t("common:actions.save")}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* --- Delete relation confirmation --- */}
      <Dialog
        open={!!deleteRelConfirm}
        onClose={() => setDeleteRelConfirm(null)}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>{t("metamodel.deleteRelationType")}</DialogTitle>
        <DialogContent>
          {deleteRelConfirm && (
            <>
              <Typography variant="body2" sx={{ mt: 1, mb: 1 }}>
                <strong>{deleteRelConfirm.label}</strong>
              </Typography>
              {deleteRelConfirm.instanceCount === null ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : deleteRelConfirm.instanceCount > 0 ? (
                <Alert severity="warning">
                  <span
                    dangerouslySetInnerHTML={{
                      __html: t("metamodel.deleteRelHasInstances", {
                        count: deleteRelConfirm.instanceCount,
                      }),
                    }}
                  />
                </Alert>
              ) : deleteRelConfirm.builtIn ? (
                <Alert severity="info">{t("metamodel.deleteRelBuiltInHidden")}</Alert>
              ) : (
                <Alert severity="info">{t("metamodel.deleteRelNoInstances")}</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRelConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteRelConfirm?.instanceCount === null}
            onClick={confirmDeleteRelation}
          >
            {deleteRelConfirm?.builtIn && deleteRelConfirm.instanceCount === 0
              ? t("metamodel.hidden")
              : t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
