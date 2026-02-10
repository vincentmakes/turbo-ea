import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Tooltip,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { useEventStream } from "../../hooks/useEventStream";

interface FlowNode {
  id: string;
  name: string;
  type: string;
  interface_count: number;
}

interface FlowEdge {
  source: string;
  target: string;
  interface_id: string;
  interface_name: string;
  role: string;
  data_objects: string[];
}

interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  stats: Record<string, number>;
}

export default function DataFlowDiagram() {
  const navigate = useNavigate();
  const [graph, setGraph] = useState<FlowGraph>({ nodes: [], edges: [], stats: {} });

  const loadGraph = useCallback(async () => {
    try {
      const data = await api.get<FlowGraph>("/integration/data-flow");
      setGraph(data);
    } catch {
      // handle
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEventStream(
    useCallback(
      (event) => {
        if (event.entity_type === "relation") {
          loadGraph();
        }
      },
      [loadGraph]
    )
  );

  const ifaceNodes = graph.nodes.filter((n) => n.type === "interface");

  // Build connections: for each interface, find provider and consumers
  const interfaceConnections = ifaceNodes.map((iface) => {
    const provides = graph.edges.filter((e) => e.target === iface.id && e.role === "provides");
    const consumes = graph.edges.filter((e) => e.target === iface.id && e.role === "consumes");
    const dataObjects = provides.length > 0 ? provides[0].data_objects : [];
    return {
      iface,
      providerApp: provides.length > 0 ? graph.nodes.find((n) => n.id === provides[0].source) : null,
      consumerApps: consumes.map((e) => graph.nodes.find((n) => n.id === e.source)).filter(Boolean) as FlowNode[],
      dataObjects,
    };
  });

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Data Flow Diagram</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Application integrations via interfaces. Provider (green) → Interface → Consumer (blue).
        </Typography>
      </Box>

      {/* Stats */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Card sx={{ flex: "1 1 150px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{graph.stats.total_interfaces || 0}</Typography>
            <Typography variant="body2" color="text.secondary">Interfaces</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: "1 1 150px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{graph.stats.total_apps || 0}</Typography>
            <Typography variant="body2" color="text.secondary">Connected Apps</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: "1 1 150px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{graph.stats.total_edges || 0}</Typography>
            <Typography variant="body2" color="text.secondary">Connections</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: "1 1 150px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{graph.stats.total_data_objects || 0}</Typography>
            <Typography variant="body2" color="text.secondary">Data Objects</Typography>
          </CardContent>
        </Card>
      </Box>

      {interfaceConnections.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="swap_horiz" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No data flows yet</Typography>
            <Typography color="text.secondary">
              Create Interface fact sheets and link applications as providers/consumers.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {interfaceConnections.map((conn) => (
            <Card key={conn.iface.id} variant="outlined" sx={{ "&:hover": { boxShadow: 2 } }}>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  {/* Provider */}
                  {conn.providerApp ? (
                    <Tooltip title={`Provider: ${conn.providerApp.name}`}>
                      <Chip
                        icon={<MaterialSymbol icon="apps" size={16} />}
                        label={conn.providerApp.name}
                        onClick={() => navigate(`/fact-sheets/${conn.providerApp!.id}`)}
                        sx={{
                          cursor: "pointer",
                          backgroundColor: "#2e7d3218",
                          color: "#2e7d32",
                          fontWeight: 600,
                          borderColor: "#2e7d32",
                        }}
                        variant="outlined"
                      />
                    </Tooltip>
                  ) : (
                    <Chip label="No provider" size="small" sx={{ color: "#999" }} />
                  )}

                  {/* Arrow */}
                  <MaterialSymbol icon="arrow_forward" size={20} />

                  {/* Interface */}
                  <Tooltip title={`Interface: ${conn.iface.name}${conn.dataObjects.length > 0 ? ` (${conn.dataObjects.join(", ")})` : ""}`}>
                    <Chip
                      icon={<MaterialSymbol icon="swap_horiz" size={16} />}
                      label={conn.iface.name}
                      onClick={() => navigate(`/fact-sheets/${conn.iface.id}`)}
                      sx={{
                        cursor: "pointer",
                        backgroundColor: "#ed6c0218",
                        color: "#ed6c02",
                        fontWeight: 600,
                        borderColor: "#ed6c02",
                      }}
                      variant="outlined"
                    />
                  </Tooltip>

                  {/* Arrow */}
                  <MaterialSymbol icon="arrow_forward" size={20} />

                  {/* Consumers */}
                  {conn.consumerApps.length > 0 ? (
                    conn.consumerApps.map((consumer) => (
                      <Tooltip key={consumer.id} title={`Consumer: ${consumer.name}`}>
                        <Chip
                          icon={<MaterialSymbol icon="apps" size={16} />}
                          label={consumer.name}
                          onClick={() => navigate(`/fact-sheets/${consumer.id}`)}
                          sx={{
                            cursor: "pointer",
                            backgroundColor: "#1565c018",
                            color: "#1565c0",
                            fontWeight: 500,
                            borderColor: "#1565c0",
                          }}
                          variant="outlined"
                        />
                      </Tooltip>
                    ))
                  ) : (
                    <Chip label="No consumers" size="small" sx={{ color: "#999" }} />
                  )}

                  {/* Data objects */}
                  {conn.dataObjects.length > 0 && (
                    <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
                      {conn.dataObjects.map((doName) => (
                        <Chip
                          key={doName}
                          label={doName}
                          size="small"
                          icon={<MaterialSymbol icon="database" size={14} />}
                          sx={{ fontSize: "0.7rem" }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
