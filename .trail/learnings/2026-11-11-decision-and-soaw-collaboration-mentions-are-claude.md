---
title: "Decision and SoAW collaboration: mentions are stored without a name and resolved per reader, discussion and history live in two shared tables"
author: Claude
date: 2026-11-11
branch: claude/decision-collaboration
id: l-59f09051
scope: repo
status: active
src: agent
touches:
  - backend/app/services/mention_markup.py
---

## Decided
- A mention is stored as a nameless span (kind + id only). The server checks it on write and fills the name per reader on read, on every surface that returns decision or SoAW text, comments or history versions. A rename is therefore never an edit, and a card the reader may not see reads "Restricted card" with no id; an opaque HMAC token lets a hidden mention survive a later save by someone who cannot see it.
- Discussion and edit history are one layer for both document types: two tables with two nullable owner foreign keys and a check that exactly one is set, not a table per document type.
- The review lock covers content, not conversation: comments are allowed in review and after signing. A rejection reason opens a thread and a signing note becomes a comment, so neither is lost on recall.
- "Mentioned in" is a text search for the mention marker, with every hit confirmed by parsing, and it counts only a chain's current revision or its open draft.
- Comment notifications are created after the commit by the batch helper in a background task (as card approvals and surveys do), never inside the save.
- Review events (sent for review, signed, recalled, rejected) are published before the commit so they are stored.
- The discussion and timeline sections are the only workspace-transfer sections that carry created_at and keep an empty NOT NULL text cell as "".

## Tried and ruled out
- Storing the card name inside the mention: every rename would read as an edit in the history and the stored text would leak a name to a reader who may not see the card.
- An index table of mentions kept in step with the text: one more thing to keep consistent through restore, revise, import and transfer; the text search is enough at register size.
- A plain LIKE on the marker as the answer: text that merely contains the marker characters listed the decision under a card the writer could not read.
- Counting a mention in any revision of a chain: a mention removed in a later revision listed the decision for good.
- Creating bell rows inside the transaction and mailing afterwards: the batch helper creates the rows itself, so everyone got two entries; mailing inside held the transaction open across SMTP.
- Regexes with `.*?` across tags on user text: quadratic on hostile markup (a 100 KB body of `<span ` blocked the single backend process for seconds; 300 KB for a minute). Opening-tag scans use `[^<>]*` and the comment length cap is checked before any scan.
- Comments anchored to selected text, live co-editing and real-time push of comments: out of scope by the owner's decision.

## Watch out
- A span the strict grammar does not match (single quotes, upper case, other attribute order) must be normalised on write with html.parser, to a fixpoint, or the read path returns the writer's label untouched.
- A random value in a `parametrize` id (`str(uuid.uuid4())`) makes each pytest-xdist worker collect a different test name and stops the run; give such cases fixed `ids=`.
- `content IS NOT NULL` is wrong for a JSONB column that can hold JSON null (an import writes it); use `jsonb_typeof`.
- A signatory entry is not always a user id (demo and imported documents name people without an account); anything that treats the list as user ids must skip those.
- Migration 171 only backfills rows that exist when it runs; demo documents inserted later get the same timeline from `backfill_timelines`, whose planner must stay equal to the migration's frozen copy (a test compares them).

In the code: backend/app/services/mention_markup.py, mention_service.py, document_collab.py, document_discussion_service.py, document_history_service.py, workspace_io/entities.py (keep_empty_text, carry_timestamps), backend/alembic/versions/169-171, frontend/src/features/ea-delivery/collab/ and mentions/.
