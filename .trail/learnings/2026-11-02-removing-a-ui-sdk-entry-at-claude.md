---
title: Removing a UI SDK entry at a minor version breaks every installed extension built before it; the host checks only the SDK major
author: Claude
date: 2026-11-02
branch: claude/charming-wozniak-jamr5e
cost: { minutes: 8, tokens: 69928 }
id: l-3760eb2c
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/CreateCardDialog.mutation.test.tsx
  - frontend/src/components/EolLinkSection.mutation.test.tsx
  - frontend/src/components/FilterSelect.colours.test.tsx
  - frontend/src/components/NotificationBell.test.tsx
  - frontend/src/components/SearchDialog.test.tsx
  - frontend/src/components/SponsorshipDialog.colours.test.tsx
  - frontend/src/components/TimelineSlider.test.tsx
  - frontend/src/features/admin/CardLayoutEditor.test.tsx
  - frontend/src/features/admin/EolAdmin.test.tsx
  - frontend/src/features/admin/ResourcesFilterSidebar.test.tsx
---

## Decided
- "Extension X failed to render: <minified name> is not a function" after a core upgrade means the extension's bundle binds a `window.TurboEA.sdk` entry core no longer exposes. Diagnose from the extensions repo, not from core's diff: `git log -S <entry> -- extensions/<x>` finds the migration commit, and `git show <that>^:extensions/<x>/frontend/entry.js | grep "= ce.<entry>"` names the minified binding (Roadmap Studio 1.33.1: `ru = ce.useChartTheme`).
- The fix was to release the already-migrated extensions, not to change core: nine extensions moved to `loadECharts` on 2026-10-31 but only three had been tagged when the report came in.

## Tried and ruled out
- Blaming the core PR that shipped in the same upgrade (#1344): it touched no SDK file; the removal was #1340 (UI SDK 1.33, core 2.186.0), merged a day earlier.
- A core compatibility shim restoring `loadRecharts` / `useChartTheme`: offered, declined by the user in favour of extension releases.

## Watch out
- `UI_SDK_VERSION` is compared on the major only, so removing an entry at a minor is a silent break for installed extensions. The 1.32 changelog promised removal at SDK 2.0; 1.33 removed early. Next time, remove at a major, or keep a rejecting stub until then.
- The committed `frontend/entry.js` in the extensions repo is the current build, not what users run; the store serves the last *tagged* release.

In the code:
- core: frontend/src/lib/extensionHost.tsx (sdk object, UI_SDK_VERSION); removal commit 88dad61.
- extensions: extensions/<x>/frontend/src/sdk.js (every binding), migration commit bb131dc.
