import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Autocomplete from "@mui/material/Autocomplete";
import Tooltip from "@mui/material/Tooltip";
import ReportShell from "./ReportShell";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FactSheetType } from "@/types";

/* ------------------------------------------------------------------ */
/*  Data interfaces                                                    */
/* ------------------------------------------------------------------ */

interface GNode {
  id: string;
  name: string;
  type: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
}

interface GEdge {
  source: string;
  target: string;
  type: string;
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  Layout interfaces                                                  */
/* ------------------------------------------------------------------ */

interface PositionedCard {
  id: string;
  node: GNode;
  column: number;
  x: number;
  y: number;
  parentId: string | null;
  isExpanded: boolean;
  canExpand: boolean;
  isRoot: boolean;
}

interface PositionedHeader {
  key: string;
  typeKey: string;
  typeLabel: string;
  typeColor: string;
  typeIcon: string;
  count: number;
  x: number;
  y: number;
}

interface Connection {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface TreeLayout {
  cards: PositionedCard[];
  headers: PositionedHeader[];
  connections: Connection[];
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/*  Layout constants                                                   */
/* ------------------------------------------------------------------ */

const CARD_W = 232;
const CARD_H = 40;
const ROOT_CARD_H = 54;
const COL_GAP = 100;
const COL_SPACING = CARD_W + COL_GAP;
const ITEM_GAP = 5;
const GROUP_GAP = 18;
const HEADER_H = 26;
const PADDING = 28;

const FALLBACK_COLORS: Record<string, string> = {
  Application: "#0f7eb5",
  Interface: "#02afa4",
  ITComponent: "#d29270",
  DataObject: "#774fcc",
  BusinessCapability: "#003399",
  Organization: "#2889ff",
  Initiative: "#33cc58",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function typeColor(key: string, types: FactSheetType[]): string {
  return types.find((t) => t.key === key)?.color || FALLBACK_COLORS[key] || "#999";
}

function typeLabel(key: string, types: FactSheetType[]): string {
  return types.find((t) => t.key === key)?.label || key;
}

function typeIcon(key: string, types: FactSheetType[]): string {
  return types.find((t) => t.key === key)?.icon || "description";
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

/* ------------------------------------------------------------------ */
/*  Tree layout algorithm                                              */
/* ------------------------------------------------------------------ */

function computeTreeLayout(
  rootId: string,
  expanded: Set<string>,
  adjMap: Map<string, { nodeId: string; relType: string }[]>,
  nodeMap: Map<string, GNode>,
  types: FactSheetType[],
): TreeLayout {
  const cards: PositionedCard[] = [];
  const headers: PositionedHeader[] = [];
  const visited = new Set<string>();

  function layoutNode(
    nodeId: string,
    column: number,
    yOffset: number,
    parentId: string | null,
  ): number {
    const node = nodeMap.get(nodeId);
    if (!node) return 0;

    visited.add(nodeId);
    const isRoot = nodeId === rootId;
    const cardH = isRoot ? ROOT_CARD_H : CARD_H;
    const x = column * COL_SPACING + PADDING;
    const isExp = expanded.has(nodeId);
    const neighbors = (adjMap.get(nodeId) || []).filter(
      (n) => !visited.has(n.nodeId) && nodeMap.has(n.nodeId),
    );

    if (!isExp || neighbors.length === 0) {
      cards.push({
        id: nodeId,
        node,
        column,
        x,
        y: yOffset,
        parentId,
        isExpanded: isExp,
        canExpand: neighbors.length > 0,
        isRoot,
      });
      return cardH;
    }

    // Group neighbors by fact-sheet type
    const groupMap = new Map<string, string[]>();
    const groupOrder: string[] = [];
    for (const n of neighbors) {
      const nn = nodeMap.get(n.nodeId);
      if (!nn) continue;
      if (!groupMap.has(nn.type)) {
        groupMap.set(nn.type, []);
        groupOrder.push(nn.type);
      }
      groupMap.get(nn.type)!.push(n.nodeId);
    }

    // Sort groups by metamodel sort_order
    groupOrder.sort((a, b) => {
      const sa = types.find((t) => t.key === a)?.sort_order ?? 99;
      const sb = types.find((t) => t.key === b)?.sort_order ?? 99;
      return sa - sb;
    });

    // Sort items within each group alphabetically
    for (const ids of groupMap.values()) {
      ids.sort((a, b) => {
        const na = nodeMap.get(a)?.name || "";
        const nb = nodeMap.get(b)?.name || "";
        return na.localeCompare(nb);
      });
    }

    // Layout children in the next column
    let childY = yOffset;
    for (let gi = 0; gi < groupOrder.length; gi++) {
      const tk = groupOrder[gi];
      const nodeIds = groupMap.get(tk)!;
      if (gi > 0) childY += GROUP_GAP;

      headers.push({
        key: `${nodeId}-${tk}`,
        typeKey: tk,
        typeLabel: typeLabel(tk, types),
        typeColor: typeColor(tk, types),
        typeIcon: typeIcon(tk, types),
        count: nodeIds.length,
        x: (column + 1) * COL_SPACING + PADDING,
        y: childY,
      });
      childY += HEADER_H;

      for (let i = 0; i < nodeIds.length; i++) {
        if (i > 0) childY += ITEM_GAP;
        childY += layoutNode(nodeIds[i], column + 1, childY, nodeId);
      }
    }

    const childrenH = childY - yOffset;
    const nodeY = yOffset + Math.max(0, childrenH / 2 - cardH / 2);

    cards.push({
      id: nodeId,
      node,
      column,
      x,
      y: nodeY,
      parentId,
      isExpanded: true,
      canExpand: true,
      isRoot,
    });

    return Math.max(cardH, childrenH);
  }

  // Run layout
  const rootNode = nodeMap.get(rootId);
  if (!rootNode) return { cards: [], headers: [], connections: [], width: 0, height: 0 };

  const totalH = layoutNode(rootId, 0, PADDING, null);

  // Build connections
  const connections: Connection[] = [];
  const cardById = new Map(cards.map((c) => [c.id, c]));
  for (const card of cards) {
    if (!card.parentId) continue;
    const parent = cardById.get(card.parentId);
    if (!parent) continue;
    const pH = parent.isRoot ? ROOT_CARD_H : CARD_H;
    const cH = card.isRoot ? ROOT_CARD_H : CARD_H;
    connections.push({
      fromId: card.parentId,
      toId: card.id,
      x1: parent.x + CARD_W,
      y1: parent.y + pH / 2,
      x2: card.x,
      y2: card.y + cH / 2,
      color: typeColor(card.node.type, types),
    });
  }

  const maxX = cards.length ? Math.max(...cards.map((c) => c.x + CARD_W)) : 0;
  const maxY = Math.max(
    ...(cards.length ? cards.map((c) => c.y + (c.isRoot ? ROOT_CARD_H : CARD_H)) : [0]),
    ...(headers.length ? headers.map((h) => h.y + HEADER_H) : [0]),
    totalH + PADDING,
  );

  return {
    cards,
    headers,
    connections,
    width: maxX + PADDING * 2,
    height: maxY + PADDING,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DependencyReport() {
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const [fsType, setFsType] = useState("");
  const [center, setCenter] = useState("");
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch all data once (optionally filtered by type)
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (fsType) p.set("type", fsType);
    api
      .get<{ nodes: GNode[]; edges: GEdge[] }>(`/reports/dependencies?${p}`)
      .then((r) => {
        setNodes(r.nodes);
        setEdges(r.edges);
        setLoading(false);
      });
  }, [fsType]);

  // Build adjacency map
  const adjMap = useMemo(() => {
    const m = new Map<string, { nodeId: string; relType: string }[]>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, []);
      m.get(e.source)!.push({ nodeId: e.target, relType: e.type });
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.target)!.push({ nodeId: e.source, relType: e.type });
    }
    return m;
  }, [edges]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Reset expansion when center changes
  useEffect(() => {
    if (center) {
      setExpanded(new Set([center]));
    } else {
      setExpanded(new Set());
    }
  }, [center]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Compute tree layout
  const layout = useMemo<TreeLayout | null>(() => {
    if (!center || !nodeMap.has(center)) return null;
    return computeTreeLayout(center, expanded, adjMap, nodeMap, types);
  }, [center, expanded, adjMap, nodeMap, types]);

  // Autocomplete options respect type filter
  const acOptions = useMemo(
    () => (fsType ? nodes.filter((n) => n.type === fsType) : nodes),
    [nodes, fsType],
  );

  const usedTypes = useMemo(() => [...new Set(nodes.map((n) => n.type))], [nodes]);

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  /* ---------- render ---------- */
  return (
    <ReportShell
      title="Dependencies"
      icon="hub"
      iconColor="#6a1b9a"
      view={view}
      onViewChange={setView}
      toolbar={
        <>
          <TextField
            select
            size="small"
            label="Type"
            value={fsType}
            onChange={(e) => {
              setFsType(e.target.value);
              setCenter("");
            }}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All Types</MenuItem>
            {types.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>

          <Autocomplete
            size="small"
            options={acOptions}
            getOptionLabel={(o) => o.name}
            value={nodes.find((n) => n.id === center) || null}
            onChange={(_, v) => setCenter(v?.id || "")}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: typeColor(option.type, types),
                    mr: 1,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" noWrap>
                  {option.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ ml: "auto", pl: 1, flexShrink: 0 }}
                >
                  {typeLabel(option.type, types)}
                </Typography>
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} label="Center on" sx={{ minWidth: 220 }} />
            )}
            sx={{ minWidth: 220 }}
          />
        </>
      }
      legend={
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {usedTypes.map((t) => (
            <Box key={t} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: typeColor(t, types),
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {typeLabel(t, types)}
              </Typography>
            </Box>
          ))}
        </Box>
      }
    >
      {/* ==================== CHART VIEW ==================== */}
      {view === "chart" ? (
        center && layout && layout.cards.length > 0 ? (
          <Paper
            variant="outlined"
            sx={{
              overflow: "auto",
              bgcolor: "#f8f9fb",
              borderRadius: 2,
              position: "relative",
            }}
            ref={scrollRef}
          >
            <Box
              sx={{
                position: "relative",
                width: layout.width,
                height: Math.max(layout.height, 300),
                minWidth: "100%",
              }}
            >
              {/* --- SVG curves --- */}
              <svg
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                }}
              >
                {layout.connections.map((c) => {
                  const active =
                    hovered === c.fromId || hovered === c.toId;
                  return (
                    <path
                      key={`${c.fromId}-${c.toId}`}
                      d={curvePath(c.x1, c.y1, c.x2, c.y2)}
                      fill="none"
                      stroke={c.color}
                      strokeWidth={active ? 2.2 : 1.4}
                      strokeOpacity={
                        hovered
                          ? active
                            ? 0.85
                            : 0.12
                          : 0.35
                      }
                      style={{ transition: "stroke-opacity 0.2s, stroke-width 0.2s" }}
                    />
                  );
                })}
              </svg>

              {/* --- Type group headers --- */}
              {layout.headers.map((h) => (
                <Box
                  key={h.key}
                  sx={{
                    position: "absolute",
                    left: h.x,
                    top: h.y,
                    height: HEADER_H,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    pl: 0.5,
                    userSelect: "none",
                  }}
                >
                  <MaterialSymbol icon={h.typeIcon} size={15} color={h.typeColor} />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: h.typeColor, lineHeight: 1 }}
                  >
                    {h.typeLabel}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.disabled", lineHeight: 1 }}>
                    ({h.count})
                  </Typography>
                </Box>
              ))}

