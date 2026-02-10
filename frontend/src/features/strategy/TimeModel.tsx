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

interface TimeItem {
  id: string;
  name: string;
  quadrant: string;
  technical_suitability: string | null;
  business_criticality: string | null;
  lifecycle_phase: string;
  relation_count: number;
}

interface RationalizationItem {
  id: string;
  name: string;
  score: number;
  reasons: string[];
  time_quadrant: string;
  technical_suitability: string | null;
  business_criticality: string | null;
  lifecycle_phase: string;
  duplicate_count: number;
  capability_overlap: number;
}

const QUADRANT_CONFIG: Record<string, { label: string; color: string; icon: string; description: string }> = {
  invest: {
    label: "Invest",
    color: "#2e7d32",
    icon: "trending_up",
    description: "High criticality + good tech fit → invest to grow",
  },
  tolerate: {
    label: "Tolerate",
    color: "#1565c0",
    icon: "check_circle",
    description: "Low criticality + adequate tech → keep as-is",
  },
  migrate: {
    label: "Migrate",
    color: "#ed6c02",
    icon: "swap_horiz",
    description: "High criticality + poor tech → migrate urgently",
  },
  eliminate: {
    label: "Eliminate",
    color: "#d32f2f",
    icon: "delete",
    description: "Low criticality + poor tech → retire/consolidate",
  },
};

function getRiskColor(score: number): string {
  if (score < 20) return "#2e7d32";
  if (score < 40) return "#4caf50";
  if (score < 60) return "#ed6c02";
  if (score < 80) return "#e65100";
  return "#d32f2f";
}

export default function TimeModel() {
  const navigate = useNavigate();
  const [timeItems, setTimeItems] = useState<TimeItem[]>([]);
  const [rationalization, setRationalization] = useState<RationalizationItem[]>([]);
  const [view, setView] = useState<"quadrant" | "rationalization">("quadrant");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [time, rat] = await Promise.all([
      api.get<TimeItem[]>("/strategy/time-model").catch(() => []),
      api.get<RationalizationItem[]>("/strategy/rationalization").catch(() => []),
    ]);
    setTimeItems(time);
    setRationalization(rat);
  }

  const grouped = useMemo(() => {
    const map: Record<string, TimeItem[]> = {
      invest: [],
      tolerate: [],
      migrate: [],
      eliminate: [],
    };
    for (const item of timeItems) {
      if (map[item.quadrant]) {
        map[item.quadrant].push(item);
      }
    }
    return map;
  }, [timeItems]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Strategic Portfolio</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            TIME model assessment and application rationalization.
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_, v) => v && setView(v)}
          size="small"
        >
          <ToggleButton value="quadrant">
            <MaterialSymbol icon="dashboard" size={18} />
            <Box sx={{ ml: 0.5 }}>TIME Model</Box>
          </ToggleButton>
          <ToggleButton value="rationalization">
            <MaterialSymbol icon="auto_fix_high" size={18} />
            <Box sx={{ ml: 0.5 }}>Rationalization</Box>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {view === "quadrant" ? (
        timeItems.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <MaterialSymbol icon="dashboard" size={48} />
              <Typography variant="h6" sx={{ mt: 2 }}>No applications assessed</Typography>
              <Typography color="text.secondary">
                Set business criticality and technical suitability on applications.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            {(["invest", "migrate", "tolerate", "eliminate"] as const).map((quadrant) => {
              const config = QUADRANT_CONFIG[quadrant];
              const items = grouped[quadrant];
              return (
                <Card
                  key={quadrant}
                  sx={{
                    border: `2px solid ${config.color}20`,
                    minHeight: 200,
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                      <MaterialSymbol icon={config.icon} size={24} />
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: config.color }}>
                          {config.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {config.description}
                        </Typography>
                      </Box>
                      <Chip
                        label={items.length}
                        size="small"
                        sx={{
                          ml: "auto",
                          backgroundColor: `${config.color}18`,
                          color: config.color,
                          fontWeight: 700,
                        }}
                      />
                    </Box>

                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                      {items.map((item) => (
                        <Box
                          key={item.id}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            p: 0.75,
                            borderRadius: 1,
                            cursor: "pointer",
                            "&:hover": { backgroundColor: "action.hover" },
                          }}
                          onClick={() => navigate(`/fact-sheets/${item.id}`)}
                        >
                          <MaterialSymbol icon="apps" size={16} />
                          <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>
                            {item.name}
                          </Typography>
                          <Tooltip title={`${item.lifecycle_phase.replace("_", " ")} | ${item.relation_count} relations`}>
                            <Chip
                              label={item.lifecycle_phase.replace("_", " ")}
                              size="small"
                              sx={{ height: 20, fontSize: "0.6rem", textTransform: "capitalize" }}
                              variant="outlined"
                            />
                          </Tooltip>
                        </Box>
                      ))}
                      {items.length === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
                          No applications in this quadrant
                        </Typography>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        )
      ) : (
        /* Rationalization view */
        rationalization.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <MaterialSymbol icon="auto_fix_high" size={48} />
              <Typography variant="h6" sx={{ mt: 2 }}>No rationalization data</Typography>
              <Typography color="text.secondary">
                Applications need criticality, suitability, and capability mappings.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <TableContainer component={Card}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Application</TableCell>
                  <TableCell>TIME</TableCell>
                  <TableCell align="right">Score</TableCell>
                  <TableCell>Reasons</TableCell>
                  <TableCell align="right">Overlap</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rationalization.map((item) => {
                  const qConfig = QUADRANT_CONFIG[item.time_quadrant];
                  return (
                    <TableRow
                      key={item.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => navigate(`/fact-sheets/${item.id}`)}
                    >
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <MaterialSymbol icon="apps" size={16} />
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {item.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={qConfig?.label || item.time_quadrant}
                          size="small"
                          sx={{
                            backgroundColor: `${qConfig?.color || "#999"}18`,
                            color: qConfig?.color || "#999",
                            fontWeight: 600,
                          }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "flex-end" }}>
                          <Box
                            sx={{
                              width: 50,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: "#e0e0e0",
                              position: "relative",
                              overflow: "hidden",
                            }}
                          >
                            <Box
                              sx={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                height: "100%",
                                width: `${item.score}%`,
                                backgroundColor: getRiskColor(item.score),
                                borderRadius: 4,
                              }}
                            />
                          </Box>
                          <Typography
                            variant="caption"
                            sx={{ color: getRiskColor(item.score), fontWeight: 700, minWidth: 30, textAlign: "right" }}
                          >
                            {Math.round(item.score)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                          {item.reasons.map((r, i) => (
                            <Chip key={i} label={r} size="small" sx={{ fontSize: "0.65rem", height: 20 }} variant="outlined" />
                          ))}
                          {item.reasons.length === 0 && (
                            <Typography variant="caption" color="text.secondary">Low risk</Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        {item.duplicate_count > 0 ? (
                          <Tooltip title={`${item.duplicate_count} apps share ${item.capability_overlap} capabilities`}>
                            <Chip
                              label={`${item.duplicate_count} apps`}
                              size="small"
                              color={item.duplicate_count >= 3 ? "warning" : "default"}
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          </Tooltip>
                        ) : (
                          <Typography variant="caption" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}
    </Box>
  );
}
