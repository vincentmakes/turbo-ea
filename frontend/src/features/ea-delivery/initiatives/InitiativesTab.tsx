import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MuiCard from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import InputAdornment from "@mui/material/InputAdornment";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import InitiativeCard from "./InitiativeCard";
import InitiativeListView from "./InitiativeListView";
import ArtefactColumns from "./ArtefactColumns";
import { useInitiativeData, type InitiativeTreeNode } from "./useInitiativeData";
import type { SoAW, DiagramSummary } from "@/types";

type ViewMode = "cards" | "list";

const EXPANDED_STORAGE_KEY = "turboea-delivery-expanded";
const VIEW_STORAGE_KEY = "turboea-delivery-view";

interface StoredViewPrefs {
  viewMode?: ViewMode;
  favoritesOnly?: boolean;
}

function readViewPrefs(): StoredViewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeViewPrefs(prefs: StoredViewPrefs) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable
  }
}

function readExpandedFromStorage(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeExpandedToStorage(expanded: Record<string, boolean>) {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(expanded));
  } catch {
    // localStorage unavailable
  }
}

/** Collect all initiative IDs from a tree (recursively). */
function collectIds(nodes: InitiativeTreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.initiative.id);
    ids.push(...collectIds(node.children));
  }
  return ids;
}

/** Check if a node or any of its descendants is a favorite. */
function hasFavoriteDescendant(
  node: InitiativeTreeNode,
  favorites: Set<string>,
): boolean {
  if (favorites.has(node.initiative.id)) return true;
  return node.children.some((c) => hasFavoriteDescendant(c, favorites));
}

/**
 * Sort tree nodes so favorites (or nodes containing favorite descendants) appear
 * first. Preserves order within each group. Recurses into children.
 */
function sortTreeByFavorites(
  nodes: InitiativeTreeNode[],
  favorites: Set<string>,
): InitiativeTreeNode[] {
  const top = nodes.filter((n) => hasFavoriteDescendant(n, favorites));
  const rest = nodes.filter((n) => !hasFavoriteDescendant(n, favorites));
  return [...top, ...rest].map((node) => ({
    ...node,
    children: sortTreeByFavorites(node.children, favorites),
  }));
}

/**
 * Filter tree to favorites only. Favorite nodes are kept with all their children.
 * Non-favorite parents are removed but their favorite children are promoted up.
 */
function filterTreeToFavorites(
  nodes: InitiativeTreeNode[],
  favorites: Set<string>,
): InitiativeTreeNode[] {
  const result: InitiativeTreeNode[] = [];
  for (const node of nodes) {
    if (favorites.has(node.initiative.id)) {
      // Keep the node and all its children (filter children recursively too for ordering)
      result.push({
        ...node,
        children: filterTreeToFavorites(node.children, favorites),
        level: 0, // will be recalculated
      });
    } else {
      // Not a favorite — promote any favorite children
      result.push(...filterTreeToFavorites(node.children, favorites));
    }
  }
  return result;
}

/** Recalculate levels in a tree starting from a given level. */
function recalcLevels(nodes: InitiativeTreeNode[], level = 0): InitiativeTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    level,
    children: recalcLevels(node.children, level + 1),
  }));
}

interface Props {
  onCreateSoaw: (initiativeId: string) => void;
  onCreateAdr: (preLinked: { id: string; name: string; type: string }[]) => void;
  onLinkDiagrams: (initiativeId: string) => void;
  onCreateArtefact: (e: React.MouseEvent<HTMLElement>, initiativeId: string) => void;
  onUnlinkDiagram: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu: (anchor: HTMLElement, soaw: SoAW) => void;
  /** Expose data hook to parent for dialog logic */
  onDataReady?: (data: ReturnType<typeof useInitiativeData>) => void;
}

