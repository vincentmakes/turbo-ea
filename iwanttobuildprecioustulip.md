# Visual EA Diagram Editor — Metamodel-driven Sidebar & Inline Editing Plan

## Goal

1. **Make the diagram editor work with ANY metamodel**, not just ArchiMate.
   - Palette and Elements tree are driven entirely by the live metamodel (`useMetamodel()`).
   - **Only one metamodel is active at a time in the editor.** Mixing arch_* and standard types on the same canvas is not allowed.
   - **If both standard and ArchiMate card types are present**, a **mode switcher** appears at the top of the left sidebar letting the user pick which metamodel to use. Default: **standard (non-ArchiMate)**.
   - If only one metamodel is present, no switcher is shown.

2. **Add the Archi-style three-tab left sidebar**:
   - **Elements** tab — tree of existing cards matching the active metamodel, draggable onto canvas.
   - **Views** tab — list of all ArchiMate diagrams for navigation.
   - **Palette** tab — card type chips for the active metamodel only.

3. **Add inline node editing** — double-click a node label → `PATCH /cards/{id}`.

---

## Current vs Target

| Concern | Current | Target |
|---------|---------|--------|
| Palette source | Hardcoded `ARCHIMATE_ELEMENT_META` (arch_* only) | `useMetamodel()` types for the **active metamodel only**, grouped by `category` |
| Mode switcher | None | Appears when both standard and ArchiMate types coexist; defaults to standard |
| Elements tree | Does not exist | Cards matching the **active metamodel** only, grouped by type, draggable |
| Node rendering | ArchiMate-specific (layer color, aspect mark) for arch_* only | Smart: ArchiMate notation for arch_* types; card type color + icon for everything else |
| `NODE_TYPES` | Static map of arch_* keys | `useMemo` from metamodel: arch_* → `ArchimateElementNode`; standard → `GenericCardNode` |
| Mixed canvas | N/A | Not allowed — each diagram uses one metamodel only |
| Drop existing card | Not possible | `archimate/existing-card` drag data → place without creating new card |
| Drop new type | Creates arch_* card | Creates card of the active metamodel's type |
| Inline editing | Not supported | Double-click → `PATCH /cards/{id}` |

---

## Layout

```
┌─────────────────┬────────────────────────────────────────┐
│  Left Sidebar   │        Canvas (ReactFlow)               │
│   280px wide    │                                         │
│ ┌─────────────┐ │                                         │
│ │[EA] [ArchiM]│ │  ← mode switcher (only when both exist) │
│ └─────────────┘ │                                         │
│ [Elements][Views][Palette]                                │
│  ─────────      │  Nodes rendered with active-metamodel   │
│  Tab content    │  styling                                │
└─────────────────┴────────────────────────────────────────┘
```

The mode switcher is a `ToggleButtonGroup` (`"ea" | "archimate"`) at the very top of the sidebar. It is:
- **Hidden** when only one metamodel is available.
- **Visible** when `useMetamodel().types` contains both `arch_*` keys and standard keys.
- **Default**: `"ea"` (standard metamodel).
- Switching mode resets the active tab to "Elements" and clears the search input.

---

## Architecture: Metamodel-driven Rendering

### The problem with hardcoded `ARCHIMATE_ELEMENT_META`

Currently `NODE_TYPES`, `ArchimateElementPalette`, and `ArchimateCanvas` all import from the static `archimateShapes.ts` which only knows about `arch_*` keys. This breaks the moment a standard type (e.g., `Application`) is dropped onto the canvas.

### Solution: Two-tier node rendering

Every ReactFlow node has a `type` field that maps to a component in `NODE_TYPES`. We register two generic entries plus the arch-specific ones:

```
NODE_TYPES = {
  // ArchiMate-specific (from archimateShapes.ts — unchanged)
  arch_ApplicationComponent → ArchimateElementNode
  arch_BusinessProcess      → ArchimateElementNode
  arch_Grouping             → ArchimateGroupingNode
  arch_Junction             → ArchimateJunctionNode
  ... all other arch_* keys → ArchimateElementNode

  // Generic fallback for ANY metamodel type
  "generic"                 → GenericCardNode
}
```

When the editor mounts, it reads `useMetamodel().types` and for every non-arch type assigns `type: "generic"` on the node. The `GenericCardNode` receives `data.color` and `data.icon` (copied from the CardType at drop/load time) and renders a standard card.

