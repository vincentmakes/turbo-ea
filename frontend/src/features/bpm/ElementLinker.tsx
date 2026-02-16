/**
 * ElementLinker — Dialog for linking BPMN elements to EA cards.
 * Search for Applications, Data Objects, IT Components and assign them.
 */
import { useState, useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import type { ProcessElement, Card } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  element: ProcessElement | null;
  processId: string;
  onSaved: () => void;
}

interface FsOption {
  id: string;
  name: string;
  type: string;
}

export default function ElementLinker({ open, onClose, element, processId, onSaved }: Props) {
  const [apps, setApps] = useState<FsOption[]>([]);
  const [dataObjects, setDataObjects] = useState<FsOption[]>([]);
  const [itComponents, setItComponents] = useState<FsOption[]>([]);

  const [selectedApp, setSelectedApp] = useState<FsOption | null>(null);
  const [selectedData, setSelectedData] = useState<FsOption | null>(null);
  const [selectedItc, setSelectedItc] = useState<FsOption | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Load options for each type
    async function load() {
      const [appRes, dataRes, itcRes] = await Promise.all([
        api.get<{ items: Card[] }>("/cards?type=Application&page_size=200&status=ACTIVE"),
        api.get<{ items: Card[] }>("/cards?type=DataObject&page_size=200&status=ACTIVE"),
        api.get<{ items: Card[] }>("/cards?type=ITComponent&page_size=200&status=ACTIVE"),
      ]);
      setApps((appRes.items || []).map((f: Card) => ({ id: f.id, name: f.name, type: f.type })));
      setDataObjects((dataRes.items || []).map((f: Card) => ({ id: f.id, name: f.name, type: f.type })));
      setItComponents((itcRes.items || []).map((f: Card) => ({ id: f.id, name: f.name, type: f.type })));
    }
    load();
  }, [open]);

  useEffect(() => {
    if (!element) return;
    setSelectedApp(element.application_id ? { id: element.application_id, name: element.application_name || "", type: "Application" } : null);
    setSelectedData(element.data_object_id ? { id: element.data_object_id, name: element.data_object_name || "", type: "DataObject" } : null);
    setSelectedItc(element.it_component_id ? { id: element.it_component_id, name: element.it_component_name || "", type: "ITComponent" } : null);
  }, [element]);

  const handleSave = async () => {
    if (!element) return;
    setSaving(true);
    try {
      await api.put(`/bpm/processes/${processId}/elements/${element.id}`, {
        application_id: selectedApp?.id || "",
        data_object_id: selectedData?.id || "",
        it_component_id: selectedItc?.id || "",
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save element links:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Link "{element?.name || "(unnamed)"}" to EA
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {element?.element_type} {element?.lane_name ? `| Lane: ${element.lane_name}` : ""}
        </Typography>

        <Autocomplete
          options={apps}
          getOptionLabel={(o) => o.name}
          value={selectedApp}
          onChange={(_, v) => setSelectedApp(v)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} label="Application" margin="normal" />}
        />

        <Autocomplete
          options={dataObjects}
          getOptionLabel={(o) => o.name}
          value={selectedData}
          onChange={(_, v) => setSelectedData(v)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} label="Data Object" margin="normal" />}
        />

        <Autocomplete
          options={itComponents}
          getOptionLabel={(o) => o.name}
          value={selectedItc}
          onChange={(_, v) => setSelectedItc(v)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} label="IT Component" margin="normal" />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
