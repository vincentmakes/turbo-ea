import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import OutlinedInput from "@mui/material/OutlinedInput";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { FlatCapability } from "./types";
import "./capabilityCatalogue.css";

function compareIds(a: string, b: string): number {
  const sa = a.replace(/^BC-/, "").split(".").map(Number);
  const sb = b.replace(/^BC-/, "").split(".").map(Number);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const av = sa[i] ?? -1;
    const bv = sb[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function splitIndustry(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(";").map((x) => x.trim()).filter(Boolean);
}

// Light-blue palette inside the BusinessCapability tone family. Drives the
// background of each level's header strip (L1 banner + L2/L3/L4/L5 rows).
// Pure values, lightening with depth, so the visual hierarchy reads even
// on a stack of small rows. Text on every level is the brand navy
// `#003399`. Same indexing convention as HierarchySection.tsx:30
// (LEVEL_COLORS).
const BC_LEVEL_COLORS = [
  "#90caf9", // L1 — Material Blue 200
  "#bbdefb", // L2 — Material Blue 100
  "#e3f2fd", // L3 — Material Blue 50
  "#f1f7fc", // L4
  "#f8fbfe", // L5
] as const;

// Dark-mode counterpart — same family, picked so the per-level depth still
// reads against a #1e1e1e paper.
const BC_LEVEL_COLORS_DARK = [
  "#3a5d80", // L1
  "#2f4a66", // L2
  "#263a4f", // L3
  "#1f2e3d", // L4
  "#1b2632", // L5
] as const;

function levelColor(level: number, isDark = false): string {
  const palette = isDark ? BC_LEVEL_COLORS_DARK : BC_LEVEL_COLORS;
  const i = Math.max(0, Math.min(level - 1, palette.length - 1));
  return palette[i];
}

interface Props {
  data: FlatCapability[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpenDetail: (id: string) => void;
}

export default function CapabilityCatalogueBrowser({
  data,
  selected,
  onSelectedChange,
  onOpenDetail,
}: Props) {
  const { t } = useTranslation(["cards", "common"]);
  // Without `cssVariables: true` on the MUI theme, the `var(--mui-palette-…)`
  // tokens used in the catalogue stylesheet aren't actually injected, so we
  // must read the active palette mode at render time and toggle a class on
  // the root. The CSS file owns all the dual-mode rules.
  const isDark = useTheme().palette.mode === "dark";

  // Indexes ----------------------------------------------------------------
  const byId = useMemo(() => {
    const m = new Map<string, FlatCapability>();
    for (const c of data) m.set(c.id, c);
    return m;
  }, [data]);

  const byParent = useMemo(() => {
    const map = new Map<string | null, FlatCapability[]>();
    for (const c of data) {
      const list = map.get(c.parent_id) ?? [];
      list.push(c);
      map.set(c.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => compareIds(a.id, b.id));
    return map;
  }, [data]);

  const descendantsOf = useMemo(() => {
    const cache = new Map<string, string[]>();
    for (const c of data) {
      const out: string[] = [];
      const stack = [...(byParent.get(c.id) ?? [])];
      while (stack.length > 0) {
        const n = stack.pop()!;
        out.push(n.id);
        for (const k of byParent.get(n.id) ?? []) stack.push(k);
      }
      cache.set(c.id, out);
    }
    return cache;
  }, [data, byParent]);

  // Facets -----------------------------------------------------------------
  const allLevels = useMemo(() => {
    const s = new Set<number>();
    for (const c of data) s.add(c.level);
    return Array.from(s).sort((a, b) => a - b);
  }, [data]);

  const allIndustries = useMemo(() => {
    const s = new Set<string>();
    for (const c of data) for (const ind of splitIndustry(c.industry)) s.add(ind);
    return Array.from(s).sort();
  }, [data]);

  // Filter / view state ----------------------------------------------------
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<number>>(() => new Set(allLevels));
  const [industries, setIndustries] = useState<Set<string>>(new Set());
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const c of data) if (c.level === 1) s.add(c.id);
    return s;
  });

  // Re-seed the level filter once data finishes loading.
  useEffect(() => {
    setLevels((prev) => (prev.size === 0 ? new Set(allLevels) : prev));
  }, [allLevels]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.filter((c) => {
      if (!levels.has(c.level)) return false;
      if (industries.size > 0) {
        const inds = splitIndustry(c.industry);
        if (!inds.some((i) => industries.has(i))) return false;
      }
      if (!showDeprecated && c.deprecated) return false;
      if (q) {
        const hay = [c.id, c.name, c.description ?? "", (c.aliases ?? []).join(" ")]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, levels, industries, showDeprecated, query]);

  // Always include ancestors so each L1 column shows something.
  const visibleSet = useMemo(() => {
    const ids = new Set(visible.map((c) => c.id));
    for (const c of visible) {
      let cursor = c.parent_id;
      while (cursor) {
        if (ids.has(cursor)) break;
        ids.add(cursor);
        cursor = byId.get(cursor)?.parent_id ?? null;
      }
    }
    return ids;
  }, [visible, byId]);

  // Selection helpers ------------------------------------------------------
  // Existing-card matches are non-selectable (rendered as a green tick).
  const isSelectable = (cap: FlatCapability) => !cap.existing_card_id;

  // Subtree-cascading selection — symmetric in direction (always walks
  // downward) but never touches ancestors:
  //   - selecting an unselected node adds the node + all selectable descendants
  //   - deselecting a selected node removes the node + all selectable descendants
  // Deselecting a child therefore never tears down its parent, so users can
  // assemble "L1 + a couple of leaves" by selecting L1, then pruning the
  // intermediate L2/L3 they don't want. Conversely, deselecting the parent
  // wipes the whole subtree in one action.
  const toggleSelect = (id: string) => {
    const cap = byId.get(id);
    if (!cap || !isSelectable(cap)) return;
    const next = new Set(selected);
    const subtree = [id, ...(descendantsOf.get(id) ?? [])].filter((sid) => {
      const c = byId.get(sid);
      return c && isSelectable(c);
    });
    if (next.has(id)) {
      for (const s of subtree) next.delete(s);
    } else {
      for (const s of subtree) next.add(s);
    }
    onSelectedChange(next);
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const expandAll = () => {
    const s = new Set<string>();
    for (const c of data) s.add(c.id);
    setExpanded(s);
  };
  const collapseAll = () => setExpanded(new Set());

  // Level stepper ----------------------------------------------------------
  const maxLevel = useMemo(() => {
    let m = 1;
    for (const c of data) if (c.level > m) m = c.level;
    return m;
  }, [data]);

  const expandablesByLevel = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const c of data) {
      if ((byParent.get(c.id) ?? []).length === 0) continue;
      const list = m.get(c.level) ?? [];
      list.push(c.id);
      m.set(c.level, list);
    }
    return m;
  }, [data, byParent]);

  const currentLevel = useMemo(() => {
    let depth = 0;
    for (let lvl = 1; lvl <= maxLevel - 1; lvl++) {
      const ids = expandablesByLevel.get(lvl) ?? [];
      if (ids.length === 0) continue;
      if (ids.every((id) => expanded.has(id))) depth = lvl;
      else break;
    }
    return depth;
  }, [expanded, expandablesByLevel, maxLevel]);

  const stepperMax = Math.max(maxLevel - 1, 0);

  // Per-L1 stepwise expand / collapse — one tree level at a time, scoped to a
  // single L1's subtree. Mirrors the global level stepper but applies only to
  // descendants of the chosen L1, so users can pop one branch open without
  // disturbing the others. The current "depth" of an L1 is the deepest tree
  // level k such that every expandable node within the subtree at levels
  // 1..k is in `expanded`:
  //   depth 0 — L1 collapsed (header only)
  //   depth 1 — L1 expanded, no L2 children opened (L2 list visible)
  //   depth 2 — L1 + every L2-with-kids expanded (L3 visible)
  //   …
  // Pressing + bumps the depth by one (opens that level); pressing − closes
  // the current depth and everything deeper, so the next press always
  // strictly decreases the depth by exactly one.
  const l1OpenDepth = (l1Id: string): number => {
    const within = new Set([l1Id, ...(descendantsOf.get(l1Id) ?? [])]);
    let depth = 0;
    for (let lvl = 1; lvl <= maxLevel - 1; lvl++) {
      const ids = (expandablesByLevel.get(lvl) ?? []).filter((id) => within.has(id));
      if (ids.length === 0) continue;
      if (ids.every((id) => expanded.has(id))) depth = lvl;
      else break;
    }
    return depth;
  };

  const l1MaxDepth = (l1Id: string): number => {
    const within = new Set([l1Id, ...(descendantsOf.get(l1Id) ?? [])]);
    let max = 0;
    for (let lvl = 1; lvl <= maxLevel - 1; lvl++) {
      const ids = (expandablesByLevel.get(lvl) ?? []).filter((id) => within.has(id));
      if (ids.length > 0) max = lvl;
    }
    return max;
  };

  const expandL1OneLevel = (l1Id: string) => {
    const within = new Set([l1Id, ...(descendantsOf.get(l1Id) ?? [])]);
    const cur = l1OpenDepth(l1Id);
    const max = l1MaxDepth(l1Id);
    if (cur >= max) return;
    const target = cur + 1;
    const next = new Set(expanded);
    for (const id of expandablesByLevel.get(target) ?? []) {
      if (within.has(id)) next.add(id);
    }
    setExpanded(next);
  };

  const collapseL1OneLevel = (l1Id: string) => {
    const within = new Set([l1Id, ...(descendantsOf.get(l1Id) ?? [])]);
    const cur = l1OpenDepth(l1Id);
    if (cur === 0) return;
    const next = new Set(expanded);
    // Close the current depth AND everything deeper, so depth strictly drops
    // by one regardless of any leftover state from earlier interactions.
    for (let lvl = cur; lvl <= maxLevel - 1; lvl++) {
      for (const id of expandablesByLevel.get(lvl) ?? []) {
        if (within.has(id)) next.delete(id);
      }
    }
    setExpanded(next);
  };

  const expandOneLevel = () => {
    const target = Math.min(currentLevel + 1, stepperMax);
    if (target === currentLevel) return;
    const next = new Set(expanded);
    for (let lvl = 1; lvl <= target; lvl++) {
      for (const id of expandablesByLevel.get(lvl) ?? []) next.add(id);
    }
    setExpanded(next);
  };

  const collapseOneLevel = () => {
    const target = Math.max(currentLevel - 1, 0);
    if (target === currentLevel) return;
    const next = new Set<string>();
    for (let lvl = 1; lvl <= target; lvl++) {
      for (const id of expandablesByLevel.get(lvl) ?? []) next.add(id);
    }
    setExpanded(next);
  };

  const selectAllVisible = () => {
    const next = new Set(selected);
    for (const id of visibleSet) {
      const c = byId.get(id);
      if (c && isSelectable(c)) next.add(id);
    }
    onSelectedChange(next);
  };

  const clearSelection = () => onSelectedChange(new Set());

  const resetFilters = () => {
    setQuery("");
    setLevels(new Set(allLevels));
    setIndustries(new Set());
    setShowDeprecated(false);
  };

  const roots = (byParent.get(null) ?? []).filter((r) => visibleSet.has(r.id));
  const selectionCount = selected.size;

  const visibleCreatable = useMemo(
    () =>
      Array.from(visibleSet).filter((id) => {
        const c = byId.get(id);
        return c && isSelectable(c);
      }),
    [visibleSet, byId],
  );

  return (
    <Box className={`tcc-root${isDark ? " tcc-root--dark" : ""}`}>
      {/* Filter bar */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder={t("cards:catalogue.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: "1 1 220px", minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={18} />
                </InputAdornment>
              ),
            }}
          />

          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="overline" color="text.secondary">
              {t("cards:catalogue.levelLabel")}
            </Typography>
            {allLevels.map((lvl) => {
              const checked = levels.has(lvl);
              return (
                <Chip
                  key={lvl}
                  label={`L${lvl}`}
                  size="small"
                  color={checked ? "primary" : "default"}
                  variant={checked ? "filled" : "outlined"}
                  onClick={() => {
                    const next = new Set(levels);
                    if (next.has(lvl)) next.delete(lvl);
                    else next.add(lvl);
                    setLevels(next);
                  }}
                />
              );
            })}
          </Stack>

          {allIndustries.length > 1 && (
            <Select
              multiple
              size="small"
              displayEmpty
              value={Array.from(industries)}
              onChange={(e) => {
                const v = e.target.value as string[];
                setIndustries(new Set(v));
              }}
              input={<OutlinedInput />}
              renderValue={(v) => {
                const arr = v as string[];
                if (arr.length === 0) return t("cards:catalogue.industryAll");
                if (arr.length === 1) return arr[0];
                return t("cards:catalogue.industryNSelected", { count: arr.length });
              }}
              sx={{ minWidth: 160 }}
            >
              {allIndustries.map((ind) => (
                <MenuItem key={ind} value={ind}>
                  <Checkbox size="small" checked={industries.has(ind)} />
                  <ListItemText primary={ind} />
                </MenuItem>
              ))}
            </Select>
          )}

          <Tooltip title={t("cards:catalogue.deprecatedTooltip")}>
            <Chip
              size="small"
              variant={showDeprecated ? "filled" : "outlined"}
              color={showDeprecated ? "warning" : "default"}
              label={t("cards:catalogue.deprecatedToggle")}
              onClick={() => setShowDeprecated((v) => !v)}
            />
          </Tooltip>

          <Button size="small" onClick={resetFilters}>
            {t("cards:catalogue.resetFilters")}
          </Button>
        </Stack>
      </Paper>

      {/* Action bar */}
      <Stack
        className="tcc-action-bar"
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        sx={{ mb: 1.5 }}
        useFlexGap
      >
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          <strong>{visible.length}</strong>{" "}
          {t("cards:catalogue.matchCount", { count: visible.length })}
          {visible.length !== data.length && (
            <>
              {" · "}
              <strong>{data.length}</strong> {t("cards:catalogue.total")}
            </>
          )}
          {selectionCount > 0 && (
            <>
              {" · "}
              <strong>{selectionCount}</strong> {t("cards:catalogue.selectedLabel")}
            </>
          )}
        </Typography>

        <div className="tcc-stepper" role="group" aria-label="Expand by level">
          <button
            type="button"
            onClick={collapseOneLevel}
            disabled={currentLevel <= 0}
            aria-label="Collapse one level"
          >
            <MaterialSymbol icon="remove" size={16} />
          </button>
          <span className="tcc-stepper-label">
            {/* Display levels 1-indexed: depth=0 in state means "L1 cards
                visible only" → "Level 1 / N" in the UI. The underlying state
                still uses 0-based depth so the calculations remain natural. */}
            {t("cards:catalogue.levelStepper", {
              current: currentLevel + 1,
              max: stepperMax + 1,
            })}
          </span>
          <button
            type="button"
            onClick={expandOneLevel}
            disabled={currentLevel >= stepperMax}
            aria-label="Expand one level"
          >
            <MaterialSymbol icon="add" size={16} />
          </button>
        </div>

        <Button size="small" onClick={expandAll}>
          {t("cards:catalogue.expandAll")}
        </Button>
        <Button size="small" onClick={collapseAll}>
          {t("cards:catalogue.collapseAll")}
        </Button>
        <Button
          size="small"
          onClick={selectAllVisible}
          disabled={visibleCreatable.length === 0}
        >
          {t("cards:catalogue.selectVisible")}
        </Button>
        <Button size="small" onClick={clearSelection} disabled={selectionCount === 0}>
          {t("cards:catalogue.clearSelection")}
        </Button>
      </Stack>

      {/* L1 grid */}
      {roots.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6">{t("cards:catalogue.noMatches")}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t("cards:catalogue.adjustFilters")}
          </Typography>
        </Paper>
      ) : (
        <div className="tcc-l1-grid">
          {roots.map((r) => (
            <L1Card
              key={r.id}
              node={r}
              byParent={byParent}
              visible={visibleSet}
              expanded={expanded}
              selected={selected}
              descendantsOf={descendantsOf}
              onToggleExpand={toggleExpand}
              onExpandL1={expandL1OneLevel}
              onCollapseL1={collapseL1OneLevel}
              openDepth={l1OpenDepth(r.id)}
              maxDepth={l1MaxDepth(r.id)}
              onToggleSelect={toggleSelect}
              onOpenDetail={onOpenDetail}
              isSelectable={isSelectable}
              isDark={isDark}
            />
          ))}
        </div>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// L1Card + ChildRow
// ---------------------------------------------------------------------------

interface L1CardProps {
  node: FlatCapability;
  byParent: Map<string | null, FlatCapability[]>;
  visible: Set<string>;
  expanded: Set<string>;
  selected: Set<string>;
  descendantsOf: Map<string, string[]>;
  onToggleExpand: (id: string) => void;
  onExpandL1: (id: string) => void;
  onCollapseL1: (id: string) => void;
  openDepth: number;
  maxDepth: number;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  isSelectable: (cap: FlatCapability) => boolean;
  isDark: boolean;
}

function L1Card({
  node,
  byParent,
  visible,
  expanded,
  selected,
  descendantsOf,
  onToggleExpand,
  onExpandL1,
  onCollapseL1,
  openDepth,
  maxDepth,
  onToggleSelect,
  onOpenDetail,
  isSelectable,
  isDark,
}: L1CardProps) {
  const { t } = useTranslation(["cards"]);
  const kids = (byParent.get(node.id) ?? []).filter((c) => visible.has(c.id));
  const hasKids = kids.length > 0;
  const isOpen = expanded.has(node.id);
  const selfSelected = selected.has(node.id);
  const isExisting = !!node.existing_card_id;

  // Tri-state for the L1 checkbox is bound to L1's OWN selection state, not
  // the subtree:
  //   selfSelected            → "checked"      (user picked L1; stays solid
  //                                              even if individual descendants
  //                                              are then unticked)
  //   some descendants picked → "indeterminate" (visual hint that the subtree
  //                                              is partially populated even
  //                                              though L1 itself isn't ticked)
  //   none of the above       → "unchecked"
  // This keeps the deselect cascade unsurprising: unticking an L2 must never
  // make the L1 checkbox jump to indeterminate or unchecked.
  let someDescendantsSelected = false;
  for (const sid of descendantsOf.get(node.id) ?? []) {
    if (selected.has(sid)) {
      someDescendantsSelected = true;
      break;
    }
  }
  let checkState: "unchecked" | "checked" | "indeterminate";
  if (selfSelected) checkState = "checked";
  else if (someDescendantsSelected) checkState = "indeterminate";
  else checkState = "unchecked";

  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = checkState === "indeterminate";
    }
  }, [checkState]);

  // L1 header background is the level-1 colour from the active palette
  // (light blue in light mode, muted blue in dark). The brand navy
  // `#003399` reads on the light tone; in dark mode the row text uses the
  // lifted lavender that's set on .tcc-row in CSS, so we mirror that here
  // for the header to feel cohesive with its rows.
  const headerStyle: CSSProperties = {
    background: levelColor(1, isDark),
    color: isDark ? "#cdd9ee" : "#003399",
  };

  const expandLabel = t("cards:catalogue.expandOneLevel");
  const collapseLabel = t("cards:catalogue.collapseOneLevel");
  const canExpand = hasKids && openDepth < maxDepth;
  const canCollapse = openDepth > 0;

  return (
    <section className={`tcc-l1-card${selfSelected ? " is-selected" : ""}`}>
      <header className="tcc-l1-header" style={headerStyle}>
        {/* Per-L1 ± pill — mirrors the global .tcc-stepper aesthetic but
            scoped to this L1's subtree only. Always renders both buttons; the
            inactive direction goes disabled. Pressing + opens one tree level
            within this L1; pressing − closes the deepest open level. */}
        <div className="tcc-branch-stepper" role="group" aria-label={expandLabel}>
          <button
            type="button"
            onClick={() => onCollapseL1(node.id)}
            disabled={!canCollapse}
            aria-label={collapseLabel}
            title={collapseLabel}
          >
            <MaterialSymbol icon="remove" size={16} />
          </button>
          <button
            type="button"
            onClick={() => onExpandL1(node.id)}
            disabled={!canExpand}
            aria-label={expandLabel}
            title={expandLabel}
          >
            <MaterialSymbol icon="add" size={16} />
          </button>
        </div>
        {isExisting ? (
          <Tooltip title={`Already a card: ${node.name}`}>
            <span className="tcc-existing-tick">
              <MaterialSymbol icon="check_circle" size={20} />
            </span>
          </Tooltip>
        ) : (
          <Checkbox
            inputRef={checkboxRef}
            size="small"
            checked={checkState === "checked"}
            onChange={() => onToggleSelect(node.id)}
            inputProps={{ "aria-label": `Select ${node.id} ${node.name}` }}
            sx={{
              p: 0.5,
              color: "rgba(0,51,153,0.55)",
              "&.Mui-checked, &.MuiCheckbox-indeterminate": { color: "#003399" },
            }}
          />
        )}
        <button
          type="button"
          className="tcc-l1-name"
          onClick={() => onOpenDetail(node.id)}
        >
          {node.name}
        </button>
        {node.deprecated && <span className="tcc-deprecated-badge">Dep.</span>}
        {hasKids && <span className="tcc-cap-count">{kids.length}</span>}
      </header>
      {isOpen && hasKids && (
        <ul className="tcc-l2-list">
          {kids.map((k) => (
            <ChildRow
              key={k.id}
              node={k}
              byParent={byParent}
              visible={visible}
              expanded={expanded}
              selected={selected}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
              onOpenDetail={onOpenDetail}
              isSelectable={isSelectable}
              isDark={isDark}
              depth={1}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ChildRowProps {
  node: FlatCapability;
  byParent: Map<string | null, FlatCapability[]>;
  visible: Set<string>;
  expanded: Set<string>;
  selected: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  isSelectable: (cap: FlatCapability) => boolean;
  isDark: boolean;
  depth: number;
}

function ChildRow({
  node,
  byParent,
  visible,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onOpenDetail,
  isSelectable,
  isDark,
  depth,
}: ChildRowProps) {
  const kids = (byParent.get(node.id) ?? []).filter((c) => visible.has(c.id));
  const isOpen = expanded.has(node.id);
  const hasKids = kids.length > 0;
  const isExisting = !!node.existing_card_id;
  const selfSelected = selected.has(node.id);
  const isL2 = depth === 1;

  // Each row's background is its level colour from the active palette
  // (light-blue in light mode, muted blue in dark). Set inline because the
  // value is data-driven; CSS owns layout + the constant text/border.
  const rowStyle: CSSProperties = {
    background: levelColor(node.level, isDark),
  };

  const checkbox = isExisting ? (
    <Tooltip title={`Already a card: ${node.name}`}>
      <span className="tcc-existing-tick">
        <MaterialSymbol icon="check_circle" size={18} />
      </span>
    </Tooltip>
  ) : (
    <Checkbox
      size="small"
      checked={selfSelected}
      onChange={() => onToggleSelect(node.id)}
      inputProps={{ "aria-label": `Select ${node.id} ${node.name}` }}
      sx={{ p: 0.5, color: "rgba(0,51,153,0.55)", "&.Mui-checked": { color: "#003399" } }}
    />
  );

  const chevron = (
    <button
      type="button"
      className={`tcc-chevron${hasKids ? "" : " is-empty"}${isOpen ? " is-open" : ""}`}
      onClick={() => hasKids && onToggleExpand(node.id)}
      aria-label={hasKids ? (isOpen ? "Collapse" : "Expand") : ""}
      tabIndex={hasKids ? 0 : -1}
    >
      {hasKids && <MaterialSymbol icon="chevron_right" size={16} />}
    </button>
  );

  return (
    <li>
      <div
        className={`tcc-row${selfSelected ? " is-selected" : ""}${isL2 ? " is-l2" : ""}`}
        style={rowStyle}
      >
        {checkbox}
        {chevron}
        <button
          type="button"
          className="tcc-name-btn"
          onClick={() => onOpenDetail(node.id)}
          title={node.description ?? undefined}
        >
          {node.name}
        </button>
        {node.deprecated && <span className="tcc-deprecated-badge">Dep.</span>}
        {hasKids && <span className="tcc-cap-count">{kids.length}</span>}
      </div>
      {isOpen && hasKids && (
        <ul className="tcc-l2-children">
          {kids.map((k) => (
            <ChildRow
              key={k.id}
              node={k}
              byParent={byParent}
              visible={visible}
              expanded={expanded}
              selected={selected}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
              onOpenDetail={onOpenDetail}
              isSelectable={isSelectable}
              isDark={isDark}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