For arch_* types, the node `type` remains the specific arch key so ArchiMate notation (aspect marks, layer colors) continues to work.

### `GenericCardNode` component

```tsx
// Renders a card as a colored box with the card type icon and label.
// Used for all non-ArchiMate card types.
function GenericCardNode({ data, selected }: NodeProps<ArchiMateDiagramNode>) {
  return (
    <Box sx={{
      width: data.width || 160, height: data.height || 60,
      background: data.color || "#e0e0e0",
      border: selected ? "2px solid #1976d2" : "1.5px solid rgba(0,0,0,0.25)",
      borderRadius: "4px",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      position: "relative",
    }}>
      {data.icon && (
        <Box sx={{ position: "absolute", top: 3, right: 5 }}>
          <MaterialSymbol icon={data.icon} size={12} color="rgba(0,0,0,0.4)" />
        </Box>
      )}
      <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "11px", textAlign: "center", px: 1 }}>
        {data.label}
      </Typography>
      {/* handles */}
    </Box>
  );
}
```

### `ArchiMateDiagramNodeData` additions

Add two optional fields to the existing interface (backward-compatible with saved diagrams):

```typescript
export interface ArchiMateDiagramNodeData extends Record<string, unknown> {
  label: string;
  elementTypeKey: string;
  cardId?: string;
  layer: ArchiMateLayer | string;   // widen to string for non-arch layers
  aspect: ArchiMateAspect | string; // widen to string
  color: string;
  width: number;
  height: number;
  icon?: string;   // NEW — card type icon for GenericCardNode
  // cardTypeName?: string; // optional, for tooltip
}
```

### `NODE_TYPES` — built once, not per-render

```typescript
// archimateNodes.tsx — export a stable base map for arch_* keys
export const ARCH_NODE_TYPES: Record<string, ComponentType<any>> = {
  ...Object.fromEntries(Object.keys(ARCHIMATE_ELEMENT_META).map((key) => {
    if (key === "arch_Grouping" || key === "arch_Location") return [key, ArchimateGroupingNode];
    if (key === "arch_Junction") return [key, ArchimateJunctionNode];
    return [key, ArchimateElementNode];
  })),
  generic: GenericCardNode,   // catch-all for standard metamodel types
};
```

In `ArchimateCanvas`, extend with metamodel types at mount time:

```typescript
const { types } = useMetamodel();
const nodeTypes = useMemo(() => {
  const extra: Record<string, ComponentType<any>> = {};
  for (const t of types) {
    if (!t.key.startsWith("arch_") && !ARCH_NODE_TYPES[t.key]) {
      extra[t.key] = GenericCardNode;
    }
  }
  return { ...ARCH_NODE_TYPES, ...extra };
}, [types]);
```

This is memoized on `types` (stable from the metamodel singleton cache) so it doesn't re-create on every render. ReactFlow accepts memoized `nodeTypes`.

---

## New and Changed Files

| File | Action | Purpose |
|------|--------|---------|
| `archimateNodes.tsx` | **Modify** | Add `GenericCardNode`; export `ARCH_NODE_TYPES` (stable base); add inline-edit logic |
| `ArchimateElementPalette.tsx` | **Rewrite** | Replace hardcoded `ARCHIMATE_ELEMENT_META` loop with `useMetamodel()` types grouped by `category` |
| `ArchimateLeftSidebar.tsx` | **New** | Three-tab shell: Elements / Views / Palette |
| `ArchimateElementsTree.tsx` | **New** | Inventory tree, ALL card types, search, draggable rows, "already on canvas" indicator |
| `ArchimateViewsTree.tsx` | **New** | List of ArchiMate diagrams with navigation |
| `ArchimateCanvas.tsx` | **Modify** | Build `nodeTypes` from metamodel; handle `archimate/existing-card` drop; fix drop coordinates; expose `nodeCardIds`; use `rfInstance.screenToFlowPosition()` |
| `ArchimateDiagramEditor.tsx` | **Modify** | Use `ArchimateLeftSidebar`; thread `nodeCardIds` state |
| `types.ts` | **Modify** | Widen `layer`/`aspect` to `string`; add `icon?` to node data; add `ExistingCardDrop` interface |

No new backend endpoints. No changes to `archimateShapes.ts` (ArchiMate-specific metadata stays as-is).

---

