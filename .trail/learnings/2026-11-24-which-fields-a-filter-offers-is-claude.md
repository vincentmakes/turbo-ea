---
title: "Which fields a filter offers is decided in three layers: a section switch in the metamodel, what the person adds, and what a portal admin chooses for visitors…"
author: Claude
date: 2026-11-24
branch: claude/relaxed-pasteur-x0j2cs
cost: { minutes: 31, tokens: 210986 }
id: l-efaf44a3
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/reports/cardFilters.ts
  - backend/app/services/portal_card_filters.py
  - frontend/src/features/reports/CardFilterSection.tsx
  - frontend/src/features/admin/WebPortalsAdmin.tsx
  - backend/app/api/v1/web_portals.py
  - frontend/src/features/web-portals/portalViewerState.ts
---

## Decided
Discussion 1425 asked for text, number and date filters on web portals. The owner's answer, chosen on 24 November 2026 before any code was written:
- A metamodel section can be switched off for filters. Its fields are then hidden by default but a person can still add them with "Add filter". Reason: the switch exists to keep long field lists (the EU AI Act extension) out of the way, not to forbid filtering.
- Text, number and date fields become filterable in the same change (text and link fields: contains; number and percentage: a range; date: a range). They never show by default, so existing reports look the same.
- In reports, the fields a person added are part of that report's state: kept in the browser per report and stored in a saved report.
- On a portal, the admin chooses which filters visitors see, and a per-portal switch lets visitors add more. It is on by default. A visitor's added fields are remembered in their browser.
- One pull request with three stages. The Inventory sidebar is not part of it.

## Tried and ruled out
- A section switched off meaning "not filterable at all": then "Add filter" would have almost nothing to add.
- A per-field setting in the metamodel: the owner asked for the section level only.
- Remembering added fields on the user's account per card type, shared by every report: needs a new account preference and a rule for when a saved report and the personal list disagree.
- Visitors never allowed to add filters, or always allowed with no switch: the reporter wants portals for people who do not use the tool to stay fixed, the owner wants adding to work on portals too. The switch serves both.
- Storing the section switch with the "collapsed" and "hidden from detail" settings: those are stored by the section's position and are not moved when a section is deleted.

## Watch out
- The portal visitor bar never offered yes/no fields and only one value per field. "An existing portal looks the same" means that exact rule, not the reports' rule.
- The lists that feed colour-by, group-by and matching in reports are the same lists that fed the filter rows. The section switch must change the rows only.
- A portal only accepts a filter on a field its page shows, and never on a cost field. The count of results would otherwise reveal a hidden value.
- Left out and told to the owner: the Inventory sidebar offers a cost filter to people who cannot see costs; a portal's public data includes the labels and options of fields the admin hid; deleting a section leaves "collapsed" and "hidden from detail" pointing at the wrong section.

In the code:
- Section flag: `hideInFilters` on a section inside `fields_schema`.
- Rows and catalog: `frontend/src/lib/fieldFilters.ts`, `frontend/src/components/filters/`.
- Filter state: `filterFields` and `attrConditions` in `frontend/src/features/reports/cardFilters.ts`.
- Portal: `card_config.visitor_filters`, `card_config.visitor_can_add_filters`; `backend/app/services/portal_card_filters.py`, `portal_visibility.py`.
