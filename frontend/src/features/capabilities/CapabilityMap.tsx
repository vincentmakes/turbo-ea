import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { useEventStream } from "../../hooks/useEventStream";
import type { FactSheet, FactSheetType } from "../../types/fact-sheet";

interface TreeNode {
  id: string;
  name: string;
  description: string | null;
  type: FactSheetType;
  status: string;
  parent_id: string | null;
  completion: number;
  attributes: Record<string, unknown> | null;
  relation_count: number;
  children: TreeNode[];
  [key: string]: unknown;
}

// Color intensity based on relation count (how many apps mapped)
function getHeatColor(count: number): string {
  if (count === 0) return "#f5f5f5";
  if (count <= 2) return "#e3f2fd";
  if (count <= 5) return "#90caf9";
  if (count <= 10) return "#42a5f5";
  return "#1565c0";
}

function getTextColor(count: number): string {
  return count > 5 ? "#fff" : "#212121";
}

function L3Tile({ node, onClick }: { node: TreeNode; onClick: () => void }) {
  const bg = getHeatColor(node.relation_count);
  const fg = getTextColor(node.relation_count);

  return (
    <Tooltip
      title={`${node.name}${node.description ? ` — ${node.description}` : ""} (${node.relation_count} relation${node.relation_count !== 1 ? "s" : ""})`}
    >
      <Box
        onClick={onClick}
        sx={{
          px: 1.5,
          py: 1,
          backgroundColor: bg,
          color: fg,
          borderRadius: 1,
          cursor: "pointer",
          fontSize: "0.8rem",
          fontWeight: 500,
          border: "1px solid",
          borderColor: "divider",
          "&:hover": { opacity: 0.85, boxShadow: 2 },
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 36,
        }}
      >
        <span>{node.name}</span>
        {node.relation_count > 0 && (
          <Chip
            label={node.relation_count}
            size="small"
            sx={{
              height: 20,
              fontSize: "0.7rem",
              ml: 0.5,
              backgroundColor: "rgba(0,0,0,0.15)",
              color: fg,
            }}
          />
        )}
      </Box>
    </Tooltip>
  );
}

function L2Block({ node, onNavigate }: { node: TreeNode; onNavigate: (id: string) => void }) {
  return (
    <Card
      variant="outlined"
      sx={{ mb: 1.5, "&:hover": { boxShadow: 1 } }}
    >
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography
          variant="subtitle2"
          sx={{ mb: 1, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
          onClick={() => onNavigate(node.id)}
        >
          {node.name}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {node.children.map((l3) => (
            <L3Tile key={l3.id} node={l3} onClick={() => onNavigate(l3.id)} />
          ))}
          {node.children.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No L3 capabilities
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function L1Column({ node, onNavigate }: { node: TreeNode; onNavigate: (id: string) => void }) {
  return (
    <Box
      sx={{
        minWidth: 260,
        maxWidth: 320,
        flex: "1 1 280px",
      }}
    >
      <Card
        sx={{
          backgroundColor: "primary.dark",
          color: "white",
          mb: 1.5,
          cursor: "pointer",
          "&:hover": { opacity: 0.9 },
        }}
        onClick={() => onNavigate(node.id)}
      >
        <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {node.name}
          </Typography>
          {node.description && (
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {node.description}
            </Typography>
          )}
        </CardContent>
      </Card>

      {node.children.map((l2) => (
        <L2Block key={l2.id} node={l2} onNavigate={onNavigate} />
      ))}
      {node.children.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          No L2 capabilities yet
        </Typography>
      )}
    </Box>
  );
}

export default function CapabilityMap() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const loadTree = useCallback(async () => {
    try {
      const data = await api.get<TreeNode[]>("/hierarchy/business-capabilities");
      setTree(data);
    } catch {
      // handle error
    }
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEventStream(
    useCallback(
      (event) => {
        if (
          event.entity_type === "fact_sheet" &&
          (event.payload as Record<string, string>)?.type === "business_capability"
        ) {
          loadTree();
        }
        if (event.entity_type === "relation") {
          loadTree();
        }
      },
      [loadTree]
    )
  );

  async function handleCreate() {
    try {
      await api.post("/fact-sheets", {
        name: newName,
        type: "business_capability",
        parent_id: parentId,
      });
      setCreateOpen(false);
      setNewName("");
      setParentId(null);
      loadTree();
    } catch {
      // handle
    }
  }

  function handleNavigate(id: string) {
    navigate(`/fact-sheets/${id}`);
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Business Capability Map</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Heat map shows number of mapped relations. Click any capability to view details.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={20} />}
          onClick={() => {
            setParentId(null);
            setCreateOpen(true);
          }}
        >
          Add L1
        </Button>
      </Box>

      {tree.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="account_tree" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>
              No business capabilities defined yet
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Create L1 capabilities to start building your capability map.
            </Typography>
            <Button variant="contained" onClick={() => setCreateOpen(true)}>
              Create First Capability
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Box
          sx={{
            display: "flex",
            gap: 2,
            overflowX: "auto",
            pb: 2,
            flexWrap: "wrap",
          }}
        >
          {tree.map((l1) => (
            <L1Column key={l1.id} node={l1} onNavigate={handleNavigate} />
          ))}
        </Box>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Business Capability</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            fullWidth
            autoFocus
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
