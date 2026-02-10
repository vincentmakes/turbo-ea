import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";

interface InterfaceInfo {
  id: string;
  name: string;
  description: string | null;
  frequency: string | null;
  data_format: string | null;
  transport_protocol: string | null;
  provider_app: { id: string; name: string } | null;
  consumer_apps: { id: string; name: string }[];
  data_objects: { id: string; name: string }[];
}

interface IntegrationStatsData {
  total_interfaces: number;
  total_data_objects: number;
  apps_with_interfaces: number;
  avg_interfaces_per_app: number;
  most_connected_apps: { id: string; name: string; interface_count: number }[];
}

const PROTOCOL_COLORS: Record<string, string> = {
  REST: "#2e7d32",
  SOAP: "#1565c0",
  GraphQL: "#e91e63",
  gRPC: "#9c27b0",
  FTP: "#795548",
  MQ: "#ff9800",
};

const FREQUENCY_LABELS: Record<string, string> = {
  real_time: "Real-time",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  on_demand: "On demand",
};

export default function InterfaceCircleMap() {
  const navigate = useNavigate();
  const [interfaces, setInterfaces] = useState<InterfaceInfo[]>([]);
  const [stats, setStats] = useState<IntegrationStatsData | null>(null);
  const [view, setView] = useState<"circle" | "table">("circle");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [ifaces, statsData] = await Promise.all([
      api.get<InterfaceInfo[]>("/integration/interfaces").catch(() => []),
      api.get<IntegrationStatsData>("/integration/stats").catch(() => null),
    ]);
    setInterfaces(ifaces);
    setStats(statsData);
  }

  // Group interfaces by provider app for circle map
  const byProvider = new Map<string, { app: { id: string; name: string }; interfaces: InterfaceInfo[] }>();
  const noProvider: InterfaceInfo[] = [];

  for (const iface of interfaces) {
    if (iface.provider_app) {
      const key = iface.provider_app.id;
      if (!byProvider.has(key)) {
        byProvider.set(key, { app: iface.provider_app, interfaces: [] });
      }
      byProvider.get(key)!.interfaces.push(iface);
    } else {
      noProvider.push(iface);
    }
  }

  const providerGroups = Array.from(byProvider.values()).sort((a, b) =>
    b.interfaces.length - a.interfaces.length
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Interface Map</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Interfaces grouped by provider application with consumer connections.
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_, v) => v && setView(v)}
          size="small"
        >
          <ToggleButton value="circle">
            <MaterialSymbol icon="bubble_chart" size={18} />
            <Box sx={{ ml: 0.5 }}>Cluster</Box>
          </ToggleButton>
          <ToggleButton value="table">
            <MaterialSymbol icon="table_rows" size={18} />
            <Box sx={{ ml: 0.5 }}>Table</Box>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Stats bar */}
      {stats && (
        <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
          <Card sx={{ flex: "1 1 140px" }}>
            <CardContent sx={{ textAlign: "center", py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="h5" color="primary.main">{stats.total_interfaces}</Typography>
              <Typography variant="caption" color="text.secondary">Interfaces</Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: "1 1 140px" }}>
            <CardContent sx={{ textAlign: "center", py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="h5" color="primary.main">{stats.apps_with_interfaces}</Typography>
              <Typography variant="caption" color="text.secondary">Connected Apps</Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: "1 1 140px" }}>
            <CardContent sx={{ textAlign: "center", py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="h5" color="primary.main">{stats.avg_interfaces_per_app}</Typography>
              <Typography variant="caption" color="text.secondary">Avg/App</Typography>
            </CardContent>
          </Card>
          {stats.most_connected_apps.length > 0 && (
            <Card sx={{ flex: "2 1 280px" }}>
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                  Most Connected
                </Typography>
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                  {stats.most_connected_apps.slice(0, 5).map((app) => (
                    <Chip
                      key={app.id}
                      label={`${app.name} (${app.interface_count})`}
                      size="small"
                      onClick={() => navigate(`/fact-sheets/${app.id}`)}
                      sx={{ cursor: "pointer" }}
                    />
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}
        </Box>
      )}

      {interfaces.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="swap_horiz" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No interfaces defined</Typography>
            <Typography color="text.secondary">
              Create Interface fact sheets and link apps as providers/consumers.
            </Typography>
          </CardContent>
        </Card>
      ) : view === "circle" ? (
        /* Cluster view: interfaces grouped by provider */
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {providerGroups.map((group) => (
            <Card
              key={group.app.id}
              sx={{ flex: "1 1 300px", maxWidth: 400 }}
            >
              <CardContent>
                {/* Provider header */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 1.5,
                    cursor: "pointer",
                    "&:hover": { opacity: 0.8 },
                  }}
                  onClick={() => navigate(`/fact-sheets/${group.app.id}`)}
                >
                  <MaterialSymbol icon="apps" size={20} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {group.app.name}
                  </Typography>
                  <Chip label={`${group.interfaces.length} interfaces`} size="small" sx={{ ml: "auto" }} />
                </Box>

                {/* Interface bubbles */}
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {group.interfaces.map((iface) => (
                    <Box
                      key={iface.id}
                      sx={{
                        p: 1,
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "divider",
                        cursor: "pointer",
                        "&:hover": { backgroundColor: "action.hover" },
                      }}
                      onClick={() => navigate(`/fact-sheets/${iface.id}`)}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
                        <MaterialSymbol icon="swap_horiz" size={16} />
                        <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>
                          {iface.name}
                        </Typography>
                        {iface.transport_protocol && (
                          <Chip
                            label={iface.transport_protocol}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              color: PROTOCOL_COLORS[iface.transport_protocol] || "#666",
                              borderColor: PROTOCOL_COLORS[iface.transport_protocol] || "#ccc",
                            }}
                            variant="outlined"
                          />
                        )}
                      </Box>
                      {/* Consumers */}
                      {iface.consumer_apps.length > 0 && (
                        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>→</Typography>
                          {iface.consumer_apps.map((c) => (
                            <Chip
                              key={c.id}
                              label={c.name}
                              size="small"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                              variant="outlined"
                            />
                          ))}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          ))}

          {/* Orphan interfaces */}
          {noProvider.length > 0 && (
            <Card sx={{ flex: "1 1 300px", maxWidth: 400, borderColor: "warning.main" }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5, color: "warning.main" }}>
                  No Provider Assigned
                </Typography>
                {noProvider.map((iface) => (
                  <Box
                    key={iface.id}
                    sx={{ p: 1, borderRadius: 1, border: "1px solid", borderColor: "divider", mb: 0.5, cursor: "pointer", "&:hover": { backgroundColor: "action.hover" } }}
                    onClick={() => navigate(`/fact-sheets/${iface.id}`)}
                  >
                    <Typography variant="body2">{iface.name}</Typography>
                  </Box>
                ))}
              </CardContent>
            </Card>
          )}
        </Box>
      ) : (
        /* Table view */
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Interface</TableCell>
                <TableCell>Protocol</TableCell>
                <TableCell>Frequency</TableCell>
                <TableCell>Format</TableCell>
                <TableCell>Provider</TableCell>
                <TableCell>Consumers</TableCell>
                <TableCell>Data Objects</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {interfaces.map((iface) => (
                <TableRow key={iface.id} hover>
                  <TableCell>
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer" }}
                      onClick={() => navigate(`/fact-sheets/${iface.id}`)}
                    >
                      <MaterialSymbol icon="swap_horiz" size={16} />
                      <Typography variant="body2" sx={{ fontWeight: 500, "&:hover": { textDecoration: "underline" } }}>
                        {iface.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    {iface.transport_protocol ? (
                      <Chip
                        label={iface.transport_protocol}
                        size="small"
                        sx={{
                          color: PROTOCOL_COLORS[iface.transport_protocol] || "#666",
                          borderColor: PROTOCOL_COLORS[iface.transport_protocol] || "#ccc",
                        }}
                        variant="outlined"
                      />
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {iface.frequency ? FREQUENCY_LABELS[iface.frequency] || iface.frequency : "-"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{iface.data_format || "-"}</Typography>
                  </TableCell>
                  <TableCell>
                    {iface.provider_app ? (
                      <Chip
                        label={iface.provider_app.name}
                        size="small"
                        onClick={() => navigate(`/fact-sheets/${iface.provider_app!.id}`)}
                        sx={{ cursor: "pointer" }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.secondary">-</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {iface.consumer_apps.length > 0
                        ? iface.consumer_apps.map((c) => (
                          <Chip
                            key={c.id}
                            label={c.name}
                            size="small"
                            onClick={() => navigate(`/fact-sheets/${c.id}`)}
                            sx={{ cursor: "pointer" }}
                            variant="outlined"
                          />
                        ))
                        : <Typography variant="caption" color="text.secondary">-</Typography>
                      }
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {iface.data_objects.length > 0
                        ? iface.data_objects.map((d) => (
                          <Chip
                            key={d.id}
                            label={d.name}
                            size="small"
                            icon={<MaterialSymbol icon="database" size={14} />}
                            onClick={() => navigate(`/fact-sheets/${d.id}`)}
                            sx={{ cursor: "pointer", fontSize: "0.7rem" }}
                          />
                        ))
                        : <Typography variant="caption" color="text.secondary">-</Typography>
                      }
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
