---
title: "A rejected or withdrawn decision or SoAW is recorded as an outcome beside its sign-off state, never as a new state, and the lifecycle is fixed rather than conf…"
author: Claude
date: 2026-11-27
branch: claude/focused-wright-euw8l3
cost: { minutes: 1, tokens: 2941 }
id: l-884bd606
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/adr.py
  - backend/app/services/adr_service.py
  - backend/app/services/revision_chain.py
---

## Decided
The owner settled the design for discussion #1433 (a rejection silently returned a decision to Draft; no way to cancel one) on 2026-11-27:
- The owner chose to leave the three sign-off values (draft, in review, signed) alone. A separate outcome on the document records Changes requested, Rejected or Withdrawn, with who, when and why. A document with an outcome is always a draft; Rejected and Withdrawn make it closed (locked, kept, reopened explicitly).
- A signatory gets two actions: Request changes (what Reject did before: back to an editable draft) and Reject (closes the document). The author side gets Withdraw and Reopen. Any single signatory can reject, as before.
- No Archived state: the register hides closed documents by default behind a switch. Superseded and Deprecated from the discussion already exist as derived standing (superseded, revoked, expired).
- Decisions and Statements of Architecture Work change together, in one pull request.
- A rejected or withdrawn revision remains its decision's open revision and is reopened to retry, so revision numbers count signed versions only and the revision-chain rules are not touched.
- Drafts whose last timeline step was a rejection are backfilled as Changes requested; old timeline rows read Rejected as written.
- Opus implements, Fable plans and reviews.

## Tried and ruled out
- New values in the sign-off column (rejected, cancelled, changes_requested), as the discussion literally proposes: every lock, delete, restore, rollback and revision rule treats "not signed" as "being worked on", and the extension SDK and MCP server document exactly three values.
- A customisable workflow (admin-defined states and transitions): the owner does not want it.
- Label only (mark a returned draft, no new actions): gives no terminal Rejected and no Withdraw.
- A manual archive flag: standing is derived and nothing is retired by hand.
- Keeping a closed revision as its own record and numbering the next attempt after it: signed revision numbers would get gaps and the chain rules would have to skip closed rows.

## Watch out
- The existing reject endpoint changes meaning (it closes the document); the old behaviour moves to a request-changes endpoint. Tests that pin "reject returns to draft" move with it.
- A closed revision blocks revising its signed parent (409 open revision exists); the way forward is Reopen, or delete.
- A closed decision can only be deleted with the delete permission; a closed SoAW must be reopened first because SoAW has no delete permission.
- The MCP server matches the backend's edit-refusal wording, so the two change together.
- GitHub discussions have no MCP read tool in a cloud session; the public page was read with a web fetch.

In the code:
- branch claude/focused-wright-euw8l3
- backend/app/services/review_outcome.py (new, the single definition of outcome and closed)
- backend/app/api/v1/adr.py, soaw.py; backend/app/services/adr_service.py, soaw_service.py, document_collab.py
- backend/app/services/revision_chain.py: deliberately unchanged
- migration 182_review_outcome.py: columns outcome, outcome_at, outcome_by, outcome_by_name, outcome_note on both tables
- frontend/src/features/ea-delivery/reviewOutcome.ts (new)
