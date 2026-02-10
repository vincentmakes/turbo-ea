import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { FACT_SHEET_TYPE_ICONS } from "../../types/fact-sheet";

interface TraceabilityNode {
  id: string;
  name: string;
  fs_type: string;
  children: TraceabilityNode[];
}

const TYPE_COLORS: Record<string, string> = {
  objective: "#9c27b0",
  initiative: "#ed6c02",
  application: "#1565c0",
  business_capability: "#2e7d32",
};

export default function Traceability() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<TraceabilityNode[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const data = await api.get<TraceabilityNode[]>("/strategy/traceability");
      setTree(data);
    } catch {
      // handle
    }
  }

  // Count totals
  let totalObjectives = tree.length;
  let totalInitiatives = 0;
  let totalApps = 0;
  let totalCaps = 0;
  for (const obj of tree) {
    for (const child of obj.children) {
      if (child.fs_type === "initiative") {
        totalInitiatives++;
        totalApps += child.children.length;
      } else if (child.fs_type === "business_capability") {
        totalCaps++;
      }
    }
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Strategic Traceability</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Objective → Initiative → Application alignment tree.
        </Typography>
      </Box>

      {/* Summary */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        {[
          { label: "Objectives", count: totalObjectives, color: TYPE_COLORS.objective },
          { label: "Initiatives", count: totalInitiatives, color: TYPE_COLORS.initiative },
          { label: "Applications", count: totalApps, color: TYPE_COLORS.application },
          { label: "Capabilities", count: totalCaps, color: TYPE_COLORS.business_capability },
        ].map((stat) => (
          <Card key={stat.label} sx={{ flex: "1 1 140px" }}>
            <CardContent sx={{ textAlign: "center", py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="h5" sx={{ color: stat.color }}>{stat.count}</Typography>
              <Typography variant="caption" color="text.secondary">{stat.label}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {tree.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="flag" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No strategic alignment data</Typography>
            <Typography color="text.secondary">
              Create Objectives and link them to Initiatives and Business Capabilities.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {tree.map((objective) => (
            <Card key={objective.id}>
              <CardContent>
                {/* Objective */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 2,
                    cursor: "pointer",
                    "&:hover": { opacity: 0.8 },
                  }}
                  onClick={() => navigate(`/fact-sheets/${objective.id}`)}
                >
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      backgroundColor: `${TYPE_COLORS.objective}18`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <MaterialSymbol icon="flag" size={20} />
                  </Box>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {objective.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Objective</Typography>
                  </Box>
                  <Chip
                    label={`${objective.children.length} linked`}
                    size="small"
                    sx={{ ml: "auto" }}
                  />
                </Box>

                {/* Children: Initiatives and Capabilities */}
                <Box sx={{ pl: 4, borderLeft: `2px solid ${TYPE_COLORS.objective}30` }}>
                  {objective.children.map((child) => (
                    <Box key={child.id} sx={{ mb: 1.5 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          cursor: "pointer",
                          p: 0.5,
                          borderRadius: 1,
                          "&:hover": { backgroundColor: "action.hover" },
                        }}
                        onClick={() => navigate(`/fact-sheets/${child.id}`)}
                      >
                        <MaterialSymbol
                          icon={FACT_SHEET_TYPE_ICONS[child.fs_type as keyof typeof FACT_SHEET_TYPE_ICONS] || "circle"}
                          size={18}
                        />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {child.name}
                        </Typography>
                        <Chip
                          label={child.fs_type.replace("_", " ")}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: "0.6rem",
                            color: TYPE_COLORS[child.fs_type] || "#666",
                            borderColor: TYPE_COLORS[child.fs_type] || "#ccc",
                            textTransform: "capitalize",
                          }}
                          variant="outlined"
                        />
                      </Box>

                      {/* Initiative's applications */}
                      {child.children.length > 0 && (
                        <Box sx={{ pl: 3, mt: 0.5, borderLeft: `2px solid ${TYPE_COLORS[child.fs_type] || "#ccc"}30` }}>
                          {child.children.map((grandchild) => (
                            <Box
                              key={grandchild.id}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 0.5,
                                p: 0.5,
                                cursor: "pointer",
                                borderRadius: 1,
                                "&:hover": { backgroundColor: "action.hover" },
                              }}
                              onClick={() => navigate(`/fact-sheets/${grandchild.id}`)}
                            >
                              <MaterialSymbol
                                icon={FACT_SHEET_TYPE_ICONS[grandchild.fs_type as keyof typeof FACT_SHEET_TYPE_ICONS] || "circle"}
                                size={16}
                              />
                              <Typography variant="body2">{grandchild.name}</Typography>
                              <Chip
                                label={grandchild.fs_type.replace("_", " ")}
                                size="small"
                                sx={{
                                  height: 18,
                                  fontSize: "0.6rem",
                                  textTransform: "capitalize",
                                }}
                                variant="outlined"
                              />
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  ))}

                  {objective.children.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      No linked initiatives or capabilities
                    </Typography>
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
