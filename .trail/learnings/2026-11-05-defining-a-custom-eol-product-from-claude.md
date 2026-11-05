---
title: "Defining a custom EOL product from a card is a quiet caption link under the search, always there for a manager, and the form opens with the card's name"
author: Claude
date: 2026-11-05
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 45, tokens: 291234 }
id: l-ed7cb0ab
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/CreateCardDialog.branches.test.tsx
  - CHANGELOG.md
  - backend/app/api/v1/ai_suggest.py
  - backend/app/api/v1/eol.py
  - backend/app/api/v1/reports.py
  - backend/app/schemas/ai_suggest.py
  - backend/app/schemas/eol_custom.py
  - backend/app/services/ai_service.py
  - backend/app/services/eol_custom_service.py
  - backend/app/services/eol_service.py
---

## Decided
The user found the info banner ("Not on endoflife.date? Define X as a custom product" with a Create button) too loud in a card's End of Life section. It is now one caption line under the product search: "Not on endoflife.date?" followed by an inline text link "Define it as a custom product…" for a user with eol.manage, shown whenever no product is selected. Anyone else sees the hint to ask an EOL manager, and only once endoflife.date has no match for what was typed or for the card's name. The create form's Product name opens with what was typed in the search, or the card's name when nothing was typed; in the Create-card dialog that is the name typed so far.

## Tried and ruled out
Keeping the "no upstream match" gate on the manager's link: a strong but wrong endoflife.date match for the card's name (a short name like "ERP") hid the only way to define the product. A quiet link needs no gate; the gate stays for the non-manager hint, which is advice and would otherwise flash while typing.

## Watch out
The demo dataset's "member" role carries eol.manage, so impersonating it never shows the non-manager hint; to see it in a browser, create a role from member's permissions with eol.manage false and impersonate that. The card page has no data-testid on the End of Life section; locate the accordion by its "End of Life" heading and expand it when the card is unlinked.

In the code:
- frontend/src/components/EolLinkSection.tsx (EolPicker): `canManage || noUpstream` renders the caption; `createFrom = typed || cardName` feeds `initialTitle`.
- Keys `eol.custom.notOnEolDate`, `eol.custom.createAction`, `eol.custom.askManager` in cards.json (no `{{name}}`).
- Tests: frontend/src/components/EolLinkSection.custom.test.tsx ("defining a custom product from the section", "the create form's name follows what was typed").