              {/* --- Cards --- */}
              {layout.cards.map((card) => {
                const cardH = card.isRoot ? ROOT_CARD_H : CARD_H;
                const tc = typeColor(card.node.type, types);
                const isHov = hovered === card.id;
                const dimmed = hovered !== null && !isHov;

                return (
                  <Tooltip
                    key={card.id}
                    title={`${typeLabel(card.node.type, types)} · ${(adjMap.get(card.id) || []).length} connections`}
                    placement="top"
                    arrow
                    enterDelay={400}
                  >
                    <Paper
                      elevation={isHov ? 4 : card.isRoot ? 2 : 0}
                      sx={{
                        position: "absolute",
                        left: card.x,
                        top: card.y,
                        width: CARD_W,
                        height: cardH,
                        display: "flex",
                        alignItems: "center",
                        px: 1.5,
                        gap: 0.75,
                        cursor: "pointer",
                        borderLeft: `3.5px solid ${tc}`,
                        borderRadius: "8px",
                        bgcolor: card.isExpanded
                          ? "rgba(0,0,0,0.03)"
                          : "background.paper",
                        opacity: dimmed ? 0.45 : 1,
                        transition:
                          "box-shadow 0.2s, opacity 0.2s, background-color 0.2s",
                        "&:hover": { boxShadow: 4, bgcolor: "background.paper" },
                        ...(card.isRoot && {
                          borderLeftWidth: 4,
                          boxShadow: 2,
                        }),
                        ...(!card.isRoot &&
                          !card.isExpanded && {
                            border: "1px solid",
                            borderColor: "divider",
                            borderLeftColor: tc,
                            borderLeftWidth: "3.5px",
                          }),
                      }}
                      onClick={() => toggleExpand(card.id)}
                      onDoubleClick={() => navigate(`/fact-sheets/${card.id}`)}
                      onMouseEnter={() => setHovered(card.id)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {card.isRoot && (
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              color: tc,
                              fontWeight: 700,
                              lineHeight: 1.2,
                              fontSize: "0.65rem",
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            {typeLabel(card.node.type, types)}
                          </Typography>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: 600, lineHeight: 1.3 }}
                          >
                            {card.node.name}
                          </Typography>
                        </Box>
                      )}

                      {!card.isRoot && (
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ flex: 1, fontWeight: 500, minWidth: 0 }}
                        >
                          {card.node.name}
                        </Typography>
                      )}

                      {card.canExpand && (
                        <MaterialSymbol
                          icon={card.isExpanded ? "expand_more" : "chevron_right"}
                          size={18}
                          color="#999"
                        />
                      )}
                    </Paper>
                  </Tooltip>
                );
              })}
            </Box>

            {/* Stats chip */}
            <Box sx={{ position: "sticky", bottom: 8, left: 0, px: 1, pb: 0.5, textAlign: "right" }}>
              <Chip
                size="small"
                label={`${layout.cards.length} nodes · ${layout.connections.length} relations`}
                variant="outlined"
                sx={{ bgcolor: "background.paper" }}
              />
            </Box>
          </Paper>
        ) : (
          /* ---------- Picker / empty state ---------- */
          <Paper
            variant="outlined"
            sx={{ p: 4, textAlign: "center", borderRadius: 2 }}
          >
            <MaterialSymbol icon="account_tree" size={52} color="#c0c0c0" />
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1.5 }}>
              Select a fact sheet to explore
            </Typography>
            <Typography
              variant="body2"
              color="text.disabled"
              sx={{ mb: 3, maxWidth: 380, mx: "auto" }}
            >
              Use the &ldquo;Center on&rdquo; search above, or click a fact sheet
              below to visualize its dependencies.
            </Typography>

            {nodes.length === 0 ? (
              <Typography color="text.disabled" variant="body2">
                No fact sheets found.
              </Typography>
            ) : (
              <Box sx={{ textAlign: "left", maxWidth: 720, mx: "auto" }}>
                {usedTypes.map((tk) => {
                  const items = nodes.filter((n) => n.type === tk);
                  const tc = typeColor(tk, types);
                  const MAX = 12;
                  return (
                    <Box key={tk} sx={{ mb: 2 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                          mb: 0.75,
                        }}
                      >
                        <MaterialSymbol
                          icon={typeIcon(tk, types)}
                          size={16}
                          color={tc}
                        />
                        <Typography
                          variant="subtitle2"
                          sx={{ fontWeight: 700, color: tc }}
                        >
                          {typeLabel(tk, types)}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          ({items.length})
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                        {items.slice(0, MAX).map((n) => (
                          <Chip
                            key={n.id}
                            label={n.name}
                            size="small"
                            onClick={() => setCenter(n.id)}
                            variant="outlined"
                            sx={{
                              borderColor: tc + "50",
                              "&:hover": {
                                bgcolor: tc + "14",
                                borderColor: tc,
                              },
                            }}
                          />
                        ))}
                        {items.length > MAX && (
                          <Chip
                            label={`+${items.length - MAX} more`}
                            size="small"
                            variant="outlined"
                            sx={{ fontStyle: "italic", color: "text.disabled" }}
                          />
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Paper>
        )
      ) : (
        /* ==================== TABLE VIEW ==================== */
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Source</TableCell>
                <TableCell>Relation</TableCell>
                <TableCell>Target</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {edges.map((e, i) => {
                const s = nodes.find((n) => n.id === e.source);
                const t = nodes.find((n) => n.id === e.target);
                return (
                  <TableRow key={i} hover>
                    <TableCell
                      sx={{ cursor: "pointer", fontWeight: 500 }}
                      onClick={() => s && navigate(`/fact-sheets/${s.id}`)}
                    >
                      {s?.name}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={e.type} variant="outlined" />
                    </TableCell>
                    <TableCell
                      sx={{ cursor: "pointer", fontWeight: 500 }}
                      onClick={() => t && navigate(`/fact-sheets/${t.id}`)}
                    >
                      {t?.name}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}
    </ReportShell>
  );
}