## Phase 1 — `ArchimateElementPalette.tsx` — Rewrite to Metamodel-driven

**Replace hardcoded arch_* loop with `activeTypes` prop passed from the sidebar.**
The palette no longer calls `useMetamodel()` itself — the sidebar owns mode selection and passes filtered types down.

### New prop
```typescript
interface Props {
  activeTypes: CardType[];   // pre-filtered to the active metamodel by ArchimateLeftSidebar
}
```

### After
```tsx
export function ArchimateElementPalette({ activeTypes }: Props) {
  const rml = useResolveMetaLabel();

  // Group by category; preserve insertion order
  const groups = useMemo(() => {
    const map = new Map<string, CardType[]>();
    for (const t of activeTypes) {
      const cat = t.category ?? "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(t);
    }
    return Array.from(map.entries()).map(([category, cardTypes]) => ({
      category,
      cardTypes: cardTypes.sort((a, b) => a.sort_order - b.sort_order),
    }));
  }, [activeTypes]);

  // Derive a display color for each group header from its first type
  // ArchiMate categories use ARCHIMATE_LAYER_COLORS; others use the type color

  return (
    <Box sx={{ width: "100%", height: "100%", overflowY: "auto" }}>
      {loading && <CircularProgress size={16} sx={{ m: 2 }} />}
      {groups.map(({ category, cardTypes }) => (
        <Accordion key={category} defaultExpanded={false} ...>
          <AccordionSummary>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "2px", background: groupColor(category, cardTypes) }} />
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "11px" }}>
                {displayCategory(category)}   {/* strips "ArchiMate:" prefix for display */}
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 1 }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {cardTypes.map((ct) => (
                <Chip
                  key={ct.key}
                  label={rml(ct.key, ct.translations, "label")}
                  size="small"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("archimate/element-type", ct.key);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  sx={{
                    fontSize: "10px", height: 22, cursor: "grab",
                    background: `${ct.color}cc`,
                    "&:hover": { background: ct.color },
                  }}
                />
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
```

**`displayCategory(category)`**: strips the `"ArchiMate:"` prefix for display. `"ArchiMate:Application"` → `"Application"`. `"Application & Data"` → `"Application & Data"`.

**`groupColor(category, cardTypes)`**: if `category.startsWith("ArchiMate:")`, look up `ARCHIMATE_LAYER_COLORS` by the layer name after the colon. Otherwise use `cardTypes[0].color`.

### Tests (`ArchimateElementPalette.test.tsx` — update)
- Renders groups from metamodel, not hardcoded arch_* groups
- "Application & Data" group appears when standard metamodel is active
- "Application" group (ArchiMate) appears when ArchiMate is active
- Dragging a standard type chip sets `archimate/element-type` to the type key

---

## Phase 2 — `ArchimateElementsTree.tsx` — All Card Types

**Shows all inventory cards for ALL active card types.**

### Data fetching
- Load all non-hidden `CardType[]` from `useMetamodel()` to know the available groups.
- Load cards via `useCardSearch` — `enabled=true` always, `types=[]` (no filter = all types), `pageSize=500`.
- On search input change: pass `search` to `useCardSearch`.

### Tree structure
```
[Search: ________________]

▼ Application & Data                   ← category group header
    ▼ Application  (12)                ← card type sub-group
        ○ SAP S/4HANA           [✓]    ← card row (✓ = already on canvas)
        ○ NexaCore ERP
    ▼ Data Object  (3)
        ○ Customer Master

▶ Business Architecture  (8)
▶ Technical Architecture  (6)

▼ ArchiMate: Application               ← only if ArchiMate enabled
    ▶ Application Component  (4)
    ▶ Application Service  (2)
```

- Top-level groups: unique `category` values from the metamodel, sorted by first type's `sort_order`.
- Second level: `CardType` sub-groups within the category.
- Third level: individual `Card` rows.
- `nodeCardIds` prop: cards with matching ID get a `✓` chip + 60% opacity.
- Cards are still draggable even if already on canvas (user might want to place same card in a second diagram view).

### Drag data
```typescript
e.dataTransfer.setData(
  "archimate/existing-card",
  JSON.stringify({ cardId: card.id, typeKey: card.type, name: card.name }),
);
```

