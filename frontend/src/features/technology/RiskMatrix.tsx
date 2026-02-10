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

interface RiskItem {
  id: string;
  name: string;
  technical_suitability: string | null;
  business_criticality: string | null;
  lifecycle_phase: string;
  tech_risk: number;
  component_count: number;
}

interface TechRisk {
  fact_sheet_id: string;
  name: string;
  fs_type: string;
  lifecycle_phase: string;
  lifecycle_risk: number;
  resource_classification: string | null;
  classification_risk: number;
  dependent_app_count: number;
  aggregate_risk: number;
}

const CRITICALITY_ORDER = ["administrative_service", "business_operational", "business_critical", "mission_critical"];
const SUITABILITY_ORDER = ["unreasonable", "insufficient", "appropriate", "perfect"];

const CRITICALITY_LABELS: Record<string, string> = {
  administrative_service: "Administrative",
  business_operational: "Operational",
  business_critical: "Critical",
  mission_critical: "Mission Critical",
};
const SUITABILITY_LABELS: Record<string, string> = {
  unreasonable: "Unreasonable",
  insufficient: "Insufficient",
  appropriate: "Appropriate",
  perfect: "Perfect",
};

const SUITABILITY_COLORS: Record<string, string> = {
  unreasonable: "#d32f2f",
  insufficient: "#ed6c02",
  appropriate: "#1565c0",
  perfect: "#2e7d32",
};

const CRITICALITY_COLORS: Record<string, string> = {
  administrative_service: "#9e9e9e",
  business_operational: "#1565c0",
  business_critical: "#ed6c02",
  mission_critical: "#d32f2f",
};

function getRiskColor(risk: number): string {
  if (risk < 0.2) return "#2e7d32";
  if (risk < 0.4) return "#4caf50";
  if (risk < 0.6) return "#ed6c02";
  if (risk < 0.8) return "#e65100";
  return "#d32f2f";
}

