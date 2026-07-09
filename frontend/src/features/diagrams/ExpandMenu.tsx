import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

export interface RelationSummaryEntry {
  relation_type_key: string;
  label: string;
  direction: "outgoing" | "incoming";
  peer_type_key: string | null;
  count: number;
}

export interface RelationSummaryHierarchy {
  children_count: number;
  parent_id: string | null;
  parent_name: string | null;
  parent_type: string | null;
}

interface RelationSummaryResponse {
  by_type: RelationSummaryEntry[];
  hierarchy: RelationSummaryHierarchy;
}

export interface HierarchyChildRef {
  id: string;
  name: string;
  type: string;
}

export interface ExpandMenuTarget {
  cellId: string;
  cardId: string;
  /** Anchor in viewport coords (clientX/clientY). */
  anchor: { x: number; y: number };
  /** Card ids currently nested INSIDE this cell as visual drill-down
   *  children. Lets the menu mark "already in container" rows so the
   *  user can spot which hierarchy children are missing and only
   *  selects those for re-insertion. */
  nestedCardIds?: Set<string>;
}

export interface ShowDependencyPick {
  mode: "show";
  entries: RelationSummaryEntry[];
}

export interface DrillDownPick {
  mode: "drill_down";
  /** Selected children to nest inside the current card. */
  children: HierarchyChildRef[];
}

export interface RollUpPick {
  mode: "roll_up";
  parent: { id: string; name: string; type: string };
  /** Siblings the user explicitly checked — inserted as NEW cells
   *  alongside the current card. Empty for "Roll up to parent only". */
  siblings: HierarchyChildRef[];
  /** Every child of the parent (current card excluded). The editor uses
   *  this to find siblings ALREADY on the canvas and re-parent them into
   *  the new container, even when no siblings were checked. */
  allSiblings: HierarchyChildRef[];
}

export type ExpandMenuPick = ShowDependencyPick | DrillDownPick | RollUpPick;

interface Props {
  target: ExpandMenuTarget | null;
  onClose: () => void;
  /** Fired when the user commits one of the three sections. The editor
   *  decides how to render based on `mode`. */
  onPick: (pick: ExpandMenuPick, target: ExpandMenuTarget) => void;
}

/**
 * LeanIX-style expand menu rewritten for the new semantics:
 *
 *   - **Show Dependency** is a checklist of relation types; the user picks
 *     one or many and clicks Insert.
 *   - **Drill-Down** is a checklist of the card's hierarchy children. The
 *     editor turns the current cell into a container holding the picked
 *     children.
 *   - **Roll-Up** is a checklist of the card's parent + siblings (cards
 *     sharing the same parent). The editor wraps the current cell + picked
 *     siblings inside a new parent container.
 *
 * Counts come from `GET /cards/{id}/relation-summary` and Drill-Down/Roll-Up
 * details from `GET /cards/{id}/hierarchy` + `GET /cards?parent_id=…`.
 */