### Performance
- `useCardSearch` with `pageSize=500` covers most installs in one round-trip.
- The tree renders all groups as virtualized accordions — collapsed by default. Only the first non-empty category is expanded.
- Search is live-filtered client-side against the already-loaded `items` array (no extra API call per keystroke), with a separate `debouncedSearch` passed to `useCardSearch` for server-side filtering when >500 cards.

### Props
```typescript
interface Props {
  activeTypes: CardType[];      // pre-filtered to active metamodel by ArchimateLeftSidebar
  nodeCardIds: Set<string>;
  search: string;               // controlled by sidebar (cleared on mode switch)
  onSearchChange: (v: string) => void;
}
```

The tree filters its loaded cards client-side using the `activeTypes` key set — only cards whose `type` is in `activeTypes` are shown. The `useCardSearch` query uses `types: activeTypes.map(t => t.key)` so the server also filters, keeping the payload small.

### Tests (`ArchimateElementsTree.test.tsx`)
- Renders category group headings from metamodel
- Search narrows visible items
- Cards in `nodeCardIds` have aria-label containing "already in diagram"
- Dragging sets `archimate/existing-card` dataTransfer
- Non-arch card types appear in "EA Cards" / their own category group

---

## Phase 3 — `ArchimateViewsTree.tsx`

**Unchanged from previous plan** — lists all ArchiMate diagrams, current highlighted, click to navigate, "+ New Diagram" button.

---

## Phase 4 — `ArchimateLeftSidebar.tsx`

**Three-tab shell with optional mode switcher at top.**

```tsx
type DiagramMode = "ea" | "archimate";

export function ArchimateLeftSidebar({ currentDiagramId, nodeCardIds }: Props) {
  const { types } = useMetamodel();
  const [tab, setTab] = useState<"elements" | "views" | "palette">("elements");
  const [search, setSearch] = useState("");

  // Detect which metamodels are present
  const hasArch     = useMemo(() => types.some((t) => t.key.startsWith("arch_") && !t.is_hidden), [types]);
  const hasStandard = useMemo(() => types.some((t) => !t.key.startsWith("arch_") && !t.is_hidden), [types]);
  const showSwitcher = hasArch && hasStandard;

  // Default to standard (non-ArchiMate)
  const [mode, setMode] = useState<DiagramMode>("ea");

  // Derive the active card types for this mode
  const activeTypes = useMemo(
    () => types.filter((t) => !t.is_hidden && (mode === "archimate" ? t.key.startsWith("arch_") : !t.key.startsWith("arch_"))),
    [types, mode],
  );

  const handleModeChange = (_: unknown, next: DiagramMode | null) => {
    if (!next) return;           // ToggleButtonGroup won't deselect both
    setMode(next);
    setTab("elements");          // reset to Elements tab on mode switch
    setSearch("");
  };

  return (
    <Box sx={{ width: 280, height: "100%", display: "flex", flexDirection: "column",
               borderRight: "1px solid", borderColor: "divider", flexShrink: 0 }}>

      {/* Mode switcher — only when both metamodels coexist */}
      {showSwitcher && (
        <Box sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          <ToggleButtonGroup value={mode} exclusive onChange={handleModeChange} size="small" fullWidth>
            <ToggleButton value="ea" sx={{ fontSize: "11px", py: 0.5 }}>
              EA Cards
            </ToggleButton>
            <ToggleButton value="archimate" sx={{ fontSize: "11px", py: 0.5 }}>
              ArchiMate
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}

      {/* Tab bar */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth"
            sx={{ borderBottom: 1, borderColor: "divider", minHeight: 36 }}>
        <Tab value="elements" label="Elements" sx={{ fontSize: "11px", minHeight: 36 }} />
        <Tab value="views"    label="Views"    sx={{ fontSize: "11px", minHeight: 36 }} />
        <Tab value="palette"  label="Palette"  sx={{ fontSize: "11px", minHeight: 36 }} />
      </Tabs>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        {tab === "elements" && (
          <ArchimateElementsTree
            activeTypes={activeTypes}
            nodeCardIds={nodeCardIds}
            search={search}
            onSearchChange={setSearch}
          />
        )}
        {tab === "views" && <ArchimateViewsTree currentDiagramId={currentDiagramId} />}
        {tab === "palette" && <ArchimateElementPalette activeTypes={activeTypes} />}
      </Box>
    </Box>
  );
}
```

