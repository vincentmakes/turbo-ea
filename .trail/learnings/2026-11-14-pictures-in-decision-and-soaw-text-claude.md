---
title: "Pictures in decision and SoAW text are uploaded to their own store and referenced, never embedded; sections only, with resize and alignment, 5 MB each"
author: Claude
date: 2026-11-14
branch: claude/ecstatic-heisenberg-261dmo
cost: { minutes: 18, tokens: 230967 }
id: l-82d1fb72
scope: repo
status: active
src: agent
touches:
  - backend/app/services/document_collab.py
  - backend/app/services/mention_markup.py
  - frontend/src/features/ea-delivery/RichTextEditor.tsx
  - frontend/src/lib/richHtml.ts
  - frontend/src/lib/attachmentFormats.ts
  - backend/tests/services/test_upload_limits.py
---

## Decided
The owner asked for inline pictures in the rich-text sections of decisions (ADR) and SoAWs. Settled with the owner on 2026-11-14:
- Sections only. Discussion comments stay text-only.
- Editing abilities in the first version: insert by toolbar button, paste and drag-and-drop; resize by dragging; left / centre / right alignment. No alt-text field and no captions.
- 5 MB per picture; a larger one is refused, not shrunk.
- A picture is stored once, in its own table of immutable rows, and the text holds only a reference to it. Revisions, duplicates, history versions, restore, signed documents and workspace transfer then need no copying.
- The document kind is part of the picture's address, so the view permission is checked before any lookup. Reading a decision or a SoAW is a flat permission per kind with no per-document access list, so gating a picture by kind is the same as gating it by document.
- PNG, JPEG, GIF and WebP only, decided by the leading bytes (a pasted file often has no usable name). SVG is refused because pictures are served inline.
- A picture never stored by a save is deleted after 7 days by an hourly loop. Pictures of a deleted draft are kept in this version.
- Both the server (on every save) and the browser sanitiser keep a picture only when it points at the internal store, which also stops an external picture in a document from calling out from every reader's browser.

## Tried and ruled out
- Embedding the picture in the text as base64: history stores a full copy of the text on every draft save and revisions copy it again, so each picture would be multiplied; the only size ceiling would be the edge proxy's 21 MB request limit.
- Reusing the decision "Files" store: it serves downloads only, accepts SVG, lists every upload among the decision's files and exports, allows uploads on drafts only, and SoAWs have no such store.
- Finding unused pictures by scanning for references when a draft is deleted: a picture can be referenced from decision text, any SoAW section and any history snapshot, and restore depends on the snapshots; a scan that missed one would break restore. Left for a later version.
- A 24-hour grace before deleting never-used pictures: an editor left open overnight would lose a picture on its next save.
- Pictures in comments: the server deliberately escapes everything but basic formatting there, and comments are capped at 20,000 characters.

## Watch out
- Removing an invalid picture tag can join the text around it into a new mention, and removing an invalid mention can join text into a picture tag. The save must check pictures, then mentions, then pictures again.
- The server's canonical picture markup must match the editor's output byte for byte, or every load of a document counts as an edit and adds a history version.
- The editor must know the picture node even when read-only; an editor without it drops a stored picture on the next save.
- The picture download must not set Content-Disposition, or the audit-log guard classes it as a bulk export. Its path parameters must be filled by the read-scope sweep's fixture, not added to the sweep's list of skipped parameters, which only a maintainer may widen.
- The sanitiser must not add lazy loading: the print body goes through it and pictures below the fold would print blank.

In the code:
- Address: /api/v1/document-images/{adr|soaw}/{uuid}; table document_images; migration 173.
- Kept attributes in order: src, alt, title, width, height, data-align (center | right; absent = left).
- backend/app/services/document_collab.py before_save; backend/app/services/mention_markup.py is the model for the picture markup pass.
- frontend/src/features/ea-delivery/RichTextEditor.tsx; frontend/src/lib/richHtml.ts; @tiptap/extension-image pinned to 3.31.0 (its resize option is built in).
- Cap: MAX_DOCUMENT_IMAGE_MB = 5, mirrored in frontend/src/lib/attachmentFormats.ts and backend/tests/services/test_upload_limits.py.
