---
paths:
  - "frontend/src/features/diagrams/**"
  - "frontend/src/features/reports/LayeredDependency*"
  - "frontend/src/features/reports/layeredDependency*"
  - "frontend/src/features/reports/ldv*"
  - "frontend/src/features/cards/sections/LayeredDependency*"
  - "frontend/src/api/cardsByIds.ts"
  - "frontend/drawio-config/**"
---

# DrawIO diagrams and the Layered Dependency View

> Loaded when you touch `frontend/src/features/diagrams/**`, `frontend/src/features/reports/LayeredDependency*`, `frontend/src/features/reports/layeredDependency*`, `frontend/src/features/reports/ldv*`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

- **Dependency diagrams — Layered Dependency View (LDV)**: All dependency visualizations (Dependencies Report, Card Detail dependency section, TurboLens Architect target architecture) use Turbo EA's house notation, the **Layered Dependency View**. Cards are grouped into the four EA layers (Strategy & Transformation → Business Architecture → Application & Data → Technical Architecture) as swim lanes; nodes are colored by card type; edges follow metamodel `relation_type` direction with the forward label; proposed/uncommitted cards have a dashed border + green "NEW" badge. Inspired by ArchiMate's layering and the C4 Model's "good defaults" philosophy, but distinct from both — do **not** describe it as "C4" in user-facing strings or documentation. The renderer is `frontend/src/features/reports/LayeredDependencyView.tsx` + `layeredDependencyLayout.ts` (card-detail wrapper: `features/cards/sections/LayeredDependencySection.tsx`); reuse it for any new dependency view. The only surviving `c4` identifier is the toggle-button / saved-report `chartMode` value `"c4"`, kept so existing saved reports keep resolving — do not rename it, and do not reintroduce `C4*` names anywhere else. See `frontend/UI_GUIDELINES.md` § 3.10 for the full spec.
- **A diagram view must never clobber formatting the user applied by hand.** The perspective picker recolours card cells, so it has to be able to tell *its own* colours apart from a fill the user chose. `applyViewToGraph` stamps the pre-view `fillColor`/`strokeColor` onto each cell it takes over (`turboBaseFill` / `turboBaseStroke`, `-` sentinel when there was none) and `resetViewColors` restores **only** stamped cells, leaving everything else untouched. Rewriting every card cell to its card-type colour — the old behaviour — destroyed manual formatting on every save, because `saveDiagram` calls `setDiagram` and the view effect re-ran (#905, fixed in 2.38.2). That effect is now keyed on the diagram **id**, not the diagram object, so a save never re-runs the view or its `/cards?ids=` round-trip. Same principle for anything else that bulk-rewrites cell styles: stamp what you take over, restore what you stamped.

- **Fetching cards by id list goes through `fetchCardsByIds` (`frontend/src/api/cardsByIds.ts`) — never a hand-built `/cards?ids=` URL.** The bundled edge nginx runs the default `large_client_header_buffers 4 8k`, so a request line over 8 KB is refused with 414 before it reaches the backend; an encoded UUID costs 39 bytes, so 200 ids is the most one request carries (`CARD_IDS_CHUNK`). The diagram viewer built one URL for the whole canvas and, because the diagram fetch and the logo lookup shared a try/catch, reported the 414 as "Diagram not found"; the editor's view perspectives made the same request and silently lost logos, label rows and colours ([#1093](https://github.com/vincentmakes/turbo-ea/issues/1093), fixed in 2.134.2). The helper dedupes, chunks, forwards `signal` and is all-or-nothing; the viewer keeps the diagram fetch and the decoration in **separate** try blocks so a failed lookup falls back to the diagram as stored. `CardMultiPicker` and `excelExport` predate it and keep their own loops on purpose — both tolerate a failed chunk and return partial results. The MCP server has the same rule in Python: `TurboEAClient.get_cards_by_ids` (`mcp-server/turbo_ea_mcp/api_client.py`, `chunked` + `CARD_IDS_CHUNK`) — httpx percent-encodes the comma too, and the logo tools' previews used to swallow the 414 inside their degrade-not-fail blocks, so a raised `MCP_MAX_LOGOS_PER_CALL` silently disabled the type check. Guard tests: `frontend/src/api/cardsByIds.test.ts`, `features/diagrams/DiagramViewer.test.tsx`, `staleCheck.test.ts`, `mcp-server/tests/test_write_tools_logos.py::TestChunkedCardLookups`.
- **Collapsing an expanded card group is destructive — snapshot and confirm.** `collapseCardGroup` calls `removeCells`, taking every child and its connecting edges with it. `captureGroupChildLayout` snapshots each child's geometry + style into the expand cache immediately beforehand so `expandCardGroup` / `insertChildVertex` restore the user's own arrangement (via `ExpandChildData.layout`) instead of re-running the auto-layout, and `requestCollapseGroup` confirms first when the live layout differs from the baseline captured at expand time. The cache is a React ref, so it does not survive a reload — the confirmation, not the cache, is the real safety net.
- **DrawIO card shapes carry the card-type icon.** Cards inserted onto a DrawIO diagram (`frontend/src/features/diagrams/drawio-shapes.ts`) render their metamodel icon as a white glyph in the top-left corner via a `shape=label;image=...` style — baked into the single cell so it drags/exports with the shape (no child cells/overlays). The icon is a **vector SVG data-URI**, not the Material Symbols font, because font glyphs can't be reliably rasterised into images (the DrawIO iframe has no access to the app webfont — see `features/reports/reportExport.ts`). Path data lives in the **generated, committed** `frontend/src/features/diagrams/iconPaths.ts`, built from the curated picker set (`src/components/iconCatalog.ts`) by `npm run gen:diagram-icons` (sources: `@material-symbols/svg-400` + `@mui/icons-material` fallback for legacy names; both devDeps). Regenerate and commit `iconPaths.ts` when you add icon names to the catalogue — there is no pre-commit hook. The SVG URI is `encodeURIComponent`-encoded so it has no raw `;`/`=` and survives mxGraph's `;`/`=`-delimited style parser and the view-recolour helpers' `split(";")`.

## DrawIO Integration

### How It Works
1. **Build time**: Frontend Dockerfile clones `jgraph/drawio` v31.5.3
2. **Runtime**: Nginx serves DrawIO at `/drawio/` (same origin)
3. **Editor**: `DiagramEditor.tsx` loads DrawIO in a same-origin iframe
4. **Communication**: Direct DOM access to iframe's `mxGraph` API. Graph reference stored on `iframe.contentWindow.__turboGraph`

### Shape System (`src/features/diagrams/drawio-shapes.ts`)
Cards are represented as mxGraph cells with custom XML user objects:
```xml
<object label="App Name" factSheetId="uuid" factSheetType="Application" />
```

Key functions: `insertFactSheetIntoGraph()`, `insertPendingFactSheet()`, `markCellSynced()`, `expandFactSheetGroup()`, `scanDiagramItems()`, `stampEdgeAsRelation()`, `extractFactSheetIds()`

### Diagram Feature Components
- `DiagramSyncPanel.tsx` — Sync cards between diagram and EA inventory
- `CardSidebar.tsx` — Browse cards to drag onto diagram
- `CardPickerDialog.tsx` — Search and select cards
- `CreateOnDiagramDialog.tsx` — Create new cards directly from diagram shapes
- `RelationPickerDialog.tsx` — Create/manage relations from diagram edges