**`activeTypes`** is the filtered `CardType[]` matching the current mode. It is passed down to both `ArchimateElementsTree` and `ArchimateElementPalette` so they never need to know about the mode themselves — they just render whatever types they receive.

### Tests (`ArchimateLeftSidebar.test.tsx`)
- Switcher is hidden when only standard types exist
- Switcher is hidden when only ArchiMate types exist
- Switcher is visible when both exist; defaults to "ea"
- Switching to "archimate" passes only arch_* types to children
- Switching mode resets tab to "elements"

---

## Phase 5 — `ArchimateCanvas.tsx` — Generic Drop Handler + Dynamic `nodeTypes`

### Build `nodeTypes` from metamodel

```typescript
const { types } = useMetamodel();
const nodeTypes = useMemo(() => {
  const extra: Record<string, ComponentType<any>> = {};
  for (const t of types) {
    if (!t.is_hidden && !ARCH_NODE_TYPES[t.key]) {
      extra[t.key] = GenericCardNode;
    }
  }
  return { ...ARCH_NODE_TYPES, ...extra };
}, [types]);
```

Pass `nodeTypes` to `<ReactFlow nodeTypes={nodeTypes} ...>`.

### Extended `onDrop` for existing-card drag

```typescript
const existingCardJson = event.dataTransfer.getData("archimate/existing-card");
if (existingCardJson) {
  const { cardId, typeKey, name } = JSON.parse(existingCardJson) as ExistingCardDrop;

  // Duplicate guard
  if (nodes.some((n) => n.data.cardId === cardId || n.id === cardId)) {
    setDuplicateToast(true);
    return;
  }

  // Metamodel mismatch guard — prevent mixing arch_* and standard types on one canvas
  const isArchDrop    = typeKey.startsWith("arch_");
  const canvasHasArch = nodes.some((n) => n.data.elementTypeKey?.startsWith("arch_"));
  const canvasHasStd  = nodes.some((n) => !n.data.elementTypeKey?.startsWith("arch_"));
  if ((isArchDrop && canvasHasStd) || (!isArchDrop && canvasHasArch)) {
    setMixedMetamodelToast(true);   // "Switch to ArchiMate mode before dropping this card"
    return;
  }

  // Determine rendering: ArchiMate or Generic
  const archMeta = ARCHIMATE_ELEMENT_META[typeKey];
  const ct = getType(typeKey);   // from useMetamodel()
  const position = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });

  const newNode: ArchiMateDiagramNode = {
    id: cardId,
    type: archMeta ? typeKey : (typeKey in nodeTypes ? typeKey : "generic"),
    position,
    data: {
      label: name,
      elementTypeKey: typeKey,
      cardId,
      layer: archMeta?.layer ?? ct?.category ?? "Other",
      aspect: archMeta?.aspect ?? "Other",
      color: archMeta?.defaultColor ?? ct?.color ?? "#e0e0e0",
      icon: ct?.icon,           // for GenericCardNode
      width: archMeta?.defaultWidth ?? 160,
      height: archMeta?.defaultHeight ?? 60,
    },
  };

  setNodes((nds) => [...nds, newNode]);
  scheduleSave([...nodes, newNode], edges);
  return;
}
```

### Extended `onDrop` for new-type drag (palette)

Same change: use `rfInstance.screenToFlowPosition()` for coordinates. For non-arch types, determine `type` as the typeKey (registered via `nodeTypes` above) or `"generic"`.

```typescript
const typeKey = event.dataTransfer.getData("archimate/element-type");
if (!typeKey) return;

const archMeta = ARCHIMATE_ELEMENT_META[typeKey];
const ct = getType(typeKey);
const position = rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
const label = rml(typeKey, ct?.translations, "label") ?? typeKey.replace("arch_", "").replace(/([A-Z])/g, " $1").trim();
const tempId = `temp-${Date.now()}`;

const newNode: ArchiMateDiagramNode = {
  id: tempId,
  type: archMeta ? typeKey : (typeKey in nodeTypes ? typeKey : "generic"),
  position,
  data: {
    label,
    elementTypeKey: typeKey,
    layer: archMeta?.layer ?? ct?.category ?? "Other",
    aspect: archMeta?.aspect ?? "Other",
    color: archMeta?.defaultColor ?? ct?.color ?? "#e0e0e0",
    icon: ct?.icon,
    width: archMeta?.defaultWidth ?? 160,
    height: archMeta?.defaultHeight ?? 60,
  },
};

setNodes((nds) => [...nds, newNode]);

// Create backing card
try {
  const card = await api.post("/cards", { type_key: typeKey, name: label }) as { id: string; name: string };
  setNodes((nds) => nds.map((n) =>
    n.id === tempId ? { ...n, id: card.id, data: { ...n.data, cardId: card.id, label: card.name } } : n
  ));
} catch {
  // keep optimistic node
}
```

