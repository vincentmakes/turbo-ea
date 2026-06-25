import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { EAStandard } from "@/types";

const COMPLIANCE_LEVELS = ["mandated", "recommended", "deprecated"];
const CATEGORIES = ["technical", "data", "security", "interoperability", "business", "governance"];
const COMPLIANCE_LEVEL_COLORS: Record<string, string> = {
  mandated: SEVERITY_COLORS.critical,
  recommended: STATUS_COLORS.info,
  deprecated: STATUS_COLORS.warning,
};

interface StandardFormData extends Partial<EAStandard> {
  title: string;
  category?: string;
  compliance_level?: string;
}

export default function StandardsAdmin() {
  const { t } = useTranslation("admin");
  const [loading, setLoading] = useState(true);
  const [standards, setStandards] = useState<EAStandard[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<StandardFormData>({ title: "", category: "technical", compliance_level: "recommended" });

  useEffect(() => {
    fetchStandards();
  }, []);

  const fetchStandards = async () => {
    setLoading(true);
    try {
      const data = await api.get<EAStandard[]>("/metamodel/standards");
      setStandards(data);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (standard?: EAStandard) => {
    if (standard) {
      setEditingId(standard.id);
      setFormData({
        title: standard.title,
        description: standard.description,
        rationale: standard.rationale,
        category: standard.category,
        compliance_level: standard.compliance_level,
        reference_url: standard.reference_url,
        is_active: standard.is_active,
        sort_order: standard.sort_order,
      });
    } else {
      setEditingId(null);
      setFormData({ title: "", category: "technical", compliance_level: "recommended", is_active: true, sort_order: 0 });
    }
    setOpenDialog(true);
  };

  const handleClose = () => {
    setOpenDialog(false);
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await api.patch(`/metamodel/standards/${editingId}`, formData);
      } else {
        await api.post("/metamodel/standards", formData);
      }
      await fetchStandards();
      handleClose();
    } catch (error) {
      console.error("Failed to save standard:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("admin.confirmDelete"))) return;
    try {
      await api.delete(`/metamodel/standards/${id}`);
      await fetchStandards();
    } catch (error) {
      console.error("Failed to delete standard:", error);
    }
  };

  if (loading) {
    return <CircularProgress />;
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <h3>EA Standards</h3>
        <Button variant="contained" startIcon={<MaterialSymbol icon="add" size={18} />} onClick={() => handleOpen()}>
          New Standard
        </Button>
      </Box>

      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Compliance Level</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell>Active</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {standards.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.title}</TableCell>
                <TableCell>{s.category}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={s.compliance_level}
                    sx={{ backgroundColor: COMPLIANCE_LEVEL_COLORS[s.compliance_level] || STATUS_COLORS.info, color: "white" }}
                  />
                </TableCell>
                <TableCell>{s.reference_url ? <a href={s.reference_url} target="_blank" rel="noreferrer">Link</a> : "-"}</TableCell>
                <TableCell>{s.is_active ? "Yes" : "No"}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleOpen(s)}>
                    <MaterialSymbol icon="edit" size={18} />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(s.id)}>
                    <MaterialSymbol icon="delete" size={18} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={openDialog} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? "Edit Standard" : "New Standard"}</DialogTitle>
        <DialogContent sx={{ pt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            fullWidth
            label="Title"
            value={formData.title || ""}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Description"
            value={formData.description || ""}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Rationale"
            value={formData.rationale || ""}
            onChange={(e) => setFormData({ ...formData, rationale: e.target.value })}
          />
          <Select
            fullWidth
            value={formData.category || "technical"}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            label="Category"
          >
            {CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </Select>
          <Select
            fullWidth
            value={formData.compliance_level || "recommended"}
            onChange={(e) => setFormData({ ...formData, compliance_level: e.target.value })}
            label="Compliance Level"
          >
            {COMPLIANCE_LEVELS.map((l) => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </Select>
          <TextField
            fullWidth
            label="Reference URL"
            type="url"
            value={formData.reference_url || ""}
            onChange={(e) => setFormData({ ...formData, reference_url: e.target.value })}
          />
          <FormControlLabel
            control={<Switch checked={formData.is_active ?? true} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} />}
            label="Active"
          />
          <TextField
            fullWidth
            type="number"
            label="Sort Order"
            value={formData.sort_order || 0}
            onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) })}
            inputProps={{ min: 0 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
