---
title: "Sending a decision for review also locks its extension data, and a Statement of Architecture Work can only be deleted as a draft"
author: Claude
date: 2026-11-10
branch: claude/eager-keller-tj6i2d
cost: { minutes: 1, tokens: 2472 }
id: l-df238f1c
scope: repo
status: active
src: agent
touches:
  - frontend/src/lib/extensionHost.tsx
  - backend/app/api/v1/adr.py
  - backend/app/models/architecture_decision_person.py
  - backend/tests/services/test_role_key_column_widths.py
---

## Decided
- The review lock covers everything a signatory signs, extension data included: panels are read-only as soon as a decision leaves draft. The owner accepted that the private extensions must be adjusted, and that they must only consider a decision's last revision so nothing is counted once per revision.
- A decision's card links and a SoAW's initiative are filing, not content, so the review lock leaves them editable.
- Asking for signatures is only possible from a draft, because a second request during review reset the signatures already given.
- Deleting a SoAW follows the rule for decisions: drafts only, so a revision chain cannot lose a locked member.
- The column naming a person's part in a decision is called part, not role, because a guard treats every column named after a role as an app role key.

## Tried and ruled out
- Keeping extension data editable in review: figures the signatories approved could move after some of them had signed.
- Leaving SoAW deletion open to every state: a locked SoAW could disappear and break its revision chain.
- Joining a decision's revisions by their shared number: two unrelated decisions can carry the same number after a workspace import, so chains follow the parent link only.

## Watch out
- An extension panel written for the earlier contract checks the signed flag; it would show editable controls in review and then be refused. The read-only flag is the contract.
- The demo seed and a seeding script build decisions straight from dictionaries that carried related decisions; both break when that column goes unless they are moved to links first.

In the code:
- frontend/src/lib/extensionHost.tsx: readOnly on ADR panels; UI SDK 1.34
- backend/app/api/v1/adr.py, soaw.py: update, request-signatures and delete gates
- backend/app/models/architecture_decision_person.py: column part
- backend/tests/services/test_role_key_column_widths.py: the guard matching "role" in a column name
- repo vincentmakes/turbo-ea-extensions: extensions reading decisions
