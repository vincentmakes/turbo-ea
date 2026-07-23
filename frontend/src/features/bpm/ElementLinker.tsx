/**
 * ElementLinker — Dialog for linking BPMN elements to EA cards.
 * Search for Applications, Data Objects, IT Components and assign them.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import CardPicker from "@/components/CardPicker";
import { api } from "@/api/client";
import type { ProcessElement } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  element: ProcessElement | null;
  processId: string;
  onSaved: () => void;
}

interface CardOption {
  id: string;
  name: string;
  type: string;
}

export default function ElementLinker({ open, onClose, element, processId, onSaved }: Props) {
  const { t } = useTranslation(["bpm", "common"]);

  const [selectedApp, setSelectedApp] = useState<CardOption | null>(null);
  const [selectedData, setSelectedData] = useState<CardOption | null>(null);
  const [selectedItc, setSelectedItc] = useState<CardOption | null>(null);
  const [saving, setSaving] = useState(false);

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
        {t("linker.linkToEA", { name: element?.name || t("viewer.unnamed") })}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {element?.element_type} {element?.lane_name ? `| ${t("flowTab.lane")}: ${element.lane_name}` : ""}
        </Typography>

        <CardPicker
          types="Application"
          value={selectedApp}
          onChange={setSelectedApp}
          enabled={open}
          size="medium"
          fullWidth
          sx={{ my: 1 }}
          label={t("linker.application")}
        />

        <CardPicker
          types="DataObject"
          value={selectedData}
          onChange={setSelectedData}
          enabled={open}
          size="medium"
          fullWidth
          sx={{ my: 1 }}
          label={t("linker.dataObject")}
        />

        <CardPicker
          types="ITComponent"
          value={selectedItc}
          onChange={setSelectedItc}
          enabled={open}
          size="medium"
          fullWidth
          sx={{ my: 1 }}
          label={t("linker.itComponent")}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? t("linker.saving") : t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
