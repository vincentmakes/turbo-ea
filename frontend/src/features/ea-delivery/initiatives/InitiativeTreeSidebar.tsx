import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSubtypeLabel } from "@/hooks/useResolveLabel";
import { CARD_TYPE_COLORS } from "@/theme/tokens";
import { treeKeyAction, visibleTreeRows } from "./treeKeys";
import { useInitiativeStatusColor, useInitiativeStatusLabel } from "./useInitiativeStatus";
import { flattenTree, type InitiativeTreeNode } from "./useInitiativeData";

export const UNLINKED_KEY = "__unlinked__";

interface FilterState {
  search: string;
  status: "ACTIVE" | "ARCHIVED" | "";
  subtype: string;
  artefacts: "" | "with" | "without";
  favoritesOnly: boolean;
}

interface FilterSetters {
  setSearch: (v: string) => void;
  setStatus: (v: "ACTIVE" | "ARCHIVED" | "") => void;
  setSubtype: (v: string) => void;
  setArtefacts: (v: "" | "with" | "without") => void;
  setFavoritesOnly: (v: boolean) => void;
}

interface Props {
  tree: InitiativeTreeNode[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  filter: FilterState;
  filterSetters: FilterSetters;
  unlinkedCount: number;
}

export default function InitiativeTreeSidebar({
  tree,
  totalCount,
  selectedId,
  onSelect,
  favorites,
  onToggleFavorite,
  filter,
  filterSetters,
  unlinkedCount,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const { types: metamodelTypes } = useMetamodel();
  const stLabel = useSubtypeLabel();

  const initiativeType = metamodelTypes.find((mt) => mt.key === "Initiative");
  const subtypes = initiativeType?.subtypes ?? [];

  // Expansion lives here, not per branch: the arrow keys walk the rows on
  // screen, so the sidebar has to know which branches are folded. Parents
  // start open; a fold is user-driven and in-memory.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleBranch = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const unlinkedId = unlinkedCount > 0 ? UNLINKED_KEY : null;
  const rows = useMemo(
    () => visibleTreeRows(tree, collapsed, unlinkedId),
    [tree, collapsed, unlinkedId],
  );
  const nodesById = useMemo(
    () => new Map(flattenTree(tree).map((n) => [n.initiative.id, n])),
    [tree],
  );
  // One tab stop (WAI-ARIA tree): the selected row when it is on screen,
  // else the first row.
  const tabStopId = rows.some((r) => r.id === selectedId) ? selectedId : (rows[0]?.id ?? null);

  const treeRef = useRef<HTMLDivElement>(null);
  const focusRow = (id: string | null | undefined) => {
    if (!id) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);
    el?.focus();
  };
  const handleTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("[data-tree-id]");
    const id = rowEl?.dataset.treeId;
    if (!id) return;
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return;
    const node = nodesById.get(id);
    const action = treeKeyAction(e, {
      hasChildren: !!node && node.children.length > 0,
      expanded: !collapsed.has(id),
    });
    if (!action) return;
    e.preventDefault();
    switch (action) {
      case "select":
        onSelect(id);
        break;
      case "next":
        focusRow(rows[index + 1]?.id);
        break;
      case "prev":
        focusRow(rows[index - 1]?.id);
        break;
      case "first":
        focusRow(rows[0]?.id);
        break;
      case "last":
        focusRow(rows[rows.length - 1]?.id);
        break;
      case "expand":
      case "collapse":
        toggleBranch(id);
        break;
      case "parent":
        focusRow(rows[index].parentId);
        break;
      case "favourite":
        if (id !== UNLINKED_KEY) onToggleFavorite(id);
        break;
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sticky filter strip */}
      <Box
        sx={{
          p: 1.25,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <TextField
          size="small"
          placeholder={t("sidebar.searchPlaceholder")}
          value={filter.search}
          onChange={(e) => filterSetters.setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={18} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          <TextField
            select
            size="small"
            label={t("filter.status")}
            value={filter.status}
            onChange={(e) =>
              filterSetters.setStatus(
                e.target.value as "ACTIVE" | "ARCHIVED" | "",
              )
            }
            sx={{ flex: "1 1 110px", minWidth: 110 }}
          >
            <MenuItem value="ACTIVE">{t("filter.active")}</MenuItem>
            <MenuItem value="ARCHIVED">{t("filter.archived")}</MenuItem>
            <MenuItem value="">{t("filter.all")}</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label={t("filter.subtype")}
            value={filter.subtype}
            onChange={(e) => filterSetters.setSubtype(e.target.value)}
            sx={{ flex: "1 1 110px", minWidth: 110 }}
          >
            <MenuItem value="">{t("filter.allSubtypes")}</MenuItem>
            {subtypes.map((st) => (
              <MenuItem key={st.key} value={st.key}>
                {stLabel(st)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("filter.artefacts")}
            value={filter.artefacts}
            onChange={(e) =>
              filterSetters.setArtefacts(e.target.value as "" | "with" | "without")
            }
            sx={{ flex: "1 1 110px", minWidth: 110 }}
          >
            <MenuItem value="">{t("filter.all")}</MenuItem>
            <MenuItem value="with">{t("filter.withArtefacts")}</MenuItem>
            <MenuItem value="without">{t("filter.withoutArtefacts")}</MenuItem>
          </TextField>
          <Tooltip title={t("filter.favoritesOnly")}>
            <IconButton
              size="small"
              onClick={() =>
                filterSetters.setFavoritesOnly(!filter.favoritesOnly)
              }
              sx={{
                color: filter.favoritesOnly ? "#f5a623" : "text.secondary",
                border: filter.favoritesOnly
                  ? "1px solid #f5a623"
                  : "1px solid transparent",
                borderRadius: 1,
              }}
            >
              <MaterialSymbol icon="cards_star" size={20} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Tree body */}
      <Box sx={{ flex: 1, overflow: "auto", p: 0.5 }}>
        {tree.length === 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 4 }}
          >
            {t("sidebar.noResults")}
          </Typography>
        )}
        <Box
          ref={treeRef}
          role="tree"
          aria-label={t("sidebar.treeLabel")}
          onKeyDown={handleTreeKey}
        >
          {unlinkedId && (
            <UnlinkedRow
              count={unlinkedCount}
              selected={selectedId === UNLINKED_KEY}
              tabStop={tabStopId === UNLINKED_KEY}
              onSelect={() => onSelect(UNLINKED_KEY)}
            />
          )}
          {tree.map((node) => (
            <TreeBranch
              key={node.initiative.id}
              node={node}
              selectedId={selectedId}
              tabStopId={tabStopId}
              collapsed={collapsed}
              onToggle={toggleBranch}
              onSelect={onSelect}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </Box>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          px: 1.25,
          py: 0.75,
          borderTop: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t("sidebar.count", { count: totalCount })}
        </Typography>
      </Box>
    </Box>
  );
}

// ── Tree branch (recursive, collapsible) ──────────────────────────────

interface BranchProps {
  node: InitiativeTreeNode;
  selectedId: string | null;
  /** The one row that takes the Tab key (roving tabindex). */
  tabStopId: string | null;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}

function TreeBranch({
  node,
  selectedId,
  tabStopId,
  collapsed,
  onToggle,
  onSelect,
  favorites,
  onToggleFavorite,
}: BranchProps) {
  const { t } = useTranslation(["delivery", "common"]);
  const statusLabel = useInitiativeStatusLabel();
  const statusColor = useInitiativeStatusColor();
  const hasChildren = node.children.length > 0;
  const { initiative, level } = node;
  const open = !collapsed.has(initiative.id);
  const isSelected = selectedId === initiative.id;
  const isArchived = initiative.status === "ARCHIVED";
  const attrs = (initiative.attributes ?? {}) as Record<string, unknown>;
  const initStatus = attrs.initiativeStatus as string | undefined;
  const isFavorite = favorites.has(initiative.id);
  const totalArtefacts =
    node.soaws.length + node.diagrams.length + node.adrs.length;

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          pl: level * 1.5 + 0.25,
          pr: 0.5,
          py: 0.25,
          minHeight: 36,
          borderRadius: 1,
          cursor: "pointer",
          position: "relative",
          bgcolor: isSelected ? "action.selected" : "transparent",
          borderLeft: isSelected
            ? `3px solid ${CARD_TYPE_COLORS.Initiative}`
            : "3px solid transparent",
          "&:hover": { bgcolor: isSelected ? "action.selected" : "action.hover" },
        }}
        role="treeitem"
        tabIndex={tabStopId === initiative.id ? 0 : -1}
        data-tree-id={initiative.id}
        aria-label={initiative.name}
        aria-level={level + 1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? open : undefined}
        aria-keyshortcuts="Shift+F"
        onClick={() => onSelect(initiative.id)}
      >
        {/* Tree guide lines for nested levels */}
        {Array.from({ length: level }).map((_, i) => (
          <Box
            key={i}
            sx={{
              position: "absolute",
              left: i * 12 + 8,
              top: 0,
              bottom: 0,
              width: "1px",
              bgcolor: "divider",
            }}
          />
        ))}

        {/* A mouse target only: the row carries the expanded state, and the
            Left and Right keys fold it, so the chevron is neither a tab stop
            nor announced. */}
        {hasChildren ? (
          <IconButton
            size="small"
            tabIndex={-1}
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(initiative.id);
            }}
            sx={{ width: 20, height: 20 }}
          >
            <MaterialSymbol
              icon={open ? "expand_more" : "chevron_right"}
              size={18}
            />
          </IconButton>
        ) : (
          <Box sx={{ width: 20 }} />
        )}

