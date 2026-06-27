# Turbo EA — UI Guidelines

> Codified rules for the Turbo EA frontend. The aim is **consistency**, not change — every value in this doc matches what the running app already uses.

These guidelines are influenced by [Material Design 3](https://m3.material.io/), [Atlassian Design System](https://atlassian.design/), and [Shopify Polaris](https://polaris.shopify.com/) — semantic naming, predictable patterns, accessibility-first.

---

## 1. Principles

1. **MUI 6 first.** Use the component, prop, and `sx` system that ships with MUI. Don't introduce other UI libraries.
2. **Semantic naming.** A token name says what something *is*, not what it *looks like*. Use `STATUS_COLORS.success`, never `green`.
3. **Single source of truth.** All design values live in `src/theme/tokens.ts`. No raw hex codes in feature components.
4. **Accessibility.** Aim for WCAG AA contrast. Always provide visible focus states. Translate every user-visible string.
5. **Don't reinvent.** If a pattern exists (`MetricCard`, `ApprovalStatusBadge`, `LifecycleBadge`, `ReportShell`), use it.

---

## 2. Design Tokens

All tokens are exported from [`src/theme/tokens.ts`](./src/theme/tokens.ts) and re-exported from `src/theme/index.ts`.

```ts
import { STATUS_COLORS, SEVERITY_COLORS, APPROVAL_STATUS_COLORS,
         LAYER_COLORS, CARD_TYPE_COLORS, brand, iconSize } from "@/theme/tokens";
```

### 2.1 Brand & Surface

| Token | Hex | Use |
| --- | --- | --- |
| `brand.primary` | `#1976d2` | Primary action color, focus rings, active links |
| `surface.light.default` | `#fafbfc` | Page background (light mode) |
| `surface.light.paper` | `#ffffff` | Surface background (light mode) |
| `surface.dark.default` | `#121212` | Page background (dark mode) |
| `surface.dark.paper` | `#1e1e1e` | Surface background (dark mode) |

### 2.2 Status

The four MUI status hues. Wired into `palette.success/warning/error/info`, so `<Chip color="success">`, `<Alert severity="error">`, `<Button color="warning">` etc. resolve to these values.

| Token | Hex | Use |
| --- | --- | --- |
| `STATUS_COLORS.success` | `#4caf50` | Approved, healthy, completed, low risk |
| `STATUS_COLORS.warning` | `#ff9800` | Broken, at risk, in progress, action needed |
| `STATUS_COLORS.error` | `#f44336` | Rejected, blocked, failed, high risk |
| `STATUS_COLORS.info` | `#2196f3` | Informational, neutral feedback |
| `STATUS_COLORS.neutral` | `#9e9e9e` | Draft, not set, archived |

### 2.3 Approval Status

| Token | Hex |
| --- | --- |
| `APPROVAL_STATUS_COLORS.DRAFT` | `#9e9e9e` |
| `APPROVAL_STATUS_COLORS.APPROVED` | `#4caf50` |
| `APPROVAL_STATUS_COLORS.BROKEN` | `#ff9800` |
| `APPROVAL_STATUS_COLORS.REJECTED` | `#f44336` |

Use `ApprovalStatusBadge` rather than reading the map directly when you can.

### 2.4 Severity & Priority (4-step scale)

Same scale used for: PPM task priority, TurboLens findings, risk severity.

| Token | Hex |
| --- | --- |
| `SEVERITY_COLORS.critical` | `#d32f2f` |
| `SEVERITY_COLORS.high` | `#f57c00` |
| `SEVERITY_COLORS.medium` | `#fbc02d` |
| `SEVERITY_COLORS.low` | `#66bb6a` |

`PRIORITY_COLORS` is an alias for `SEVERITY_COLORS`.

### 2.5 Health & RAG

| Token | Hex | Use |
| --- | --- | --- |
| `HEALTH_COLORS.good` | `#4caf50` | On track |
| `HEALTH_COLORS.warn` | `#ff9800` | At risk |
| `HEALTH_COLORS.bad` | `#f44336` | Off track |
| `RAG_COLORS.green` | `#2e7d32` | Status report — green |
| `RAG_COLORS.amber` | `#f57c00` | Status report — amber |
| `RAG_COLORS.red` | `#d32f2f` | Status report — red |

### 2.6 Card Types (14 — fallbacks)

Runtime-canonical values come from the per-type metamodel config (admin-editable). These are **fallbacks** for static contexts (legend keys, code that runs before the metamodel loads).

| Type | Hex | Type | Hex |
| --- | --- | --- | --- |
| `Objective` | `#c7527d` | `Application` | `#0f7eb5` |
| `Platform` | `#027446` | `Interface` | `#02afa4` |
| `Initiative` | `#33cc58` | `DataObject` | `#774fcc` |
| `Organization` | `#2889ff` | `ITComponent` | `#d29270` |
| `BusinessCapability` | `#003399` | `TechCategory` | `#a6566d` |
| `BusinessContext` | `#fe6690` | `Provider` | `#ffa31f` |
| `BusinessProcess` | `#028f00` | `System` | `#5B738B` |

In components, prefer `useMetamodel().getType(typeKey)?.color` for runtime accuracy.

### 2.7 EA Layers (4)

| Layer | Hex |
| --- | --- |
| Strategy & Transformation | `#33cc58` |
| Business Architecture | `#2889ff` |
| Application & Data | `#0f7eb5` |
| Technical Architecture | `#d29270` |

### 2.8 Spacing, Radius, Icons

| Token | Value | Notes |
| --- | --- | --- |
| MUI spacing unit | 8 px | `sx={{ p: 2 }}` = 16 px. Never use `gap: "4px"` — use `gap: 0.5`. |
| `spacing.xs` … `xl` | 0.5 / 1 / 1.5 / 2 / 3 | Aliases for the scale below |
| `radius.sm` / `md` / `lg` | 4 / 8 / 12 px | Border radius |
| `iconSize.xs` … `xl` | 16 / 18 / 20 / 24 / 32 px | `<MaterialSymbol size={iconSize.md}/>` |

Section spacing is `mb: 2`. Inline element gap is `gap: 1` or `gap: 1.5`.

### 2.9 Typography

| Token | Size / Weight | Use |
| --- | --- | --- |
| `typography.fontFamily` | `'Inter', sans-serif` | All text |
| `typography.h1` | 2 rem / 600 | Page title (rare; usually h5/h6 is enough) |
| `typography.h2` | 1.5 rem / 600 | Major section header |
| `typography.h3` | 1.25 rem / 600 | Subsection |

Default page header is `<Typography variant="h5">`. Use `variant="h6"` for in-card headers, `variant="subtitle2"` for tile labels.

---

## 3. Layout Patterns

### 3.1 Page

```
┌────────────────────────────────────┐
│ Page header  (h5)         ⟨actions⟩│
├────────────────────────────────────┤
│ ⟨optional Tabs⟩                    │
├────────────────────────────────────┤
│ Section A                          │
│   ⟨content⟩                  mb: 2 │
│ Section B                          │
│   ⟨content⟩                        │
└────────────────────────────────────┘
```

- Outer container: `<Box>` or `<Container>` with default page padding.
- Section spacing: `mb: 2` (16 px).
- Tabs: `<Tabs variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>`.

### 3.2 Cards (UI surfaces)

| Use | Component |
| --- | --- |
| KPI / metric tile | `<MetricCard/>` (already a styled `Paper variant="outlined"`) |
| Generic surface | `<Card>` (configured to default to `variant="outlined"`) |
| Drag-and-drop card | `<Paper elevation={1}>` with hover elevation |

Do **not** mix `<Paper elevation={…}>` and `<Card>` in the same surface family — pick one.

### 3.3 Buttons

| Variant | Use | Example |
| --- | --- | --- |
| `contained` | The single primary action on a surface | Save, Create, Apply |
| `outlined` | Secondary action | Cancel (in dialogs), Export |
| `text` | Tertiary or in-row action | Reset, Edit (in tables) |

Always include `startIcon={<MaterialSymbol icon="…" size={iconSize.sm} />}` rather than using a raw SVG. One contained button per surface.

### 3.4 Dialogs

```tsx
<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
  <DialogTitle>{t("…")}</DialogTitle>
  <DialogContent>{/* default padding */}</DialogContent>
  <DialogActions>
    <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
    <Button variant="contained" onClick={onSave}>{t("common:actions.save")}</Button>
  </DialogActions>
</Dialog>
```

- Use the default `DialogContent` padding. The only documented exception is `SearchDialog` (a command palette).
- Nested dialogs must use `disableRestoreFocus` to avoid `aria-hidden` focus warnings.

### 3.5 Forms

- `<TextField>`, `<Select>`, `<Autocomplete>` are full-width inside dialogs and detail panels.
- `size="small"` is reserved for **dense toolbars** and inline cell editors — not for dialog forms.
- Stack fields with `<Stack spacing={2}>` or `<Box display="flex" flexDirection="column" gap={2}>`.

### 3.6 Tables & Grids

| Use | Component |
| --- | --- |
| Inventory, large data tables, sort/filter | AG Grid (`ag-theme-quartz`) |
| Small lists (≤ 30 rows), simple layouts | MUI `<Table>` |

For MUI tables, table headers use `bgcolor: "action.hover"` for subtle distinction.

### 3.7 Status Representation

Always render status through one of these:

| Pattern | Use |
| --- | --- |
| `<ApprovalStatusBadge/>` | `approval_status` on cards |
| `<LifecycleBadge/>` | Lifecycle phase |
| `<Chip color="success" \| "warning" \| "error" \| "info">` | Generic status |
| `<Chip sx={{ bgcolor: TOKEN }}>` | Custom hue from a token (last resort) |

**Never** redeclare status colors inline. If a new status family is needed, add it to `tokens.ts`.

### 3.8 Loading, Empty, Error

| State | Component |
| --- | --- |
| Page-level load | `<CircularProgress/>` centered in a `min-height` Box |
| Inline / top-of-section progress | `<LinearProgress/>` |
| Empty list | Centered `<Typography variant="body2" color="text.secondary">` |
| Recoverable error | `<Alert severity="error">` |

Skeleton loaders are not used today — that's a deliberate choice. If introduced, add a section here.

### 3.9 Icons

- Use `<MaterialSymbol icon="..." size={...} color={...}/>` — never raw SVG.
- Sizes come from `iconSize` (16 / 18 / 20 / 24 / 32). Pick the closest existing size; don't introduce new ones.
- Pass `color` from a token or theme palette key (e.g. `color="action.active"`), not a hex.

### 3.10 Layered Dependency View

The **Layered Dependency View (LDV)** is Turbo EA's house notation for showing dependencies between cards. It is used in:

- The **Dependencies Report** (`/reports/dependencies`)
- The **Card Detail** dependency section (the immediate neighbourhood of one card)
- The **TurboLens Architect** target architecture (existing + proposed cards)

It is implemented by `C4DiagramView` and `c4Layout` (file names retained for backwards compatibility — the public name of the view is **Layered Dependency View**).

**Grouping — the four EA layers, fixed order**

Cards are grouped into swim-lane boundaries representing the four metamodel layers:

1. **Strategy & Transformation** — Objective, Platform, Initiative
2. **Business Architecture** — Organization, Business Capability, Business Context, Business Process
3. **Application & Data** — Application, Interface, Data Object
4. **Technical Architecture** — IT Component, Tech Category, Provider

Layer order is invariant. Layer color = `LAYER_COLORS[layer]` from `theme/tokens.ts`.

**Nodes**

| Property | Convention |
| --- | --- |
| Shape | Rounded rectangle, 200 × 72 px (`C4_NODE_W`, `C4_NODE_H` in `c4Layout.ts`) |
| Color | Card type color from the metamodel (`CARD_TYPE_COLORS` / type record) |
| Label | Card name (top, semibold) + card-type label (bottom, italic) |
| Border — existing | 1.5 px solid, type color |
| Border — proposed | 2 px dashed, type color, plus a green **NEW** badge top-right |
| Hover | Connected nodes stay full opacity; unconnected nodes dim to 0.35 |

**Edges**

| Property | Convention |
| --- | --- |
| Routing | Smooth-step (curved, orthogonal) |
| Direction | Always source → target as defined in the metamodel `relation_type` |
| Label | Forward label of the relation type (e.g. *uses*, *supports*, *runs on*) |
| Style — idle | 1.5 px dashed (5 / 3 px) |
| Style — hovered | 2 px solid, label background gains opacity |
| Cross-layer | Mirrored top/bottom handles so the line stays orthogonal |

**Layout**

- Within each layer: Dagre graph layout for connected nodes; grid layout (max 3 columns) for disconnected nodes.
- Between layers: vertical stacking with a 72 px gap, in the fixed order above.

**Interaction & toolbar** (`LayeredDependencyView.tsx`)

The view ships with a top-bar toolbar and is directly manipulable:

- **Drag** any card to rearrange it; **Reset layout** restores the automatic Dagre arrangement and re-fits. Manual positions are session-only and reset when the underlying graph changes (navigation / new data).
- **Fullscreen** uses the browser Fullscreen API on the view container. MUI overlays (settings popover, export menu) are portalled into the container while fullscreen so they remain visible.
- **Export** renders the whole graph (not just the visible viewport) to **PNG** or **SVG** via `html-to-image` + `getViewportForBounds`.
- **Background** cycles dots → grid → none. Default is **dots**.
- **Card display** menu: toggle the type label, toggle a lifecycle-status dot (`getCurrentPhase`), toggle **hierarchy markers** (a small chevron on a card that has a parent / children not currently on the diagram — purely informational, computed from `parent_id` + a consumer-supplied `hasChildren` flag, and disappears once the parent/child is revealed), and pick extra attribute fields. The first two chosen fields render on the card body; the full set (plus type and lifecycle) appears in the card's hover tooltip. Settings persist to `localStorage` (`tea.ldv.display.*`). Note the split of concerns: the **top-bar Card display menu controls what's drawn on cards**; the **bottom-left toolbar controls exploration** (Highlight / Expand / Reveal parent / Reveal children).
- **Bottom-left `Controls` are split into two groups** by a divider rule: a **view group** (**Fullscreen**, then zoom +/-, **Re-center**, **Reset view**) and an **exploration group** (Highlight / Expand / Reveal parent / Reveal children). Reset and Fullscreen live here, not in the top bar. The whole panel is hand-ordered: default zoom + fitView are disabled (`showZoom={false} showFitView={false}`) and every button is a custom `ControlButton`, so Fullscreen can sit first and the fitView frame icon (too like Fullscreen) is swapped for a map-pin. The divider is a full-width inline-styled `<div>` — a filled light-grey band with thin top/bottom rules (an earlier bare 1px line with margins let the canvas show through and read as a glitch).
  - **Fullscreen** (`fullscreen` / `fullscreen_exit`, first button): toggles fullscreen on the view container.
  - **Re-center** (`location_on` map-pin): custom `fitView()` button — the stock frame icon read too much like the Fullscreen button.
  - **Reset view** (`restart_alt`): a *full* reset, not just a layout reset — it undoes manual drags **and** calls the consumer's `onReset` to clear all exploration (expand + reveals) and navigation history, returning to the base centre.
- **Interaction / exploration modes** (mutually exclusive, click again to turn off): **Highlight** (`highlight`) sticky-highlights a card's connections on click; **Expand** (`alt_route`) reveals *all* of a clicked card's neighbours; **Reveal parent** (`move_up`) and **Reveal children** (`move_down`) reveal only the clicked card's hierarchy parent / direct children (targeted, `parent_id`-based). All three delegate to the consumer (which holds the full graph) via `onNodeExpand` / `onNodeReveal`. Turning a Reveal tool off only stops click-to-reveal — the surfaced cards **persist so parent and child reveals can be layered in one view**, and clear only on re-center or Reset view (the consumer clears its reveal sets on `center` change / `onReset`). The Reveal tools appear only when the consumer passes `onNodeReveal` — the static TurboLens consumers omit them.

These are presentation/interaction concerns layered in the component — they do **not** change the layout-geometry engine (`layeredDependencyLayout.ts`), so every consumer of the view gets them for free.

**What the view is — and isn't**

- It **is** an opinionated, layered EA dependency view, inspired by ArchiMate's layering principle and the C4 Model's "good defaults, fewer choices" philosophy.
- It **is not** the [C4 Model](https://c4model.com) (Context / Container / Component / Code zoom levels of one system).
- It **is not** ArchiMate — there are no fixed stencils, formal relationship semantics, or viewpoints. Element vocabulary is driven by the admin-configurable metamodel.
- It **is not** UML, BPMN, or a deployment diagram.

**Rosetta stone**

| Layered Dependency View layer | Closest ArchiMate layer |
| --- | --- |
| Strategy & Transformation | Strategy + Motivation + Implementation & Migration |
| Business Architecture | Business |
| Application & Data | Application |
| Technical Architecture | Technology + Physical |

**Do's and don'ts (specific to this view)**

✅ Do
- Use the same view component everywhere a dependency graph is shown — consistency across Card Detail, Reports, and TurboLens is the whole point.
- Mark proposed/uncommitted cards with the dashed border + **NEW** badge so users can distinguish them at a glance.
- Use the relation type's `forward_label` for edges. If the relation has no label, fall back to the type key.

❌ Don't
- Don't introduce a fifth layer or reorder the four. Layer identity is part of the standard.
- Don't reuse this view for runtime / deployment / sequence diagrams — it is a *dependency* view of the EA metamodel, not a behavioural diagram.
- Don't substitute another graph library (vis.js, Cytoscape, mermaid) for the Layered Dependency View. Mermaid is still fine for one-off illustrative diagrams (e.g. ArchitectureDiagram in TurboLens reports), but the canonical interactive dependency view is React Flow + `c4Layout`.

---

## 4. Internationalization

Every user-visible string must use a translation key. See `CLAUDE.md` for the full i18n contract (12 namespaces × 8 locales). Token names live in code; **labels** live in `src/i18n/locales/{lang}/{namespace}.json`.

---

## 5. Accessibility

- WCAG AA color contrast — the named status tokens are pre-checked against white backgrounds. If you add a token, run a contrast check.
- Visible focus on every interactive element. Don't override the MUI focus ring without replacing it with something equally visible.
- Provide `aria-label` (translated) on icon-only buttons and `aria-labelledby` for chart regions.
- Don't communicate state with color alone — pair with an icon, a label, or text.

---

## 6. Do's and Don'ts

✅ Do
- Import status / severity / health / layer / card-type colors from `@/theme/tokens`.
- Use the MUI numeric spacing scale (`p: 2`, `gap: 1.5`).
- Reuse `MetricCard`, `ApprovalStatusBadge`, `LifecycleBadge`, `ReportShell`.
- Translate every user-visible string.

❌ Don't
- Hardcode hex codes (`#4caf50`, `#1976d2`) in feature components.
- Use pixel literals in `sx` for spacing (`gap: "4px"` ❌, `gap: 0.5` ✅).
- Re-declare local copies of `APPROVAL_STATUS_COLORS`, `PRIORITY_COLORS`, etc.
- Introduce new icon sizes outside the `iconSize` scale.
- Add new card types or fields in code — they live in the metamodel (admin UI / seed data).

---

## 7. Adding a New Token

1. Decide the **semantic** name. Status? Severity? Layer? Card type?
2. Add it to `src/theme/tokens.ts`. Use `as const`.
3. Add a row to the table in this doc (sec. 2).
4. If it's a status hue, also wire it into the MUI palette in `src/theme/index.ts`.
5. Confirm WCAG AA contrast against `#ffffff` and the dark `#1e1e1e` paper.

---

## 8. Related Files

- [`src/theme/tokens.ts`](./src/theme/tokens.ts) — design tokens
- [`src/theme/index.ts`](./src/theme/index.ts) — `buildTheme()` and re-exports
- [`src/components/MaterialSymbol.tsx`](./src/components/MaterialSymbol.tsx)
- [`src/features/reports/MetricCard.tsx`](./src/features/reports/MetricCard.tsx)
- [`src/features/reports/ReportShell.tsx`](./src/features/reports/ReportShell.tsx)
- [`src/components/ApprovalStatusBadge.tsx`](./src/components/ApprovalStatusBadge.tsx)
- [`src/components/LifecycleBadge.tsx`](./src/components/LifecycleBadge.tsx)
- Project conventions: [`../CLAUDE.md`](../CLAUDE.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
