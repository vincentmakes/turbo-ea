---
title: "Which fields a filter offers is decided in three layers: a section switch in the metamodel, what the person adds, and what a portal admin chooses for visitors…"
author: Claude
date: 2026-11-24
branch: claude/relaxed-pasteur-x0j2cs
cost: { minutes: 63, tokens: 384900 }
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
  - backend/app/services/audit_changes.py
  - backend/tests/api/test_web_portals.py
  - backend/tests/api/test_web_portals_public_shaping.py
  - backend/tests/services/test_audit_changes.py
---

## Decided
Discussion 1425 asked for text, number and date filters on web portals. The owner's answer, chosen on 24 November 2026 before any code was written:
- A metamodel section can be switched off for filters. Its fields are then hidden by default but a person can still add them with "Add filter". Reason: the switch exists to keep long field lists (the EU AI Act extension) out of the way, not to forbid filtering.
- Text, number and date fields become filterable in the same change (text and link fields: contains; number and percentage: a range; date: a range). They never show by default, so existing reports look the same.
- In reports, the fields a person added are part of that report's state: kept in the browser per report and stored in a saved report.
- On a portal, the admin chooses which filters visitors see, and a per-portal switch lets visitors add more. It is on by default. A visitor's added fields are remembered in their browser.
- One pull request with three stages. The Inventory sidebar is not part of it.
- The server works out which filters a portal visitor sees and may use, and both the public page and the card list read that one answer. The page had been repeating the visibility rules by hand; a second hand-kept copy for filters is where the two would drift into a leak.
- The admin's list of visitor filters is stored only when it differs from the default. A field added to the metamodel later then still follows the default.
- An untouched portal keeps its old bar exactly: selects with options, never yes/no fields. The reports' rule (which includes yes/no) would have added filters to every existing portal.
- Old filter parameters on the public card list keep working, but only for filters the portal offers. When old and new parameters come together, both apply. Old tag links keep "any of these tags"; the new bar matches like the reports.
- A text that counts as a number has at most a two-digit exponent and 40 characters. Postgres reads 9e999 as a finite number and the browser reads it as infinity, so a wider rule let the two matchers disagree.
- A condition (text, number, date) applies only when its field is in the reader's own list of filterable fields. Otherwise a saved report or link with a cost condition would filter out of sight for a reader who cannot see costs.
- A field restored with a value counts as added. Without that the control disappeared while its box was being emptied.
- An over-long visitor filter is refused, not dropped. Dropped, the page showed every card under a bar that said filtered. Malformed JSON and malformed ids are still ignored.

## Tried and ruled out
- A section switched off meaning "not filterable at all": then "Add filter" would have almost nothing to add.
- A per-field setting in the metamodel: the owner asked for the section level only.
- Remembering added fields on the user's account per card type, shared by every report: needs a new account preference and a rule for when a saved report and the personal list disagree.
- Visitors never allowed to add filters, or always allowed with no switch: the reporter wants portals for people who do not use the tool to stay fixed, the owner wants adding to work on portals too. The switch serves both.
- Storing the section switch with the "collapsed" and "hidden from detail" settings: those are stored by the section's position and are not moved when a section is deleted.
- Changing the lists that pick facet fields so they skip hidden sections: the same lists feed colour-by, group-by and matching.
- A three-digit exponent in the number rule: see above.
- Removing a cost condition from a stored portal preset on save: the save has no field types to judge by. It is skipped when the query runs, and the dialog never offers cost fields.
- Writing the audit entry from the stored visitor list alone: with one side on the default it named the wrong filters. Both sides are resolved first.
- Putting the visitor filter logic in the route: route handlers are not covered by mutation testing here.

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
- The permission classifier refused deleting two unused strings from the nine non-English locale files, for the subagent and for the main session. English was cleaned; the other nine were left and the owner told.
- The translation step fills missing keys but does not remove keys English dropped.
- The API spec has to be regenerated locally when a route gains a parameter; it needs the backend installed in a virtualenv outside the repo.
- The stage subagents ran no tests by the owner's instruction (CI is the test run), so each stage's report lists what it was unsure of.
- A removable row appears for a field that only holds a value; Clear all on the PPM board still removes such a row.

- `backend/app/services/portal_visibility.py`: `visitor_filter_lists`, `publishable_filters`, `default_shown_filters` (twin: `defaultVisitorFilters` in `frontend/src/features/admin/webPortalFilters.ts`).
- `backend/app/services/portal_card_filters.py`: `public_visitor_conditions`, `restrict_visitor_filters`, `legacy_visitor_filters`, `condition_clauses`, `NUMBER_PATTERN`, `VisitorFiltersTooLongError`.
- `frontend/src/lib/fieldFilters.ts`: `appliedConditions`, `withActiveFilterFields`, `numericValueOf`.
- Spec: `<venv>/bin/python scripts/dump_openapi.py`.
