---
title: A card section saves with required fields still empty; only emptying a filled required field blocks Save
author: Claude
date: 2026-11-27
branch: claude/focused-ptolemy-m5fs1v
cost: { minutes: 15, tokens: 132354 }
id: l-896f699e
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/cards/sections/cardDetailUtils.tsx
  - backend/app/services/card_write_service.py
---

## Decided
Issue #1451: a section with two empty required fields could not be saved after filling only one. The editor blocked Save on any empty required field, including ones empty since creation, while the API only ever refused *clearing* a required field that had a value ("a card that is already incomplete stays editable"). The owner agreed to make the editor match the API: a field already empty and still empty gets a non-blocking hint; emptying a field that had a saved value blocks Save with an error. Data quality stays pinned at 0% and the banner still lists what is missing, so users are still pushed to complete the card.

## Tried and ruled out
Keeping the strict block and only rewording the message: it left users unable to save partial progress or edit optional fields in a section holding an unrelated empty required field, while card creation, imports and drag-fill all already allow incomplete cards.

## Watch out
The baseline for "cleared" is the card's saved attributes (card.attributes), the same values the server compares against, not the draft at edit start. Calculated, readonly, boolean and extension-locked fields stay exempt from both the hint and the block.

In the code:
- frontend/src/features/cards/sections/cardDetailUtils.tsx: requiredFieldState(field, saved, draft) -> "cleared" | "missing" | null; FieldEditor `hint` prop (testid field-hint-<key>)
- AttributeSection.tsx and DescriptionSection.tsx use it; keys validation:requiredCleared / requiredStillEmpty (requiredEmpty removed)
- backend/app/services/card_write_service.py: _check_required_not_cleared is the rule mirrored
