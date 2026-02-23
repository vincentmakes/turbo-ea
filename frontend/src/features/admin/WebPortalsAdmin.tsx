import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel, useResolveLabel } from "@/hooks/useResolveLabel";
import type { WebPortal } from "@/types";

interface ToggleEntry {
  card: boolean;
  detail: boolean;
}
type Toggles = Record<string, ToggleEntry>;

const BUILT_IN_PROPERTY_KEYS = [
  "description",
  "lifecycle",
  "tags",
  "subscribers",
  "data_quality",
  "approval_status",
] as const;

const DEFAULT_CARD: Record<string, boolean> = {
  description: true,
  lifecycle: true,
  tags: true,
  subscribers: true,
  data_quality: true,
  approval_status: false,
};

const DEFAULT_DETAIL: Record<string, boolean> = {
  description: true,
  lifecycle: true,
  tags: true,
  subscribers: true,
  data_quality: true,
  approval_status: true,
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function WebPortalsAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const { types, relationTypes } = useMetamodel();
  const rml = useResolveMetaLabel();
  const rl = useResolveLabel();

  const BUILT_IN_PROPERTIES = BUILT_IN_PROPERTY_KEYS.map((key) => ({
    key,
    label: t(`webPortals.builtInProps.${key}`),
  }));
  const [portals, setPortals] = useState<WebPortal[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPortal, setEditingPortal] = useState<WebPortal | null>(null);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [description, setDescription] = useState("");
  const [cardType, setCardType] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [toggles, setToggles] = useState<Toggles>({});
  const [filterSubtypes, setFilterSubtypes] = useState<string[]>([]);
  const [showLogo, setShowLogo] = useState(true);

  const visibleTypes = types.filter((tp) => !tp.is_hidden);

  const load = async () => {
    try {
      const data = await api.get<WebPortal[]>("/web-portals");
      setPortals(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setName("");
    setSlug("");
    setSlugManual(false);
    setDescription("");
    setCardType("");
    setIsPublished(false);
    setToggles({});
    setFilterSubtypes([]);
    setShowLogo(true);
    setError("");
    setEditingPortal(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (portal: WebPortal) => {
    setEditingPortal(portal);
    setName(portal.name);
    setSlug(portal.slug);
    setSlugManual(true);
    setDescription(portal.description || "");
    setCardType(portal.card_type);
    setIsPublished(portal.is_published);
    setToggles(
      (portal.card_config as Record<string, unknown>)?.toggles as Toggles || {}
    );
    setShowLogo(
      (portal.card_config as Record<string, unknown>)?.show_logo !== false
    );
    setFilterSubtypes(
      ((portal.filters as Record<string, unknown>)?.subtypes as string[]) || []
    );
    setError("");
    setDialogOpen(true);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManual) {
      setSlug(slugify(value));
    }
  };

  const selectedType = visibleTypes.find((tp) => tp.key === cardType);
  const allFields =
    selectedType?.fields_schema?.flatMap((s) => s.fields) || [];

  // Relation types applicable to the selected card type
  // Since the API excludes hidden types, check that the other-end type exists in visible types
  const visibleTypeKeys = new Set(types.map((tp) => tp.key));
  const applicableRelTypes = cardType
    ? relationTypes.filter(
        (r) =>
          !r.is_hidden &&
          (r.source_type_key === cardType ||
            r.target_type_key === cardType) &&
          visibleTypeKeys.has(
            r.source_type_key === cardType
              ? r.target_type_key
              : r.source_type_key
          )
      )
    : [];

  const getOtherTypeLabel = (rt: { source_type_key: string; target_type_key: string }) => {
    const otherKey =
      rt.source_type_key === cardType
        ? rt.target_type_key
        : rt.source_type_key;
    const tp = types.find((tp) => tp.key === otherKey);
    return rml(tp?.label ?? "", tp?.translations, "label") || otherKey;
  };

  const handleSave = async () => {
    setError("");
    const hasToggles = Object.keys(toggles).length > 0;
    const hasCardConfig = hasToggles || !showLogo;
    const body = {
      name,
      slug,
      description: description || null,
      card_type: cardType,
      is_published: isPublished,
      display_fields: null,
      filters:
        filterSubtypes.length > 0 ? { subtypes: filterSubtypes } : null,
      card_config: hasCardConfig
        ? { ...(hasToggles ? { toggles } : {}), show_logo: showLogo }
        : null,
    };
    try {
      if (editingPortal) {
        await api.patch(`/web-portals/${editingPortal.id}`, body);
      } else {
        await api.post("/web-portals", body);
      }
      setDialogOpen(false);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("webPortals.saveError"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/web-portals/${id}`);
      setDeleteConfirm(null);
      load();
    } catch {
      // ignore
    }
  };

  const handleTogglePublish = async (portal: WebPortal) => {
    try {
      await api.patch(`/web-portals/${portal.id}`, {
        is_published: !portal.is_published,
      });
      load();
    } catch {
      // ignore
    }
  };

  const getTypeLabel = (key: string) => {
    const ct = types.find((tp) => tp.key === key);
    return rml(ct?.label ?? "", ct?.translations, "label") || key;
  };

  const getTypeColor = (key: string) => {
    const ct = types.find((tp) => tp.key === key);
    return ct?.color || "#666";
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t("webPortals.description")}
        </Typography>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={openCreate}
          sx={{ flexShrink: 0 }}
        >
          {t("webPortals.createPortal")}
        </Button>
      </Box>

      {portals.length === 0 && (
        <Card>
          <CardContent
            sx={{
              textAlign: "center",
              py: 6,
            }}
          >
            <MaterialSymbol
              icon="language"
              size={48}
              color="#ccc"
            />
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1 }}>
              {t("webPortals.noPortals")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("webPortals.noPortalsHint")}
            </Typography>
            <Button variant="outlined" onClick={openCreate}>
              {t("webPortals.createPortal")}
            </Button>
          </CardContent>
        </Card>
      )}

      {portals.map((portal) => (
        <Card key={portal.id} sx={{ mb: 2 }}>
          <CardContent
            sx={{ display: "flex", alignItems: "center", gap: 2, py: 2 }}
          >
            <MaterialSymbol
              icon="language"
              size={24}
              color={getTypeColor(portal.card_type)}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {portal.name}
                </Typography>
                <Chip
                  label={portal.is_published ? t("common:status.published") : t("common:status.draft")}
                  size="small"
                  color={portal.is_published ? "success" : "default"}
                  sx={{ height: 22, fontSize: "0.7rem" }}
                />
              </Box>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}
              >
                <Chip
                  label={getTypeLabel(portal.card_type)}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: "0.65rem",
                    bgcolor: `${getTypeColor(portal.card_type)}18`,
                    color: getTypeColor(portal.card_type),
                    fontWeight: 600,
                  }}
                />
                <Typography
                  component="a"
                  href={`/portal/${portal.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="caption"
                  sx={{
                    color: "primary.main",
                    textDecoration: "none",
                    "&:hover": { textDecoration: "underline" },
                  }}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  /portal/{portal.slug}
                </Typography>
              </Box>
              {portal.description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  {portal.description}
                </Typography>
              )}
            </Box>
            <Tooltip
              title={portal.is_published ? t("webPortals.unpublish") : t("webPortals.publish")}
            >
              <IconButton
                size="small"
                onClick={() => handleTogglePublish(portal)}
                color={portal.is_published ? "success" : "default"}
              >
                <MaterialSymbol
                  icon={portal.is_published ? "visibility" : "visibility_off"}
                  size={20}
                />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("webPortals.openPortal")}>
              <IconButton
                size="small"
                component="a"
                href={`/portal/${portal.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MaterialSymbol icon="open_in_new" size={20} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("webPortals.copyUrl")}>
              <IconButton
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/portal/${portal.slug}`
                  );
                }}
              >
                <MaterialSymbol icon="content_copy" size={20} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("webPortals.editPortal")}>
              <IconButton size="small" onClick={() => openEdit(portal)}>
                <MaterialSymbol icon="edit" size={20} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("common:actions.delete")}>
              <IconButton
                size="small"
                color="error"
                onClick={() => setDeleteConfirm(portal.id)}
              >
                <MaterialSymbol icon="delete" size={20} />
              </IconButton>
            </Tooltip>
          </CardContent>
        </Card>
      ))}

      {/* Create / Edit dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingPortal ? t("webPortals.editPortal") : t("webPortals.createWebPortal")}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* ── Section: General ── */}
          <Typography
            variant="overline"
            sx={{ display: "block", mt: 1, mb: 1.5, fontWeight: 700, color: "text.secondary", letterSpacing: 1 }}
          >
            {t("webPortals.section.general")}
          </Typography>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              fullWidth
              label={t("webPortals.portalName")}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t("webPortals.namePlaceholder")}
            />
            <TextField
              fullWidth
              label={t("webPortals.urlSlug")}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugManual(true);
              }}
              helperText={`/portal/${slug || "..."}`}
              placeholder={t("webPortals.slugPlaceholder")}
            />
          </Box>
          <TextField
            fullWidth
            label={t("common:labels.description")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mt: 2 }}
            multiline
            rows={2}
            placeholder={t("webPortals.descriptionPlaceholder")}
          />

          <Divider sx={{ my: 3 }} />

          {/* ── Section: Data Source ── */}
          <Typography
            variant="overline"
            sx={{ display: "block", mb: 1.5, fontWeight: 700, color: "text.secondary", letterSpacing: 1 }}
          >
            {t("webPortals.section.dataSource")}
          </Typography>
          <TextField
            fullWidth
            select
            label={t("common:labels.type")}
            value={cardType}
            onChange={(e) => {
              setCardType(e.target.value);
              setToggles({});
              setFilterSubtypes([]);
            }}
            helperText={t("webPortals.cardTypeHelper")}
          >
            {visibleTypes.map((ct) => (
              <MenuItem key={ct.key} value={ct.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol
                    icon={ct.icon}
                    size={18}
                    color={ct.color}
                  />
                  {rml(ct.label, ct.translations, "label")}
                </Box>
              </MenuItem>
            ))}
          </TextField>

          {selectedType?.subtypes && selectedType.subtypes.length > 0 && (
            <TextField
              fullWidth
              select
              label={t("webPortals.filterSubtypes")}
              value={filterSubtypes}
              onChange={(e) =>
                setFilterSubtypes(
                  typeof e.target.value === "string"
                    ? e.target.value.split(",")
                    : (e.target.value as string[])
                )
              }
              sx={{ mt: 2 }}
              SelectProps={{ multiple: true }}
              helperText={t("webPortals.filterSubtypesHelper")}
            >
              {selectedType.subtypes.map((st) => (
                <MenuItem key={st.key} value={st.key}>
                  {rl(st.label, st.translations)}
                </MenuItem>
              ))}
            </TextField>
          )}

          {cardType && (
            <>
            <Divider sx={{ my: 3 }} />

            {/* ── Section: Display Configuration ── */}
            <Typography
              variant="overline"
              sx={{ display: "block", mb: 0.5, fontWeight: 700, color: "text.secondary", letterSpacing: 1 }}
            >
              {t("webPortals.section.displayConfig")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              {t("webPortals.displayConfigHint")}
            </Typography>
              <Table size="small" sx={{ "& td, & th": { py: 0.5, px: 1 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: "50%" }}>{t("webPortals.columns.property")}</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 600 }}>{t("webPortals.columns.summaryCard")}</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 600 }}>{t("webPortals.columns.expandedDetail")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {BUILT_IN_PROPERTIES.map((prop) => {
                    const tog = toggles[prop.key];
                    const cardChecked = tog ? tog.card : (DEFAULT_CARD[prop.key] ?? true);
                    const detailChecked = tog ? tog.detail : (DEFAULT_DETAIL[prop.key] ?? true);
                    return (
                      <TableRow key={prop.key}>
                        <TableCell>
                          <Typography variant="body2">{prop.label}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={cardChecked}
                            onChange={(e) =>
                              setToggles((prev) => ({
                                ...prev,
                                [prop.key]: {
                                  card: e.target.checked,
                                  detail: detailChecked,
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={detailChecked}
                            onChange={(e) =>
                              setToggles((prev) => ({
                                ...prev,
                                [prop.key]: {
                                  card: cardChecked,
                                  detail: e.target.checked,
                                },
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {allFields.length > 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        sx={{
                          pt: 1.5,
                          pb: 0.5,
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: "text.secondary",
                          borderBottom: "none",
                        }}
                      >
                        {t("webPortals.customFields")}
                      </TableCell>
                    </TableRow>
                  )}

                  {allFields.map((field, idx) => {
                    const fKey = `field:${field.key}`;
                    const tog = toggles[fKey];
                    const cardChecked = tog ? tog.card : idx < 3;
                    const detailChecked = tog ? tog.detail : true;
                    return (
                      <TableRow key={fKey}>
                        <TableCell>
                          <Typography variant="body2">{rl(field.label, field.translations)}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={cardChecked}
                            onChange={(e) =>
                              setToggles((prev) => ({
                                ...prev,
                                [fKey]: {
                                  card: e.target.checked,
                                  detail: detailChecked,
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={detailChecked}
                            onChange={(e) =>
                              setToggles((prev) => ({
                                ...prev,
                                [fKey]: {
                                  card: cardChecked,
                                  detail: e.target.checked,
                                },
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {applicableRelTypes.length > 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        sx={{
                          pt: 1.5,
                          pb: 0.5,
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: "text.secondary",
                          borderBottom: "none",
                        }}
                      >
                        {t("webPortals.relatedItems")}
                      </TableCell>
                    </TableRow>
                  )}

                  {applicableRelTypes.map((rt) => {
                    const rKey = `rel:${rt.key}`;
                    const tog = toggles[rKey];
                    const cardChecked = tog ? tog.card : false;
                    const detailChecked = tog ? tog.detail : false;
                    const verb =
                      rt.source_type_key === cardType
                        ? rml(rt.label, rt.translations, "label")
                        : rml(rt.reverse_label || rt.label, rt.translations, "reverse_label") || rml(rt.label, rt.translations, "label");
                    return (
                      <TableRow key={rKey}>
                        <TableCell>
                          <Typography variant="body2">
                            {getOtherTypeLabel(rt)}{" "}
                            <Typography
                              component="span"
                              variant="caption"
                              color="text.secondary"
                            >
                              ({verb})
                            </Typography>
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={cardChecked}
                            onChange={(e) =>
                              setToggles((prev) => ({
                                ...prev,
                                [rKey]: {
                                  card: e.target.checked,
                                  detail: detailChecked,
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={detailChecked}
                            onChange={(e) =>
                              setToggles((prev) => ({
                                ...prev,
                                [rKey]: {
                                  card: cardChecked,
                                  detail: e.target.checked,
                                },
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}

          <Divider sx={{ my: 3 }} />

          {/* ── Section: Publishing ── */}
          <FormControlLabel
            control={
              <Switch
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body1" fontWeight={500}>
                  {t("webPortals.published")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("webPortals.publishedHint")}
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={showLogo}
                onChange={(e) => setShowLogo(e.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body1" fontWeight={500}>
                  {t("webPortals.showLogo")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("webPortals.showLogoHint")}
                </Typography>
              </Box>
            }
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!name.trim() || !slug.trim() || !cardType}
          >
            {editingPortal ? t("webPortals.saveChanges") : t("common:actions.create")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
      >
        <DialogTitle>{t("webPortals.deletePortal")}</DialogTitle>
        <DialogContent>
          <Typography>
            {t("webPortals.deleteConfirm")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
          >
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
