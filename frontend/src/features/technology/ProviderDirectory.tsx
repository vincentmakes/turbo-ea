import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
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

interface ProviderCost {
  provider_id: string;
  provider_name: string;
  component_count: number;
  total_cost: number;
  app_count: number;
}

export default function ProviderDirectory() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderCost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const data = await api.get<ProviderCost[]>("/technology/provider-costs");
      setProviders(data);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }

  const maxCost = Math.max(...providers.map((p) => p.total_cost), 1);
  const totalCost = providers.reduce((sum, p) => sum + p.total_cost, 0);
  const totalComponents = providers.reduce((sum, p) => sum + p.component_count, 0);

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Provider Directory</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Technology providers with cost aggregation and dependency counts.
        </Typography>
      </Box>

      {/* Summary cards */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Card sx={{ flex: "1 1 200px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{providers.length}</Typography>
            <Typography variant="body2" color="text.secondary">Providers</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: "1 1 200px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">{totalComponents}</Typography>
            <Typography variant="body2" color="text.secondary">IT Components</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: "1 1 200px" }}>
          <CardContent sx={{ textAlign: "center", py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="h4" color="primary.main">
              {totalCost > 0 ? `$${totalCost.toLocaleString()}` : "-"}
            </Typography>
            <Typography variant="body2" color="text.secondary">Total Cost</Typography>
          </CardContent>
        </Card>
      </Box>

      {loading ? (
        <LinearProgress />
      ) : providers.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="storefront" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No providers yet</Typography>
            <Typography color="text.secondary">
              Create Provider fact sheets and link IT Components to see cost summaries.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Provider</TableCell>
                <TableCell align="right">IT Components</TableCell>
                <TableCell align="right">Applications</TableCell>
                <TableCell align="right">Total Cost</TableCell>
                <TableCell width={200}>Cost Distribution</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {providers.map((p) => (
                <TableRow
                  key={p.provider_id}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => navigate(`/fact-sheets/${p.provider_id}`)}
                >
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <MaterialSymbol icon="storefront" size={20} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {p.provider_name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Chip label={p.component_count} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell align="right">
                    <Chip label={p.app_count} size="small" color="primary" variant="outlined" />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {p.total_cost > 0 ? `$${p.total_cost.toLocaleString()}` : "-"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {p.total_cost > 0 && (
                      <LinearProgress
                        variant="determinate"
                        value={(p.total_cost / maxCost) * 100}
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                    )}
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
