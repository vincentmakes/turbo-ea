import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import SidebarShell from "../SidebarShell";
import InitiativeTreeSidebar, { UNLINKED_KEY } from "./InitiativeTreeSidebar";
import InitiativeWorkspace, {
  type WorkspaceSelection,
} from "./InitiativeWorkspace";
import {
  useInitiativeData,
  type InitiativeTreeNode,
} from "./useInitiativeData";
import type { DeliverableKind } from "./DeliverableSection";
import type { DiagramSummary, SoAW } from "@/types";

const SIDEBAR_WIDTH_KEY = "turboea-delivery-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "turboea-delivery-sidebar-collapsed";
const LAST_SELECTED_KEY = "turboea-delivery-last-selected";
const FAVORITES_ONLY_KEY = "turboea-delivery-favorites-only";

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    return localStorage.getItem(key) === "true" ? true : fallback;
  } catch {
    return fallback;
  }
}

interface Props {
  selectedInitiativeId: string | null;
  onSelectInitiative: (id: string | null) => void;
  onCreateSoaw: (initiativeId: string) => void;
  onCreateAdr: (preLinked: { id: string; name: string; type: string }[]) => void;
  onCreateDiagram: (initiativeId?: string) => void;
  onLinkDiagrams: (initiativeId: string) => void;
  onUnlinkDiagram: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu: (anchor: HTMLElement, soaw: SoAW) => void;
  onDataReady?: (data: ReturnType<typeof useInitiativeData>) => void;
}

