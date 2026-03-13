import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import C4DiagramView from "@/features/reports/C4DiagramView";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { GNode, GEdge } from "@/features/reports/c4Layout";

interface Props {
  cardId: string;
  initialExpanded?: boolean;
}

export default function C4DiagramSection({
  cardId,
  initialExpanded = false,
}: Props) {
  const { t } = useTranslation(["cards"]);
  const { types } = useMetamodel();

  const [expanded, setExpanded] = useState(initialExpanded);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fetchedRef = useRef(false);

  // Current center for navigation (starts as the card itself)
  const [center, setCenter] = useState(cardId);

  // Browser-style navigation history
  const [navHistory, setNavHistory] = useState<string[]>([cardId]);
  const [navIndex, setNavIndex] = useState(0);

  // Reset when cardId changes
  useEffect(() => {
    setCenter(cardId);
    setNavHistory([cardId]);
    setNavIndex(0);
    fetchedRef.current = false;
    setNodes([]);
    setEdges([]);
  }, [cardId]);

  // Lazy-load data on first expand
  useEffect(() => {
    if (!expanded || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError("");
    api
      .get<{ nodes: GNode[]; edges: GEdge[] }>("/reports/dependencies")
      .then((r) => {
        setNodes(r.nodes);
        setEdges(r.edges);
      })
      .catch((e) => setError(e.message || t("dependencies.error")))
      .finally(() => setLoading(false));
  }, [expanded, t]);

  // Adjacency map
  const adjMap = useMemo(() => {
    const m = new Map<
      string,
      { nodeId: string; relType: string; relLabel: string; relDescription?: string }[]
    >();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, []);
      m.get(e.source)!.push({
        nodeId: e.target,
        relType: e.type,
        relLabel: e.label || e.type,
        relDescription: e.description,
      });
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.target)!.push({
        nodeId: e.source,
        relType: e.type,
        relLabel: e.reverse_label || e.label || e.type,
        relDescription: e.description,
      });
    }
    return m;
  }, [edges]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // BFS from center to get depth-1 neighborhood
  const c4Data = useMemo(() => {
    if (!center || !nodeMap.has(center))
      return { nodes: [] as GNode[], edges: [] as GEdge[] };
    const visited = new Set<string>([center]);
    for (const neighbor of adjMap.get(center) || []) {
      if (nodeMap.has(neighbor.nodeId)) visited.add(neighbor.nodeId);
    }
    return {
      nodes: nodes.filter((n) => visited.has(n.id)),
      edges: edges.filter((e) => visited.has(e.source) && visited.has(e.target)),
    };
  }, [center, nodes, edges, adjMap, nodeMap]);

  const centerNode = nodeMap.get(center);

  // Navigation callbacks
  const navigateTo = useCallback(
    (id: string) => {
      setCenter(id);
      setNavHistory((prev) => [...prev.slice(0, navIndex + 1), id]);
      setNavIndex((prev) => prev + 1);
    },
    [navIndex],
  );

  const hasPrev = navIndex > 0;
  const hasNext = navIndex < navHistory.length - 1;

  const handlePrev = useCallback(() => {
    if (navIndex <= 0) return;
    const i = navIndex - 1;
    setNavIndex(i);
    setCenter(navHistory[i]);
  }, [navIndex, navHistory]);

  const handleNext = useCallback(() => {
    if (navIndex >= navHistory.length - 1) return;
    const i = navIndex + 1;
    setNavIndex(i);
    setCenter(navHistory[i]);
  }, [navIndex, navHistory]);

  const handleHome = useCallback(() => {
    setCenter(cardId);
    setNavHistory((prev) => [...prev.slice(0, navIndex + 1), cardId]);
    setNavIndex((prev) => prev + 1);
  }, [cardId, navIndex]);

  const handleNodeClick = useCallback((id: string) => {
    window.open(`/cards/${id}`, "_blank");
  }, []);

  const hasData = c4Data.nodes.length > 0;

  return (
    <Accordion
      defaultExpanded={initialExpanded}
      disableGutters
      onChange={(_, isExpanded) => setExpanded(isExpanded)}
    >
      <AccordionSummary
        expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="hub" size={20} />
          <Typography fontWeight={600}>{t("dependencies.title")}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error && (
          <Typography color="text.disabled" sx={{ py: 3, textAlign: "center" }}>
            {error}
          </Typography>
        )}
        {!loading && !error && !hasData && (
          <Typography color="text.disabled" sx={{ py: 3, textAlign: "center" }}>
            {t("dependencies.empty")}
          </Typography>
        )}
        {!loading && !error && hasData && (
          <C4DiagramView
            nodes={c4Data.nodes}
            edges={c4Data.edges}
            types={types}
            onNodeClick={handleNodeClick}
            onNodeShiftClick={navigateTo}
            onHome={handleHome}
            onPrev={handlePrev}
            onNext={handleNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
            centerName={centerNode?.name}
          />
        )}
      </AccordionDetails>
    </Accordion>
  );
}
