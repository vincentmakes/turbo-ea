import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  PendingParentChange,
  RemovedRelationTombstone,
} from "./drawio-shapes";
import type { StaleItem } from "./staleCheck";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PendingCard {
  cellId: string;
  type: string;
  typeLabel: string;
  typeColor: string;
  name: string;
  description?: string;
}

export interface PendingRelation {
  edgeCellId: string;
  relationType: string;
  relationLabel: string;
  sourceName: string;
  targetName: string;
  sourceColor: string;
  targetColor: string;
  /** Real or pending- prefixed IDs of the connected cards */
  sourceCardId: string;
  targetCardId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  pendingCards: PendingCard[];
  pendingRels: PendingRelation[];
  pendingRelRemovals: RemovedRelationTombstone[];
  pendingParentChanges: PendingParentChange[];
  staleItems: StaleItem[];
  syncing: boolean;
  onSyncAll: () => void;
  onSyncFS: (cellId: string) => void;
  onSyncRel: (edgeCellId: string) => void;
  onRemoveFS: (cellId: string) => void;
  onRemoveRel: (edgeCellId: string) => void;
  onSyncRelRemoval: (edgeCellId: string) => void;
  onDiscardRelRemoval: (edgeCellId: string) => void;
  onSyncParentChange: (cellId: string) => void;
  onDiscardParentChange: (cellId: string) => void;
  onAcceptStale: (cellId: string) => void;
  onRemoveStaleCard: (cellId: string) => void;
  onRemoveStaleEdge: (cellId: string) => void;
  onAcceptStaleFlow: (cellId: string) => void;
  onAcceptAllStale: () => void;
  onCheckUpdates: () => void;
  checkingUpdates: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramSyncPanel({
  open,
  onClose,
  pendingCards,
  pendingRels,
  pendingRelRemovals,
  pendingParentChanges,
  staleItems,
  syncing,
  onSyncAll,
  onSyncFS,
  onSyncRel,
  onRemoveFS,
  onRemoveRel,
  onSyncRelRemoval,
  onDiscardRelRemoval,
  onSyncParentChange,
  onDiscardParentChange,
  onAcceptStale,
  onRemoveStaleCard,
  onRemoveStaleEdge,
  onAcceptStaleFlow,
  onAcceptAllStale,
  onCheckUpdates,
  checkingUpdates,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const totalPending =
    pendingCards.length +
    pendingRels.length +
    pendingRelRemovals.length +
    pendingParentChanges.length;

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 360 } }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <MaterialSymbol icon="sync" size={22} color="#1976d2" />
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          {t("sync.title")}
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <MaterialSymbol icon="close" size={18} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", px: 2, py: 1.5 }}>
        {/* ---- Actions bar ---- */}
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <Button
            size="small"
            variant="contained"
            disabled={totalPending === 0 || syncing}
            startIcon={syncing ? <CircularProgress size={14} /> : <MaterialSymbol icon="cloud_upload" size={16} />}
            onClick={onSyncAll}
          >
            {t("sync.pushAll", { count: totalPending })}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={checkingUpdates}
            startIcon={checkingUpdates ? <CircularProgress size={14} /> : <MaterialSymbol icon="cloud_download" size={16} />}
            onClick={onCheckUpdates}
          >
            {t("sync.checkUpdates")}
          </Button>
        </Box>

