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
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import OutlinedInput from "@mui/material/OutlinedInput";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
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

// Stable per-L1 accent color drawn from Turbo EA's existing card-type palette
// (see backend/app/services/seed.py). Each L1 maps to one of these via a
// simple deterministic hash, so the same capability always gets the same
// color across reloads while neighbouring L1s look visually distinct.
const L1_ACCENT_PALETTE = [
  "#003399", // BusinessCapability deep navy
  "#0f7eb5", // Application sky blue
  "#027446", // Platform forest green
  "#774fcc", // DataObject purple
  "#c7527d", // Objective rose
  "#8e24aa", // BusinessProcess magenta
  "#d29270", // ITComponent warm tan
  "#02afa4", // Interface teal
] as const;

function l1Accent(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return L1_ACCENT_PALETTE[Math.abs(h) % L1_ACCENT_PALETTE.length];
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

  // Cascade-on-select / single-node-on-deselect:
  //   - clicking an unselected node adds the node + all selectable descendants
  //   - clicking an already-selected node removes only that node
  // This lets users start from "select L1" (which seeds the whole subtree) and
  // then prune individual descendants without losing the parent — the only way
  // to assemble e.g. an L1-only selection.
  const toggleSelect = (id: string) => {
    const cap = byId.get(id);
    if (!cap || !isSelectable(cap)) return;
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      const subtree = [id, ...(descendantsOf.get(id) ?? [])].filter((sid) => {
        const c = byId.get(sid);
        return c && isSelectable(c);
      });
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
    <Box className="tcc-root">
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
            {t("cards:catalogue.levelStepper", {
              current: currentLevel,
              max: stepperMax,
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
              byId={byId}
              byParent={byParent}
              visible={visibleSet}
              expanded={expanded}
              selected={selected}
              descendantsOf={descendantsOf}
              onToggleExpand={toggleExpand}
              onToggleSelect={toggleSelect}
              onOpenDetail={onOpenDetail}
              isSelectable={isSelectable}
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
  byId: Map<string, FlatCapability>;
  byParent: Map<string | null, FlatCapability[]>;
  visible: Set<string>;
  expanded: Set<string>;
  selected: Set<string>;
  descendantsOf: Map<string, string[]>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  isSelectable: (cap: FlatCapability) => boolean;
}

function L1Card({
  node,
  byId,
  byParent,
  visible,
  expanded,
  selected,
  descendantsOf,
  onToggleExpand,
  onToggleSelect,
  onOpenDetail,
  isSelectable,
}: L1CardProps) {
  const kids = (byParent.get(node.id) ?? []).filter((c) => visible.has(c.id));
  const isOpen = expanded.has(node.id);
  const hasKids = kids.length > 0;
  const selfSelected = selected.has(node.id);
  const isExisting = !!node.existing_card_id;

  // Tri-state: only creatable nodes count toward the parent's checkbox state.
  // Existing-as-card nodes can never be selected and so are excluded from
  // both totalCreatable and selectedCreatable.
  let totalCreatable = isSelectable(node) ? 1 : 0;
  let selectedCreatable = isSelectable(node) && selfSelected ? 1 : 0;
  for (const sid of descendantsOf.get(node.id) ?? []) {
    const c = byId.get(sid);
    if (!c || !isSelectable(c)) continue;
    totalCreatable += 1;
    if (selected.has(sid)) selectedCreatable += 1;
  }

  let checkState: "unchecked" | "checked" | "indeterminate" = "unchecked";
  if (totalCreatable === 0 || selectedCreatable === 0) checkState = "unchecked";
  else if (selectedCreatable >= totalCreatable) checkState = "checked";
  else checkState = "indeterminate";

  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = checkState === "indeterminate";
    }
  }, [checkState]);

  const accent = l1Accent(node.id);
  // Append 0x14 (8% alpha) for the header tint and 0x33 (20% alpha) for the
  // selected-state ring — using hex-with-alpha keeps it portable across
  // browsers without relying on color-mix().
  const accentStyle = {
    "--tcc-accent": accent,
    "--tcc-accent-tint": `${accent}14`,
    "--tcc-accent-ring": `${accent}33`,
  } as CSSProperties;

  return (
    <section
      className={`tcc-l1-card${selfSelected ? " is-selected" : ""}`}
      style={accentStyle}
    >
      <header className="tcc-l1-header">
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
        <IconButton
          size="small"
          onClick={() => onToggleExpand(node.id)}
          disabled={!hasKids}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          <MaterialSymbol icon={isOpen ? "expand_less" : "expand_more"} size={20} />
        </IconButton>
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
  depth,
}: ChildRowProps) {
  const kids = (byParent.get(node.id) ?? []).filter((c) => visible.has(c.id));
  const isOpen = expanded.has(node.id);
  const hasKids = kids.length > 0;
  const isExisting = !!node.existing_card_id;
  const selfSelected = selected.has(node.id);
  const isL2 = depth === 1;

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
      sx={{ p: 0.5 }}
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
      <div className={`tcc-row${selfSelected ? " is-selected" : ""}${isL2 ? " is-l2" : ""}`}>
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
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