### `nodeCardIds` emitted upward

```typescript
const { getType } = useMetamodel();

useEffect(() => {
  const ids = new Set(nodes.flatMap((n) => [n.data.cardId, n.id]).filter(Boolean) as string[]);
  onNodeCardIdsChange?.(ids);
}, [nodes, onNodeCardIdsChange]);
```

---

## Phase 6 — `archimateNodes.tsx` — Add `GenericCardNode` + Inline Edit

### `GenericCardNode`

```tsx
export function GenericCardNode({ id, data, selected }: NodeProps<ArchiMateDiagramNode>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const { updateNodeData } = useReactFlow();

  const confirmEdit = async () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === data.label) return;
    updateNodeData(id, { label: trimmed });
    if (data.cardId) {
      try { await api.patch(`/cards/${data.cardId}`, { name: trimmed }); }
      catch { updateNodeData(id, { label: data.label }); }
    }
  };

  return (
    <Box
      sx={{ width: data.width || 160, height: data.height || 60,
            background: data.color || "#e0e0e0",
            border: selected ? "2px solid #1976d2" : "1.5px solid rgba(0,0,0,0.25)",
            borderRadius: "4px", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", position: "relative" }}
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(data.label); setEditing(true); }}
    >
      {data.icon && (
        <Box sx={{ position: "absolute", top: 3, right: 5 }}>
          <MaterialSymbol icon={data.icon as string} size={12} color="rgba(0,0,0,0.4)" />
        </Box>
      )}
      {editing ? (
        <input
          className="nodrag nopan"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={confirmEdit}
          onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") { setEditing(false); setDraft(data.label); } }}
          style={{ width: "90%", textAlign: "center", fontSize: 11, fontWeight: 600,
                   background: "transparent", border: "none", outline: "1px solid #1976d2",
                   borderRadius: 2, padding: "0 4px" }}
        />
      ) : (
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "11px", textAlign: "center", px: 1 }}>
          {data.label}
        </Typography>
      )}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </Box>
  );
}
```

### Same inline-edit logic added to `ArchimateElementNode`

`ArchimateElementNode` gets identical double-click inline edit — same `editing` state, same `confirmEdit`, same `nodrag nopan` input. The only difference is the node still uses ArchiMate styling (aspect marks, layer colors).

`ArchimateGroupingNode` also gets inline editing for group name.

### Updated `ARCH_NODE_TYPES` export

```typescript
export const ARCH_NODE_TYPES: Record<string, ComponentType<any>> = {
  ...Object.fromEntries(Object.keys(ARCHIMATE_ELEMENT_META).map((key) => {
    if (key === "arch_Grouping" || key === "arch_Location") return [key, ArchimateGroupingNode];
    if (key === "arch_Junction") return [key, ArchimateJunctionNode];
    return [key, ArchimateElementNode];
  })),
  generic: GenericCardNode,
};
```

Old `NODE_TYPES` export renamed to `ARCH_NODE_TYPES` — canvas builds the final map dynamically.

---

## Phase 7 — `ArchimateDiagramEditor.tsx`

```tsx
const [nodeCardIds, setNodeCardIds] = useState<Set<string>>(new Set());

return (
  <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
    <AppBar .../>
    <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <ArchimateLeftSidebar
        currentDiagramId={id!}
        nodeCardIds={nodeCardIds}
      />
      <ReactFlowProvider>
        <ArchimateCanvas
          diagramId={id!}
          initialData={initialData}
          onSave={handleSave}
          onNodeCardIdsChange={setNodeCardIds}
        />
      </ReactFlowProvider>
    </Box>
  </Box>
);
```

---

## Phase 8 — `types.ts` additions

