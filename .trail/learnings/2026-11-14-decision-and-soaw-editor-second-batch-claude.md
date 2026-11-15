---
title: "Decision and SoAW editor, second batch: links, code, sub-heading, tables and diagrams on decisions — what the owner chose and why"
author: Claude
date: 2026-11-14
branch: claude/ecstatic-heisenberg-261dmo
cost: { minutes: 1, tokens: 3532 }
id: l-5f8aeef7
scope: repo
status: active
src: agent
touches:
  - frontend/src/lib/linkify.ts
  - frontend/src/layouts/AppLayout.tsx
  - frontend/src/features/ea-delivery/RichTextEditor.tsx
  - frontend/src/features/ea-delivery/docxHtml.ts
  - backend/app/services/adr_service.py
  - frontend/src/lib/richHtml.ts
---

## Decided
Settled with the owner on 2026-11-14, for the same PR as the pictures:
- Links on selected text in decision fields, SoAW sections and comments: a toolbar button and Ctrl/Cmd+K, with edit and remove. One link rule everywhere: http, https and mailto only; a typed bare host gets https.
- While editing, a click on a link places the caret and Ctrl/Cmd+click opens it. Ctrl/Cmd+K opens the link dialog inside an editable editor and the app's search everywhere else.
- Buttons for inline code (sections and comments), code block and a second heading level (sections only).
- Tables in decision and SoAW sections, with resizable columns and merged cells; never in comments. Word export writes a real table.
- A diagram on a decision is a reference to a free-draw diagram, stored the way a linked card is, never a copy. Deleting the diagram removes the reference. References can change on a draft and in review and are locked by signing. The editor and preview show thumbnail and name; print and Word list names; a reader without the diagrams permission sees nothing.
- The sanitiser for stored rich text also drops style tags, form and media tags, background attributes and every inline style except a table's pixel widths and a cell's text alignment.

## Tried and ruled out
- Custom sections on decisions, as a SoAW has: explored, then dropped by the owner for now. A decision's four text fields are named in many places (history snapshots, restore, discussion section chips, exports, the tool server, workspace transfer), and the mention and picture checks assume one string per field, so a list of sections would be skipped by them unless they are taught to walk it.
- A frozen copy of the diagram at signing: a second diagram store, a viewer for the copy and transfer of the copies; the owner chose the reference.
- Thumbnails in print and Word: a thumbnail is an SVG, which Word cannot show and which may not convert to a picture reliably.
- A separate PR for tables: the owner wanted one PR.

## Watch out
- The sanitiser for stored rich text is a deny-list on top of the library's defaults. Any tag or attribute the editor starts writing must be checked against it, and anything the editor stops writing can be added to it.
- A snapshot key named sections would be read as a SoAW snapshot by the history service, should custom sections on decisions come back.

In the code:
- Links: frontend/src/lib/linkify.ts (isStorableHref, normaliseLinkHref); frontend/src/layouts/AppLayout.tsx search shortcut; frontend/src/features/ea-delivery/RichTextEditor.tsx.
- Tables: @tiptap/extension-table pinned to 3.31.0; display rules in frontend/src/lib/documentContentCss.ts; Word in frontend/src/features/ea-delivery/docxHtml.ts.
- Diagrams: table architecture_decision_diagrams (migration 174); POST /adr/{id}/diagrams, DELETE /adr/{id}/diagrams/{diagram_id}; field linked_diagram_ids joins EDITABLE_IN_REVIEW in backend/app/services/adr_service.py.
- Sanitiser: frontend/src/lib/richHtml.ts; extension UI SDK stays 1.35.
