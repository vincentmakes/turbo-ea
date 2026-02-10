import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";

interface LandscapeItem {
  id: string;
  name: string;
  type: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
}

interface LandscapeGroup {
  id: string;
  name: string;
  items: LandscapeItem[];
}

interface LandscapeData {
  groups: LandscapeGroup[];
  ungrouped: LandscapeItem[];
}

export default function LandscapeReport() {
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const [type, setType] = useState("Application");
  const [groupBy, setGroupBy] = useState("BusinessCapability");
  const [data, setData] = useState<LandscapeData | null>(null);

  useEffect(() => {
    api.get<LandscapeData>(`/reports/landscape?type=${type}&group_by=${groupBy}`).then(setData);
  }, [type, groupBy]);

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Landscape Report</Typography>
      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Fact Sheet Type</InputLabel>
          <Select value={type} label="Fact Sheet Type" onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Group By</InputLabel>
          <Select value={groupBy} label="Group By" onChange={(e) => setGroupBy(e.target.value)}>
            {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      {data?.groups.map((group) => (
        <Card key={group.id} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>{group.name}</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {group.items.map((item) => (
                <Chip
                  key={item.id}
                  label={item.name}
                  onClick={() => navigate(`/fact-sheets/${item.id}`)}
                  sx={{ cursor: "pointer" }}
                />
              ))}
              {group.items.length === 0 && (
                <Typography variant="body2" color="text.secondary">No items</Typography>
              )}
            </Box>
          </CardContent>
        </Card>
      ))}

      {data?.ungrouped && data.ungrouped.length > 0 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Ungrouped</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {data.ungrouped.map((item) => (
                <Chip key={item.id} label={item.name} onClick={() => navigate(`/fact-sheets/${item.id}`)} />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
