import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import {
  FACT_SHEET_TYPE_LABELS,
  FACT_SHEET_TYPE_ICONS,
} from "../../types/fact-sheet";

interface LandscapeItem {
  id: string;
  name: string;
  fs_type: string;
  lifecycle_phase: string;
  business_criticality: string | null;
  technical_suitability: string | null;
  completion: number;
  tag_names: string[];
  relation_count: number;
}

const PHASE_COLORS: Record<string, string> = {
  plan: "#9e9e9e",
  phase_in: "#1565c0",
  active: "#2e7d32",
  phase_out: "#ed6c02",
  end_of_life: "#d32f2f",
  undefined: "#bdbdbd",
};

const PHASE_LABELS: Record<string, string> = {
  plan: "Plan",
  phase_in: "Phase In",
  active: "Active",
  phase_out: "Phase Out",
  end_of_life: "End of Life",
  undefined: "Undefined",
};

const CRITICALITY_LABELS: Record<string, string> = {
  mission_critical: "Mission Critical",
  business_critical: "Business Critical",
  business_operational: "Business Operational",
  administrative_service: "Administrative",
};

const SUITABILITY_LABELS: Record<string, string> = {
  perfect: "Perfect",
  appropriate: "Appropriate",
  insufficient: "Insufficient",
  unreasonable: "Unreasonable",
};

const FS_TYPES = [
  { value: "", label: "All Types" },
  { value: "application", label: "Application" },
  { value: "business_capability", label: "Business Capability" },
  { value: "it_component", label: "IT Component" },
  { value: "organization", label: "Organization" },
  { value: "provider", label: "Provider" },
  { value: "interface", label: "Interface" },
  { value: "initiative", label: "Initiative" },
  { value: "data_object", label: "Data Object" },
];

export default function LandscapeReport() {
  const navigate = useNavigate();
  const [items, setItems] = useState<LandscapeItem[]>([]);
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    loadData();
  }, [typeFilter]);

  async function loadData() {
    try {
      const params: Record<string, string> = {};
      if (typeFilter) params.fs_type = typeFilter;
      const data = await api.get<LandscapeItem[]>("/reports/landscape", params);
      setItems(data);
    } catch {
      // handle
    }
  }

  function handleExportCsv() {
    const params = typeFilter ? `?fs_type=${typeFilter}` : "";
    window.open(`/api/v1/reports/export/fact-sheets${params}`, "_blank");
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Landscape Report</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Complete inventory view with lifecycle, criticality, and completeness.
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={typeFilter}
              label="Type"
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              {FS_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Chip
            icon={<MaterialSymbol icon="download" size={16} />}
            label="Export CSV"
            onClick={handleExportCsv}
            variant="outlined"
            sx={{ cursor: "pointer" }}
          />
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {items.length} fact sheets
      </Typography>

      {items.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="landscape" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No fact sheets found</Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Lifecycle</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Criticality</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Suitability</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Completion</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Relations</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Tags</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => navigate(`/fact-sheets/${item.id}`)}
                >
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <MaterialSymbol
                        icon={FACT_SHEET_TYPE_ICONS[item.fs_type as keyof typeof FACT_SHEET_TYPE_ICONS] || "circle"}
                        size={18}
                      />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {item.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {FACT_SHEET_TYPE_LABELS[item.fs_type as keyof typeof FACT_SHEET_TYPE_LABELS] || item.fs_type}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={PHASE_LABELS[item.lifecycle_phase] || item.lifecycle_phase}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: "0.7rem",
                        backgroundColor: `${PHASE_COLORS[item.lifecycle_phase] || "#bdbdbd"}18`,
                        color: PHASE_COLORS[item.lifecycle_phase] || "#bdbdbd",
                        fontWeight: 600,
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {item.business_criticality
                        ? CRITICALITY_LABELS[item.business_criticality] || item.business_criticality
                        : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {item.technical_suitability
                        ? SUITABILITY_LABELS[item.technical_suitability] || item.technical_suitability
                        : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        color: item.completion >= 70 ? "#2e7d32" : item.completion >= 40 ? "#ed6c02" : "#d32f2f",
                      }}
                    >
                      {Math.round(item.completion)}%
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="body2">{item.relation_count}</Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {item.tag_names.slice(0, 3).map((tag) => (
                        <Chip key={tag} label={tag} size="small" sx={{ height: 20, fontSize: "0.6rem" }} />
                      ))}
                      {item.tag_names.length > 3 && (
                        <Chip label={`+${item.tag_names.length - 3}`} size="small" sx={{ height: 20, fontSize: "0.6rem" }} />
                      )}
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
