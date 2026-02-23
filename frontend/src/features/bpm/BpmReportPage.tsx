/**
 * BpmReportsContent — Sub-tabbed BPM report views embedded in BpmDashboard.
 * Tabs: Process Map, Capability×Process, Process×App, Dependencies, Element-App Map
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import ProcessMapReport from "@/features/reports/ProcessMapReport";

export default function BpmReportsContent() {
  const { t } = useTranslation(["bpm", "common"]);
  const [tab, setTab] = useState(0);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label={t("reports.processMap")} icon={<MaterialSymbol icon="account_tree" size={18} />} iconPosition="start" />
        <Tab label={t("reports.capabilityProcess")} />
        <Tab label={t("reports.processApplication")} />
        <Tab label={t("reports.processDependencies")} />
        <Tab label={t("reports.elementApplicationMap")} />
      </Tabs>

      {tab === 0 && <ProcessMapReport />}
      {tab === 1 && <CapabilityProcessMatrix onOpenCard={setSidePanelCardId} />}
      {tab === 2 && <ProcessAppMatrix onOpenCard={setSidePanelCardId} />}
      {tab === 3 && <ProcessDependencies onOpenCard={setSidePanelCardId} />}
      {tab === 4 && <ElementAppMap onOpenCard={setSidePanelCardId} />}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
    </Box>
  );
}

/* ================================================================== */
/*  Capability × Process Matrix                                        */
/* ================================================================== */

function CapabilityProcessMatrix({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { t } = useTranslation(["bpm", "common"]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/capability-process-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.rows.length) return <Typography color="text.secondary">{t("reports.noDataLinkCapabilities")}</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>{t("reports.capabilityProcessMatrix")}</Typography>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>{t("reports.process")}</TableCell>
                {data.columns.map((c: any) => (
                  <TableCell key={c.id} align="center" sx={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                    {c.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r: any) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => onOpenCard(r.id)}>
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

function ProcessAppMatrix({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { t } = useTranslation(["bpm", "common"]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/process-application-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.rows.length) return <Typography color="text.secondary">{t("reports.noDataLinkApplications")}</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>{t("reports.processApplicationMatrix")}</Typography>
        <TableContainer sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>{t("reports.process")}</TableCell>
                {data.columns.map((c: any) => (
                  <TableCell key={c.id} align="center" sx={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                    {c.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r: any) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => onOpenCard(r.id)}>
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
                            title={cells.map((x: any) => x.source === "element" ? `${t("reports.element")}: ${x.element_name}` : t("reports.relation")).join(", ")}
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

function ProcessDependencies({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { t } = useTranslation(["bpm", "common"]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/reports/bpm/process-dependencies")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.nodes.length) return <Typography color="text.secondary">{t("reports.noDependencies")}</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>{t("reports.processDependenciesTitle")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("reports.dependenciesSummary", { processes: data.nodes.length, dependencies: data.edges.length })}
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold" }}>{t("reports.fromProcess")}</TableCell>
                <TableCell align="center">{t("reports.dependsOn")}</TableCell>
                <TableCell sx={{ fontWeight: "bold" }}>{t("reports.toProcess")}</TableCell>
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
                      onClick={() => onOpenCard(e.source)}
                    >
                      {src?.name || e.source}
                    </TableCell>
                    <TableCell align="center">
                      <MaterialSymbol icon="arrow_forward" />
                    </TableCell>
                    <TableCell
                      sx={{ cursor: "pointer", color: "primary.main" }}
                      onClick={() => onOpenCard(e.target)}
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

function ElementAppMap({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { t } = useTranslation(["bpm", "common"]);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any[]>("/reports/bpm/element-application-map")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data.length) return <Typography color="text.secondary">{t("reports.noElementsLinked")}</Typography>;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>{t("reports.elementApplicationMapTitle")}</Typography>
        {data.map((group: any) => (
          <Box key={group.application_id} sx={{ mb: 3 }}>
            <Typography
              variant="subtitle2"
              sx={{ cursor: "pointer", color: "primary.main", mb: 1 }}
              onClick={() => onOpenCard(group.application_id)}
            >
              {group.application_name} ({t("reports.elementsCount", { count: group.elements.length })})
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("reports.element")}</TableCell>
                    <TableCell>{t("common:labels.type")}</TableCell>
                    <TableCell>{t("reports.process")}</TableCell>
                    <TableCell>{t("reports.lane")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.elements.map((el: any) => (
                    <TableRow key={el.element_id} hover>
                      <TableCell>{el.element_name || t("viewer.unnamed")}</TableCell>
                      <TableCell>{el.element_type}</TableCell>
                      <TableCell
                        sx={{ cursor: "pointer", color: "primary.main" }}
                        onClick={() => onOpenCard(el.process_id)}
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
