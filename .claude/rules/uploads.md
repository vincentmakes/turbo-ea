---
paths:
  - "backend/app/services/attachment_validation.py"
  - "backend/app/services/card_logos.py"
  - "backend/app/api/v1/file_attachments.py"
  - "backend/app/api/v1/resources.py"
  - "frontend/src/lib/attachmentFormats.ts"
  - "frontend/src/features/admin/Resources*"
  - "backend/app/services/document_collab.py"
  - "backend/app/services/document_image*.py"
  - "backend/app/api/v1/document_images.py"
  - "frontend/src/lib/documentImageMarkup.ts"
  - "frontend/src/features/ea-delivery/documentImage*.ts"
  - "frontend/src/features/ea-delivery/RichTextEditor*"
---

# File uploads and attachment validation

> Loaded when you touch `backend/app/services/attachment_validation.py`, `backend/app/services/card_logos.py`, `backend/app/api/v1/file_attachments.py`, `backend/app/api/v1/resources.py`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

- **An upload is what its bytes say, not what the client calls it.** `file.content_type` is multipart metadata the client writes, so it decides nothing: `backend/app/services/attachment_validation.py` resolves the **extension** to a format, requires the leading bytes to prove the container, and stores that table's **canonical** MIME — never the browser's string, which is how `image/jpg` and `application/x-zip-compressed` used to split one format into two Resources filter rows. A signature identifies a container, not a format (every OOXML and ODF file is a zip; `.doc`/`.xls`/`.ppt`/`.msg` are all OLE2), so the extension tells family members apart and the signature is what stops a renamed executable — that is the honest limit of the check. The size cap (`MAX_ATTACHMENT_BYTES`, 20 MB) lives there too and is mirrored in **three** other places that must not drift: the edge nginx's `client_max_body_size` (deliberately *higher*, see below), `frontend/src/lib/attachmentFormats.ts` (the `accept=` list, the pre-upload checks and the filter sidebar all derive from it) and the manual. `tests/services/test_upload_limits.py` reads the Dockerfile, the chart, the Terraform files and the TS mirror off disk and fails on any disagreement — written because the last drift (nginx 5 MB vs. an advertised 10 MB) shipped a raw 413 to users and no test noticed. `card_logos.sniff_image_mime` is the same posture for card logos; `services` must not import from `api`, so the four image signatures are deliberately duplicated. Guard tests: `tests/services/test_attachment_validation.py`, `tests/api/test_file_attachments.py`.

## Pictures in decision and SoAW text (2.205.0)

A picture is uploaded once to `POST /api/v1/document-images/{adr|soaw}` into an immutable `document_images` row (migration 173) and the text holds only `<img src="/api/v1/document-images/<kind>/<uuid>" [alt] [title] [width] [height] [data-align]>`. Design record: `.trail/learnings/2026-11-14-pictures-in-decision-and-soaw-text-claude.md`. Invariants a change must not break:

- **One markup contract per side, byte-identical.** `backend/app/services/document_image_markup.py` and `frontend/src/lib/documentImageMarkup.ts` (with the editor's node, `features/ea-delivery/documentImageExtension.ts`) each define the route, the kept attributes and their order once. The server's canonical tag must equal the editor's output byte for byte, or every load of a document counts as an edit and adds a history version. Guards: `tests/services/test_document_image_markup.py`, `lib/documentImageMarkup.test.ts`, the byte-for-byte cases in `RichTextEditor.test.tsx`.
- **`document_collab.before_save` runs pictures → mentions → pictures**, re-running the mention pass when the last picture pass changed anything: removing a tag can splice its neighbours into a new mention or `<img>`. Guards: the splice cases in `test_document_image_markup.py`, `tests/services/test_document_collab.py`.
- **Rows are immutable and shared** by revisions, duplicates, history versions, restores and workspace transfer, so nothing deletes a row a save has stored (`used_at` set). The only delete is `document_image_service.purge_unused_once` (never-used rows past the grace). Guard: `tests/services/test_document_image_service.py`.
- **The GET sets no `Content-Disposition`** (it would class the route as a bulk export for `test_audit_log_guard.py`), sends the stored type with `nosniff`, and its path parameters are filled by the `world` fixture of `tests/api/test_read_scope_sentinel_sweep.py` — never added to its skipped-parameter list. Guard: `tests/api/test_document_images.py`.
- **The picture node is registered on read-only editors too**; an editor without it drops a stored picture on the next save. Guard: `RichTextEditor.test.tsx`.
- **SVG is never accepted**: pictures are served inline, so only PNG / JPEG / GIF / WebP decided by the leading bytes (`attachment_validation.sniff_raster_image`). Guard: `tests/api/test_document_images.py`.
- **The stored type is trusted only if it is one of the four.** The GET sends `mime_type` as the response type, so a row whose type is not in `attachment_validation.RASTER_IMAGE_MIME_TYPES` (derived from `_RASTER_IMAGES`; only an imported workspace bundle can hold one) answers the same 404 as an unknown id. Guard: `test_a_stored_row_of_another_type_is_404` in `tests/api/test_document_images.py`.
- **The 5 MB cap** (`MAX_DOCUMENT_IMAGE_MB`) is mirrored in `frontend/src/lib/attachmentFormats.ts` and pinned by `tests/services/test_upload_limits.py`.
