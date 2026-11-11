---
title: "The decision register cannot say what is in force: revisions are separate records with no forward pointer, and related decisions are stored but never shown"
author: Claude
date: 2026-11-10
branch: claude/eager-keller-tj6i2d
cost: { minutes: 4, tokens: 107978 }
id: l-a4bd9b5f
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/adr.py
  - backend/app/models/architecture_decision.py
  - backend/app/services/turbolens_commit.py
  - backend/app/services/seed_demo.py
  - backend/app/models/file_attachment.py
  - frontend/src/features/ea-delivery/ADREditor.tsx
  - docs/guide/grc.md
---

## Decided
Nothing is decided by the owner yet. This was an analysis of discussion #1376 (decisions: show what is in force when a decision changes or revokes earlier ones), with no code change. The analysis recommended, awaiting the owner's word: keep the sign-off status as it is and add one derived "standing" per decision (scheduled, in force, in force amended, superseded, revoked, expired), computed at read time in a single backend service from the revision chain, typed decision-to-decision links held in their own table and authored on the acting decision, and an effective date. Suggested order: revision banners and current-only lists first (no schema change), then typed links and standing, then decision makers, consolidated revisions and attachments.

Three questions were left with the owner: whether a new revision keeps its reference number, whether past decisions can be recorded as decided without in-app signatures, and whether a rejection should stop bumping the revision number.

## Tried and ruled out
Setting a superseded or revoked state by hand: it goes stale and the reporter asked for it to be derived. Modelling partial revocation clause by clause: a free-text scope note on an "amends" link covers it.

## Watch out
A signed decision can be revised twice, since nothing guards against a second draft, and the revisions listing then finds two children where it expects one (read from the code, not run). The frontend never calls that listing.
A rejection bumps the revision number on the same record, so "Revision 2" can mean "rejected once" and not "second signed version".
Related decisions hold mixed shapes: ids, reference numbers in the demo seed, and assessment objects written by the TurboLens commit.
The user manual already says the editor offers related decisions; no editor, preview or export renders them.
Past decisions cannot be backfilled: the importer creates drafts only and the signing date is always the moment of the last signature.
Attachments require a card, and the decision rich-text editor has no image support.
GitHub discussions have no MCP read tool in a cloud session; the public discussion page was read with WebFetch.

In the code:
- backend/app/api/v1/adr.py: revise_adr (no guard on an existing child), list_revisions (scalar_one_or_none on children), reject_adr (revision_number += 1), sign_adr (signed_at = now)
- backend/app/models/architecture_decision.py: related_decisions JSONB, parent_id, revision_number
- backend/app/services/turbolens_commit.py: related_decisions=[{"type": "assessment", ...}]
- backend/app/services/seed_demo.py: related_decisions as "ADR-001" strings
- backend/app/models/file_attachment.py: card_id not nullable
- frontend/src/features/ea-delivery/ADREditor.tsx, ADRPreview.tsx, AdrGrid.tsx: no forward pointer, no related decisions
- docs/guide/grc.md: "Related decisions — reference other ADRs"
