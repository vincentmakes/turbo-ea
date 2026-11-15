/**
 * The free-draw diagrams linked to a decision: a live link, like a linked
 * card, never a copy. Each shows its thumbnail and name and opens the diagram.
 *
 * Links are filing, applied at once through `POST` / `DELETE
 * /adr/{id}/diagrams…` (not through Save): editable while the decision is a
 * draft or in review, fixed once signed. A reader without `diagrams.view`
 * sees nothing at all, and a read-only decision with no diagram shows no
 * section either.
 */
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import DiagramPickerDialog, { DIAGRAM_ICON } from "@/components/DiagramPickerDialog";
import MaterialSymbol from "@/components/MaterialSymbol";
import { hasPermission } from "@/components/RequirePermission";
import { useAuth } from "@/hooks/useAuth";
import { diagramThumbnailSrc } from "@/lib/diagramThumbnail";
import type { AdrLinkedDiagram, ArchitectureDecision, DiagramSummary } from "@/types";

export const diagramsPath = (adrId: string) => `/adr/${adrId}/diagrams`;

// Stryker disable all: static layout, which jsdom cannot measure.
const SX = {
  paper: { p: 3, mb: 3 },
  plain: { mb: 4 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 },
  plainTitle: { fontWeight: 700 },
  grid: {
    display: "grid",
    gap: 2,
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  },
  card: { position: "relative" },
  thumb: {
    aspectRatio: "16 / 10",
    bgcolor: "action.hover",
    borderBottom: 1,
    borderColor: "divider",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    p: 1,
  },
  img: { width: "100%", height: "100%", objectFit: "contain" },
  name: { px: 1.5, py: 1 },
  remove: { position: "absolute", top: 4, insetInlineEnd: 4, bgcolor: "background.paper" },
} as const;
// Stryker restore all

export interface DecisionDiagramsSectionProps {
  adrId: string;
  diagrams: AdrLinkedDiagram[] | undefined;
  /** Attach and remove are offered (draft or in review, to `adr.manage`). */
  editable: boolean;
  /** The list after an attach or a remove. */
  onChange?: (diagrams: AdrLinkedDiagram[]) => void;
  /** `paper`: the editor's framed section; `plain`: the preview's heading. */
  variant?: "paper" | "plain";
}

export default function DecisionDiagramsSection({
  adrId,
  diagrams,
  editable,
  onChange,
  variant = "paper",
}: DecisionDiagramsSectionProps) {
  const { t } = useTranslation(["delivery", "common"]);
  const { user } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirming, setConfirming] = useState<AdrLinkedDiagram | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const list = diagrams ?? [];
  if (!hasPermission(user?.permissions, "diagrams.view")) return null;
  if (!editable && list.length === 0) return null;

  const refusal = (err: unknown, fallback: string) =>
    (err instanceof Error && err.message) || t(fallback);

  const handlePick = async (picked: DiagramSummary) => {
    setPickerOpen(false);
    setBusy(true);
    try {
      const updated = await api.post<ArchitectureDecision>(diagramsPath(adrId), {
        diagram_id: picked.id,
      });
      setError("");
      onChange?.(updated.diagrams ?? []);
    } catch (err) {
      setError(refusal(err, "adr.diagrams.attachFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    const target = confirming;
    setConfirming(null);
    if (!target) return;
    setBusy(true);
    try {
      await api.delete(`${diagramsPath(adrId)}/${target.id}`);
      setError("");
      onChange?.(list.filter((d) => d.id !== target.id));
    } catch (err) {
      setError(refusal(err, "adr.diagrams.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const plain = variant === "plain";
  const content = (
    <>
      <Box sx={SX.header}>
        <Typography variant="h6" sx={plain ? SX.plainTitle : undefined}>
          {t("adr.diagrams.title")}
        </Typography>
        {editable && (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setPickerOpen(true)}
            disabled={busy}
            sx={{ textTransform: "none" }}
          >
            {t("adr.diagrams.attach")}
          </Button>
        )}
      </Box>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {list.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("adr.diagrams.empty")}
        </Typography>
      ) : (
        <Box sx={SX.grid}>
          {list.map((d) => {
            const src = diagramThumbnailSrc(d.thumbnail);
            return (
              <Card key={d.id} variant="outlined" sx={SX.card} data-testid="decision-diagram">
                <CardActionArea component={RouterLink} to={`/diagrams/${d.id}`}>
                  <Box sx={SX.thumb}>
                    {src ? (
                      <Box component="img" src={src} alt="" sx={SX.img} />
                    ) : (
                      <MaterialSymbol icon={DIAGRAM_ICON} size={36} />
                    )}
                  </Box>
                  <Typography variant="body2" fontWeight={600} noWrap sx={SX.name}>
                    {d.name}
                  </Typography>
                </CardActionArea>
                {editable && (
                  <Tooltip title={t("adr.diagrams.remove")}>
                    <IconButton
                      size="small"
                      aria-label={t("adr.diagrams.remove")}
                      onClick={() => setConfirming(d)}
                      disabled={busy}
                      sx={SX.remove}
                    >
                      <MaterialSymbol icon="link_off" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
              </Card>
            );
          })}
        </Box>
      )}

      {editable && (
        <DiagramPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={handlePick}
          excludeIds={list.map((d) => d.id)}
          title={t("adr.diagrams.pickerTitle")}
        />
      )}
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        disableRestoreFocus
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("adr.diagrams.remove")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t("adr.diagrams.removeConfirm", { name: confirming?.name ?? "" })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>{t("common:actions.cancel")}</Button>
          <Button color="error" variant="contained" onClick={handleRemove}>
            {t("common:actions.remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  return plain ? (
    <Box sx={SX.plain} data-testid="decision-diagrams">
      {content}
    </Box>
  ) : (
    <Paper sx={SX.paper} data-testid="decision-diagrams">
      {content}
    </Paper>
  );
}
