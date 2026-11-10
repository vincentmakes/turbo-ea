---
title: "A decision keeps its number across revisions and its standing is derived, never set by hand; revocation is itself a signed decision"
author: Claude
date: 2026-11-10
branch: claude/eager-keller-tj6i2d
cost: { minutes: 27, tokens: 273219 }
id: l-2570d391
scope: repo
status: active
replaces: l-a4bd9b5f
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/services/ai_service.py
  - backend/app/services/openai_chat.py
  - backend/tests/api/test_settings.py
  - backend/tests/services/test_ai_service.py
  - backend/tests/services/test_ai_service_insights.py
  - backend/tests/services/test_openai_chat.py
  - docs/admin/ai.ar.md
  - docs/admin/ai.da.md
---

## Decided
The owner settled the design for discussion #1376 (the decision register could not say what is in force):
- A revision keeps the decision's number. Number and revision stay two separate attributes, unique together, and are only combined for display (ADR-012 · Rev 2). Existing chains keep the numbers already issued.
- Standing (scheduled, in force, amended, superseded, revoked, expired) is derived at read time in one backend service from the revision chain, typed links between decisions, and the effective and valid-until dates. The sign-off status keeps its three values, because the extension SDK and every lock check depend on them.
- A decision stops being in force only through another signed decision (replaces, revokes) or a newer revision. There is no manual retire.
- A rejection no longer bumps the revision number: revisions count signed versions.
- Sending a decision or a SoAW for review locks its content; editing means recalling the signatures. Card links are filing and stay editable.
- Past decisions are recorded with a separate admin-only permission, stored as signed with a recorded marker and no signatures, and labelled as recorded.
- Decision makers and participants are named separately from signatories, as users or plain names.
- An amendment is brought into the text by a consolidated revision that names the amending decision and goes through sign-off.
- One pull request. Opus builds, Fable reviews the diff, CI carries the heavy checks.

## Tried and ruled out
- A new number per revision with a "superseded by" pointer (classic ADR practice): the owner wants a citation of ADR-012 to always resolve to the current text.
- Renumbering existing chains to their first number: it rewrites references people already quoted.
- A direct "retire" action (Ardoq sets Retired by hand): weaker governance for a review board.
- A fourth sign-off status for recorded decisions: it would break the lock checks, rollback and the extension SDK's documented three statuses.
- A consolidated text published without sign-off: unsigned text would be shown as in force.
- Inline images in the decision text, expiry reminders and importing recorded decisions: left out of this round.

## Watch out
- Revisions now share a reference, so anything matching on the reference alone (sign to-dos, the importer's "already exists" map) must match on the decision's id or resolve to the current revision.
- Lists must drop only earlier revisions, never the open draft revision, or a draft Rev 2 disappears from the register.
- A revoked or replaced decision must not be revisable, or a later revision has no defined standing.
- The download route for a decision file is seen as a bulk export by the audit-log guard; it joins the exemption list and the owner applies the ratchet label.
- Before this, a signed decision could be revised twice and the revisions listing then failed; a rejection bumped the revision number; related decisions held three shapes (ids, references, TurboLens assessment objects).

In the code:
- backend/app/services/revision_chain.py, decision_standing.py (new, the single definitions)
- backend/app/api/v1/adr.py, soaw.py; backend/app/services/adr_service.py
- backend/app/models/architecture_decision.py: unique (reference_number, revision_number) named uq_adr_reference_revision; related_decisions dropped in favour of architecture_decision_links
- backend/tests/services/test_audit_log_guard.py: NOT_A_BULK_EXPORT
- plan: one PR on branch claude/eager-keller-tj6i2d
