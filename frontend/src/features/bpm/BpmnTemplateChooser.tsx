/**
 * BpmnTemplateChooser — Modal dialog for selecting a BPMN starter template.
 * Also supports importing an existing .bpmn file.
 */
import { useState, useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { BpmnTemplate } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (bpmnXml: string) => void;
}

const TEMPLATE_ICONS: Record<string, string> = {
  blank: "note_add",
  "simple-approval": "check_circle",
  "order-to-cash": "shopping_cart",
  "procure-to-pay": "receipt_long",
  "hire-to-retire": "person_add",
  "incident-management": "warning",
};

export default function BpmnTemplateChooser({ open, onClose, onSelect }: Props) {
  const [templates, setTemplates] = useState<BpmnTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<BpmnTemplate[]>("/bpm/templates").then(setTemplates).catch(console.error);
  }, [open]);

  const handleCreate = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const tmpl = await api.get<BpmnTemplate>(`/bpm/templates/${selected}`);
      if (tmpl.bpmn_xml) onSelect(tmpl.bpmn_xml);
    } catch (err) {
      console.error("Failed to load template:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bpmn,.xml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      onSelect(text);
    };
    input.click();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Start your process diagram</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {templates.map((t) => (
            <Grid item xs={6} sm={4} key={t.key}>
              <Card
                variant={selected === t.key ? "elevation" : "outlined"}
                sx={{
                  border: selected === t.key ? 2 : 1,
                  borderColor: selected === t.key ? "primary.main" : "divider",
                }}
              >
                <CardActionArea onClick={() => setSelected(t.key)}>
                  <CardContent sx={{ textAlign: "center", py: 3 }}>
                    <MaterialSymbol
                      icon={TEMPLATE_ICONS[t.key] || "description"}
                      size={40}
                      color={selected === t.key ? "#1976d2" : "#666"}
                    />
                    <Typography variant="subtitle2" sx={{ mt: 1 }}>
                      {t.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.description}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Box sx={{ mt: 2, textAlign: "center" }}>
          <Button variant="text" startIcon={<MaterialSymbol icon="upload" />} onClick={handleImport}>
            Import existing BPMN file...
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!selected || loading}
        >
          {loading ? "Loading..." : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
