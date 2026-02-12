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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PendingFactSheet {
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
  /** Real or pending- prefixed IDs of the connected fact sheets */
  sourceFactSheetId: string;
  targetFactSheetId: string;
}

export interface StaleItem {
  cellId: string;
  factSheetId: string;
  diagramName: string;
  inventoryName: string;
  typeColor: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  pendingFS: PendingFactSheet[];
  pendingRels: PendingRelation[];
  staleItems: StaleItem[];
  syncing: boolean;
  onSyncAll: () => void;
  onSyncFS: (cellId: string) => void;
  onSyncRel: (edgeCellId: string) => void;
  onRemoveFS: (cellId: string) => void;
  onRemoveRel: (edgeCellId: string) => void;
  onAcceptStale: (cellId: string) => void;
  onCheckUpdates: () => void;
  checkingUpdates: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DiagramSyncPanel({
  open,
  onClose,
  pendingFS,
  pendingRels,
  staleItems,
  syncing,
  onSyncAll,
  onSyncFS,
  onSyncRel,
  onRemoveFS,
  onRemoveRel,
  onAcceptStale,
  onCheckUpdates,
  checkingUpdates,
}: Props) {
  const totalPending = pendingFS.length + pendingRels.length;

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
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        <MaterialSymbol icon="sync" size={22} color="#1976d2" />
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          Synchronise
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
            Push all ({totalPending})
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={checkingUpdates}
            startIcon={checkingUpdates ? <CircularProgress size={14} /> : <MaterialSymbol icon="cloud_download" size={16} />}
            onClick={onCheckUpdates}
          >
            Check updates
          </Button>
        </Box>

        {/* ---- Pending fact sheets ---- */}
        {pendingFS.length > 0 && (
          <>
            <SectionTitle icon="note_add" label="New Fact Sheets" count={pendingFS.length} />
            {pendingFS.map((fs) => (
              <ItemRow key={fs.cellId}>
                <Box
                  sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: fs.typeColor, flexShrink: 0 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap fontWeight={500}>
                    {fs.name}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {fs.typeLabel}
                  </Typography>
                </Box>
                <Tooltip title="Push to inventory">
                  <IconButton size="small" onClick={() => onSyncFS(fs.cellId)} disabled={syncing}>
                    <MaterialSymbol icon="cloud_upload" size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remove from diagram">
                  <IconButton size="small" onClick={() => onRemoveFS(fs.cellId)} disabled={syncing}>
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
            <SectionTitle icon="link" label="New Relations" count={pendingRels.length} />
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
                <Tooltip title="Push to inventory">
                  <IconButton size="small" onClick={() => onSyncRel(rel.edgeCellId)} disabled={syncing}>
                    <MaterialSymbol icon="cloud_upload" size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remove from diagram">
                  <IconButton size="small" onClick={() => onRemoveRel(rel.edgeCellId)} disabled={syncing}>
                    <MaterialSymbol icon="delete_outline" size={16} color="#c62828" />
                  </IconButton>
                </Tooltip>
              </ItemRow>
            ))}
          </>
        )}

        {/* ---- Stale / out-of-sync items ---- */}
        {staleItems.length > 0 && (
          <>
            <SectionTitle icon="update" label="Inventory Changed" count={staleItems.length} />
            {staleItems.map((item) => (
              <ItemRow key={item.cellId}>
                <Box
                  sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: item.typeColor, flexShrink: 0 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    <s style={{ color: "#999" }}>{item.diagramName}</s>{" "}
                    <strong>{item.inventoryName}</strong>
                  </Typography>
                </Box>
                <Tooltip title="Accept update from inventory">
                  <IconButton size="small" onClick={() => onAcceptStale(item.cellId)}>
                    <MaterialSymbol icon="check" size={16} color="#2e7d32" />
                  </IconButton>
                </Tooltip>
              </ItemRow>
            ))}
          </>
        )}

        {/* ---- Empty state ---- */}
        {totalPending === 0 && staleItems.length === 0 && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <MaterialSymbol icon="check_circle" size={36} color="#66bb6a" />
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
              Everything is in sync.
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