```typescript
// Widen existing fields so standard EA types work
export interface ArchiMateDiagramNodeData extends Record<string, unknown> {
  label: string;
  elementTypeKey: string;
  cardId?: string;
  layer: ArchiMateLayer | string;   // ArchiMate layer OR category string
  aspect: ArchiMateAspect | string; // ArchiMate aspect OR "Other"
  color: string;
  width: number;
  height: number;
  icon?: string;                    // NEW — card type icon for GenericCardNode
}

// NEW
export interface ExistingCardDrop {
  cardId: string;
  typeKey: string;
  name: string;
}
```

---

## Phase 9 — i18n

Add to `en/archimate.json` and all 7 non-English locales:

```json
{
  "sidebar": {
    "elementsTab": "Elements",
    "viewsTab": "Views",
    "paletteTab": "Palette",
    "searchPlaceholder": "Search cards…",
    "alreadyInDiagram": "Already in diagram",
    "newDiagram": "New Diagram",
    "noCards": "No cards found",
    "loadingCards": "Loading…",
    "categoryOther": "Other"
  },
  "canvas": {
    "duplicateCard": "This card is already in the diagram",
    "editNodeHint": "Double-click to rename"
  }
}
```

---

## Implementation Commits (in order)

| # | Commit | Files |
|---|--------|-------|
| 1 | `feat(archimate): GenericCardNode for non-ArchiMate card types + inline edit on all nodes` | `archimateNodes.tsx` + tests |
| 2 | `feat(archimate): palette reads live metamodel (category-grouped), not hardcoded arch_* list` | `ArchimateElementPalette.tsx` + tests |
| 3 | `feat(archimate): ArchimateElementsTree — all card types, drag existing cards onto canvas` | `ArchimateElementsTree.tsx` + tests |
| 4 | `feat(archimate): ArchimateViewsTree — in-editor diagram navigation` | `ArchimateViewsTree.tsx` + tests |
| 5 | `feat(archimate): ArchimateLeftSidebar — three-tab shell with metamodel mode switcher` | `ArchimateLeftSidebar.tsx` + tests |
| 6 | `feat(archimate): canvas — dynamic nodeTypes from metamodel, existing-card drop, coordinate fix` | `ArchimateCanvas.tsx`, `types.ts` |
| 7 | `feat(archimate): wire ArchimateLeftSidebar into diagram editor` | `ArchimateDiagramEditor.tsx` |
| 8 | `feat(archimate): i18n for sidebar and canvas` | all 8 locale `archimate.json` files |
| 9 | `test(e2e): update ArchiMate diagram-editor E2E for new sidebar and generic card types` | `e2e/tests/archimate/diagram-editor.spec.ts` |

---

## Key Invariants

- **One metamodel at a time**: a single diagram canvas only ever contains nodes from one metamodel (all arch_* or all standard). The canvas `onDrop` enforces this with a mismatch guard. The sidebar mode switcher makes it obvious which mode is active.
- **Default to standard (non-ArchiMate)**: when both metamodels are present, the sidebar defaults to `mode = "ea"`. The user must explicitly switch to ArchiMate mode.
- **Switcher only when needed**: the `ToggleButtonGroup` is only rendered when `useMetamodel()` returns both arch_* and non-arch_* non-hidden types. Single-metamodel installs see a clean sidebar with no switcher.
- **`activeTypes` flows top-down**: `ArchimateLeftSidebar` owns mode state and passes a pre-filtered `activeTypes: CardType[]` to both `ArchimateElementPalette` and `ArchimateElementsTree`. Neither child knows about mode selection.
- **Metamodel-driven, not hardcoded**: palette and elements tree react instantly to new card types added via admin.
- **No double-creation**: dropping an existing card never calls `POST /cards`. Only palette drops create new cards.
- **No duplicate nodes per diagram**: same `cardId` cannot appear twice. Enforced in `onDrop` with early-return + toast.
- **ArchiMate notation preserved**: arch_* types use `ArchimateElementNode` (layer colors, aspect marks). Standard types use `GenericCardNode` (card type color + icon). Discriminator: presence in `ARCHIMATE_ELEMENT_META`.
- **Backward-compatible saved diagrams**: existing saved diagrams with arch_* node types continue to load correctly. The mismatch guard applies only to new drops, not to loading.
- **Inline edit optimistic**: label updates immediately; `PATCH /cards/{id}` async; reverts on error.
- **`useCardSearch` reused as-is**: from `features/diagrams/useCardSearch.ts` — no duplication.
- **`nodeTypes` stable**: built via `useMemo` on `types` (singleton cache) — re-renders only when metamodel changes, which is rare.
