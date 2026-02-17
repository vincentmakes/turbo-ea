import { useState, useEffect } from "react";
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
import type { WebPortal } from "@/types";

interface ToggleEntry {
  card: boolean;
  detail: boolean;
}
type Toggles = Record<string, ToggleEntry>;

const BUILT_IN_PROPERTIES = [
  { key: "description", label: "Description" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "tags", label: "Tags" },
  { key: "subscribers", label: "Team / Stakeholders" },
  { key: "data_quality", label: "Data Quality" },
  { key: "approval_status", label: "Approval Status" },
];

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
  const { types, relationTypes } = useMetamodel();
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

  const visibleTypes = types.filter((t) => !t.is_hidden);

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

  const selectedType = visibleTypes.find((t) => t.key === cardType);
  const allFields =
    selectedType?.fields_schema?.flatMap((s) => s.fields) || [];

  // Relation types applicable to the selected card type
  const hiddenTypeKeys = new Set(types.filter((t) => t.is_hidden).map((t) => t.key));
  const applicableRelTypes = cardType
    ? relationTypes.filter(
        (r) =>
          !r.is_hidden &&
          (r.source_type_key === cardType ||
            r.target_type_key === cardType) &&
          !hiddenTypeKeys.has(
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
    return types.find((t) => t.key === otherKey)?.label || otherKey;
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
      setError(err instanceof Error ? err.message : "Failed to save portal");
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
    const t = types.find((t) => t.key === key);
    return t?.label || key;
  };

  const getTypeColor = (key: string) => {
    const t = types.find((t) => t.key === key);
    return t?.color || "#666";
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <MaterialSymbol icon="language" size={28} color="#1976d2" />
        <Typography variant="h5" fontWeight={600}>
          Web Portals
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={openCreate}
        >
          Create Portal
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Web portals are public-facing pages that display cards to end
        users without requiring authentication. Configure which card type
        to display, apply filters, and customize the card layout.
      </Typography>

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
              No web portals yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Create your first portal to share card data with end users.
            </Typography>
            <Button variant="outlined" onClick={openCreate}>
              Create Portal
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
                  label={portal.is_published ? "Published" : "Draft"}
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
              title={portal.is_published ? "Unpublish" : "Publish"}
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
            <Tooltip title="Open Portal">
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
            <Tooltip title="Copy portal URL">
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
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => openEdit(portal)}>
                <MaterialSymbol icon="edit" size={20} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
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
          {editingPortal ? "Edit Portal" : "Create Web Portal"}
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
            General
          </Typography>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              fullWidth
              label="Portal Name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Application Catalog"
            />
            <TextField
              fullWidth
              label="URL Slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugManual(true);
              }}
              helperText={`/portal/${slug || "..."}`}
              placeholder="e.g. application-catalog"
            />
          </Box>
          <TextField
            fullWidth
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mt: 2 }}
            multiline
            rows={2}
            placeholder="Optional description displayed at the top of the portal"
          />

          <Divider sx={{ my: 3 }} />

          {/* ── Section: Data Source ── */}
          <Typography
            variant="overline"
            sx={{ display: "block", mb: 1.5, fontWeight: 700, color: "text.secondary", letterSpacing: 1 }}
          >
            Data Source
          </Typography>
          <TextField
            fullWidth
            select
            label="Card Type"
            value={cardType}
            onChange={(e) => {
              setCardType(e.target.value);
              setToggles({});
              setFilterSubtypes([]);
            }}
            helperText="Which type of cards to display in this portal"
          >
            {visibleTypes.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol
                    icon={t.icon}
                    size={18}
                    color={t.color}
                  />
                  {t.label}
                </Box>
              </MenuItem>
            ))}
          </TextField>

          {selectedType?.subtypes && selectedType.subtypes.length > 0 && (
            <TextField
              fullWidth
              select
              label="Filter by Subtypes (optional)"
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
              helperText="Only show cards of these subtypes"
            >
              {selectedType.subtypes.map((st) => (
                <MenuItem key={st.key} value={st.key}>
                  {st.label}
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
              Display Configuration
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
              Choose which properties appear on the summary card and the expanded
              detail view. Visible select fields and relation types also become
              filter dropdowns on the portal automatically.
            </Typography>
              <Table size="small" sx={{ "& td, & th": { py: 0.5, px: 1 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: "50%" }}>Property</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 600 }}>Summary Card</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 600 }}>Expanded Detail</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {BUILT_IN_PROPERTIES.map((prop) => {
                    const t = toggles[prop.key];
                    const cardChecked = t ? t.card : (DEFAULT_CARD[prop.key] ?? true);
                    const detailChecked = t ? t.detail : (DEFAULT_DETAIL[prop.key] ?? true);
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
                        Custom Fields
                      </TableCell>
                    </TableRow>
                  )}

                  {allFields.map((field, idx) => {
                    const fKey = `field:${field.key}`;
                    const t = toggles[fKey];
                    const cardChecked = t ? t.card : idx < 3;
                    const detailChecked = t ? t.detail : true;
                    return (
                      <TableRow key={fKey}>
                        <TableCell>
                          <Typography variant="body2">{field.label}</Typography>
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
                        Related Items
                      </TableCell>
                    </TableRow>
                  )}

                  {applicableRelTypes.map((rt) => {
                    const rKey = `rel:${rt.key}`;
                    const t = toggles[rKey];
                    const cardChecked = t ? t.card : false;
                    const detailChecked = t ? t.detail : false;
                    const verb =
                      rt.source_type_key === cardType
                        ? rt.label
                        : rt.reverse_label || rt.label;
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
                  Published
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Make this portal publicly accessible without authentication
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
                  Show Logo
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Display the application logo in the portal header
                </Typography>
              </Box>
            }
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!name.trim() || !slug.trim() || !cardType}
          >
            {editingPortal ? "Save Changes" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
      >
        <DialogTitle>Delete Portal</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this portal? This action cannot be
            undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
