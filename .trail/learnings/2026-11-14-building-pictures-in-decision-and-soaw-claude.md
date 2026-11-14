---
title: "Building pictures in decision and SoAW text: what the editor, the Word export and the import path each needed that the plan did not foresee"
author: Claude
date: 2026-11-14
branch: claude/ecstatic-heisenberg-261dmo
cost: { minutes: 46, tokens: 196062 }
id: l-a3cc171c
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/document_images.py
  - backend/app/services/attachment_validation.py
  - backend/tests/api/test_document_images.py
  - CHANGELOG.md
  - README.md
  - VERSION
  - backend/app/services/document_image_markup.py
  - backend/app/services/workspace_io/sections.py
  - backend/tests/services/test_workspace_io_id_bearing_columns.py
  - backend/tests/services/test_workspace_io_roundtrip.py
---

## Decided
- A locked (read-only) editor reports no edits at all. TipTap appends an empty paragraph after a final picture, list or rule on the first transaction, even a selection change, so a locked document used to report a change when someone clicked its picture.
- The picture route serves a row only when its stored type is PNG, JPEG, GIF or WebP. Uploads can only store those, but a workspace bundle can carry a row with any type, and the route sends the stored type inline from the app's own origin.
- A picture is a block, so it can sit inside a list item or a quote. The Word converter writes those as their text only, so it now writes each item's or quote's own pictures after its text.
- Aligning a picture stays available when file uploads are switched off: it edits the text, it uploads nothing.
- The server accepts an upper-case picture id and stores it lower-case; the editor does the same, so both sides agree on one spelling.

## Tried and ruled out
- Checking in jsdom that pictures load, resize or print: jsdom never loads an image, has no canvas and no createImageBitmap. Those paths were checked in a real browser instead (Playwright against a local backend and Vite).
- Re-checking picture bytes on workspace import: the read-side check on the stored type closes the hole without touching the importer.

## Watch out
- Byte-identical round trip holds on load only. A document ending in a picture gains a trailing empty paragraph on the first transaction in an editable editor, as a document ending in a list always did.
- The resize handles of the TipTap image extension are attached whatever the editor's state and only removed on a document change, so they are hidden with CSS when the editor is not editable.
- The sanitiser now drops external pictures, but stored text can still load external content through other tags (video, audio, source) and through a style attribute with a background URL. The editor produces none of these. Left open, reported to the owner.
- Registering a user for a local browser check: the email validator refuses reserved domains such as .test; example.com is accepted.

In the code:
- frontend/src/features/ea-delivery/RichTextEditor.tsx onUpdate guard (isEditable); EDITOR_IMAGE_SX hides [data-resize-handle] under contenteditable=false.
- backend/app/api/v1/document_images.py GET; attachment_validation.RASTER_IMAGE_MIME_TYPES.
- frontend/src/features/ea-delivery/docxHtml.ts nestedPictures.
- Local run: uvicorn app.main:app with POSTGRES_PORT=5433 POSTGRES_DB=<a database of its own>, npx vite --port 5173; frontend build needs NODE_OPTIONS=--max-old-space-size=6144 in this container.