export default function InitiativesTab({
  selectedInitiativeId,
  onSelectInitiative,
  onCreateSoaw,
  onCreateAdr,
  onCreateDiagram,
  onLinkDiagrams,
  onUnlinkDiagram,
  onSoawContextMenu,
  onDataReady,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));
  const [mobileOpen, setMobileOpen] = useState(false);

  const data = useInitiativeData();
  const {
    tree,
    loading,
    error,
    setError,
    initiatives,
    filteredInitiatives,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    subtypeFilter,
    setSubtypeFilter,
    artefactFilter,
    setArtefactFilter,
    unlinkedSoaws,
    unlinkedDiagrams,
    unlinkedAdrs,
  } = data;

  useEffect(() => {
    onDataReady?.(data);
  }, [data, onDataReady]);

  // ── Sidebar layout state ─────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidthRaw] = useState(() =>
    readNumber(SIDEBAR_WIDTH_KEY, 320),
  );
  const [collapsed, setCollapsedRaw] = useState(() =>
    readBool(SIDEBAR_COLLAPSED_KEY, false),
  );

  const setSidebarWidth = useCallback((w: number) => {
    setSidebarWidthRaw(w);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedRaw((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // ── Favorites (server-side, mirrors prior tab behaviour) ────────────
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnlyRaw] = useState(() =>
    readBool(FAVORITES_ONLY_KEY, false),
  );

  const setFavoritesOnly = useCallback((v: boolean) => {
    setFavoritesOnlyRaw(v);
    try {
      localStorage.setItem(FAVORITES_ONLY_KEY, String(v));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ id: string; card_id: string }[]>("/favorites?type=Initiative")
      .then((res) => {
        if (!cancelled) {
          setFavorites(new Set(res.map((f) => f.card_id)));
        }
      })
      .catch(() => {
        // non-critical
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        api.delete(`/favorites/${id}`).catch(() => {
          setFavorites((p) => new Set(p).add(id));
        });
      } else {
        next.add(id);
        api.post(`/favorites/${id}`).catch(() => {
          setFavorites((p) => {
            const r = new Set(p);
            r.delete(id);
            return r;
          });
        });
      }
      return next;
    });
  }, []);

  // ── Tree filtering by favorites ─────────────────────────────────────
  const visibleTree = useMemo(() => {
    if (!favoritesOnly) return tree;
    return filterTreeToFavorites(tree, favorites);
  }, [tree, favorites, favoritesOnly]);

  // ── Selection: URL → resolved node ──────────────────────────────────
  const flatNodeMap = useMemo(() => {
    const m = new Map<string, InitiativeTreeNode>();
    const walk = (nodes: InitiativeTreeNode[]) => {
      for (const n of nodes) {
        m.set(n.initiative.id, n);
        walk(n.children);
      }
    };
    walk(tree);
    return m;
  }, [tree]);

  // Restore last selected initiative on first load if URL has none.
  useEffect(() => {
    if (selectedInitiativeId) return;
    if (loading) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LAST_SELECTED_KEY);
    } catch {
      // ignore
    }
    if (saved && flatNodeMap.has(saved)) {
      onSelectInitiative(saved);
    }
    // Only run once after data loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const selection = useMemo<WorkspaceSelection>(() => {
    if (selectedInitiativeId === UNLINKED_KEY) {
      return {
        kind: "unlinked",
        soaws: unlinkedSoaws,
        diagrams: unlinkedDiagrams,
        adrs: unlinkedAdrs,
      };
    }
    if (selectedInitiativeId) {
      const node = flatNodeMap.get(selectedInitiativeId);
      if (node) return { kind: "initiative", node };
    }
    return null;
  }, [
    selectedInitiativeId,
    flatNodeMap,
    unlinkedSoaws,
    unlinkedDiagrams,
    unlinkedAdrs,
  ]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelectInitiative(id);
      if (id !== UNLINKED_KEY) {
        try {
          localStorage.setItem(LAST_SELECTED_KEY, id);
        } catch {
          // ignore
        }
      }
      setMobileOpen(false);
    },
    [onSelectInitiative],
  );

  const handleCreateArtefact = useCallback(
    (kind: DeliverableKind, initiativeId?: string) => {
      const target = initiativeId ?? selectedInitiativeId ?? "";
      const isInitiative = target && target !== UNLINKED_KEY;
      if (kind === "soaw") {
        onCreateSoaw(isInitiative ? target : "");
      } else if (kind === "diagram") {
        onCreateDiagram(isInitiative ? target : undefined);
      } else if (kind === "adr") {
        if (isInitiative) {
          const node = flatNodeMap.get(target);
          if (node) {
            onCreateAdr([
              {
                id: node.initiative.id,
                name: node.initiative.name,
                type: node.initiative.type,
              },
            ]);
            return;
          }
        }
        onCreateAdr([]);
      }
    },
    [
      selectedInitiativeId,
      flatNodeMap,
      onCreateSoaw,
      onCreateAdr,
      onCreateDiagram,
    ],
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Total visible count for footer (counts every node in the visible tree).
  const totalCount = countTreeNodes(visibleTree);
  const noInitiatives = initiatives.length === 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {noInitiatives ? (
        <Alert severity="info">{t("empty.noInitiatives")}</Alert>
      ) : (
        <>
          {(() => {
            const treeSidebar = (
              <InitiativeTreeSidebar
                tree={visibleTree}
                totalCount={totalCount}
                selectedId={selectedInitiativeId}
                onSelect={handleSelect}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                filter={{
                  search,
                  status: statusFilter,
                  subtype: subtypeFilter,
                  artefacts: artefactFilter,
                  favoritesOnly,
                }}
                filterSetters={{
                  setSearch,
                  setStatus: setStatusFilter,
                  setSubtype: setSubtypeFilter,
                  setArtefacts: setArtefactFilter,
                  setFavoritesOnly,
                }}
                unlinkedCount={
                  unlinkedSoaws.length +
                  unlinkedDiagrams.length +
                  unlinkedAdrs.length
                }
              />
            );

            const workspace =
              filteredInitiatives.length === 0 && !favoritesOnly ? (
                <Box sx={{ p: 4 }}>
                  <Alert severity="info">{t("empty.noMatch")}</Alert>
                </Box>
              ) : (
                <InitiativeWorkspace
                  selection={selection}
                  onSelectInitiative={handleSelect}
                  onCreateArtefact={handleCreateArtefact}
                  onLinkDiagrams={onLinkDiagrams}
                  onUnlinkDiagram={onUnlinkDiagram}
                  onSoawContextMenu={onSoawContextMenu}
                  isFavorite={(id) => favorites.has(id)}
                  onToggleFavorite={toggleFavorite}
                />
              );

            if (compact) {
              return (
                <>
                  <Box
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      bgcolor: "background.paper",
                    }}
                  >
                    <Box
                      sx={{
                        p: 1,
                        borderBottom: 1,
                        borderColor: "divider",
                      }}
                    >
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<MaterialSymbol icon="menu_open" size={18} />}
                        onClick={() => setMobileOpen(true)}
                        sx={{ textTransform: "none" }}
                      >
                        {t("sidebar.expand")}
                      </Button>
                    </Box>
                    <Box sx={{ minWidth: 0 }}>{workspace}</Box>
                  </Box>
                  <Drawer
                    anchor="left"
                    open={mobileOpen}
                    onClose={() => setMobileOpen(false)}
                    PaperProps={{
                      sx: { width: "92vw", maxWidth: 400 },
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        px: 1.5,
                        py: 0.5,
                        borderBottom: 1,
                        borderColor: "divider",
                        flexShrink: 0,
                      }}
                    >
                      <Typography variant="subtitle2" sx={{ fontSize: 14 }}>
                        {t("tabs.initiatives")}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => setMobileOpen(false)}
                        aria-label={t("sidebar.collapse")}
                      >
                        <MaterialSymbol icon="close" size={20} />
                      </IconButton>
                    </Box>
                    <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
                      {treeSidebar}
                    </Box>
                  </Drawer>
                </>
              );
            }

            return (
              <Box
                sx={{
                  display: "flex",
                  // Top-align so the sidebar isn't stretched by the workspace —
                  // the sidebar gets its own explicit height (sticky to viewport)
                  // and the workspace flows naturally with the page.
                  alignItems: "flex-start",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "background.paper",
                }}
              >
                {/* Sidebar — sticks to the viewport below the fixed AppBar (64px),
                    with a small breathing-room offset, and keeps its definite
                    height so the SidebarShell's internal flex layout (header /
                    scrollable tree / footer) resolves correctly. */}
                <Box
                  sx={{
                    position: "sticky",
                    top: 80,
                    alignSelf: "flex-start",
                    flexShrink: 0,
                    height: "calc(100vh - 96px)",
                    display: "flex",
                    borderTopLeftRadius: 4,
                    borderBottomLeftRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <SidebarShell
                    title={t("tabs.initiatives")}
                    width={sidebarWidth}
                    onWidthChange={setSidebarWidth}
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapsed}
                    collapseTooltip={t("sidebar.collapse")}
                    expandTooltip={t("sidebar.expand")}
                  >
                    {treeSidebar}
                  </SidebarShell>
                </Box>

                {/* Workspace — natural content height, drives the page scroll. */}
                <Box sx={{ flex: 1, minWidth: 0 }}>{workspace}</Box>
              </Box>
            );
          })()}
        </>
      )}
    </Box>
  );
}

function countTreeNodes(nodes: InitiativeTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1 + countTreeNodes(node.children);
  }
  return n;
}

function filterTreeToFavorites(
  nodes: InitiativeTreeNode[],
  favorites: Set<string>,
): InitiativeTreeNode[] {
  const result: InitiativeTreeNode[] = [];
  for (const node of nodes) {
    if (favorites.has(node.initiative.id)) {
      result.push({
        ...node,
        children: filterTreeToFavorites(node.children, favorites),
      });
    } else {
      result.push(...filterTreeToFavorites(node.children, favorites));
    }
  }
  return result;
}
