---
title: "Relation description (#1284) was built and then dropped: do not rebuild it"
author: Claude
date: 2026-10-21
branch: feat/relations-richer-data
cost: { minutes: 107, tokens: 789439 }
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/metamodel.py
  - backend/app/services/card_completeness.py
  - backend/app/services/data_quality.py
  - backend/app/services/relation_orientation.py
  - backend/tests/api/test_approval_mandatory.py
  - backend/tests/api/test_metamodel.py
  - backend/tests/services/test_card_completeness.py
  - backend/tests/services/test_data_quality.py
---

## Decided
- The maintainer dropped #1284 (a UI for `relations.description`: edit popover, add-dialog batch field, caption on card detail and in the inventory relation editor, DrawIO edge `tooltip`, `sanitise_public_xml` stripping `tooltip`) from PR #1301 before merge, untested, on 2026-10-21. The column and the API field stay as they were; only the LDV hover shows a description today. A future "show relation descriptions" request needs the maintainer's explicit go-ahead, not a re-implementation from the old plan.
- PR #1301 keeps #1293 (relation attributes in mass edit) and #1296 (`subtypes[*].optional_relations`, per-subtype mandatory-relation exemption).

## Tried and ruled out
- Reverting hunk by hunk inside the two mixed commits: the branch was squashed onto main instead, with the #1284-only files restored from main and the two mixed files (`RelationsSection.tsx` and its test) rebuilt from main plus the #1296 hunks. Cheaper and leaves no half-reverted hunk.

## Watch out
- If `tooltip` is ever written onto a diagram edge again, `_PRIVATE_CELL_ATTRS` in `backend/app/api/v1/diagrams.py` must strip it: a published diagram would otherwise hand anonymous visitors the relation's free text.