export default function InitiativesTab({
  onCreateSoaw,
  onCreateAdr,
  onLinkDiagrams,
  onCreateArtefact,
  onUnlinkDiagram,
  onSoawContextMenu,
  onDataReady,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const { types: metamodelTypes } = useMetamodel();
  const rl = useResolveLabel();

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
    soaws,
    diagrams,
  } = data;

  // Expose data to parent on mount / change
  React.useEffect(() => {
    onDataReady?.(data);
  }, [data, onDataReady]);

  const [storedViewPrefs] = useState(readViewPrefs);
  const [viewMode, setViewModeRaw] = useState<ViewMode>(storedViewPrefs.viewMode ?? "cards");
  const [unlinkedExpanded, setUnlinkedExpanded] = useState(false);

  const setViewMode = useCallback((v: ViewMode) => {
    setViewModeRaw(v);
    writeViewPrefs({ ...readViewPrefs(), viewMode: v });
  }, []);

  // ── Expand/collapse state (persisted to localStorage) ──
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(readExpandedFromStorage);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeExpandedToStorage(next);
      return next;
    });
  }, []);

  // Auto-expand on "With Artefacts" filter
  const prevExpandedRef = useRef<Record<string, boolean> | null>(null);

  useEffect(() => {
    if (artefactFilter === "with") {
      // Save current state before auto-expanding
      if (prevExpandedRef.current === null) {
        prevExpandedRef.current = { ...expandedIds };
      }
      // Expand all visible initiatives
      const allIds = collectIds(tree);
      const next: Record<string, boolean> = {};
      for (const id of allIds) next[id] = true;
      setExpandedIds(next);
      writeExpandedToStorage(next);
    } else if (prevExpandedRef.current !== null) {
      // Restore previous state
      setExpandedIds(prevExpandedRef.current);
      writeExpandedToStorage(prevExpandedRef.current);
      prevExpandedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artefactFilter, tree]);

  // ── Favorites (server-side) ──
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnlyRaw] = useState(storedViewPrefs.favoritesOnly ?? false);

  const setFavoritesOnly = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setFavoritesOnlyRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      writeViewPrefs({ ...readViewPrefs(), favoritesOnly: next });
      return next;
    });
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
        // silently ignore — favorites are non-critical
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
          // Revert on failure
          setFavorites((p) => new Set(p).add(id));
        });
      } else {
        next.add(id);
        api.post(`/favorites/${id}`).catch(() => {
          // Revert on failure
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

  // Sort tree: favorites first; when favoritesOnly, extract & promote favorite nodes
  const sortedTree = useMemo(() => {
    if (favoritesOnly) {
      const filtered = filterTreeToFavorites(tree, favorites);
      return recalcLevels(filtered);
    }
    return sortTreeByFavorites(tree, favorites);
  }, [tree, favorites, favoritesOnly]);

  const initiativeType = useMemo(
    () => metamodelTypes.find((t) => t.key === "Initiative"),
    [metamodelTypes],
  );
  const subtypes = initiativeType?.subtypes ?? [];

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Filter bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <TextField
          size="small"
          placeholder={t("header.searchInitiatives")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 220 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={20} />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          select
          size="small"
          label={t("filter.status")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "ACTIVE" | "ARCHIVED" | "")}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="ACTIVE">{t("filter.active")}</MenuItem>
          <MenuItem value="ARCHIVED">{t("filter.archived")}</MenuItem>
          <MenuItem value="">{t("filter.all")}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={t("filter.subtype")}
          value={subtypeFilter}
          onChange={(e) => setSubtypeFilter(e.target.value)}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">{t("filter.allSubtypes")}</MenuItem>
          {subtypes.map((st) => (
            <MenuItem key={st.key} value={st.key}>
              {rl(st.key, st.translations)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t("filter.artefacts")}
          value={artefactFilter}
          onChange={(e) =>
            setArtefactFilter(e.target.value as "" | "with" | "without")
          }
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">{t("filter.all")}</MenuItem>
          <MenuItem value="with">{t("filter.withArtefacts")}</MenuItem>
          <MenuItem value="without">{t("filter.withoutArtefacts")}</MenuItem>
        </TextField>

        {/* Favorites only toggle */}
        <Tooltip title={t("filter.favoritesOnly")}>
          <IconButton
            size="small"
            onClick={() => setFavoritesOnly((p) => !p)}
            sx={{
              color: favoritesOnly ? "#f5a623" : "text.secondary",
              border: favoritesOnly ? "1px solid #f5a623" : "1px solid transparent",
              borderRadius: 1,
            }}
          >
            <MaterialSymbol icon="cards_star" size={22} />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          {t("header.resultCount", { count: filteredInitiatives.length })}
        </Typography>

        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v: ViewMode | null) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value="cards">
            <Tooltip title={t("view.cardView")}>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="dashboard" size={20} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="list">
            <Tooltip title={t("view.listView")}>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="view_list" size={20} />
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Empty state */}
      {initiatives.length === 0 && soaws.length === 0 && diagrams.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("empty.noInitiatives")}
        </Alert>
      )}

      {/* List view */}
      {viewMode === "list" && (
        <InitiativeListView
          tree={sortedTree}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpanded}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onLinkDiagrams={onLinkDiagrams}
          onCreateArtefact={onCreateArtefact}
          onUnlinkDiagram={onUnlinkDiagram}
          onSoawContextMenu={onSoawContextMenu}
        />
      )}

      {/* Cards view */}
      {viewMode === "cards" && (
        <>
          {filteredInitiatives.length === 0 && initiatives.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t("empty.noMatch")}
            </Alert>
          )}

          {sortedTree.map((node) => (
            <InitiativeCard
              key={node.initiative.id}
              node={node}
              expanded={!!expandedIds[node.initiative.id]}
              onToggleExpand={toggleExpanded}
              isFavorite={favorites.has(node.initiative.id)}
              onToggleFavorite={toggleFavorite}
              favorites={favorites}
              expandedIds={expandedIds}
              onLinkDiagrams={onLinkDiagrams}
              onCreateArtefact={onCreateArtefact}
              onUnlinkDiagram={onUnlinkDiagram}
              onSoawContextMenu={onSoawContextMenu}
              onCreateSoaw={onCreateSoaw}
              onCreateAdr={(init) => onCreateAdr([init])}
            />
          ))}

          {/* Unlinked artefacts */}
          {(unlinkedSoaws.length > 0 ||
            unlinkedDiagrams.length > 0 ||
            unlinkedAdrs.length > 0) && (
            <MuiCard sx={{ mb: 2, borderLeft: "4px solid #999" }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 2,
                  py: 1.5,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={() => setUnlinkedExpanded((p) => !p)}
              >
                <IconButton size="small" sx={{ mr: 1 }}>
                  <MaterialSymbol
                    icon={unlinkedExpanded ? "expand_more" : "chevron_right"}
                    size={20}
                  />
                </IconButton>
                <MaterialSymbol icon="folder_open" size={22} color="#999" />
                <Typography
                  sx={{ ml: 1, fontWeight: 600, flex: 1, color: "text.secondary" }}
                >
                  {t("unlinked.title")}
                </Typography>
                <Chip
                  label={t("card.artefactCount", {
                    count:
                      unlinkedSoaws.length + unlinkedDiagrams.length + unlinkedAdrs.length,
                  })}
                  size="small"
                  variant="outlined"
                />
              </Box>
              <Collapse in={unlinkedExpanded}>
                <Box sx={{ px: 2, pb: 2 }}>
                  <ArtefactColumns
                    soaws={unlinkedSoaws}
                    diagrams={unlinkedDiagrams}
                    adrs={unlinkedAdrs}
                    initiativeId=""
                  />
                </Box>
              </Collapse>
            </MuiCard>
          )}
        </>
      )}
    </>
  );
}