        <MaterialSymbol
          icon="rocket_launch"
          size={18}
          color={isArchived ? "#999" : CARD_TYPE_COLORS.Initiative}
        />

        <Typography
          sx={{
            ml: 0.5,
            fontSize: "0.875rem",
            fontWeight: isSelected ? 600 : 400,
            flex: 1,
            minWidth: 0,
            color: isArchived ? "text.secondary" : "text.primary",
          }}
          noWrap
        >
          {initiative.name}
        </Typography>

        {/* Tiny artefact count + status dot + favorite */}
        {totalArtefacts > 0 && (
          <Chip
            label={totalArtefacts}
            size="small"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", px: 0 }}
          />
        )}
        {initStatus && (
          <Tooltip title={statusLabel(initStatus)} placement="top">
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: statusColor(initStatus),
              }}
            />
          </Tooltip>
        )}
        {/* A mouse target: from the keyboard the row's Shift+F does this. */}
        <IconButton
          size="small"
          tabIndex={-1}
          aria-label={t(isFavorite ? "sidebar.unstar" : "sidebar.star", { name: initiative.name })}
          aria-pressed={isFavorite}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(initiative.id);
          }}
          sx={{
            width: 22,
            height: 22,
            opacity: isFavorite ? 1 : 0.35,
            "&:hover": { opacity: 1 },
          }}
        >
          <MaterialSymbol
            icon="cards_star"
            size={16}
            color={isFavorite ? "#f5a623" : "currentColor"}
          />
        </IconButton>
      </Box>

      {hasChildren && open && (
        <>
          {node.children.map((child) => (
            <TreeBranch
              key={child.initiative.id}
              node={child}
              selectedId={selectedId}
              tabStopId={tabStopId}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </>
      )}
    </>
  );
}

// ── Synthetic "Unlinked" row ──────────────────────────────────────────

function UnlinkedRow({
  count,
  selected,
  tabStop,
  onSelect,
}: {
  count: number;
  selected: boolean;
  tabStop: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  return (
    <Box
      role="treeitem"
      tabIndex={tabStop ? 0 : -1}
      data-tree-id={UNLINKED_KEY}
      aria-label={t("sidebar.unlinked")}
      aria-level={1}
      aria-selected={selected}
      onClick={onSelect}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 0.75,
        py: 0.5,
        minHeight: 36,
        borderRadius: 1,
        cursor: "pointer",
        bgcolor: selected ? "action.selected" : "transparent",
        borderLeft: selected
          ? "3px solid #999"
          : "3px solid transparent",
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
        mb: 0.5,
      }}
    >
      <MaterialSymbol icon="folder_open" size={18} color="#999" />
      <Typography
        sx={{
          fontSize: "0.875rem",
          flex: 1,
          color: "text.secondary",
          fontStyle: "italic",
        }}
        noWrap
      >
        {t("sidebar.unlinked")}
      </Typography>
      <Chip
        label={count}
        size="small"
        variant="outlined"
        sx={{ height: 18, fontSize: "0.65rem" }}
      />
    </Box>
  );
}