        {/* ---- Pending cards ---- */}
        {pendingCards.length > 0 && (
          <>
            <SectionTitle icon="note_add" label={t("sync.newCards")} count={pendingCards.length} />
            {pendingCards.map((card) => (
              <ItemRow key={card.cellId}>
                <Box
                  sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: card.typeColor, flexShrink: 0 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap fontWeight={500}>
                    {card.name}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {card.typeLabel}
                  </Typography>
                </Box>
                <Tooltip title={t("sync.pushToInventory")}>
                  <IconButton size="small" onClick={() => onSyncFS(card.cellId)} disabled={syncing}>
                    <MaterialSymbol icon="cloud_upload" size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("sync.removeFromDiagram")}>
                  <IconButton size="small" onClick={() => onRemoveFS(card.cellId)} disabled={syncing}>
                    <MaterialSymbol icon="delete_outline" size={16} color="#c62828" />
                  </IconButton>
                </Tooltip>
              </ItemRow>
            ))}
          </>
        )}

        {/* ---- Pending relations ---- */}
        {pendingRels.length > 0 && (
          <>
            <SectionTitle icon="link" label={t("sync.newRelations")} count={pendingRels.length} />
            {pendingRels.map((rel) => (
              <ItemRow key={rel.edgeCellId}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap fontWeight={500}>
                    {rel.sourceName}{" "}
                    <Typography component="span" variant="caption" color="text.disabled">
                      → {rel.relationLabel} →
                    </Typography>{" "}
                    {rel.targetName}
                  </Typography>
                </Box>
                <Tooltip title={t("sync.pushToInventory")}>
                  <IconButton size="small" onClick={() => onSyncRel(rel.edgeCellId)} disabled={syncing}>
                    <MaterialSymbol icon="cloud_upload" size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("sync.removeFromDiagram")}>
                  <IconButton size="small" onClick={() => onRemoveRel(rel.edgeCellId)} disabled={syncing}>
                    <MaterialSymbol icon="delete_outline" size={16} color="#c62828" />
                  </IconButton>
                </Tooltip>
              </ItemRow>
            ))}
          </>
        )}

        {/* ---- Removed relations (canvas → inventory deletions) ---- */}
        {pendingRelRemovals.length > 0 && (
          <>
            <SectionTitle
              icon="link_off"
              label={t("sync.removedRelations")}
              count={pendingRelRemovals.length}
            />
            {pendingRelRemovals.map((rel) => (
              <ItemRow key={rel.edgeCellId}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    <s style={{ opacity: 0.6 }}>
                      {t("sync.relationLabel", { label: rel.relationLabel })}
                    </s>
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {t("sync.willDeleteRelation")}
                  </Typography>
                </Box>
                <Tooltip title={t("sync.applyDeletion")}>
                  <IconButton
                    size="small"
                    onClick={() => onSyncRelRemoval(rel.edgeCellId)}
                    disabled={syncing}
                  >
                    <MaterialSymbol icon="cloud_upload" size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("sync.keepInInventory")}>
                  <IconButton
                    size="small"
                    onClick={() => onDiscardRelRemoval(rel.edgeCellId)}
                    disabled={syncing}
                  >
                    <MaterialSymbol icon="undo" size={16} />
                  </IconButton>
                </Tooltip>
              </ItemRow>
            ))}
          </>
        )}


        {/* ---- Hierarchy changes (parent_id updates) ---- */}
        {pendingParentChanges.length > 0 && (
          <>
            <SectionTitle
              icon="account_tree"
              label={t("sync.hierarchyChanges")}
              count={pendingParentChanges.length}
            />
            {pendingParentChanges.map((p) => (
              <ItemRow key={p.cellId}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap fontWeight={500}>
                    {p.cardName || "?"}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {p.kind === "attach"
                      ? t("sync.parentAttach", { parent: p.parentCardName || "?" })
                      : t("sync.parentDetach", { parent: p.parentCardName || "?" })}
                  </Typography>
                </Box>
                <Tooltip title={t("sync.applyHierarchy")}>
                  <IconButton
                    size="small"
                    onClick={() => onSyncParentChange(p.cellId)}
                    disabled={syncing}
                  >
                    <MaterialSymbol icon="cloud_upload" size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("sync.discardHierarchy")}>
                  <IconButton
                    size="small"
                    onClick={() => onDiscardParentChange(p.cellId)}
                    disabled={syncing}
                  >
                    <MaterialSymbol icon="undo" size={16} />
                  </IconButton>
                </Tooltip>
              </ItemRow>
            ))}
          </>
        )}

        {/* ---- Stale / out-of-sync items (inventory → canvas) ---- */}
        {staleItems.length > 0 && (
          <>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <SectionTitle
                  icon="update"
                  label={t("sync.inventoryChanged")}
                  count={staleItems.length}
                />
              </Box>
              {staleItems.length > 1 && (
                <Button size="small" onClick={onAcceptAllStale} sx={{ flexShrink: 0 }}>
                  {t("sync.acceptAll")}
                </Button>
              )}
            </Box>
            {staleItems.map((item) => {
              if (item.kind === "relationDeleted") {
                return (
                  <ItemRow key={item.cellId}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        <s style={{ opacity: 0.6 }}>
                          {item.sourceName}{" "}
                          <Typography component="span" variant="caption" color="text.disabled">
                            → {item.relationLabel} →
                          </Typography>{" "}
                          {item.targetName}
                        </s>
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        {t("sync.staleDeletedRelation")}
                      </Typography>
                    </Box>
                    <Tooltip title={t("sync.removeEdgeFromDiagram")}>
                      <IconButton size="small" onClick={() => onRemoveStaleEdge(item.cellId)}>
                        <MaterialSymbol icon="delete_outline" size={16} color="#c62828" />
                      </IconButton>
                    </Tooltip>
                  </ItemRow>
                );
              }
              if (item.kind === "relationFlowChanged") {
                return (
                  <ItemRow key={item.cellId}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {item.sourceName}{" "}
                        <Typography component="span" variant="caption" color="text.disabled">
                          → {item.relationLabel} →
                        </Typography>{" "}
                        {item.targetName}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        {t("sync.staleFlowChanged")}
                      </Typography>
                    </Box>
                    <Tooltip title={t("sync.acceptUpdate")}>
                      <IconButton size="small" onClick={() => onAcceptStaleFlow(item.cellId)}>
                        <MaterialSymbol icon="check" size={16} color="#2e7d32" />
                      </IconButton>
                    </Tooltip>
                  </ItemRow>
                );
              }
              if (item.kind === "cardDeleted" || item.kind === "cardArchived") {
                return (
                  <ItemRow key={item.cellId}>
                    <Box
                      sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: item.typeColor, flexShrink: 0 }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        <s style={{ opacity: 0.6 }}>{item.name}</s>
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        {item.kind === "cardDeleted"
                          ? t("sync.staleDeletedCard")
                          : t("sync.staleArchivedCard")}
                      </Typography>
                    </Box>
                    <Tooltip title={t("sync.removeFromDiagram")}>
                      <IconButton size="small" onClick={() => onRemoveStaleCard(item.cellId)}>
                        <MaterialSymbol icon="delete_outline" size={16} color="#c62828" />
                      </IconButton>
                    </Tooltip>
                  </ItemRow>
                );
              }
              return (
                <ItemRow key={item.cellId}>
                  <Box
                    sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: item.typeColor, flexShrink: 0 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      <s style={{ opacity: 0.5 }}>{item.diagramName}</s>{" "}
                      <strong>{item.inventoryName}</strong>
                    </Typography>
                  </Box>
                  <Tooltip title={t("sync.acceptUpdate")}>
                    <IconButton size="small" onClick={() => onAcceptStale(item.cellId)}>
                      <MaterialSymbol icon="check" size={16} color="#2e7d32" />
                    </IconButton>
                  </Tooltip>
                </ItemRow>
              );
            })}
          </>
        )}

        {/* ---- Empty state ---- */}
        {totalPending === 0 &&
          staleItems.length === 0 && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <MaterialSymbol icon="check_circle" size={36} color="#66bb6a" />
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
              {t("sync.allInSync")}
            </Typography>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}

/* ---- Small helpers ---- */

function SectionTitle({ icon, label, count }: { icon: string; label: string; count: number }) {
  return (
    <>
      <Divider sx={{ my: 1.5 }} />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
        <MaterialSymbol icon={icon} size={16} color="#666" />
        <Typography variant="subtitle2" fontWeight={700}>
          {label}
        </Typography>
        <Chip size="small" label={count} sx={{ height: 18, fontSize: "0.65rem" }} />
      </Box>
    </>
  );
}

function ItemRow({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        py: 0.75,
        px: 1,
        borderRadius: 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {children}
    </Box>
  );
}
