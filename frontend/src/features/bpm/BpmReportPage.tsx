/**
 * BpmReportsContent — Sub-tabbed BPM report views embedded in BpmDashboard.
 * Tabs: Process Map, Capability×Process, Process×App, Dependencies, Element-App Map
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import ProcessMapReport from "@/features/reports/ProcessMapReport";

export default function BpmReportsContent() {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="Process Map" icon={<MaterialSymbol icon="account_tree" size={18} />} iconPosition="start" />
        <Tab label="Capability × Process" />
        <Tab label="Process × Application" />
        <Tab label="Process Dependencies" />
        <Tab label="Element-Application Map" />
      </Tabs>

      {tab === 0 && <ProcessMapReport />}
      {tab === 1 && <CapabilityProcessMatrix />}
      {tab === 2 && <ProcessAppMatrix />}
      {tab === 3 && <ProcessDependencies />}
      {tab === 4 && <ElementAppMap />}
    </Box>
  );
}

/* ================================================================== */
/*  Capability × Process Matrix                                        */
/* ================================================================== */

function CapabilityProcessMatrix() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/capability-process-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.rows.length) return <Typography color="text.secondary">No data. Link processes to capabilities first.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Capability × Process Matrix</Typography>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>Process</TableCell>
                {data.columns.map((c: any) => (
                  <TableCell key={c.id} align="center" sx={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                    {c.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r: any) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${r.id}`)}>
                  <TableCell>{r.name}</TableCell>
                  {data.columns.map((c: any) => {
                    const cell = data.cells.find(
                      (x: any) => x.process_id === r.id && x.capability_id === c.id
                    );
                    return (
                      <TableCell key={c.id} align="center">
                        {cell ? <Chip label="X" size="small" color="primary" /> : ""}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Process × Application Matrix                                       */
/* ================================================================== */

function ProcessAppMatrix() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/process-application-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.rows.length) return <Typography color="text.secondary">No data. Link processes to applications first.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Process × Application Matrix</Typography>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>Process</TableCell>
                {data.columns.map((c: any) => (
                  <TableCell key={c.id} align="center" sx={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                    {c.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r: any) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/fact-sheets/${r.id}`)}>
                  <TableCell>{r.name}</TableCell>
                  {data.columns.map((c: any) => {
                    const cells = data.cells.filter(
                      (x: any) => x.process_id === r.id && x.application_id === c.id
                    );
                    return (
                      <TableCell key={c.id} align="center">
                        {cells.length > 0 ? (
                          <Chip
                            label={cells.some((x: any) => x.source === "element") ? "E" : "R"}
                            size="small"
                            color={cells.some((x: any) => x.source === "element") ? "secondary" : "primary"}
                            title={cells.map((x: any) => x.source === "element" ? `Element: ${x.element_name}` : "Relation").join(", ")}
                          />
                        ) : ""}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Process Dependencies                                               */
/* ================================================================== */

function ProcessDependencies() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/process-dependencies")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.nodes.length) return <Typography color="text.secondary">No process dependencies defined yet.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Process Dependencies</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {data.nodes.length} processes, {data.edges.length} dependencies
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>From Process</TableCell>
                <TableCell align="center">depends on</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>To Process</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.edges.map((e: any) => {
                const src = data.nodes.find((n: any) => n.id === e.source);
                const tgt = data.nodes.find((n: any) => n.id === e.target);
                return (
                  <TableRow key={e.id} hover>
                    <TableCell
                      sx={{ cursor: "pointer", color: "primary.main" }}
                      onClick={() => navigate(`/fact-sheets/${e.source}`)}
                    >
                      {src?.name || e.source}
                    </TableCell>
                    <TableCell align="center">
                      <MaterialSymbol icon="arrow_forward" />
                    </TableCell>
                    <TableCell
                      sx={{ cursor: "pointer", color: "primary.main" }}
                      onClick={() => navigate(`/fact-sheets/${e.target}`)}
                    >
                      {tgt?.name || e.target}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/*  Element-Application Map                                            */
/* ================================================================== */

function ElementAppMap() {
  const navigate = useNavigate();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any[]>("/reports/bpm/element-application-map")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data.length) return <Typography color="text.secondary">No BPMN elements linked to applications yet.</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>Element-Application Map</Typography>
        {data.map((group: any) => (
          <Box key={group.application_id} sx={{ mb: 3 }}>
            <Typography
              variant="subtitle2"
              sx={{ cursor: "pointer", color: "primary.main", mb: 1 }}
              onClick={() => navigate(`/fact-sheets/${group.application_id}`)}
            >
              {group.application_name} ({group.elements.length} elements)
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Element</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Process</TableCell>
                    <TableCell>Lane</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.elements.map((el: any) => (
                    <TableRow key={el.element_id} hover>
                      <TableCell>{el.element_name || "(unnamed)"}</TableCell>
                      <TableCell>{el.element_type}</TableCell>
                      <TableCell
                        sx={{ cursor: "pointer", color: "primary.main" }}
                        onClick={() => navigate(`/fact-sheets/${el.process_id}`)}
                      >
                        {el.process_name}
                      </TableCell>
                      <TableCell>{el.lane_name || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}
