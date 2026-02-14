import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { WebPortal } from "@/types";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function WebPortalsAdmin() {
  const { types } = useMetamodel();
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
  const [factSheetType, setFactSheetType] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [displayFields, setDisplayFields] = useState<string[]>([]);
  const [filterSubtypes, setFilterSubtypes] = useState<string[]>([]);

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
    setFactSheetType("");
    setIsPublished(false);
    setDisplayFields([]);
    setFilterSubtypes([]);
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
    setFactSheetType(portal.fact_sheet_type);
    setIsPublished(portal.is_published);
    setDisplayFields(portal.display_fields || []);
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

  const selectedType = visibleTypes.find((t) => t.key === factSheetType);
  const allFields =
    selectedType?.fields_schema?.flatMap((s) => s.fields) || [];

  const handleSave = async () => {
    setError("");
    const body = {
      name,
      slug,
      description: description || null,
      fact_sheet_type: factSheetType,
      is_published: isPublished,
      display_fields: displayFields.length > 0 ? displayFields : null,
      filters:
        filterSubtypes.length > 0 ? { subtypes: filterSubtypes } : null,
      card_config: null,
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
        Web portals are public-facing pages that display fact sheets to end
        users without requiring authentication. Configure which fact sheet type
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
              Create your first portal to share fact sheet data with end users.
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
              color={getTypeColor(portal.fact_sheet_type)}
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
                  label={getTypeLabel(portal.fact_sheet_type)}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: "0.65rem",
                    bgcolor: `${getTypeColor(portal.fact_sheet_type)}18`,
                    color: getTypeColor(portal.fact_sheet_type),
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
        maxWidth="sm"
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
          <TextField
            fullWidth
            label="Portal Name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            sx={{ mt: 1 }}
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
            sx={{ mt: 2 }}
            helperText={`Portal will be accessible at /portal/${slug || "..."}`}
            placeholder="e.g. application-catalog"
          />
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
          <TextField
            fullWidth
            select
            label="Fact Sheet Type"
            value={factSheetType}
            onChange={(e) => {
              setFactSheetType(e.target.value);
              setDisplayFields([]);
              setFilterSubtypes([]);
            }}
            sx={{ mt: 2 }}
            helperText="Which type of fact sheets to display in this portal"
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
              helperText="Only show fact sheets of these subtypes"
            >
              {selectedType.subtypes.map((st) => (
                <MenuItem key={st.key} value={st.key}>
                  {st.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          {allFields.length > 0 && (
            <TextField
              fullWidth
              select
              label="Display Fields on Cards (optional)"
              value={displayFields}
              onChange={(e) =>
                setDisplayFields(
                  typeof e.target.value === "string"
                    ? e.target.value.split(",")
                    : (e.target.value as string[])
                )
              }
              sx={{ mt: 2 }}
              SelectProps={{ multiple: true }}
              helperText="Select which fields to show on fact sheet cards. Leave empty to show all."
            >
              {allFields.map((f) => (
                <MenuItem key={f.key} value={f.key}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
              />
            }
            label="Published (publicly accessible)"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!name.trim() || !slug.trim() || !factSheetType}
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
