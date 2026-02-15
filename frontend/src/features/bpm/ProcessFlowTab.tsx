/**
 * ProcessFlowTab — Rendered inside FactSheetDetail for BusinessProcess.
 * Shows: BPMN viewer (read-only) + element table + link buttons.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import MaterialSymbol from "@/components/MaterialSymbol";
import BpmnViewer from "./BpmnViewer";
import ElementLinker from "./ElementLinker";
import BpmnTemplateChooser from "./BpmnTemplateChooser";
import { api } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import type { ProcessDiagramData, ProcessElement } from "@/types";

interface Props {
  processId: string;
}

export default function ProcessFlowTab({ processId }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [diagram, setDiagram] = useState<ProcessDiagramData | null>(null);
  const [elements, setElements] = useState<ProcessElement[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkElement, setLinkElement] = useState<ProcessElement | null>(null);
  const [showTemplateChooser, setShowTemplateChooser] = useState(false);
  const [selectedBpmnId, setSelectedBpmnId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [diagData, elemsData] = await Promise.all([
        api.get<ProcessDiagramData | null>(`/bpm/processes/${processId}/diagram`),
        api.get<ProcessElement[]>(`/bpm/processes/${processId}/elements`),
      ]);
      setDiagram(diagData);
      setElements(elemsData || []);
    } catch {
      // No diagram yet
      setDiagram(null);
      setElements([]);
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTemplateSelected = async (bpmnXml: string) => {
    try {
      await api.put(`/bpm/processes/${processId}/diagram`, {
        bpmn_xml: bpmnXml,
      });
      setShowTemplateChooser(false);
      loadData();
    } catch (err) {
      console.error("Failed to save template:", err);
    }
  };

  if (loading) {
    return <Typography color="text.secondary">Loading process flow...</Typography>;
  }

  if (!diagram) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <MaterialSymbol icon="route" size={48} color="#666" />
        <Typography variant="h6" gutterBottom>
          No process flow diagram yet
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Create a BPMN 2.0 diagram to document this process flow.
        </Typography>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="add" />}
            onClick={() => setShowTemplateChooser(true)}
          >
            Start from Template
          </Button>
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="edit" />}
            onClick={() => navigate(`/bpm/processes/${processId}/flow`)}
          >
            Open Editor
          </Button>
        </Box>
        <BpmnTemplateChooser
          open={showTemplateChooser}
          onClose={() => setShowTemplateChooser(false)}
          onSelect={handleTemplateSelected}
        />
      </Box>
    );
  }

  return (
    <Box>
      {/* Actions bar */}
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="edit" />}
          onClick={() => navigate(`/bpm/processes/${processId}/flow`)}
        >
          Open Editor
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MaterialSymbol icon="download" />}
          onClick={async () => {
            const res = await api.getRaw(`/bpm/processes/${processId}/diagram/export/bpmn`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `process-${processId}.bpmn`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export BPMN
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<MaterialSymbol icon="image" />}
          onClick={async () => {
            const res = await api.getRaw(`/bpm/processes/${processId}/diagram/export/svg`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `process-${processId}.svg`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export SVG
        </Button>
        <Box sx={{ flex: 1 }} />
        <Chip label={`v${diagram.version}`} size="small" variant="outlined" />
        {isAdmin && (
          <Button
            variant="outlined"
            size="small"
            color="error"
            startIcon={<MaterialSymbol icon="delete" />}
            onClick={() => setConfirmDelete(true)}
          >
            Delete Diagram
          </Button>
        )}
      </Box>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete Process Diagram?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete all diagram versions and extracted process elements.
            You will be able to start fresh from a template.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              try {
                await api.delete(`/bpm/processes/${processId}/diagram`);
                setConfirmDelete(false);
                setDiagram(null);
                setElements([]);
              } catch (err) {
                console.error("Failed to delete diagram:", err);
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* BPMN Diagram (read-only) */}
      <BpmnViewer
        bpmnXml={diagram.bpmn_xml}
        elements={elements}
        onElementClick={setSelectedBpmnId}
        height={400}
      />

      {/* Elements Table */}
      {elements.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            Process Elements ({elements.length})
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Lane</TableCell>
                  <TableCell>Application</TableCell>
                  <TableCell>Data Object</TableCell>
                  <TableCell>IT Component</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {elements.map((el) => (
                  <TableRow
                    key={el.id}
                    hover
                    selected={el.bpmn_element_id === selectedBpmnId}
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSelectedBpmnId(el.bpmn_element_id)}
                  >
                    <TableCell>
                      {el.name || <em style={{ color: "#999" }}>unnamed</em>}
                      {el.is_automated && (
                        <Chip label="Auto" size="small" color="success" sx={{ ml: 0.5 }} />
                      )}
                    </TableCell>
                    <TableCell>{el.element_type}</TableCell>
                    <TableCell>{el.lane_name || "—"}</TableCell>
                    <TableCell>
                      {el.application_name ? (
                        <Chip label={el.application_name} size="small" color="primary" variant="outlined" />
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {el.data_object_name ? (
                        <Chip label={el.data_object_name} size="small" color="secondary" variant="outlined" />
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {el.it_component_name ? (
                        <Chip label={el.it_component_name} size="small" variant="outlined" />
                      ) : "—"}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Link to EA">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setLinkElement(el); }}>
                          <MaterialSymbol icon="link" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <ElementLinker
        open={!!linkElement}
        onClose={() => setLinkElement(null)}
        element={linkElement}
        processId={processId}
        onSaved={loadData}
      />
    </Box>
  );
}