export default function RiskMatrix() {
  const navigate = useNavigate();
  const [matrixData, setMatrixData] = useState<RiskItem[]>([]);
  const [riskScores, setRiskScores] = useState<TechRisk[]>([]);
  const [view, setView] = useState<"matrix" | "obsolescence">("matrix");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [matrix, risks] = await Promise.all([
      api.get<RiskItem[]>("/technology/risk-matrix").catch(() => []),
      api.get<TechRisk[]>("/technology/risk-scores").catch(() => []),
    ]);
    setMatrixData(matrix);
    setRiskScores(risks);
  }

  // Build matrix grid: rows=criticality, cols=suitability
  const matrixGrid = useMemo(() => {
    const grid: Record<string, Record<string, RiskItem[]>> = {};
    for (const crit of CRITICALITY_ORDER) {
      grid[crit] = {};
      for (const suit of SUITABILITY_ORDER) {
        grid[crit][suit] = [];
      }
      grid[crit]["unset"] = [];
    }
    grid["unset"] = {};
    for (const suit of [...SUITABILITY_ORDER, "unset"]) {
      grid["unset"][suit] = [];
    }

    for (const item of matrixData) {
      const crit = item.business_criticality || "unset";
      const suit = item.technical_suitability || "unset";
      if (grid[crit]?.[suit]) {
        grid[crit][suit].push(item);
      }
    }
    return grid;
  }, [matrixData]);

  // Stats
  const highRiskApps = matrixData.filter(
    (d) => d.business_criticality === "mission_critical" &&
      (d.technical_suitability === "unreasonable" || d.technical_suitability === "insufficient")
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Risk Management</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Application risk matrix and technology obsolescence tracking.
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_, v) => v && setView(v)}
          size="small"
        >
          <ToggleButton value="matrix">
            <MaterialSymbol icon="grid_on" size={18} />
            <Box sx={{ ml: 0.5 }}>Risk Matrix</Box>
          </ToggleButton>
          <ToggleButton value="obsolescence">
            <MaterialSymbol icon="warning" size={18} />
            <Box sx={{ ml: 0.5 }}>Obsolescence</Box>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Alert banner for high-risk apps */}
      {highRiskApps.length > 0 && (
        <Card sx={{ mb: 2, backgroundColor: "#fff3e0", border: "1px solid #ffb74d" }}>
          <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 }, display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="warning" size={20} />
            <Typography variant="body2">
              <strong>{highRiskApps.length}</strong> mission-critical application{highRiskApps.length !== 1 ? "s" : ""} with
              poor technical fitness: {highRiskApps.map((a) => a.name).join(", ")}
            </Typography>
          </CardContent>
        </Card>
      )}

      {view === "matrix" ? (
        matrixData.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <MaterialSymbol icon="grid_on" size={48} />
              <Typography variant="h6" sx={{ mt: 2 }}>No application data</Typography>
              <Typography color="text.secondary">
                Set business criticality and technical suitability on applications.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 2, textAlign: "center" }}>
                Business Criticality (rows) vs Technical Suitability (columns)
              </Typography>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ minWidth: 700 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, width: 140 }}>Criticality</TableCell>
                      {SUITABILITY_ORDER.map((s) => (
                        <TableCell key={s} align="center" sx={{ fontWeight: 600, color: SUITABILITY_COLORS[s] }}>
                          {SUITABILITY_LABELS[s]}
                        </TableCell>
                      ))}
                      <TableCell align="center" sx={{ fontWeight: 600, color: "#999" }}>Unset</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...CRITICALITY_ORDER].reverse().map((crit) => (
                      <TableRow key={crit}>
                        <TableCell sx={{ fontWeight: 600, color: CRITICALITY_COLORS[crit] }}>
                          {CRITICALITY_LABELS[crit]}
                        </TableCell>
                        {[...SUITABILITY_ORDER, "unset"].map((suit) => {
                          const items = matrixGrid[crit]?.[suit] || [];
                          // Determine cell danger level
                          const critIdx = CRITICALITY_ORDER.indexOf(crit);
                          const suitIdx = SUITABILITY_ORDER.indexOf(suit);
                          const dangerLevel = suit === "unset" ? 0 : (critIdx - suitIdx + 3) / 6;
                          const bgColor = items.length > 0
                            ? `rgba(${dangerLevel > 0.5 ? "211,47,47" : dangerLevel > 0.3 ? "237,108,2" : "46,125,50"}, ${Math.min(0.08 + items.length * 0.04, 0.25)})`
                            : "transparent";

                          return (
                            <TableCell
                              key={suit}
                              align="center"
                              sx={{ backgroundColor: bgColor, verticalAlign: "top", minWidth: 120, p: 1 }}
                            >
                              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, justifyContent: "center" }}>
                                {items.map((item) => (
                                  <Tooltip key={item.id} title={`${item.name} — ${item.lifecycle_phase.replace("_", " ")} (${item.component_count} components)`}>
                                    <Chip
                                      label={item.name}
                                      size="small"
                                      onClick={() => navigate(`/fact-sheets/${item.id}`)}
                                      sx={{ cursor: "pointer", fontSize: "0.7rem" }}
                                    />
                                  </Tooltip>
                                ))}
                                {items.length === 0 && (
                                  <Typography variant="caption" color="text.secondary">-</Typography>
                                )}
                              </Box>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        )
      ) : (
        /* Obsolescence view */
        riskScores.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <MaterialSymbol icon="warning" size={48} />
              <Typography variant="h6" sx={{ mt: 2 }}>No IT components</Typography>
              <Typography color="text.secondary">
                Create IT Components with lifecycle dates and resource classifications.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <TableContainer component={Card}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Technology</TableCell>
                  <TableCell>Lifecycle</TableCell>
                  <TableCell>Classification</TableCell>
                  <TableCell align="right">Dependent Apps</TableCell>
                  <TableCell>Risk Score</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {riskScores.map((score) => (
                  <TableRow
                    key={score.fact_sheet_id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/fact-sheets/${score.fact_sheet_id}`)}
                  >
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <MaterialSymbol icon="memory" size={18} />
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {score.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={score.lifecycle_phase.replace("_", " ")}
                        size="small"
                        sx={{
                          textTransform: "capitalize",
                          backgroundColor: `${getRiskColor(score.lifecycle_risk)}18`,
                          color: getRiskColor(score.lifecycle_risk),
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={(score.resource_classification || "standard").replace("_", " ")}
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: "capitalize" }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontWeight: score.dependent_app_count > 5 ? 700 : 400 }}>
                        {score.dependent_app_count}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box
                          sx={{
                            width: 60,
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
                              width: `${score.aggregate_risk * 100}%`,
                              backgroundColor: getRiskColor(score.aggregate_risk),
                              borderRadius: 4,
                            }}
                          />
                        </Box>
                        <Typography variant="caption" sx={{ color: getRiskColor(score.aggregate_risk), fontWeight: 600 }}>
                          {Math.round(score.aggregate_risk * 100)}%
                        </Typography>
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
