import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import LayeredDependencyView from "@/features/reports/LayeredDependencyView";
import { useLdvSettings } from "@/features/reports/ldvDisplaySettings";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { GNode, GEdge } from "@/features/reports/layeredDependencyLayout";

interface Props {
  cardId: string;
}

export default function LayeredDependencySection({ cardId }: Props) {
  const { t } = useTranslation(["cards"]);
  const { types } = useMetamodel();
  const [ldvSettings] = useLdvSettings();

  const [expanded, setExpanded] = useState(true);
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

  // Expand mode: tracks which nodes have been expanded
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Reset when cardId changes
  useEffect(() => {
    setCenter(cardId);
    setNavHistory([cardId]);
    setNavIndex(0);
    setExpandedNodes(new Set());
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

  // (ldvVisible computed below with expand support)

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

  // Expand mode: toggle a node's neighbors into the visible set
  const handleExpand = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);
  const handleExpandReset = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  // BFS from center + expanded nodes to build visible neighborhood
  const ldvVisible = useMemo(() => {
    if (!center || !nodeMap.has(center))
      return { nodes: [] as GNode[], edges: [] as GEdge[] };
    const visited = new Set<string>([center]);
    // depth-1 from center
    for (const nb of adjMap.get(center) || []) {
      if (nodeMap.has(nb.nodeId)) visited.add(nb.nodeId);
    }
    // depth-1 from each expanded node
    for (const eid of expandedNodes) {
      if (!visited.has(eid)) continue; // only expand already-visible nodes
      for (const nb of adjMap.get(eid) || []) {
        if (nodeMap.has(nb.nodeId)) visited.add(nb.nodeId);
      }
    }
    // When "show hierarchy" is on, pull in each visible card's ancestor chain
    // so a parent (e.g. a parent Organization) appears in the layout. The
    // containment edge itself is synthesised by the view from parent_id.
    if (ldvSettings.showHierarchy) {
      for (const id of [...visited]) {
        let cur = nodeMap.get(id);
        const guard = new Set<string>();
        while (cur?.parent_id && nodeMap.has(cur.parent_id) && !guard.has(cur.parent_id)) {
          guard.add(cur.parent_id);
          visited.add(cur.parent_id);
          cur = nodeMap.get(cur.parent_id);
        }
      }
    }
    return {
      nodes: nodes.filter((n) => visited.has(n.id)),
      edges: edges.filter((e) => visited.has(e.source) && visited.has(e.target)),
    };
  }, [center, nodes, edges, adjMap, nodeMap, expandedNodes, ldvSettings.showHierarchy]);

  const hasData = ldvVisible.nodes.length > 0;

  return (
    <Accordion
      defaultExpanded
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
          <Box sx={{ height: 600 }}>
            <LayeredDependencyView
              nodes={ldvVisible.nodes}
              edges={ldvVisible.edges}
              types={types}
              onNodeClick={handleNodeClick}
              onNodeShiftClick={navigateTo}
              onNodeExpand={handleExpand}
              onExpandReset={handleExpandReset}
              onHome={handleHome}
              onPrev={handlePrev}
              onNext={handleNext}
              hasPrev={hasPrev}
              hasNext={hasNext}
              centerName={centerNode?.name}
              centerId={center}
            />
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
