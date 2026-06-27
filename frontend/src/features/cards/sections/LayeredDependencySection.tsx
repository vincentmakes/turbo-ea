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
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuthContext } from "@/hooks/AuthContext";
import { api } from "@/api/client";
import { resolveRevealIds } from "@/features/reports/layeredDependencyLayout";
import type { GNode, GEdge } from "@/features/reports/layeredDependencyLayout";

interface Props {
  cardId: string;
}

export default function LayeredDependencySection({ cardId }: Props) {
  const { t } = useTranslation(["cards", "reports"]);
  const { types } = useMetamodel();
  const { user } = useAuthContext();
  const canCreateDiagram =
    !!user?.permissions?.["*"] || !!user?.permissions?.["diagrams.manage"];

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

  // Reveal-parent / reveal-children modes: ids surfaced by each tool, tracked
  // separately so toggling one tool off clears only its own reveals.
  const [revealedParentIds, setRevealedParentIds] = useState<Set<string>>(new Set());
  const [revealedChildIds, setRevealedChildIds] = useState<Set<string>>(new Set());

  // Reset when cardId changes
  useEffect(() => {
    setCenter(cardId);
    setNavHistory([cardId]);
    setNavIndex(0);
    setExpandedNodes(new Set());
    setRevealedParentIds(new Set());
    setRevealedChildIds(new Set());
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

  // Re-centring the view (home / navigate / prev / next all change `center`)
  // is the "reset" that clears reveals — toggling a Reveal tool off keeps them
  // so parents and children can be layered in the same view.
  useEffect(() => {
    setRevealedParentIds(new Set());
    setRevealedChildIds(new Set());
  }, [center]);

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

  // Full reset (toolbar Reset button): back to the card itself with no
  // exploration (expand / reveals) and a clean navigation history.
  const handleReset = useCallback(() => {
    setCenter(cardId);
    setNavHistory([cardId]);
    setNavIndex(0);
    setExpandedNodes(new Set());
    setRevealedParentIds(new Set());
    setRevealedChildIds(new Set());
  }, [cardId]);

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

  // Reveal a clicked card's hierarchical parent or direct children.
  const handleNodeReveal = useCallback(
    (id: string, kind: "parents" | "children") => {
      const ids = resolveRevealIds(nodes, nodeMap, id, kind);
      if (ids.length === 0) return;
      const setter = kind === "parents" ? setRevealedParentIds : setRevealedChildIds;
      setter((prev) => {
        const next = new Set(prev);
        for (const rid of ids) next.add(rid);
        return next;
      });
    },
    [nodes, nodeMap],
  );

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
    // Targeted reveals: hierarchical parents / children surfaced by the toolbar.
    for (const id of revealedParentIds) if (nodeMap.has(id)) visited.add(id);
    for (const id of revealedChildIds) if (nodeMap.has(id)) visited.add(id);

    const visibleEdges = edges.filter((e) => visited.has(e.source) && visited.has(e.target));
    // Draw the containment line for parent/child pairs surfaced by the Reveal
    // tools (the view no longer auto-synthesises hierarchy edges).
    if (revealedParentIds.size > 0 || revealedChildIds.size > 0) {
      for (const n of nodes) {
        if (!visited.has(n.id) || !n.parent_id || !visited.has(n.parent_id)) continue;
        visibleEdges.push({
          source: n.parent_id,
          target: n.id,
          type: "hierarchy",
          label: t("reports:dependency.hierarchyContains"),
          reverse_label: t("reports:dependency.hierarchyPartOf"),
        });
      }
    }
    // Annotate each visible card with whether it has any child in the full
    // dataset, so the view can draw the "hidden children" hierarchy marker.
    const parentIds = new Set(nodes.map((n) => n.parent_id).filter(Boolean) as string[]);
    const visibleNodes = nodes
      .filter((n) => visited.has(n.id))
      .map((n) => ({ ...n, hasChildren: parentIds.has(n.id) }));
    return { nodes: visibleNodes, edges: visibleEdges };
  }, [
    center,
    nodes,
    edges,
    adjMap,
    nodeMap,
    expandedNodes,
    revealedParentIds,
    revealedChildIds,
    t,
  ]);

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
              onNodeReveal={handleNodeReveal}
              onReset={handleReset}
              onHome={handleHome}
              onPrev={handlePrev}
              onNext={handleNext}
              hasPrev={hasPrev}
              hasNext={hasNext}
              centerName={centerNode?.name}
              centerId={center}
              canCreateDiagram={canCreateDiagram}
            />
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
