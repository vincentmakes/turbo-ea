/**
 * MessageFlowsTable — the messages exchanged between the pools of a
 * published process flow, with the Interface card each one realises.
 *
 * Rendered under the elements table on the Published tab. The rows come from
 * the parser (`GET /bpm/processes/{id}/message-flows`); the only editable
 * thing is the Interface link, PATCHed per row. Like a step's Organization
 * links the link is informative — no card-to-card relation is derived.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker from "@/components/CardPicker";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { ProcessMessageFlow } from "@/types";

interface Props {
  processId: string;
  /** Whether the viewer may change the Interface links. */
  canEdit: boolean;
  onNotify?: (message: string) => void;
}

export default function MessageFlowsTable({ processId, canEdit, onNotify }: Props) {
  const { t } = useTranslation(["bpm", "common"]);
  const [refetchKey, setRefetchKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { data: flows } = useApiQuery<ProcessMessageFlow[]>(
    `/bpm/processes/${processId}/message-flows`,
    { refetchKey },
  );

  if (!flows || flows.length === 0) return null;

  const setInterface = async (flow: ProcessMessageFlow, interfaceId: string | null) => {
    try {
      await api.patch(`/bpm/processes/${processId}/message-flows/${flow.id}`, {
        interface_id: interfaceId,
      });
      setRefetchKey((k) => k + 1);
      onNotify?.(t("flowTab.messageFlowUpdated"));
    } catch {
      onNotify?.(t("flowTab.messageFlowUpdateFailed"));
    }
    setEditingId(null);
  };

  return (
    <Box sx={{ mt: 3 }} data-testid="message-flows-table">
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        {t("flowTab.messageFlows")}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
        {t("flowTab.messageFlowsSubtitle")}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("common:labels.name")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("flowTab.from")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("flowTab.to")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("flowTab.interface")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {flows.map((flow, idx) => (
              <TableRow key={flow.id} hover>
                <TableCell>{idx + 1}</TableCell>
                <TableCell>
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    <MaterialSymbol icon="mail" size={14} color="#0097a7" />
                    {flow.name || <Typography component="span" variant="body2" color="text.secondary">{t("viewer.unnamed")}</Typography>}
                  </Box>
                </TableCell>
                <TableCell>{flow.source_name || flow.source_ref}</TableCell>
                <TableCell>
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    <MaterialSymbol icon="arrow_forward" size={14} color="#999" />
                    {flow.target_name || flow.target_ref}
                  </Box>
                </TableCell>
                <TableCell>
                  {editingId === flow.id ? (
                    <CardPicker
                      types="Interface"
                      value={null}
                      onChange={(val) => setInterface(flow, val?.id ?? null)}
                      onBlur={() => setEditingId(null)}
                      enabled
                      autoFocus
                      sx={{ minWidth: 180 }}
                      placeholder={t("flowTab.searchCardType", { type: "Interface" })}
                    />
                  ) : flow.interface_name ? (
                    <Chip
                      label={flow.interface_name}
                      size="small"
                      color="info"
                      onDelete={canEdit ? () => setInterface(flow, null) : undefined}
                      onClick={canEdit ? () => setEditingId(flow.id) : undefined}
                      sx={{ maxWidth: 200 }}
                    />
                  ) : canEdit ? (
                    <Box
                      role="button"
                      onClick={() => setEditingId(flow.id)}
                      sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", color: "text.secondary" }}
                    >
                      <MaterialSymbol icon="add_link" size={14} color="#bbb" />
                      <Typography variant="caption">{t("flowTab.linkCardType", { type: "Interface" })}</Typography>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">—</Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
