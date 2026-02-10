import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
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
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";

function FactSheetTypesTab() {
  const { types, invalidateCache } = useMetamodel();
  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState({ key: "", label: "", icon: "category", color: "#1976d2", category: "application", has_hierarchy: false, description: "" });

  const handleCreate = async () => {
    await api.post("/metamodel/types", {
      ...newType,
      fields_schema: [],
      built_in: false,
    });
    invalidateCache();
    setCreateOpen(false);
    window.location.reload();
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button variant="contained" startIcon={<MaterialSymbol icon="add" size={18} />} onClick={() => setCreateOpen(true)}>
          New Fact Sheet Type
        </Button>
      </Box>

      {types.map((t) => (
        <Accordion key={t.key}>
          <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <MaterialSymbol icon={t.icon} size={20} color={t.color} />
              <Typography fontWeight={600}>{t.label}</Typography>
              <Chip size="small" label={t.category} />
              {t.has_hierarchy && <Chip size="small" label="Hierarchy" variant="outlined" />}
              {t.built_in && <Chip size="small" label="Built-in" color="info" />}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Key: <code>{t.key}</code> | {t.description || "No description"}
            </Typography>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" gutterBottom>Fields</Typography>
            {t.fields_schema.map((section, si) => (
              <Box key={si} sx={{ ml: 2, mb: 1 }}>
                <Typography variant="body2" fontWeight={600}>{section.section}</Typography>
                <List dense>
                  {section.fields.map((f) => (
                    <ListItem key={f.key} sx={{ py: 0 }}>
                      <ListItemText
                        primary={`${f.label} (${f.key})`}
                        secondary={`Type: ${f.type}${f.options ? ` | Options: ${f.options.map((o) => o.label).join(", ")}` : ""}`}
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            ))}
            {t.fields_schema.length === 0 && (
              <Typography variant="body2" color="text.secondary">No custom fields</Typography>
            )}
          </AccordionDetails>
        </Accordion>
      ))}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Fact Sheet Type</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Key (e.g., MyCustomType)" value={newType.key} onChange={(e) => setNewType({ ...newType, key: e.target.value })} sx={{ mt: 1, mb: 2 }} />
          <TextField fullWidth label="Label" value={newType.label} onChange={(e) => setNewType({ ...newType, label: e.target.value })} sx={{ mb: 2 }} />
          <TextField fullWidth label="Description" value={newType.description} onChange={(e) => setNewType({ ...newType, description: e.target.value })} sx={{ mb: 2 }} />
          <TextField fullWidth label="Icon (Material Symbol)" value={newType.icon} onChange={(e) => setNewType({ ...newType, icon: e.target.value })} sx={{ mb: 2 }} />
          <TextField fullWidth label="Color" type="color" value={newType.color} onChange={(e) => setNewType({ ...newType, color: e.target.value })} sx={{ mb: 2 }} />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Category</InputLabel>
            <Select value={newType.category} label="Category" onChange={(e) => setNewType({ ...newType, category: e.target.value })}>
              <MenuItem value="business">Business</MenuItem>
              <MenuItem value="application">Application</MenuItem>
              <MenuItem value="technology">Technology</MenuItem>
              <MenuItem value="transformation">Transformation</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel control={<Switch checked={newType.has_hierarchy} onChange={(e) => setNewType({ ...newType, has_hierarchy: e.target.checked })} />} label="Supports Hierarchy (Parent/Child)" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newType.key || !newType.label}>Create</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function RelationTypesTab() {
  const { types, relationTypes, invalidateCache } = useMetamodel();
  const [createOpen, setCreateOpen] = useState(false);
  const [newRel, setNewRel] = useState({ key: "", label: "", source_type_key: "", target_type_key: "" });

  const handleCreate = async () => {
    await api.post("/metamodel/relation-types", { ...newRel, attributes_schema: [], built_in: false });
    invalidateCache();
    setCreateOpen(false);
    window.location.reload();
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button variant="contained" startIcon={<MaterialSymbol icon="add" size={18} />} onClick={() => setCreateOpen(true)}>
          New Relation Type
        </Button>
      </Box>

      {relationTypes.map((rt) => (
        <Card key={rt.key} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography fontWeight={600}>{rt.label}</Typography>
              <Typography variant="body2" color="text.secondary">({rt.key})</Typography>
              <Box sx={{ flex: 1 }} />
              <Chip size="small" label={rt.source_type_key} />
              <MaterialSymbol icon="arrow_forward" size={16} />
              <Chip size="small" label={rt.target_type_key} />
              {rt.built_in && <Chip size="small" label="Built-in" color="info" />}
            </Box>
          </CardContent>
        </Card>
      ))}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Relation Type</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Key" value={newRel.key} onChange={(e) => setNewRel({ ...newRel, key: e.target.value })} sx={{ mt: 1, mb: 2 }} />
          <TextField fullWidth label="Label" value={newRel.label} onChange={(e) => setNewRel({ ...newRel, label: e.target.value })} sx={{ mb: 2 }} />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Source Type</InputLabel>
            <Select value={newRel.source_type_key} label="Source Type" onChange={(e) => setNewRel({ ...newRel, source_type_key: e.target.value })}>
              {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Target Type</InputLabel>
            <Select value={newRel.target_type_key} label="Target Type" onChange={(e) => setNewRel({ ...newRel, target_type_key: e.target.value })}>
              {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newRel.key || !newRel.source_type_key || !newRel.target_type_key}>Create</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default function MetamodelAdmin() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Metamodel Configuration</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Fact Sheet Types" />
        <Tab label="Relation Types" />
      </Tabs>

      {tab === 0 && <FactSheetTypesTab />}
      {tab === 1 && <RelationTypesTab />}
    </Box>
  );
}
