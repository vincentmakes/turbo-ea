import { useEffect, useMemo, useRef, useState } from "react";
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
import Tooltip from "@mui/material/Tooltip";
import { alpha, useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import IndustryFilter from "./IndustryFilter";
import type { CatalogueNode, CatalogueKindConfig } from "./types";
import "./referenceCatalogue.css";

/** Stable hierarchy sort key. Parses ids of the form ``<FAMILY>-<digits>(.<digits>)*``
 *  (e.g. BC-1.10, MC-10). Different prefix families sort in their own
 *  partitions — Macro Capabilities (``MC-``) always lead, then everything
 *  else alphabetically — so BC-1.10 sorts *after* BC-1.9, while MC-90 still
 *  sorts before BC-100. */
function makeCompareIds() {
  const parse = (s: string) => {
    const m = /^([A-Z]+)-(\d+(?:\.\d+)*)$/.exec(s);
    if (!m) return { fam: "~", parts: [Number.MAX_SAFE_INTEGER] };
    return { fam: m[1], parts: m[2].split(".").map(Number) };
  };
  return (a: string, b: string): number => {
    const A = parse(a);
    const B = parse(b);
    if (A.fam !== B.fam) {
      if (A.fam === "MC") return -1;
      if (B.fam === "MC") return 1;
      return A.fam.localeCompare(B.fam);
    }
    const len = Math.max(A.parts.length, B.parts.length);
    for (let i = 0; i < len; i++) {
      const av = A.parts[i] ?? -1;
      const bv = B.parts[i] ?? -1;
      if (av !== bv) return av - bv;
    }
    return 0;
  };
}

function splitIndustry(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(";").map((x) => x.trim()).filter(Boolean);
}

interface Props {
  data: CatalogueNode[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpenDetail: (id: string) => void;
  config: CatalogueKindConfig;
}

export default function CatalogueBrowser({
  data,
  selected,
  onSelectedChange,
  onOpenDetail,
  config,
}: Props) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const ns = config.i18nNamespace;
  const compareIds = useMemo(() => makeCompareIds(), []);

  // Indexes ----------------------------------------------------------------
  const byId = useMemo(() => {
    const m = new Map<string, CatalogueNode>();
    for (const c of data) m.set(c.id, c);
    return m;
  }, [data]);

  const byParent = useMemo(() => {
    const map = new Map<string | null, CatalogueNode[]>();
    for (const c of data) {
      const list = map.get(c.parent_id) ?? [];
      list.push(c);
      map.set(c.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => compareIds(a.id, b.id));
    return map;
  }, [data, compareIds]);

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
    for (const c of data) for (const ind of splitIndustry(c.industry ?? null)) s.add(ind);
    return Array.from(s).sort();
  }, [data]);

  // Filter / view state ----------------------------------------------------
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<number>>(() => new Set(allLevels));
  const [industries, setIndustries] = useState<Set<string>>(new Set());
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Macros (level 0) become the new root tier when present — expand them
    // so their L1 children are visible on load. When no macros are loaded
    // (older wheels, non-Cross industries), fall back to expanding L1.
    const hasMacros = data.some((c) => c.level === 0);
    const rootLevel = hasMacros ? 0 : 1;
    const s = new Set<string>();
    for (const c of data) if (c.level === rootLevel) s.add(c.id);
    return s;
  });

  useEffect(() => {
    setLevels((prev) => (prev.size === 0 ? new Set(allLevels) : prev));
  }, [allLevels]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.filter((c) => {
      if (!levels.has(c.level)) return false;
      if (industries.size > 0) {
        const inds = splitIndustry(c.industry ?? null);
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
  const isSelectable = (cap: CatalogueNode) => !cap.existing_card_id;

  const toggleSelect = (id: string) => {
    const cap = byId.get(id);
    if (!cap || !isSelectable(cap)) return;
    const next = new Set(selected);
    const subtree = [id, ...(descendantsOf.get(id) ?? [])].filter((sid) => {
      const c = byId.get(sid);
      return c && isSelectable(c) && visibleSet.has(sid);
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

  const roots = useMemo(
    () => (byParent.get(null) ?? []).filter((r) => visibleSet.has(r.id)),
    [byParent, visibleSet],
  );

  const industryGroups = useMemo(() => {
    const map = new Map<string, CatalogueNode[]>();
    for (const r of roots) {
      const key = splitIndustry(r.industry ?? null)[0] || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === "Cross-Industry") return -1;
        if (b === "Cross-Industry") return 1;
        if (a === "__none__") return 1;
        if (b === "__none__") return -1;
        return a.localeCompare(b);
      })
      .map(([key, items]) => ({ key, items }));
  }, [roots]);

  const selectionCount = selected.size;

  const visibleCreatable = useMemo(
    () =>
      Array.from(visibleSet).filter((id) => {
        const c = byId.get(id);
        return c && isSelectable(c);
      }),
    [visibleSet, byId],
  );

  const accentStyle = {
    "--tcc-accent": config.accentColor,
    "--tcc-selection": config.selectionColor,
  } as React.CSSProperties;

  return (
    <Box
      className={`tcc-root${isDark ? " tcc-root--dark" : ""}`}
      style={accentStyle}
    >
      <Box
        sx={{
          position: { xs: "static", sm: "sticky" },
          top: { sm: 64 },
          zIndex: 100,
          bgcolor: "background.default",
          pb: 1.5,
          boxShadow: {
            xs: "none",
            sm: `0 2px 6px -1px ${alpha(theme.palette.common.black, isDark ? 0.45 : 0.08)}`,
          },
        }}
      >
      <Paper variant="outlined" sx={{ p: 1.5, mb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder={t(`cards:${ns}.searchPlaceholder`)}
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
              {t(`cards:${ns}.levelLabel`)}
            </Typography>
            {allLevels.map((lvl) => {
              const checked = levels.has(lvl);
              return (
                <Chip
                  key={lvl}
                  label={config.levelLabel(lvl)}
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
            <IndustryFilter
              industries={allIndustries}
              selected={industries}
              onChange={setIndustries}
              i18nNamespace={ns}
            />
          )}

          <Tooltip title={t(`cards:${ns}.deprecatedTooltip`)}>
            <Chip
              size="small"
              variant={showDeprecated ? "filled" : "outlined"}
              color={showDeprecated ? "warning" : "default"}
              label={t(`cards:${ns}.deprecatedToggle`)}
              onClick={() => setShowDeprecated((v) => !v)}
            />
          </Tooltip>

          <Button size="small" onClick={resetFilters}>
            {t(`cards:${ns}.resetFilters`)}
          </Button>
        </Stack>
      </Paper>

      <Stack
        className="tcc-action-bar"
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          <strong>{visible.length}</strong>{" "}
          {t(`cards:${ns}.matchCount`, { count: visible.length })}
          {visible.length !== data.length && (
            <>
              {" · "}
              <strong>{data.length}</strong> {t(`cards:${ns}.total`)}
            </>
          )}
          {selectionCount > 0 && (
            <>
              {" · "}
              <strong>{selectionCount}</strong> {t(`cards:${ns}.selectedLabel`)}
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
            {t(`cards:${ns}.levelStepper`, {
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
          {t(`cards:${ns}.expandAll`)}
        </Button>
        <Button size="small" onClick={collapseAll}>
          {t(`cards:${ns}.collapseAll`)}
        </Button>
        <Button size="small" onClick={selectAllVisible} disabled={visibleCreatable.length === 0}>
          {t(`cards:${ns}.selectVisible`)}
        </Button>
        <Button size="small" onClick={clearSelection} disabled={selectionCount === 0}>
          {t(`cards:${ns}.clearSelection`)}
        </Button>
      </Stack>
      </Box>

      {roots.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6">{t(`cards:${ns}.noMatches`)}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t(`cards:${ns}.adjustFilters`)}
          </Typography>
        </Paper>
      ) : (
        <>
          {industryGroups.map(({ key, items }) => (
            <Box key={key} sx={{ mb: 3 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: "block", mb: 1, pl: 0.5, fontWeight: 700 }}
              >
                {key === "__none__" ? t(`cards:${ns}.industryGroupUnknown`) : key}
              </Typography>
              <div className="tcc-l1-grid">
                {items.map((r) => (
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
                    selectionColor={config.selectionColor}
                    expandLabel={t(`cards:${ns}.expandOneLevel`)}
                    collapseLabel={t(`cards:${ns}.collapseOneLevel`)}
                  />
                ))}
              </div>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}

interface L1CardProps {
  node: CatalogueNode;
  byParent: Map<string | null, CatalogueNode[]>;
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
  isSelectable: (cap: CatalogueNode) => boolean;
  selectionColor: string;
  expandLabel: string;
  collapseLabel: string;
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
  selectionColor,
  expandLabel,
  collapseLabel,
}: L1CardProps) {
  const kids = (byParent.get(node.id) ?? []).filter((c) => visible.has(c.id));
  const hasKids = kids.length > 0;
  const isOpen = expanded.has(node.id);
  const selfSelected = selected.has(node.id);
  const isExisting = !!node.existing_card_id;

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

  const canExpand = hasKids && openDepth < maxDepth;
  const canCollapse = openDepth > 0;

  const checkboxColor = `color-mix(in srgb, ${selectionColor} 55%, transparent)`;

  return (
    <section className={`tcc-l1-card${selfSelected ? " is-selected" : ""}`}>
      <header className="tcc-l1-header">
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
              color: checkboxColor,
              "&.Mui-checked, &.MuiCheckbox-indeterminate": { color: selectionColor },
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
              selectionColor={selectionColor}
              depth={1}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ChildRowProps {
  node: CatalogueNode;
  byParent: Map<string | null, CatalogueNode[]>;
  visible: Set<string>;
  expanded: Set<string>;
  selected: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  isSelectable: (cap: CatalogueNode) => boolean;
  selectionColor: string;
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
  selectionColor,
  depth,
}: ChildRowProps) {
  const kids = (byParent.get(node.id) ?? []).filter((c) => visible.has(c.id));
  const isOpen = expanded.has(node.id);
  const hasKids = kids.length > 0;
  const isExisting = !!node.existing_card_id;
  const selfSelected = selected.has(node.id);
  const isL2 = depth === 1;

  const checkboxColor = `color-mix(in srgb, ${selectionColor} 55%, transparent)`;

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
      sx={{
        p: 0.5,
        color: checkboxColor,
        "&.Mui-checked": { color: selectionColor },
      }}
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
              selectionColor={selectionColor}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
