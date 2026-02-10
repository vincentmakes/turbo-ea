import { useEffect, useState, useMemo } from "react";
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
  Tooltip,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";

interface RadarItem {
  id: string;
  name: string;
  category: string | null;
  ring: string;
  quadrant: string;
  app_count: number;
}

interface TechStack {
  app_id: string;
  app_name: string;
  business_criticality: string | null;
  components: {
    id: string;
    name: string;
    category: string | null;
    lifecycle_phase: string | null;
    resource_classification: string | null;
    cost: number | null;
  }[];
}

const RING_ORDER = ["adopt", "trial", "assess", "hold"] as const;
const RING_COLORS: Record<string, string> = {
  adopt: "#2e7d32",
  trial: "#1565c0",
  assess: "#ed6c02",
  hold: "#d32f2f",
};
const RING_LABELS: Record<string, string> = {
  adopt: "Adopt",
  trial: "Trial",
  assess: "Assess",
  hold: "Hold",
};

const CRITICALITY_LABELS: Record<string, string> = {
  administrative_service: "Administrative",
  business_operational: "Operational",
  business_critical: "Critical",
  mission_critical: "Mission Critical",
};

export default function TechRadar() {
  const navigate = useNavigate();
  const [radarItems, setRadarItems] = useState<RadarItem[]>([]);
  const [techStacks, setTechStacks] = useState<TechStack[]>([]);
  const [view, setView] = useState<"radar" | "stacks">("radar");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [radar, stacks] = await Promise.all([
      api.get<RadarItem[]>("/technology/radar").catch(() => []),
      api.get<TechStack[]>("/technology/tech-stacks").catch(() => []),
    ]);
    setRadarItems(radar);
    setTechStacks(stacks);
  }

  // Group radar items by quadrant and ring
  const grouped = useMemo(() => {
    const quadrants = new Map<string, Map<string, RadarItem[]>>();
    for (const item of radarItems) {
      if (!quadrants.has(item.quadrant)) {
        quadrants.set(item.quadrant, new Map());
      }
      const rings = quadrants.get(item.quadrant)!;
      if (!rings.has(item.ring)) {
        rings.set(item.ring, []);
      }
      rings.get(item.ring)!.push(item);
    }
    return quadrants;
  }, [radarItems]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Technology Landscape</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Technology radar and application tech stacks.
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_, v) => v && setView(v)}
          size="small"
        >
          <ToggleButton value="radar">
            <MaterialSymbol icon="radar" size={18} />
            <Box sx={{ ml: 0.5 }}>Radar</Box>
          </ToggleButton>
          <ToggleButton value="stacks">
            <MaterialSymbol icon="layers" size={18} />
            <Box sx={{ ml: 0.5 }}>Tech Stacks</Box>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Ring legend */}
      <Box sx={{ display: "flex", gap: 1.5, mb: 3, flexWrap: "wrap" }}>
        {RING_ORDER.map((ring) => (
          <Chip
            key={ring}
            label={`${RING_LABELS[ring]} (${radarItems.filter((i) => i.ring === ring).length})`}
            sx={{
              backgroundColor: `${RING_COLORS[ring]}18`,
              color: RING_COLORS[ring],
              fontWeight: 600,
            }}
          />
        ))}
      </Box>

      {view === "radar" ? (
        radarItems.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <MaterialSymbol icon="radar" size={48} />
              <Typography variant="h6" sx={{ mt: 2 }}>No technologies mapped</Typography>
              <Typography color="text.secondary">
                Create IT Component fact sheets with categories and lifecycle dates.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {Array.from(grouped.entries()).map(([quadrant, rings]) => (
              <Card key={quadrant} sx={{ flex: "1 1 300px", minWidth: 280 }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
                    {quadrant}
                  </Typography>
                  {RING_ORDER.map((ring) => {
                    const items = rings.get(ring) || [];
                    if (items.length === 0) return null;
                    return (
                      <Box key={ring} sx={{ mb: 2 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            color: RING_COLORS[ring],
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          {RING_LABELS[ring]}
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                          {items.map((item) => (
                            <Tooltip
                              key={item.id}
                              title={`${item.name} — ${item.category || "Uncategorized"} (${item.app_count} app${item.app_count !== 1 ? "s" : ""})`}
                            >
                              <Chip
                                label={item.name}
                                size="small"
                                onClick={() => navigate(`/fact-sheets/${item.id}`)}
                                sx={{
                                  cursor: "pointer",
                                  borderColor: RING_COLORS[ring],
                                  "&:hover": { backgroundColor: `${RING_COLORS[ring]}18` },
                                }}
                                variant="outlined"
                                icon={
                                  item.app_count > 0 ? (
                                    <Chip
                                      label={item.app_count}
                                      size="small"
                                      sx={{
                                        height: 18,
                                        fontSize: "0.65rem",
                                        ml: 0.5,
                                      }}
                                    />
                                  ) : undefined
                                }
                              />
                            </Tooltip>
                          ))}
                        </Box>
                      </Box>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </Box>
        )
      ) : (
        /* Tech Stacks view */
        techStacks.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <MaterialSymbol icon="layers" size={48} />
              <Typography variant="h6" sx={{ mt: 2 }}>No tech stacks yet</Typography>
              <Typography color="text.secondary">
                Link Applications to IT Components to see tech stacks.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <TableContainer component={Card}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Application</TableCell>
                  <TableCell>Criticality</TableCell>
                  <TableCell>Technology Stack</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {techStacks.map((stack) => (
                  <TableRow key={stack.app_id} hover>
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer" }}
                        onClick={() => navigate(`/fact-sheets/${stack.app_id}`)}
                      >
                        <MaterialSymbol icon="apps" size={18} />
                        <Typography variant="body2" sx={{ fontWeight: 500, "&:hover": { textDecoration: "underline" } }}>
                          {stack.app_name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      {stack.business_criticality ? (
                        <Chip
                          label={CRITICALITY_LABELS[stack.business_criticality] || stack.business_criticality}
                          size="small"
                          variant="outlined"
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                        {stack.components.map((comp) => {
                          const phase = comp.lifecycle_phase || "plan";
                          const ring = {
                            plan: "assess",
                            phase_in: "trial",
                            active: "adopt",
                            phase_out: "hold",
                            end_of_life: "hold",
                          }[phase] || "assess";
                          return (
                            <Tooltip
                              key={comp.id}
                              title={`${comp.name} — ${comp.category || "N/A"} (${phase.replace("_", " ")})`}
                            >
                              <Chip
                                label={comp.name}
                                size="small"
                                onClick={() => navigate(`/fact-sheets/${comp.id}`)}
                                sx={{
                                  cursor: "pointer",
                                  borderColor: RING_COLORS[ring],
                                  color: RING_COLORS[ring],
                                }}
                                variant="outlined"
                              />
                            </Tooltip>
                          );
                        })}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}
    </Box>
  );
}