export default function ExpandMenu({ target, onClose, onPick }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<RelationSummaryEntry[] | null>(null);
  const [hierarchy, setHierarchy] = useState<RelationSummaryHierarchy | null>(null);
  const [children, setChildren] = useState<HierarchyChildRef[]>([]);
  const [siblings, setSiblings] = useState<HierarchyChildRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Per-section selections.
  const [selectedDeps, setSelectedDeps] = useState<Set<string>>(new Set());
  const [selectedChildren, setSelectedChildren] = useState<Set<string>>(new Set());
  const [selectedSiblings, setSelectedSiblings] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!target) {
      setEntries(null);
      setHierarchy(null);
      setChildren([]);
      setSiblings([]);
      setSelectedDeps(new Set());
      setSelectedChildren(new Set());
      setSelectedSiblings(new Set());
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<RelationSummaryResponse>(`/cards/${target.cardId}/relation-summary`)
      .then(async (r) => {
        if (cancelled) return;
        setEntries(r.by_type);
        setHierarchy(r.hierarchy);

        // Fetch children + siblings in parallel when relevant — keeps the
        // menu snappy even on cards with deep hierarchies.
        const fetches: Promise<unknown>[] = [];
        if (r.hierarchy.children_count > 0) {
          fetches.push(
            api
              .get<{
                ancestors: HierarchyChildRef[];
                children: HierarchyChildRef[];
                level: number;
              }>(`/cards/${target.cardId}/hierarchy`)
              .then((h) => {
                if (cancelled) return;
                setChildren(h.children);
              }),
          );
        }
        if (r.hierarchy.parent_id) {
          fetches.push(
            api
              .get<{ items: HierarchyChildRef[] }>(
                `/cards?parent_id=${r.hierarchy.parent_id}&page_size=200`,
              )
              .then((resp) => {
                if (cancelled) return;
                // The endpoint returns every child under the parent —
                // exclude the current card so the user sees only siblings.
                setSiblings(resp.items.filter((c) => c.id !== target.cardId));
              }),
          );
        }
        await Promise.all(fetches);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("editor.expandMenu.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, t]);

  const totalDeps = useMemo(
    () => entries?.reduce((sum, e) => sum + e.count, 0) ?? 0,
    [entries],
  );

  if (!target) return null;

  const toggleDep = (entry: RelationSummaryEntry) => {
    if (entry.count === 0) return;
    const k = `${entry.direction}:${entry.relation_type_key}`;
    setSelectedDeps((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleChild = (id: string) => {
    setSelectedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSibling = (id: string) => {
    setSelectedSiblings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCommitDeps = () => {
    if (!entries || selectedDeps.size === 0) return;
    const picks = entries.filter((e) =>
      selectedDeps.has(`${e.direction}:${e.relation_type_key}`),
    );
    if (picks.length === 0) return;
    onPick({ mode: "show", entries: picks }, target);
    onClose();
  };

  const handleCommitDrillDown = () => {
    if (children.length === 0) return;
    // Always filter out children already nested inside the container —
    // mxGraph would silently re-parent the duplicate cell and our
    // dedup logic would strip its cardId.
    const insertable = target.nestedCardIds
      ? children.filter((c) => !target.nestedCardIds!.has(c.id))
      : children;
    const picks = selectedChildren.size > 0
      ? insertable.filter((c) => selectedChildren.has(c.id))
      : insertable;
    if (picks.length === 0) return;
    onPick({ mode: "drill_down", children: picks }, target);
    onClose();
  };

  const handleCommitRollUp = () => {
    if (!hierarchy?.parent_id || !hierarchy.parent_name) return;
    const parent = {
      id: hierarchy.parent_id,
      name: hierarchy.parent_name,
      type: hierarchy.parent_type || "",
    };
    // Only the explicitly checked siblings are inserted as new cells.
    // "Roll up to parent only" (nothing checked) yields an empty list — the
    // editor still re-parents any of `siblings` already on the canvas via
    // `allSiblings`.
    const selected = siblings.filter((s) => selectedSiblings.has(s.id));
    onPick({ mode: "roll_up", parent, siblings: selected, allSiblings: siblings }, target);
    onClose();
  };

  return (
    <Menu
      open={!!target}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.anchor.y, left: target.anchor.x }}
      slotProps={{ paper: { sx: { width: 320, maxHeight: 560, overflow: "auto" } } }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
          {t("editor.expandMenu.title")}
        </Box>
        <Box sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
          {t("editor.expandMenu.summary", { count: totalDeps })}
        </Box>
      </Box>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {error && (
        <Box sx={{ px: 2, py: 1.5, color: "error.main", fontSize: "0.8rem" }}>
          {error}
        </Box>
      )}

      {!loading && !error && (
        <>
          {/* ── Show Dependency (multi-select) ────────────────────── */}
          <SectionHeader icon="hub" label={t("editor.expandMenu.showDependency")} />
          {entries && entries.length === 0 && (
            <Box sx={{ px: 2, py: 1, color: "text.disabled", fontSize: "0.8rem" }}>
              {t("editor.expandMenu.empty")}
            </Box>
          )}
          {entries?.map((entry) => {
            const k = `${entry.direction}:${entry.relation_type_key}`;
            const disabled = entry.count === 0;
            const selected = selectedDeps.has(k);
            return (
              <MenuItem
                key={k}
                disabled={disabled}
                onClick={() => toggleDep(entry)}
                sx={{ minWidth: 260 }}
              >
                <Checkbox
                  size="small"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => toggleDep(entry)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ p: 0.5 }}
                />
                <ListItemIcon sx={{ minWidth: 24 }}>
                  <MaterialSymbol
                    icon={
                      entry.direction === "outgoing"
                        ? "arrow_outward"
                        : "arrow_downward"
                    }
                    size={14}
                    color={disabled ? "#bbb" : "#1976d2"}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={entry.label}
                  secondary={
                    entry.peer_type_key
                      ? t("editor.expandMenu.viaType", { type: entry.peer_type_key })
                      : undefined
                  }
                />
                <Chip
                  size="small"
                  label={entry.count}
                  sx={{
                    ml: 1,
                    height: 20,
                    fontSize: "0.7rem",
                    bgcolor: disabled ? "transparent" : "primary.light",
                    color: disabled ? "text.disabled" : "primary.contrastText",
                  }}
                />
              </MenuItem>
            );
          })}
          <Box sx={{ display: "flex", justifyContent: "flex-end", px: 2, py: 0.75 }}>
            <Button
              size="small"
              variant="contained"
              disabled={selectedDeps.size === 0}
              onClick={handleCommitDeps}
            >
              {t("editor.expandMenu.insertDeps", { count: selectedDeps.size })}
            </Button>
          </Box>

          {/* ── Drill-Down (children) ─────────────────────────────── */}
          <Divider sx={{ my: 0.5 }} />
          <SectionHeader
            icon="south"
            label={t("editor.expandMenu.drillDown")}
            badge={hierarchy?.children_count}
          />
          {hierarchy && hierarchy.children_count === 0 && (
            <Box sx={{ px: 2, py: 1, color: "text.disabled", fontSize: "0.8rem" }}>
              {t("editor.expandMenu.noChildren")}
            </Box>
          )}
          {hierarchy && hierarchy.children_count > 0 && children.length === 0 && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
              <CircularProgress size={14} />
            </Box>
          )}
          {children.map((c) => {
            const alreadyInside = target.nestedCardIds?.has(c.id) ?? false;
            const selected = selectedChildren.has(c.id);
            return (
              <MenuItem
                key={c.id}
                onClick={() => {
                  if (alreadyInside) return;
                  toggleChild(c.id);
                }}
                disabled={alreadyInside}
                sx={{ minWidth: 260 }}
              >
                <Checkbox
                  size="small"
                  checked={alreadyInside || selected}
                  disabled={alreadyInside}
                  onChange={() => toggleChild(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ p: 0.5 }}
                />
                <ListItemText
                  primary={c.name}
                  secondary={
                    alreadyInside
                      ? t("editor.expandMenu.alreadyInContainer")
                      : c.type
                  }
                  primaryTypographyProps={{
                    noWrap: true,
                    fontSize: "0.85rem",
                    sx: alreadyInside
                      ? { color: "text.disabled", fontStyle: "italic" }
                      : undefined,
                  }}
                  secondaryTypographyProps={{ fontSize: "0.7rem" }}
                />
              </MenuItem>
            );
          })}
          {children.length > 0 && (() => {
            const missingCount = target.nestedCardIds
              ? children.filter((c) => !target.nestedCardIds!.has(c.id)).length
              : children.length;
            return (
              <Box sx={{ display: "flex", justifyContent: "flex-end", px: 2, py: 0.75 }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={missingCount === 0 && selectedChildren.size === 0}
                  onClick={handleCommitDrillDown}
                >
                  {selectedChildren.size > 0
                    ? t("editor.expandMenu.drillDownSelected", {
                        count: selectedChildren.size,
                      })
                    : missingCount === 0
                      ? t("editor.expandMenu.allChildrenInside")
                      : t("editor.expandMenu.drillDownAll", { count: missingCount })}
                </Button>
              </Box>
            );
          })()}

          {/* ── Roll-Up (parent + siblings) ───────────────────────── */}
          <Divider sx={{ my: 0.5 }} />
          <SectionHeader icon="north" label={t("editor.expandMenu.rollUp")} />
          {!hierarchy?.parent_id && (
            <Box sx={{ px: 2, py: 1, color: "text.disabled", fontSize: "0.8rem" }}>
              {t("editor.expandMenu.noParent")}
            </Box>
          )}
          {hierarchy?.parent_id && (
            <Box sx={{ px: 2, py: 0.5, fontSize: "0.78rem", color: "text.secondary" }}>
              {t("editor.expandMenu.parentLabel", {
                name: hierarchy.parent_name || "?",
              })}
            </Box>
          )}
          {siblings.map((s) => {
            const selected = selectedSiblings.has(s.id);
            return (
              <MenuItem
                key={s.id}
                onClick={() => toggleSibling(s.id)}
                sx={{ minWidth: 260 }}
              >
                <Checkbox
                  size="small"
                  checked={selected}
                  onChange={() => toggleSibling(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ p: 0.5 }}
                />
                <ListItemText
                  primary={s.name}
                  secondary={s.type}
                  primaryTypographyProps={{ noWrap: true, fontSize: "0.85rem" }}
                  secondaryTypographyProps={{ fontSize: "0.7rem" }}
                />
              </MenuItem>
            );
          })}
          {hierarchy?.parent_id && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", px: 2, py: 0.75 }}>
              <Button
                size="small"
                variant="contained"
                onClick={handleCommitRollUp}
              >
                {selectedSiblings.size > 0
                  ? t("editor.expandMenu.rollUpSelected", {
                      count: selectedSiblings.size,
                    })
                  : t("editor.expandMenu.rollUpAlone")}
              </Button>
            </Box>
          )}
        </>
      )}
    </Menu>
  );
}

function SectionHeader({
  icon,
  label,
  badge,
}: {
  icon: string;
  label: string;
  badge?: number;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 2,
        py: 0.5,
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "text.secondary",
      }}
    >
      <MaterialSymbol icon={icon} size={14} color="#666" />
      {label}
      {badge != null && badge > 0 && (
        <Chip
          size="small"
          label={badge}
          sx={{ ml: "auto", height: 18, fontSize: "0.65rem" }}
        />
      )}
    </Box>
  );
}
